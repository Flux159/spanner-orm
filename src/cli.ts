#!/usr/bin/env node

import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { Command, Option } from "commander";
import { generateCreateTablePostgres } from "./pg/ddl.js";
import { generateCreateTableSpanner } from "./spanner/ddl.js";
import type { TableConfig, Dialect } from "./types/common.js"; // Added Dialect

const MIGRATIONS_DIR = "./spanner-orm-migrations";

interface SchemaModule {
  [key: string]: TableConfig | unknown;
}

interface CliOptions {
  schema: string;
  dialect: Dialect;
}

interface DdlOptions {
  schema: string;
  dialect: Dialect;
  // Potentially other options like output path for DDL if not stdout
}

interface MigrateCreateOptions {
  name: string;
  // Potentially --schema to compare against, --outDir for migrations
}

// Helper to load schema and extract tables
async function loadSchemaTables(schemaPath: string): Promise<TableConfig[]> {
  const absoluteSchemaPath = path.resolve(process.cwd(), schemaPath);
  if (!fs.existsSync(absoluteSchemaPath)) {
    console.error(`Error: Schema file not found at ${absoluteSchemaPath}`);
    process.exit(1); // Exit early if schema not found
  }

  const schemaModule: SchemaModule = await import(absoluteSchemaPath);

  let tables: TableConfig[] = Object.values(schemaModule).filter(
    (exportedItem): exportedItem is TableConfig => {
      return !!(
        typeof exportedItem === "object" &&
        exportedItem !== null &&
        (exportedItem as any)._isTable === true
      );
    }
  );

  // If no tables found at top-level, check if they are nested under a 'schema' or 'tables' export
  if (tables.length === 0) {
    const nestedSchema = schemaModule.schema || schemaModule.tables;
    if (typeof nestedSchema === "object" && nestedSchema !== null) {
      tables = Object.values(nestedSchema).filter(
        (exportedItem): exportedItem is TableConfig => {
          return !!(
            typeof exportedItem === "object" &&
            exportedItem !== null &&
            (exportedItem as any)._isTable === true
          );
        }
      );
    }
  }

  if (tables.length === 0) {
    console.error(
      `No table definitions found in ${absoluteSchemaPath}. Ensure tables are exported directly or under a 'schema' or 'tables' object, and have the '_isTable' property.`
    );
    console.log("Detected exports:", Object.keys(schemaModule));
    process.exit(1);
  }
  return tables;
}

async function runDdlGenerator(options: DdlOptions, command: Command) {
  try {
    // command object is present due to commander action signature, may not be used.
    const tables = await loadSchemaTables(options.schema);
    const ddlOutputAr: string[] = [];

    if (options.dialect === "pg") {
      tables.forEach((table) => {
        ddlOutputAr.push(generateCreateTablePostgres(table));
      });
    } else if (options.dialect === "spanner") {
      tables.forEach((table) => {
        ddlOutputAr.push(generateCreateTableSpanner(table));
      });
    }
    console.log(ddlOutputAr.join("\n\n"));
  } catch (error) {
    // loadSchemaTables will exit if schema not found, so this catch is for other errors
    console.error(`Error processing schema or generating DDL:`);
    console.error(error);
    process.exit(1);
  }
}

function sanitizeMigrationName(name: string): string {
  return name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
}

async function handleMigrateCreate(
  name: string,
  options: Record<string, any>,
  command: Command
) {
  // command object is present due to commander action signature, may not be used.
  // const schemaPath = options.schema || "./src/schema.ts"; // Default or from option
  const migrationsDir = options.outDir || MIGRATIONS_DIR;

  try {
    await fsp.mkdir(migrationsDir, { recursive: true });

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T.]/g, "")
      .slice(0, 14); // YYYYMMDDHHMMSS
    const saneName = sanitizeMigrationName(name);
    const migrationFileName = `${timestamp}_${saneName}.ts`;
    const migrationFilePath = path.join(migrationsDir, migrationFileName);

    // TODO: T4.2 (Diffing) and T4.3 (Migration File Generation) will provide these.
    // For now, this is a template.
    const pgUpStatements: string[] = [
      `-- Migration UP for PostgreSQL: ${saneName}`,
      `-- Example: CREATE TABLE "example_table" ("id" SERIAL PRIMARY KEY);`,
    ];
    const pgDownStatements: string[] = [
      `-- Migration DOWN for PostgreSQL: ${saneName}`,
      `-- Example: DROP TABLE IF EXISTS "example_table";`,
    ];
    const spannerUpStatements: string[] = [
      `-- Migration UP for Spanner: ${saneName}`,
      `-- Example: CREATE TABLE example_table (id INT64 NOT NULL) PRIMARY KEY (id);`,
    ];
    const spannerDownStatements: string[] = [
      `-- Migration DOWN for Spanner: ${saneName}`,
      `-- Example: DROP TABLE example_table;`,
    ];

    const migrationFileContent = `// Migration: ${saneName}
// Generated at: ${new Date().toISOString()}
import type { Migration } from "spanner-orm"; // Assuming a type for migrations

export const up: Migration = {
  pg: async (db) => {
    // db is a PG client instance
${pgUpStatements
  .map((s) => `    // await db.query(\`${s.replace(/`/g, "\\`")}\`);`)
  .join("\n")}
    await db.query(\`${pgUpStatements[0].replace(/`/g, "\\`")}\`);
    // Add more DDL statements here for PostgreSQL
  },
  spanner: async (db) => {
    // db is a Spanner client instance
    // Spanner DDL statements are often run in batches
    // const [operation] = await db.updateSchema([
${spannerUpStatements
  .map((s) => `    //  \`${s.replace(/`/g, "\\`")}\`,`)
  .join("\n")}
    // ]);
    // await operation.promise();
    // For simplicity in template, let's assume single statements or user handles batching
    await db.updateSchema([\`${spannerUpStatements[0].replace(/`/g, "\\`")}\`]);
    // Add more DDL statements here for Spanner
  },
};

export const down: Migration = {
  pg: async (db) => {
${pgDownStatements
  .map((s) => `    // await db.query(\`${s.replace(/`/g, "\\`")}\`);`)
  .join("\n")}
    await db.query(\`${pgDownStatements[0].replace(/`/g, "\\`")}\`);
  },
  spanner: async (db) => {
    // await db.updateSchema([
${spannerDownStatements
  .map((s) => `    //  \`${s.replace(/`/g, "\\`")}\`,`)
  .join("\n")}
    // ]);
    await db.updateSchema([\`${spannerDownStatements[0].replace(
      /`/g,
      "\\`"
    )}\`]);
  },
};
`;

    await fsp.writeFile(migrationFilePath, migrationFileContent);
    console.log(`Created migration: ${migrationFilePath}`);
    console.log(
      `\nNote: This is a template. You'll need to fill in the actual DDL statements based on schema changes.`
    );
    console.log(
      `Future versions will auto-populate this from schema diffing (T4.2, T4.3).`
    );
  } catch (error) {
    console.error(`Error creating migration file for "${name}":`);
    console.error(error);
    process.exit(1);
  }
}

async function handleMigrateLatest(
  options: Record<string, any>,
  command: Command
) {
  // command object is present due to commander action signature, may not be used.
  const dialect = options.dialect as Dialect;
  if (!dialect) {
    console.error(
      "Error: --dialect (pg or spanner) is required for 'migrate latest'."
    );
    process.exit(1);
  }
  // TODO: Implement T4.4 'latest'
  // 1. Read MIGRATIONS_DIR
  // 2. Connect to DB (using adapter for dialect)
  // 3. Get list of applied migrations (T4.5 - Migration Tracking Table)
  // 4. Determine pending migrations
  // 5. Execute 'up' functions for pending migrations in order
  // 6. Update tracking table
  console.log(`Running 'migrate latest' for dialect: ${dialect}`);
  console.log("Migrations directory:", options.outDir || MIGRATIONS_DIR);
  console.log("Schema path (if provided for context):", options.schema);
  console.log(
    "This command is not yet fully implemented (depends on T4.1, T4.2, T4.3, T4.5)."
  );
}

async function handleMigrateDown(
  options: Record<string, any>,
  command: Command
) {
  // command object is present due to commander action signature, may not be used.
  const dialect = options.dialect as Dialect;
  if (!dialect) {
    console.error(
      "Error: --dialect (pg or spanner) is required for 'migrate down'."
    );
    process.exit(1);
  }
  // TODO: Implement T4.4 'down'
  // 1. Connect to DB
  // 2. Get last applied migration from tracking table (T4.5)
  // 3. Execute 'down' function for that migration
  // 4. Update tracking table
  console.log(`Running 'migrate down' for dialect: ${dialect}`);
  console.log("This command is not yet fully implemented (depends on T4.5).");
}

const program = new Command();

program
  .name("spanner-orm-cli")
  .description(
    "CLI tool for spanner-orm to generate DDL and manage migrations."
  );

// DDL Generation Command (existing functionality)
program
  .command("generate-ddl")
  .description("Generate DDL from schema definitions.")
  .requiredOption(
    "-s, --schema <path>",
    "Path to the schema file (e.g., ./dist/schema.js)"
  )
  .addOption(
    new Option("-d, --dialect <dialect>", "SQL dialect for DDL generation")
      .choices(["pg", "spanner"])
      .makeOptionMandatory(true)
  )
  .action(runDdlGenerator);

// Migration Command
const migrate = program
  .command("migrate")
  .description("Manage database migrations.");
// .option("-c, --config <path>", "Path to spanner-orm config file", "./spanner-orm.config.js") // Future use
// .option("--outDir <path>", "Directory for migration files", MIGRATIONS_DIR) // Common option for migrate subcommands

migrate
  .command("create <name>")
  .description("Create a new migration file.")
  // .option("-s, --schema <path>", "Path to the current schema file for diffing (optional for now)")
  .option("--outDir <path>", "Directory for migration files", MIGRATIONS_DIR)
  .action(handleMigrateCreate);

migrate
  .command("latest")
  .description("Run all pending migrations.")
  .requiredOption("--dialect <dialect>", "Database dialect (pg or spanner)")
  // .option("-s, --schema <path>", "Path to the schema file (optional, for context)")
  .option("--outDir <path>", "Directory for migration files", MIGRATIONS_DIR)
  .action(handleMigrateLatest);

migrate
  .command("down")
  .description("Revert the last applied migration.")
  .requiredOption("--dialect <dialect>", "Database dialect (pg or spanner)")
  .option("--outDir <path>", "Directory for migration files", MIGRATIONS_DIR)
  .action(handleMigrateDown);

// Make schema and dialect optional for the main program if subcommands handle them
// For now, let's keep the top-level options for the original DDL generator if called directly
// This part might need refinement based on how commander handles default commands or actions.
// If no command is specified, it might try to run a default action.
// To avoid ambiguity, it's often better to have specific commands for all actions.

// If the script is called without any subcommand, show help.
// Commander does this by default if no action is specified for the root program
// and no default command is set.

program.parseAsync(process.argv).catch((err) => {
  console.error("An unexpected error occurred in CLI:", err);
  process.exit(1);
});
