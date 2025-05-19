#!/usr/bin/env node

import path from "path";
import fs from "fs";
import { Command, Option } from "commander";
import { generateCreateTablePostgres } from "./pg/ddl.js";
import { generateCreateTableSpanner } from "./spanner/ddl.js";
import type { TableConfig } from "./types/common.js";

interface SchemaModule {
  [key: string]: TableConfig | unknown;
}

interface CliOptions {
  schema: string;
  dialect: "pg" | "spanner";
}

async function runDdlGenerator(options: CliOptions, command: Command) {
  // command parameter is added to match commander's action signature, though not used.
  const absoluteSchemaPath = path.resolve(process.cwd(), options.schema);

  if (!fs.existsSync(absoluteSchemaPath)) {
    console.error(`Error: Schema file not found at ${absoluteSchemaPath}`);
    process.exit(1);
  }

  try {
    const schemaModule: SchemaModule = await import(absoluteSchemaPath);

    const tables: TableConfig[] = Object.values(schemaModule).filter(
      (exportedItem): exportedItem is TableConfig => {
        if (
          typeof exportedItem === "object" &&
          exportedItem !== null &&
          exportedItem.hasOwnProperty("_isTable")
        ) {
          return (exportedItem as { _isTable?: boolean })._isTable === true;
        }
        return false;
      }
    );

    if (tables.length === 0) {
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
            item.hasOwnProperty("_isTable") &&
            (item as { _isTable?: boolean })._isTable === true
          ) {
            tables.push(item as TableConfig);
          }
        });
      }
    }

    if (tables.length === 0) {
      console.error(
        `No table definitions found in ${absoluteSchemaPath}. Ensure tables are exported and have a distinguishing property (e.g., '_isTable').`
      );
      console.log("Detected exports:", Object.keys(schemaModule));
      process.exit(1);
    }

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
    console.error(
      `Error loading or processing schema file ${absoluteSchemaPath}:`
    );
    console.error(error);
    process.exit(1);
  }
}

const program = new Command();

program
  .name("spanner-orm-cli")
  .description(
    "CLI tool for spanner-orm to manage schema, DDL, and migrations."
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
  .description("Manage database migrations");

migrate
  .command("create")
  .description("Create a new, empty migration file.")
  .requiredOption(
    "-n, --name <name>",
    "Name for the migration file (e.g., create_users_table)"
  )
  .action(async (options: { name: string }, command: Command) => {
    // command parameter is added to match commander's action signature
    const migrationsDir = path.resolve(process.cwd(), "migrations");
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
      console.log(`Created migrations directory at ${migrationsDir}`);
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T.]/g, "")
      .slice(0, 14); // YYYYMMDDHHMMSS

    const migrationFileName = `${timestamp}_${options.name.replace(
      /\s+/g,
      "_"
    )}.ts`;
    const migrationFilePath = path.join(migrationsDir, migrationFileName);

    const migrationFileContent = `// Migration: ${options.name}
// Created at: ${new Date().toISOString()}

export async function upPg(): Promise<string[]> {
  // Add your PostgreSQL DDL statements here
  // Example: return ["CREATE TABLE users (...);"];
  return [];
}

export async function downPg(): Promise<string[]> {
  // Add your PostgreSQL DDL statements to roll back here
  // Example: return ["DROP TABLE users;"];
  return [];
}

export async function upSpanner(): Promise<string[]> {
  // Add your Google Spanner DDL statements here
  // Example: return ["CREATE TABLE users (...) PRIMARY KEY (id);"];
  return [];
}

export async function downSpanner(): Promise<string[]> {
  // Add your Google Spanner DDL statements to roll back here
  // Example: return ["DROP TABLE users;"];
  return [];
}
`;

    fs.writeFileSync(migrationFilePath, migrationFileContent);
    console.log(`Created migration file: ${migrationFilePath}`);
  });

migrate
  .command("latest")
  .description("Apply all pending migrations. (Not yet implemented)")
  .option("-c, --config <path>", "Path to ORM configuration file (optional)")
  .action(async (options: { config?: string }, command: Command) => {
    // command parameter is added to match commander's action signature
    console.log("Applying latest migrations...");
    if (options.config) {
      console.log(`Using config file: ${options.config}`);
    }
    // Placeholder for actual migration logic
    console.log("Functionality for 'migrate latest' is not yet implemented.");
    // 1. Read migrations directory
    // 2. Determine pending migrations (e.g., by checking a migrations tracking table)
    // 3. Execute 'up' function for the configured dialect for each pending migration
    // 4. Update migrations tracking table
  });

migrate
  .command("down")
  .description("Roll back the last applied migration. (Not yet implemented)")
  .option("-c, --config <path>", "Path to ORM configuration file (optional)")
  .action(async (options: { config?: string }, command: Command) => {
    // command parameter is added to match commander's action signature
    console.log("Rolling back last migration...");
    if (options.config) {
      console.log(`Using config file: ${options.config}`);
    }
    // Placeholder for actual rollback logic
    console.log("Functionality for 'migrate down' is not yet implemented.");
    // 1. Determine the last applied migration from tracking table
    // 2. Execute 'down' function for that migration
    // 3. Update migrations tracking table
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("An unexpected error occurred in CLI:", err);
  process.exit(1);
});
