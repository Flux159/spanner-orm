#!/usr/bin/env node

import path from "path";
import fs from "fs/promises";
import { Command, Option } from "commander";
import { PostgresAdapter } from "./pg/adapter.js";
import { PgliteAdapter } from "./pglite/adapter.js";
import { SpannerAdapter } from "./spanner/adapter.js";
import type { DatabaseAdapter } from "./types/adapter.js";
// import { generateCreateTablePostgres } from "./pg/ddl.js"; // Will be handled by migration-generator
// import { generateCreateTableSpanner } from "./spanner/ddl.js"; // Will be handled by migration-generator
import { generateSchemaSnapshot } from "./core/snapshot.js";
import { generateSchemaDiff } from "./core/differ.js";
import {
  generateMigrationDDL, // Still used by handleDdlGeneration
  generateCombinedMigrationFileContent,
} from "./core/migration-generator.js";
// Unused migration-meta imports removed as this logic is now in migration-runner.ts
// import {
//   MIGRATION_TABLE_NAME,
//   getCreateMigrationTableDDL,
//   getAppliedMigrationNames,
//   recordMigrationApplied,
//   recordMigrationReverted,
// } from "./core/migration-meta.js";
import type {
  TableConfig,
  Dialect,
  SchemaSnapshot, // Added
  // MigrationExecutor, // No longer needed here
  // Dialect, // Removed duplicate
} from "./types/common.js";
import { OrmClient } from "./client.js"; // Added for programmatic migration

const MIGRATIONS_DIR = "spanner-orm-migrations";
const SNAPSHOT_FILENAME = "latest.snapshot.json"; // Added for snapshot management
const ORM_SNAPSHOT_VERSION = "1.0.0"; // Consistent with snapshot.ts

interface SchemaModule {
  [key: string]: TableConfig | unknown;
}

interface DdlOptions {
  schema: string;
  dialect: Dialect;
  output?: string;
}

interface MigrateLatestOptions {
  schema: string;
  // dialect: Dialect; // Will be determined by DB_DIALECT
  // Potentially add --dry-run later
}

interface MigrateDownOptions {
  schema: string;
  // dialect: Dialect; // Will be determined by DB_DIALECT
  // Potentially add --steps <number> later
}

interface MigrateCreateOptions {
  // Added interface for options
  schema: string;
}

async function ensureMigrationsDirExists() {
  try {
    await fs.mkdir(MIGRATIONS_DIR, { recursive: true });
  } catch (error) {
    console.error(
      `Error creating migrations directory ./${MIGRATIONS_DIR}:`,
      error
    );
    process.exit(1);
  }
}

function getTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:T.]/g, "")
    .slice(0, 14); // YYYYMMDDHHMMSS
}

// Modified to return a Record for snapshot generator
async function loadSchemaTablesMap(
  schemaPath: string
): Promise<Record<string, TableConfig>> {
  const absoluteSchemaPath = path.resolve(process.cwd(), schemaPath);
  if (!(await fs.stat(absoluteSchemaPath).catch(() => false))) {
    console.error(`Error: Schema file not found at ${absoluteSchemaPath}`);
    process.exit(1);
  }

  try {
    const schemaModule: SchemaModule = await import(absoluteSchemaPath);
    const tablesMap: Record<string, TableConfig> = {};
    const potentialTables: TableConfig[] = Object.values(schemaModule).filter(
      (exportedItem): exportedItem is TableConfig =>
        typeof exportedItem === "object" &&
        exportedItem !== null &&
        (exportedItem as { _isTable?: boolean })._isTable === true
    );

    potentialTables.forEach((table) => {
      if (table.tableName) {
        tablesMap[table.tableName] = table;
      }
    });

    if (Object.keys(tablesMap).length === 0) {
      // Attempt to find tables if nested under 'schema' or 'tables' export
      let schemaContainer: Record<string, unknown> | undefined;
      if (
        schemaModule.schema &&
        typeof schemaModule.schema === "object" &&
        schemaModule.schema !== null
      ) {
        schemaContainer = schemaModule.schema as Record<string, unknown>;
      } else if (
        schemaModule.tables &&
        typeof schemaModule.tables === "object" &&
        schemaModule.tables !== null
      ) {
        schemaContainer = schemaModule.tables as Record<string, unknown>;
      }

      if (schemaContainer) {
        Object.values(schemaContainer).forEach((item) => {
          if (
            typeof item === "object" &&
            item !== null &&
            (item as { _isTable?: boolean })._isTable === true &&
            (item as TableConfig).tableName
          ) {
            tablesMap[(item as TableConfig).tableName] = item as TableConfig;
          }
        });
      }
    }

    if (Object.keys(tablesMap).length === 0) {
      console.error(
        `No table definitions found in ${absoluteSchemaPath}. Ensure tables are exported, have an '_isTable: true' property, and a 'tableName' property.`
      );
      process.exit(1);
    }
    return tablesMap;
  } catch (error) {
    console.error(
      `Error loading or processing schema file ${absoluteSchemaPath}:`,
      error
    );
    process.exit(1);
  }
}

async function handleDdlGeneration(options: DdlOptions) {
  const tablesMap = await loadSchemaTablesMap(options.schema);
  const currentSnapshot = generateSchemaSnapshot(tablesMap);
  const emptySnapshot: SchemaSnapshot = {
    version: ORM_SNAPSHOT_VERSION,
    dialect: "common",
    tables: {},
  };
  const schemaDiff = generateSchemaDiff(emptySnapshot, currentSnapshot);
  // Pass currentSnapshot as the newSchemaSnapshot because the diff is from empty to current
  const ddlStatementsResult = generateMigrationDDL(
    schemaDiff,
    currentSnapshot,
    options.dialect
  );

  let outputDdl = "";
  if (options.dialect === "spanner") {
    // ddlStatementsResult is string[][] for Spanner
    const spannerDdlBatches = ddlStatementsResult as string[][];
    outputDdl = spannerDdlBatches
      .map((batch) => batch.join(";\n") + (batch.length > 0 ? ";" : "")) // Add semicolon to each statement in a batch
      .join("\n\n"); // Separate batches with double newline
  } else {
    // ddlStatementsResult is string[] for other dialects (e.g., Postgres)
    const pgDdlStatements = ddlStatementsResult as string[];
    outputDdl = pgDdlStatements.join("\n\n"); // Existing behavior for Postgres
  }

  if (options.output) {
    const outputPath = path.resolve(process.cwd(), options.output);
    try {
      await fs.writeFile(outputPath, outputDdl);
      console.log(`DDL output successfully written to ${outputPath}`);
    } catch (error) {
      console.error(`Error writing DDL to file ${outputPath}:`, error);
      process.exit(1);
    }
  } else {
    console.log(outputDdl);
  }
}

async function getDatabaseAdapter(): Promise<DatabaseAdapter | null> {
  const dbDialect = process.env.DB_DIALECT as Dialect | undefined;

  if (!dbDialect) {
    console.error(
      "Error: DB_DIALECT environment variable is not set. Please set it to 'postgres' or 'spanner'."
    );
    return null;
  }

  let adapter: DatabaseAdapter;

  try {
    if (dbDialect === "postgres") {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        console.error(
          "Error: DATABASE_URL environment variable is not set for postgres dialect."
        );
        return null;
      }
      if (
        databaseUrl.startsWith("postgres://") ||
        databaseUrl.startsWith("postgresql://")
      ) {
        adapter = new PostgresAdapter(databaseUrl);
      } else {
        // Assume PGlite if not a postgres connection string
        adapter = new PgliteAdapter(databaseUrl); // dataDir is the path
      }
    } else if (dbDialect === "spanner") {
      const projectId = process.env.SPANNER_PROJECT_ID;
      const instanceId = process.env.SPANNER_INSTANCE_ID;
      const databaseId = process.env.SPANNER_DATABASE_ID;

      if (!projectId || !instanceId || !databaseId) {
        console.error(
          "Error: SPANNER_PROJECT_ID, SPANNER_INSTANCE_ID, or SPANNER_DATABASE_ID environment variables are not set for spanner dialect."
        );
        return null;
      }
      adapter = new SpannerAdapter({
        projectId,
        instanceId,
        databaseId,
      });
    } else {
      console.error(
        `Error: Unsupported DB_DIALECT: ${dbDialect}. Must be 'postgres' or 'spanner'.`
      );
      return null;
    }

    console.log(`Connecting to ${dbDialect}...`);
    await adapter.connect();
    console.log(`Successfully connected to ${dbDialect}.`);
    return adapter;
  } catch (error) {
    console.error(`Error connecting to ${dbDialect}:`, error);
    return null;
  }
}

async function handleMigrateCreate(
  name: string,
  options: MigrateCreateOptions
) {
  await ensureMigrationsDirExists();
  const timestamp = getTimestamp();
  const baseFilename = `${timestamp}-${name}`;
  const snapshotFilePath = path.join(MIGRATIONS_DIR, SNAPSHOT_FILENAME);

  const tablesMap = await loadSchemaTablesMap(options.schema);
  const currentSnapshot = generateSchemaSnapshot(tablesMap);

  let previousSnapshot: SchemaSnapshot;
  try {
    const snapshotContent = await fs.readFile(snapshotFilePath, "utf-8");
    previousSnapshot = JSON.parse(snapshotContent) as SchemaSnapshot;
    if (previousSnapshot.version !== ORM_SNAPSHOT_VERSION) {
      console.warn(
        `Warning: Snapshot version mismatch. Expected ${ORM_SNAPSHOT_VERSION}, found ${previousSnapshot.version}. Proceeding with caution.`
      );
    }
    console.log(`Loaded previous schema snapshot from ${snapshotFilePath}`);
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.log(
        "No previous schema snapshot found. Assuming this is the first migration."
      );
    } else {
      console.warn(
        `Warning: Could not read or parse previous schema snapshot from ${snapshotFilePath}. Error: ${error.message}. Falling back to empty schema for diff.`
      );
    }
    previousSnapshot = {
      version: ORM_SNAPSHOT_VERSION,
      dialect: "common",
      tables: {},
    };
  }

  const upSchemaDiff = generateSchemaDiff(previousSnapshot, currentSnapshot);
  const downSchemaDiff = generateSchemaDiff(currentSnapshot, previousSnapshot);

  const migrationFileContent = generateCombinedMigrationFileContent(
    upSchemaDiff,
    downSchemaDiff,
    currentSnapshot,
    previousSnapshot
  );

  const migrationPath = path.join(MIGRATIONS_DIR, `${baseFilename}.ts`);
  let migrationGeneratedSuccessfully = false; // Default to false

  if (migrationFileContent === null) {
    console.log("No schema changes detected. Migration file not created.");
    // Snapshot should not be updated if no migration file is created
  } else {
    try {
      await fs.writeFile(migrationPath, migrationFileContent);
      console.log(`Created migration file: ${migrationPath}`);
      migrationGeneratedSuccessfully = true;
    } catch (error) {
      console.error(`Error creating migration file:`, error);
      // migrationGeneratedSuccessfully remains false
    }

    if (migrationGeneratedSuccessfully) {
      try {
        await fs.writeFile(
          snapshotFilePath,
          JSON.stringify(currentSnapshot, null, 2)
        );
        console.log(
          `Successfully saved current schema snapshot to ${snapshotFilePath}`
        );
      } catch (error) {
        console.error(
          `Error saving current schema snapshot to ${snapshotFilePath}:`,
          error
        );
        // Note: Migration file was created, but snapshot failed. This is a potential partial state.
        // Depending on desired atomicity, one might consider deleting the migration file here.
        // For now, we'll just log the error.
      }
    } else {
      console.error(
        "Migration file content was generated but could not be written to disk. Snapshot will not be updated."
      );
    }
  }
}

async function handleMigrateLatest(options: MigrateLatestOptions) {
  const { schema: schemaPath } = options;
  const adapter = await getDatabaseAdapter();

  if (!adapter) {
    console.error("Failed to initialize database adapter. Exiting.");
    process.exit(1);
  }
  const dialect = adapter.dialect; // Keep dialect for logging
  console.log(
    `Starting 'migrate latest' for dialect: ${dialect} using schema: ${schemaPath}`
  );

  // Create an OrmClient instance to use the new migrateLatest method
  const db = new OrmClient(adapter, dialect);

  try {
    // The migrationsPath option is not strictly needed here if we rely on the default
    // MIGRATIONS_DIR, which is what the CLI implicitly uses.
    // The OrmClient.migrateLatest method will use its default if options.migrationsPath is undefined.
    await db.migrateLatest({ migrationsPath: MIGRATIONS_DIR });
    console.log(
      "CLI: All pending migrations applied successfully via OrmClient."
    );
  } catch (error) {
    console.error("Error during migration process:", error);
    process.exit(1);
  } finally {
    if (adapter) {
      await adapter.disconnect();
      console.log("Database connection closed.");
    }
    console.log("Migrate latest process finished.");
  }
}

async function handleMigrateDown(options: MigrateDownOptions) {
  const { schema: schemaPath } = options;
  const adapter = await getDatabaseAdapter();

  if (!adapter) {
    console.error("Failed to initialize database adapter. Exiting.");
    process.exit(1);
  }
  const dialect = adapter.dialect; // Keep dialect for logging
  console.log(
    `Starting 'migrate down' for dialect: ${dialect} using schema: ${schemaPath}`
  );

  // Create an OrmClient instance to use the new migrateDown method
  const db = new OrmClient(adapter, dialect);

  try {
    // Similar to migrateLatest, using the default MIGRATIONS_DIR.
    await db.migrateDown({ migrationsPath: MIGRATIONS_DIR });
    console.log("CLI: Last migration successfully reverted via OrmClient.");
  } catch (error) {
    console.error("Error during migrate down process:", error);
    process.exit(1);
  } finally {
    if (adapter) {
      await adapter.disconnect();
      console.log("Database connection closed.");
    }
    console.log("Migrate down process finished.");
  }
}

const program = new Command();

program
  .name("spanner-orm-cli")
  .description("CLI tool for spanner-orm to manage DDL and migrations.");

program
  .command("ddl")
  .description("Generate DDL from schema definitions.")
  .requiredOption(
    "-s, --schema <path>",
    "Path to the schema file (e.g., ./dist/schema.js)"
  )
  .addOption(
    new Option("-d, --dialect <dialect>", "SQL dialect for DDL generation")
      .choices(["postgres", "spanner"] as const)
      .makeOptionMandatory(true)
  )
  .option("-o, --output <path>", "Optional path to write DDL output to a file.")
  .action(handleDdlGeneration);

const migrateCommand = program
  .command("migrate")
  .description("Manage database migrations.");

migrateCommand
  .command("create <name>")
  .description(
    "Create a new migration file (e.g., YYYYMMDDHHMMSS-name.ts) with dialect-specific up/down functions (migratePostgresUp, migrateSpannerUp, etc.), populating with DDL based on schema changes. The <name> should be descriptive, e.g., 'add-users-table'."
  )
  .requiredOption(
    // Added schema option
    "-s, --schema <path>",
    "Path to the current schema file (e.g., ./dist/schema.js)"
  )
  .action(handleMigrateCreate);

migrateCommand
  .command("latest")
  .description(
    "Apply all pending migrations. DB_DIALECT environment variable must be set."
  )
  .requiredOption(
    "-s, --schema <path>",
    "Path to the schema file (e.g., ./dist/schema.js)"
  )
  // Dialect option removed, will be inferred from DB_DIALECT
  .action(handleMigrateLatest);

migrateCommand
  .command("down")
  .description(
    "Revert the last applied migration. DB_DIALECT environment variable must be set."
  )
  .requiredOption(
    "-s, --schema <path>",
    "Path to the schema file (e.g., ./dist/schema.js)"
  )
  // Dialect option removed, will be inferred from DB_DIALECT
  .action(handleMigrateDown);

program.parseAsync(process.argv).catch((err) => {
  console.error("An unexpected error occurred in CLI:", err);
  process.exit(1);
});
