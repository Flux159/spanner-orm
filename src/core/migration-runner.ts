import path from "path";
import fs from "fs/promises";
import type { DatabaseAdapter } from "../types/adapter.js";
import type {
  Dialect,
  MigrationExecutor,
  MigrationExecuteSql,
} from "../types/common.js"; // Added MigrationExecuteSql
import {
  MIGRATION_TABLE_NAME,
  getCreateMigrationTableDDL,
  getAppliedMigrationNames,
  recordMigrationApplied,
  recordMigrationReverted,
} from "./migration-meta.js";

const MIGRATIONS_DIR_DEFAULT = "spanner-orm-migrations";
const MIGRATION_FILE_SUFFIX = ".ts"; // From cli.ts

interface QueryResultRow {
  [column: string]: any;
}
type QuerySqlFn = <T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
) => Promise<T[]>;

// Changed executeSql type to MigrationExecuteSql
async function ensureMigrationTable(
  executeSql: MigrationExecuteSql,
  dialect: Dialect
) {
  console.log(
    `Ensuring migration tracking table '${MIGRATION_TABLE_NAME}' exists...`
  );
  const createTableDdlStatements = getCreateMigrationTableDDL(dialect);
  for (const ddl of createTableDdlStatements) {
    try {
      await executeSql(ddl, []); // Pass empty array for params
    } catch (error: any) {
      if (
        (dialect === "spanner" &&
          error.message &&
          error.message.includes("AlreadyExists")) ||
        (dialect === "postgres" &&
          error.message &&
          error.message.includes("already exists"))
      ) {
        console.log(
          `Migration table '${MIGRATION_TABLE_NAME}' already exists.`
        );
      } else {
        console.error(
          `Error creating migration table '${MIGRATION_TABLE_NAME}':`,
          error
        );
        throw error;
      }
    }
  }
  console.log("Migration tracking table check complete.");
}

export async function runPendingMigrations(
  adapter: DatabaseAdapter,
  dialect: Dialect,
  migrationsDirectory: string = MIGRATIONS_DIR_DEFAULT
): Promise<void> {
  const executeCmdSql = adapter.execute.bind(adapter); // For DML operations
  const queryRowsSql = adapter.query.bind(adapter) as QuerySqlFn;

  // Use executeDDL for Spanner DDL, otherwise fallback to regular execute
  const ddlExecutor: MigrationExecuteSql =
    adapter.dialect === "spanner" && typeof adapter.executeDDL === "function"
      ? adapter.executeDDL.bind(adapter)
      : adapter.execute.bind(adapter);

  await ensureMigrationTable(ddlExecutor, dialect); // ensureMigrationTable uses DDL

  const appliedMigrationNames = await getAppliedMigrationNames(
    queryRowsSql,
    dialect
  );
  console.log(
    "Applied migrations:",
    appliedMigrationNames.length > 0 ? appliedMigrationNames : "None"
  );

  const absoluteMigrationsDir = path.resolve(
    process.cwd(),
    migrationsDirectory
  );
  try {
    await fs.access(absoluteMigrationsDir);
  } catch (e) {
    console.log(
      `Migrations directory ${absoluteMigrationsDir} does not exist. No migrations to run.`
    );
    return;
  }

  const allMigrationFiles = await fs.readdir(absoluteMigrationsDir);

  const pendingMigrations = allMigrationFiles
    .filter(
      (file) =>
        file.endsWith(MIGRATION_FILE_SUFFIX) &&
        !file.endsWith(".pg.ts") && // Exclude old pg-specific format
        !file.endsWith(".spanner.ts") && // Exclude old spanner-specific format
        !appliedMigrationNames.includes(file.replace(MIGRATION_FILE_SUFFIX, ""))
      // SNAPSHOT_FILENAME is not typically in this dir, but good to be aware if structure changes
    )
    .sort();

  if (pendingMigrations.length === 0) {
    console.log("No pending migrations to apply.");
    return;
  }

  console.log(
    `Found ${pendingMigrations.length} pending migrations:`,
    pendingMigrations
  );

  for (const migrationFile of pendingMigrations) {
    const migrationName = migrationFile.replace(MIGRATION_FILE_SUFFIX, "");
    console.log(`Applying migration: ${migrationFile}...`);
    // Ensure dynamic import path is absolute or correctly resolved
    const migrationPath = path.join(absoluteMigrationsDir, migrationFile);

    try {
      const migrationModule = (await import(migrationPath)) as Record<
        string,
        MigrationExecutor
      >;

      const upFunctionName =
        dialect === "postgres" ? "migratePostgresUp" : "migrateSpannerUp";
      const upFunction: MigrationExecutor | undefined =
        migrationModule[upFunctionName];

      if (typeof upFunction !== "function") {
        throw new Error(
          `Migration file ${migrationFile} does not export a suitable '${upFunctionName}' function for dialect ${dialect}.`
        );
      }
      // Pass ddlExecutor to upFunction for Spanner, executeCmdSql otherwise (though ddlExecutor falls back)
      await upFunction(ddlExecutor, dialect);
      // Recording migration is a DML operation (INSERT)
      await recordMigrationApplied(executeCmdSql, migrationName, dialect);
      console.log(`Successfully applied migration: ${migrationFile}`);
    } catch (error) {
      console.error(`Failed to apply migration ${migrationFile}:`, error);
      console.error("Migration process halted due to error.");
      throw error; // Re-throw to stop further processing and signal failure
    }
  }
  console.log("All pending migrations applied successfully.");
}

export async function revertLastMigration(
  adapter: DatabaseAdapter,
  dialect: Dialect,
  migrationsDirectory: string = MIGRATIONS_DIR_DEFAULT
): Promise<void> {
  const executeCmdSql = adapter.execute.bind(adapter); // For DML operations
  const queryRowsSql = adapter.query.bind(adapter) as QuerySqlFn;

  // Use executeDDL for Spanner DDL, otherwise fallback to regular execute
  const ddlExecutor: MigrationExecuteSql =
    adapter.dialect === "spanner" && typeof adapter.executeDDL === "function"
      ? adapter.executeDDL.bind(adapter)
      : adapter.execute.bind(adapter);

  // No need to ensure migration table for down, if it's not there, no migrations were applied.
  const appliedMigrationNames = await getAppliedMigrationNames(
    queryRowsSql,
    dialect
  );

  if (appliedMigrationNames.length === 0) {
    console.log(
      "No migrations have been applied for this dialect. Nothing to revert."
    );
    return;
  }

  const lastMigrationName =
    appliedMigrationNames[appliedMigrationNames.length - 1];
  const migrationFile = `${lastMigrationName}${MIGRATION_FILE_SUFFIX}`;
  console.log(`Attempting to revert migration: ${migrationFile}...`);

  const absoluteMigrationsDir = path.resolve(
    process.cwd(),
    migrationsDirectory
  );
  const migrationPath = path.join(absoluteMigrationsDir, migrationFile);

  try {
    await fs.access(migrationPath);
  } catch (e) {
    console.error(
      `Migration file ${migrationFile} not found in ${absoluteMigrationsDir}. Cannot revert.`
    );
    console.error(
      `This might indicate an issue with the migration log or missing migration files.`
    );
    throw new Error(`Migration file ${migrationFile} not found.`);
  }

  try {
    const migrationModule = (await import(migrationPath)) as Record<
      string,
      MigrationExecutor
    >;
    const downFunctionName =
      dialect === "postgres" ? "migratePostgresDown" : "migrateSpannerDown";
    const downFunction: MigrationExecutor | undefined =
      migrationModule[downFunctionName];

    if (typeof downFunction !== "function") {
      throw new Error(
        `Migration file ${migrationFile} does not export a suitable '${downFunctionName}' function for dialect ${dialect}.`
      );
    }

    // Pass ddlExecutor to downFunction for Spanner
    await downFunction(ddlExecutor, dialect);
    // Recording migration revert is a DML operation (DELETE)
    await recordMigrationReverted(executeCmdSql, lastMigrationName, dialect);
    console.log(`Successfully reverted migration: ${migrationFile}`);
  } catch (error) {
    console.error(`Failed to revert migration ${migrationFile}:`, error);
    console.error("Migration down process halted due to error.");
    throw error; // Re-throw to signal failure
  }
  console.log("Migrate down process finished.");
}
