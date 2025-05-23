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
import { generateMigrationDDL } from "./core/migration-generator.js";
import {
  MIGRATION_TABLE_NAME,
  getCreateMigrationTableDDL,
  getAppliedMigrationNames,
  recordMigrationApplied,
  recordMigrationReverted, // Now needed for migrate down
} from "./core/migration-meta.js";
import type {
  TableConfig,
  Dialect,
  SchemaSnapshot, // Added
  MigrationExecutor, // Now needed
  // Dialect, // Removed duplicate
} from "./types/common.js";

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

// interface MigrateCreateOptions {
//   name: string;
// }

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

const migrationFileTemplate = (dialect: Dialect): string => `
// Migration file for ${dialect}
// Generated at ${new Date().toISOString()}

import type { MigrationExecutor, Dialect } from "spanner-orm"; // Adjust path as needed

export const up: MigrationExecutor = async (executeSql, currentDialect) => {
  if (currentDialect === "${dialect}") {
    // UP_STATEMENTS_PLACEHOLDER
    console.log("Applying UP migration for ${dialect}...");
  }
};

export const down: MigrationExecutor = async (executeSql, currentDialect) => {
  if (currentDialect === "${dialect}") {
    // DOWN_STATEMENTS_PLACEHOLDER
    console.log("Applying DOWN migration for ${dialect}...");
  }
};
`;

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

function formatDdlForTemplate(
  ddlStatements: string[] | string[][],
  dialect: Dialect
): string {
  if (!ddlStatements || ddlStatements.length === 0) {
    return "    // No DDL statements generated for this migration.";
  }

  if (dialect === "spanner" && Array.isArray(ddlStatements[0])) {
    // It's string[][] for Spanner
    const batches = ddlStatements as string[][];
    let result = "";
    batches.forEach((batch, index) => {
      if (batches.length > 1) {
        result += `    // --- Batch ${index + 1} ---\n`;
      }
      result += batch
        .map(
          (stmt) => `    await executeSql(\`${stmt.replace(/`/g, "\\`")}\`);`
        )
        .join("\n");
      if (index < batches.length - 1) {
        result += "\n"; // Add a newline between batches if not the last one
      }
    });
    return result;
  } else {
    // It's string[] for PostgreSQL or Spanner (if not batched, though it should be)
    return (ddlStatements as string[])
      .map((stmt) => `    await executeSql(\`${stmt.replace(/`/g, "\\`")}\`);`)
      .join("\n");
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
    // Basic validation (optional, but good practice)
    if (previousSnapshot.version !== ORM_SNAPSHOT_VERSION) {
      console.warn(
        `Warning: Snapshot version mismatch. Expected ${ORM_SNAPSHOT_VERSION}, found ${previousSnapshot.version}. Proceeding with caution.`
      );
      // Potentially force empty if versions are incompatible, or attempt migration
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
      dialect: "common", // 'common' as it's a generic schema representation
      tables: {},
    };
  }

  // Diff for UP: from previous (or empty) to current
  const upSchemaDiff = generateSchemaDiff(previousSnapshot, currentSnapshot);
  // Diff for DOWN: from current to previous (or empty)
  const downSchemaDiff = generateSchemaDiff(currentSnapshot, previousSnapshot);

  const dialects: Dialect[] = ["postgres", "spanner"];
  let allMigrationsGeneratedSuccessfully = true;

  for (const dialect of dialects) {
    // For upDdl, newSchemaSnapshot is currentSnapshot (diff is previous -> current)
    const upDdl = generateMigrationDDL(upSchemaDiff, currentSnapshot, dialect);
    // For downDdl, newSchemaSnapshot is previousSnapshot (diff is current -> previous)
    const downDdl = generateMigrationDDL(
      downSchemaDiff,
      previousSnapshot,
      dialect
    );

    const formattedUpDdl = formatDdlForTemplate(upDdl, dialect);
    const formattedDownDdl = formatDdlForTemplate(downDdl, dialect);

    let template = migrationFileTemplate(dialect);
    template = template.replace("// UP_STATEMENTS_PLACEHOLDER", formattedUpDdl);
    template = template.replace(
      "// DOWN_STATEMENTS_PLACEHOLDER",
      formattedDownDdl
    );

    const migrationPath = path.join(
      MIGRATIONS_DIR,
      `${baseFilename}.${dialect === "postgres" ? "pg" : dialect}.ts`
    );

    try {
      await fs.writeFile(migrationPath, template);
      console.log(`Created ${dialect} migration file: ${migrationPath}`);
    } catch (error) {
      console.error(`Error creating ${dialect} migration file:`, error);
      allMigrationsGeneratedSuccessfully = false;
      // Do not exit immediately, allow other dialect generation to be attempted or reported.
    }
  }

  if (allMigrationsGeneratedSuccessfully) {
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
      // This is a non-fatal error for the migration creation itself, but should be logged.
    }
  } else {
    console.error(
      "One or more migration files could not be generated. Snapshot will not be updated."
    );
  }
}

async function handleMigrateLatest(options: MigrateLatestOptions) {
  const { schema: schemaPath } = options;
  const adapter = await getDatabaseAdapter();

  if (!adapter) {
    console.error("Failed to initialize database adapter. Exiting.");
    process.exit(1);
  }
  const dialect = adapter.dialect; // Get dialect from the adapter
  console.log(
    `Starting 'migrate latest' for dialect: ${dialect} using schema: ${schemaPath}`
  );

  const executeCmdSql = adapter.execute.bind(adapter);
  const queryRowsSql = adapter.query.bind(adapter);

  try {
    // Step 2: Ensure migration tracking table exists.
    console.log(
      `Ensuring migration tracking table '${MIGRATION_TABLE_NAME}' exists...`
    );
    const createTableDdlStatements = getCreateMigrationTableDDL(dialect);
    for (const ddl of createTableDdlStatements) {
      try {
        await executeCmdSql(ddl);
      } catch (error: any) {
        if (
          (dialect === "spanner" &&
            error.message &&
            error.message.includes("AlreadyExists")) ||
          (dialect === "postgres" && // Covers pg and pglite
            error.message &&
            error.message.includes("already exists"))
        ) {
          console.log(
            `Migration table '${MIGRATION_TABLE_NAME}' already exists.`
          );
        } else {
          throw error;
        }
      }
    }
    console.log("Migration tracking table check complete.");

    // Step 3: Get already applied migrations.
    const appliedMigrationNames = await getAppliedMigrationNames(
      queryRowsSql,
      dialect
    );
    console.log(
      "Applied migrations:",
      appliedMigrationNames.length > 0 ? appliedMigrationNames : "None"
    );

    // Step 4: Read all migration file names from MIGRATIONS_DIR.
    await ensureMigrationsDirExists();
    const allMigrationFiles = await fs.readdir(MIGRATIONS_DIR);
    const dialectSuffix = `.${dialect === "postgres" ? "pg" : dialect}.ts`;

    const pendingMigrations = allMigrationFiles
      .filter(
        (file) =>
          file.endsWith(dialectSuffix) &&
          !appliedMigrationNames.includes(file.replace(dialectSuffix, ""))
      )
      .sort();

    if (pendingMigrations.length === 0) {
      console.log("No pending migrations to apply.");
      return; // Early exit if no pending migrations
    }

    console.log(
      `Found ${pendingMigrations.length} pending migrations:`,
      pendingMigrations
    );

    // Step 5: Execute pending migrations.
    for (const migrationFile of pendingMigrations) {
      const migrationName = migrationFile.replace(dialectSuffix, "");
      console.log(`Applying migration: ${migrationFile}...`);
      const migrationPath = path.join(
        process.cwd(),
        MIGRATIONS_DIR,
        migrationFile
      );

      try {
        const migrationModule = (await import(migrationPath)) as {
          up: MigrationExecutor;
        };
        if (typeof migrationModule.up !== "function") {
          throw new Error(
            `Migration file ${migrationFile} does not export an 'up' function.`
          );
        }

        // Transaction handling can be complex and adapter-specific.
        // For simplicity, we'll assume individual statements are atomic or migrations handle their own transactions.
        // if (adapter.beginTransaction) await adapter.beginTransaction();
        await migrationModule.up(executeCmdSql, dialect);
        await recordMigrationApplied(executeCmdSql, migrationName, dialect);
        // if (adapter.commitTransaction) await adapter.commitTransaction();
        console.log(`Successfully applied migration: ${migrationFile}`);
      } catch (error) {
        // if (adapter.rollbackTransaction) await adapter.rollbackTransaction();
        console.error(`Failed to apply migration ${migrationFile}:`, error);
        console.error("Migration process halted due to error.");
        process.exit(1);
      }
    }

    console.log("All pending migrations applied successfully.");
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
  const dialect = adapter.dialect;
  console.log(
    `Starting 'migrate down' for dialect: ${dialect} using schema: ${schemaPath}`
  );

  const executeCmdSql = adapter.execute.bind(adapter);
  const queryRowsSql = adapter.query.bind(adapter);

  try {
    const appliedMigrationNames = await getAppliedMigrationNames(
      queryRowsSql,
      dialect
    );

    if (appliedMigrationNames.length === 0) {
      console.log(
        "No migrations have been applied for this dialect. Nothing to revert."
      );
      return; // Early exit
    }

    const lastMigrationName =
      appliedMigrationNames[appliedMigrationNames.length - 1];
    // No need to check !lastMigrationName as length > 0 is confirmed

    const dialectSuffix = `.${dialect === "postgres" ? "pg" : dialect}.ts`;
    const migrationFile = `${lastMigrationName}${dialectSuffix}`;
    console.log(`Attempting to revert migration: ${migrationFile}...`);

    const migrationPath = path.join(
      process.cwd(),
      MIGRATIONS_DIR,
      migrationFile
    );

    if (!(await fs.stat(migrationPath).catch(() => false))) {
      console.error(
        `Migration file ${migrationFile} not found in ./${MIGRATIONS_DIR}. Cannot revert.`
      );
      console.error(
        `This might indicate an issue with the migration log or missing migration files.`
      );
      process.exit(1);
    }

    try {
      const migrationModule = (await import(migrationPath)) as {
        down: MigrationExecutor;
      };
      if (typeof migrationModule.down !== "function") {
        throw new Error(
          `Migration file ${migrationFile} does not export a 'down' function.`
        );
      }

      // if (adapter.beginTransaction) await adapter.beginTransaction();
      await migrationModule.down(executeCmdSql, dialect);
      await recordMigrationReverted(executeCmdSql, lastMigrationName, dialect);
      // if (adapter.commitTransaction) await adapter.commitTransaction();
      console.log(`Successfully reverted migration: ${migrationFile}`);
    } catch (error) {
      // if (adapter.rollbackTransaction) await adapter.rollbackTransaction();
      console.error(`Failed to revert migration ${migrationFile}:`, error);
      console.error("Migration down process halted due to error.");
      process.exit(1);
    }
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
    "Create new migration files (one for each dialect), populating with DDL based on schema changes. The <name> should be descriptive, e.g., 'add-users-table'."
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
