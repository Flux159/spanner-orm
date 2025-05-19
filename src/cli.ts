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

async function runDdlGenerator(options: CliOptions) {
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
    "CLI tool for spanner-orm to generate DDL from schema definitions."
  )
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

program.parseAsync(process.argv).catch((err) => {
  console.error("An unexpected error occurred in CLI:", err);
  process.exit(1);
});
