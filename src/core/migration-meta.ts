// src/core/migration-meta.ts
import type { Dialect } from "../types/common.js";

export const MIGRATION_TABLE_NAME = "_spanner_orm_migrations_log";

// Type for the executeSql function (commands), matching MigrationExecutor's callback
type ExecuteSqlFn = (sql: string, params?: unknown[]) => Promise<void>;

// Type for a function that can query rows, based on DatabaseAdapter's query method
interface QueryResultRow {
  [column: string]: any;
}
type QuerySqlFn = <T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
) => Promise<T[]>;

/**
 * Returns the DDL statement(s) to create the migration tracking table if it doesn't exist.
 * @param dialect The SQL dialect.
 * @returns An array of DDL strings.
 */
export function getCreateMigrationTableDDL(dialect: Dialect): string[] {
  const tableName = MIGRATION_TABLE_NAME; // In Spanner, identifiers are case-sensitive if quoted.
  // For simplicity, using unquoted which defaults to uppercase.
  // PG is case-insensitive by default unless quoted.
  // Using the constant directly should be fine.

  if (dialect === "postgres") {
    return [
      `CREATE TABLE IF NOT EXISTS ${tableName} (
  name VARCHAR(255) NOT NULL,
  dialect VARCHAR(10) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (name, dialect)
);`,
    ];
  } else if (dialect === "spanner") {
    // Spanner does not support IF NOT EXISTS for CREATE TABLE in the same way.
    // The calling code (e.g., migrate latest) will need to handle potential "already exists" errors
    // or check for table existence using information_schema if a pure "create if not exists" is needed.
    // For now, this DDL assumes it's run when the table is known not to exist, or errors are handled.
    // A common pattern is to attempt creation and catch the "AlreadyExists" error.
    // However, for a migration system, it's often better to ensure it's created once.
    // Let's provide a simple CREATE TABLE. The runner must be idempotent or check.
    return [
      `CREATE TABLE ${tableName} (
  name STRING(255) NOT NULL,
  dialect STRING(10) NOT NULL,
  applied_at TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (name, dialect);`,
    ];
    // Note: Spanner's "IF NOT EXISTS" is typically handled by the client library or by checking INFORMATION_SCHEMA.
    // For a migration tool, the first migration run usually includes creating this table.
  }
  return [];
}

/**
 * Retrieves a sorted list of applied migration names for a given dialect.
 * @param executeSql The function to execute SQL queries.
 * @param dialect The SQL dialect.
 * @returns A promise that resolves to an array of migration names.
 */
export async function getAppliedMigrationNames(
  querySql: QuerySqlFn, // Changed to use QuerySqlFn
  dialect: Dialect
): Promise<string[]> {
  const tableName = MIGRATION_TABLE_NAME;
  const selectSql =
    dialect === "postgres"
      ? `SELECT name FROM ${tableName} WHERE dialect = $1 ORDER BY applied_at ASC, name ASC;`
      : `SELECT name FROM ${tableName} WHERE dialect = @p1 ORDER BY applied_at ASC, name ASC;`;

  try {
    const result = await querySql<{ name: string }>(selectSql, [dialect]);
    return result.map((row) => row.name);
  } catch (error) {
    // If the table doesn't exist, it's a common scenario for the first migration.
    // Specific error codes/messages depend on the database and driver.
    // For example, PostgreSQL might throw an "undefined_table" error (code 42P01).
    // Spanner might throw a "Table not found" error.
    // This basic catch logs a warning and returns an empty array, assuming no migrations applied.
    // A more robust solution would inspect the error type.
    const errorMsg = error instanceof Error ? error.message.toLowerCase() : "";
    if (
      errorMsg.includes("does not exist") ||
      errorMsg.includes("not found") ||
      errorMsg.includes("undefined_table")
    ) {
      console.log(
        `Migration tracking table '${tableName}' not found. Assuming no migrations applied yet.`
      );
      return [];
    }
    console.error(
      `Error querying applied migration names from ${tableName}:`,
      error
    );
    throw error; // Re-throw other errors
  }
}

/**
 * Records a migration as having been applied.
 * @param executeSql The function to execute SQL queries.
 * @param migrationName The name of the migration (e.g., YYYYMMDDHHMMSS-description).
 * @param dialect The SQL dialect.
 */
export async function recordMigrationApplied(
  executeSql: ExecuteSqlFn,
  migrationName: string,
  dialect: Dialect
): Promise<void> {
  const tableName = MIGRATION_TABLE_NAME;
  const appliedAtValue =
    dialect === "spanner" ? "PENDING_COMMIT_TIMESTAMP()" : "CURRENT_TIMESTAMP";
  const insertSql =
    dialect === "postgres"
      ? `INSERT INTO ${tableName} (name, dialect, applied_at) VALUES ($1, $2, ${appliedAtValue});`
      : `INSERT INTO ${tableName} (name, dialect, applied_at) VALUES (@p1, @p2, ${appliedAtValue});`;

  await executeSql(insertSql, [migrationName, dialect]);
}

/**
 * Records a migration as having been reverted (removes its record).
 * @param executeSql The function to execute SQL queries.
 * @param migrationName The name of the migration to remove.
 * @param dialect The SQL dialect.
 */
export async function recordMigrationReverted(
  executeSql: ExecuteSqlFn,
  migrationName: string,
  dialect: Dialect
): Promise<void> {
  const tableName = MIGRATION_TABLE_NAME;
  const deleteSql =
    dialect === "postgres"
      ? `DELETE FROM ${tableName} WHERE name = $1 AND dialect = $2;`
      : `DELETE FROM ${tableName} WHERE name = @p1 AND dialect = @p2;`;

  await executeSql(deleteSql, [migrationName, dialect]);
}
