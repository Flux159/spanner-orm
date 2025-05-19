#!/usr/bin/env node

import path from "path";
import fs from "fs/promises";
import { Command, Option } from "commander";
import { generateCreateTablePostgres } from "./pg/ddl.js";
import { generateCreateTableSpanner } from "./spanner/ddl.js";
import type {
  TableConfig,
  Dialect,
  // MigrationExecutor,
} from "./types/common.js";

const MIGRATIONS_DIR = "spanner-orm-migrations";

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
  dialect: Dialect;
  // Potentially add --dry-run later
}

interface MigrateDownOptions {
  schema: string;
  dialect: Dialect;
  // Potentially add --steps <number> later
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
    // Add your ${dialect} UP migration statements here
    // Example: await executeSql(\`CREATE TABLE my_new_table (...)\`);
    console.log("Applying UP migration for ${dialect}...");
  }
};

export const down: MigrationExecutor = async (executeSql, currentDialect) => {
  if (currentDialect === "${dialect}") {
    // Add your ${dialect} DOWN migration statements here
    // Example: await executeSql(\`DROP TABLE my_new_table\`);
    console.log("Applying DOWN migration for ${dialect}...");
  }
};
`;

async function loadSchemaTables(schemaPath: string): Promise<TableConfig[]> {
  const absoluteSchemaPath = path.resolve(process.cwd(), schemaPath);
  if (!(await fs.stat(absoluteSchemaPath).catch(() => false))) {
    console.error(`Error: Schema file not found at ${absoluteSchemaPath}`);
    process.exit(1);
  }

  try {
    const schemaModule: SchemaModule = await import(absoluteSchemaPath);
    const tables: TableConfig[] = Object.values(schemaModule).filter(
      (exportedItem): exportedItem is TableConfig =>
        typeof exportedItem === "object" &&
        exportedItem !== null &&
        (exportedItem as { _isTable?: boolean })._isTable === true
    );

    if (tables.length === 0) {
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
            (item as { _isTable?: boolean })._isTable === true
          ) {
            tables.push(item as TableConfig);
          }
        });
      }
    }

    if (tables.length === 0) {
      console.error(
        `No table definitions found in ${absoluteSchemaPath}. Ensure tables are exported and have an '_isTable: true' property.`
      );
      process.exit(1);
    }
    return tables;
  } catch (error) {
    console.error(
      `Error loading or processing schema file ${absoluteSchemaPath}:`,
      error
    );
    process.exit(1);
  }
}

async function handleDdlGeneration(options: DdlOptions) {
  const tables = await loadSchemaTables(options.schema);
  const ddlStatements: string[] = [];

  if (options.dialect === "postgres") {
    tables.forEach((table) =>
      ddlStatements.push(generateCreateTablePostgres(table))
    );
  } else if (options.dialect === "spanner") {
    tables.forEach((table) =>
      ddlStatements.push(generateCreateTableSpanner(table))
    );
  }

  const outputDdl = ddlStatements.join("\n\n");

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

async function handleMigrateCreate(name: string, _options: {}) {
  await ensureMigrationsDirExists();
  const timestamp = getTimestamp();
  const baseFilename = `${timestamp}-${name}`;

  const pgMigrationPath = path.join(MIGRATIONS_DIR, `${baseFilename}.pg.ts`);
  const spannerMigrationPath = path.join(
    MIGRATIONS_DIR,
    `${baseFilename}.spanner.ts`
  );

  try {
    await fs.writeFile(pgMigrationPath, migrationFileTemplate("postgres"));
    console.log(`Created PostgreSQL migration file: ${pgMigrationPath}`);

    await fs.writeFile(spannerMigrationPath, migrationFileTemplate("spanner"));
    console.log(`Created Spanner migration file: ${spannerMigrationPath}`);
  } catch (error) {
    console.error("Error creating migration files:", error);
    process.exit(1);
  }
}

async function handleMigrateLatest(options: MigrateLatestOptions) {
  console.log(
    `Simulating 'migrate latest' for dialect: ${options.dialect} using schema: ${options.schema}`
  );
  console.log("This command will eventually: ");
  console.log("1. Load the schema definition.");
  console.log("2. Check the database for the current migration state (T4.5).");
  console.log("3. Read migration files from ./${MIGRATIONS_DIR}.");
  console.log("4. Determine pending migrations.");
  console.log(
    "5. Execute pending migrations in order for the specified dialect."
  );
  // Actual implementation requires T4.1, T4.2, T4.3 (partially done by create), T4.5
}

async function handleMigrateDown(options: MigrateDownOptions) {
  console.log(
    `Simulating 'migrate down' for dialect: ${options.dialect} using schema: ${options.schema}`
  );
  console.log("This command will eventually: ");
  console.log("1. Check the database for the last applied migration (T4.5).");
  console.log(
    "2. Read the corresponding migration file from ./${MIGRATIONS_DIR}."
  );
  console.log(
    "3. Execute the 'down' function from that migration file for the specified dialect."
  );
  // Actual implementation requires T4.5
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
    "Create new migration files (one for each dialect). The <name> should be descriptive, e.g., 'add-users-table'."
  )
  .action(handleMigrateCreate);

migrateCommand
  .command("latest")
  .description("Apply all pending migrations.")
  .requiredOption(
    "-s, --schema <path>", // Schema might be needed for context or validation
    "Path to the schema file (e.g., ./dist/schema.js)"
  )
  .addOption(
    new Option("-d, --dialect <dialect>", "SQL dialect to apply migrations for")
      .choices(["postgres", "spanner"] as const)
      .makeOptionMandatory(true)
  )
  .action(handleMigrateLatest);

migrateCommand
  .command("down")
  .description("Revert the last applied migration.")
  .requiredOption(
    "-s, --schema <path>", // Schema might be needed for context or validation
    "Path to the schema file (e.g., ./dist/schema.js)"
  )
  .addOption(
    new Option("-d, --dialect <dialect>", "SQL dialect to revert migration for")
      .choices(["postgres", "spanner"] as const)
      .makeOptionMandatory(true)
  )
  .action(handleMigrateDown);

program.parseAsync(process.argv).catch((err) => {
  console.error("An unexpected error occurred in CLI:", err);
  process.exit(1);
});
