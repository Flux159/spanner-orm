// src/types/adapter.ts
import type { Dialect } from "./common.js";

export interface QueryResultRow {
  [column: string]: any;
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
   * Executes a SQL command (e.g., INSERT, UPDATE, DELETE, DDL) that does not return rows.
   * @param sql The SQL string to execute.
   * @param params Optional array of parameters for prepared statements.
   */
  execute(sql: string, params?: unknown[]): Promise<void>;

  /**
   * Executes a SQL query that returns rows.
   * @param sql The SQL string to query.
   * @param params Optional array of parameters for prepared statements.
   * @returns A promise that resolves to an array of result rows.
   */
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]>;

  /**
   * Begins a transaction.
   * Optional: Not all adapters or scenarios might support/require this directly from the ORM.
   */
  beginTransaction?(): Promise<void>;

  /**
   * Commits the current transaction.
   */
  commitTransaction?(): Promise<void>;

  /**
   * Rolls back the current transaction.
   */
  rollbackTransaction?(): Promise<void>;
}

// Placeholder for connection options, to be defined per adapter
export interface ConnectionOptions {
  [key: string]: any;
}
