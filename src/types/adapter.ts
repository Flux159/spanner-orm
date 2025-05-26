// src/types/adapter.ts
import type { Dialect } from "./common.js"; // Dialect is imported here

// Re-export Dialect if it's meant to be available via this module,
// or ensure client.ts imports it directly from common.ts
export type { Dialect }; // Re-exporting Dialect

export interface QueryResultRow {
  [column: string]: any;
}

/**
 * Represents an active database transaction.
 */
export interface Transaction {
  /**
   * Executes a SQL command within the transaction.
   */
  execute(
    sql: string,
    params?: unknown[],
    spannerTypeHints?: Record<
      string,
      { code: string; arrayElementType?: { code: string } }
    >
  ): Promise<number | AffectedRows>; // Changed to return affected rows/count

  /**
   * Executes a SQL query within the transaction.
   */
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
    spannerTypeHints?: Record<
      string,
      { code: string; arrayElementType?: { code: string } }
    >
  ): Promise<T[]>;

  /**
   * Commits the transaction.
   */
  commit(): Promise<void>;

  /**
   * Rolls back the transaction.
   */
  rollback(): Promise<void>;
}

export interface AffectedRows {
  // Ensure AffectedRows is defined or imported if it's from elsewhere
  count: number;
}

export interface DatabaseAdapter {
  dialect: Dialect;

  /**
   * Connects to the database.
   */
  connect(): Promise<void>;

  /**
   * Disconnects from the database.
   */
  disconnect(): Promise<void>;

  /**
   * Executes a SQL command (e.g., INSERT, UPDATE, DELETE, DDL).
   * For INSERT, UPDATE, DELETE, it should ideally return the number of affected rows.
   * For DDL or other commands, it might return void or a specific status.
   * @param sql The SQL string to execute.
   * @param params Optional array of parameters for prepared statements.
   * @returns A promise that resolves to the number of affected rows or void.
   */
  execute(
    sql: string,
    params?: unknown[] | { [key: string]: string },
    spannerTypeHints?: Record<
      string,
      { code: string; arrayElementType?: { code: string } }
    >
  ): Promise<number | AffectedRows>; // Modified to return count/AffectedRows

  /**
   * Executes a SQL query that returns rows.
   * @param sql The SQL string to query.
   * @param params Optional array of parameters for prepared statements.
   * @returns A promise that resolves to an array of result rows.
   */
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
    spannerTypeHints?: Record<
      string,
      { code: string; arrayElementType?: { code: string } }
    >
  ): Promise<T[]>;

  /**
   * Executes a DML statement (INSERT, UPDATE, DELETE) and returns the affected/returned rows.
   * This is particularly useful for statements with RETURNING or THEN RETURN clauses.
   * Optional: Adapters can implement this if they have a distinct way to handle DML-with-returning
   * versus standard queries. If not implemented, the ORM might fall back to using the `query` method.
   * @param sql The SQL string to execute.
   * @param params Optional parameters, which can be an array or an object map.
   * @returns A promise that resolves to an array of result rows.
   */
  executeAndReturnRows?<TResult extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: any, // Allows unknown[] for PG-like, Record<string, any> for Spanner
    spannerTypeHints?: Record<
      string,
      { code: string; arrayElementType?: { code: string } }
    >
  ): Promise<TResult[]>;

  /**
   * Executes a prepared query, potentially with result shaping if includes are present.
   * @param preparedQuery The PreparedQuery object from QueryBuilder.
   * @returns A promise that resolves to an array of result rows, possibly shaped.
   */
  queryPrepared?<TTable extends import("./common.js").TableConfig<any, any>>(
    preparedQuery: import("./common.js").PreparedQuery<TTable>
  ): Promise<any[]>; // Return type will be complex with generics later

  /**
   * Begins a transaction.
   * Optional: Not all adapters or scenarios might support/require this directly from the ORM.
   */
  beginTransaction?(): Promise<Transaction>; // Changed to return Transaction

  /**
   * Commits the current transaction. (Usually part of the Transaction object)
   */
  // commitTransaction?(): Promise<void>; // This logic is now on the Transaction object

  /**
   * Rolls back the current transaction. (Usually part of the Transaction object)
   */
  // rollbackTransaction?(): Promise<void>; // This logic is now on the Transaction object

  /**
   * Executes a DDL command, specifically for adapters that require a different API for DDL.
   * @param sql The DDL string to execute.
   * @param params Optional array of parameters (often unused for DDL).
   * @returns A promise that resolves similarly to execute, often with a count of 0 for DDL.
   */
  executeDDL?(
    sql: string,
    params?: unknown[] | { [key: string]: string }
  ): Promise<number | AffectedRows>;
}

// Placeholder for connection options, to be defined per adapter
export interface ConnectionOptions {
  [key: string]: any;
}
