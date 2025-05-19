// src/spanner/adapter.ts

import {
  Spanner,
  Database,
  Transaction,
  Instance,
} from "@google-cloud/spanner";
import type {
  DatabaseAdapter,
  QueryResultRow as AdapterQueryResultRow,
  ConnectionOptions,
} from "../types/adapter.js";

export interface SpannerConnectionOptions extends ConnectionOptions {
  projectId: string;
  instanceId: string;
  databaseId: string;
  // Add other Spanner specific options if needed, e.g., credentials
}

/**
 * Represents the execution context within a Spanner transaction.
 */
export interface SpannerTransactionAdapter {
  dialect: "spanner";
  execute(sql: string, params?: Record<string, any>): Promise<void>; // For DML/DDL
  query<T extends AdapterQueryResultRow = AdapterQueryResultRow>(
    sql: string,
    params?: Record<string, any>
  ): Promise<T[]>; // For SELECT
}

export class ConcreteSpannerAdapter implements DatabaseAdapter {
  readonly dialect = "spanner";
  private spannerClient?: Spanner;
  private instance?: Instance;
  private db?: Database;
  private options: SpannerConnectionOptions;
  private isConnected: boolean = false;

  constructor(options: SpannerConnectionOptions) {
    if (!options.projectId || !options.instanceId || !options.databaseId) {
      throw new Error(
        "projectId, instanceId, and databaseId are required for Spanner adapter."
      );
    }
    this.options = options;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      console.log("Spanner adapter already connected.");
      return;
    }
    try {
      this.spannerClient = new Spanner({ projectId: this.options.projectId });
      this.instance = this.spannerClient.instance(this.options.instanceId);
      this.db = this.instance.database(this.options.databaseId);
      // Perform a simple query to verify connection and authentication
      await this.db.run("SELECT 1");
      this.isConnected = true;
      console.log("Spanner adapter connected successfully.");
    } catch (error) {
      console.error("Error connecting Spanner adapter:", error);
      this.spannerClient = undefined;
      this.instance = undefined;
      this.db = undefined;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected || !this.spannerClient) {
      console.log("Spanner adapter already disconnected or not connected.");
      return;
    }
    try {
      await this.spannerClient.close();
      this.isConnected = false;
      this.spannerClient = undefined;
      this.instance = undefined;
      this.db = undefined;
      console.log("Spanner adapter disconnected.");
    } catch (error) {
      console.error("Error disconnecting Spanner adapter:", error);
      throw error;
    }
  }

  private ensureConnected(): Database {
    if (!this.isConnected || !this.db) {
      throw new Error(
        "Spanner adapter is not connected. Call connect() first."
      );
    }
    return this.db;
  }

  async execute(sql: string, params?: Record<string, any>): Promise<void> {
    const db = this.ensureConnected();
    try {
      // DDL and DML statements are run within a transaction.
      // For a single DML/DDL, we can use a simple transaction.
      await db.runTransactionAsync(async (transaction: Transaction) => {
        await transaction.runUpdate({ sql, params });
        await transaction.commit();
      });
    } catch (error) {
      console.error("Error executing command with Spanner adapter:", error);
      throw error;
    }
  }

  async query<TResult extends AdapterQueryResultRow = AdapterQueryResultRow>(
    sql: string,
    params?: Record<string, any>
  ): Promise<TResult[]> {
    const db = this.ensureConnected();
    try {
      const [rows] = await db.run({
        sql,
        params,
        json: true, // Automatically convert Spanner data types to JSON
      });
      return rows as TResult[];
    } catch (error) {
      console.error("Error executing query with Spanner adapter:", error);
      throw error;
    }
  }

  async beginTransaction(): Promise<void> {
    // Spanner transactions are typically managed by runTransactionAsync.
    // Exposing raw begin/commit/rollback is less common for Spanner's client lib patterns.
    console.warn(
      "beginTransaction is not typically used directly with Spanner adapter's runTransactionAsync pattern. Use the transaction() callback method."
    );
  }

  async commitTransaction(): Promise<void> {
    console.warn(
      "commitTransaction is not typically used directly with Spanner adapter's runTransactionAsync pattern."
    );
  }

  async rollbackTransaction(): Promise<void> {
    console.warn(
      "rollbackTransaction is not typically used directly with Spanner adapter's runTransactionAsync pattern."
    );
  }

  async transaction<T>(
    callback: (txAdapter: SpannerTransactionAdapter) => Promise<T>
  ): Promise<T> {
    const db = this.ensureConnected();
    try {
      const result = await db.runTransactionAsync(
        async (transaction: Transaction) => {
          const txExecutor: SpannerTransactionAdapter = {
            dialect: "spanner",
            execute: async (
              cmdSql: string,
              cmdParams?: Record<string, any>
            ): Promise<void> => {
              await transaction.runUpdate({ sql: cmdSql, params: cmdParams });
            },
            query: async <
              TQuery extends AdapterQueryResultRow = AdapterQueryResultRow
            >(
              querySql: string,
              queryParams?: Record<string, any>
            ): Promise<TQuery[]> => {
              const [rows] = await transaction.run({
                sql: querySql,
                params: queryParams,
                json: true,
              });
              return rows as TQuery[];
            },
          };
          const cbResult = await callback(txExecutor);
          // Commit is implicitly handled by runTransactionAsync if callback resolves without error
          return cbResult;
        }
      );
      return result;
    } catch (error) {
      console.error("Spanner transaction failed:", error);
      // Rollback is implicitly handled by runTransactionAsync if callback throws
      throw error;
    }
  }
}
