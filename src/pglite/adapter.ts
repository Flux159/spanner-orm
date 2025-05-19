// src/pglite/adapter.ts

import { PGlite } from "@electric-sql/pglite";
import type {
  DatabaseAdapter,
  QueryResultRow as AdapterQueryResultRow,
  ConnectionOptions,
} from "../types/adapter.js";

// Define a more specific connection options type for PGlite
export interface PgliteConnectionOptions extends ConnectionOptions {
  dataDir?: string;
}

/**
 * Represents the execution context within a PGlite transaction,
 * conforming to a subset of DatabaseAdapter for transactional operations.
 */
export interface PgliteTransactionAdapter {
  dialect: "postgres"; // PGlite is PG compatible
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T extends AdapterQueryResultRow = AdapterQueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]>;
}

export class ConcretePgliteAdapter implements DatabaseAdapter {
  readonly dialect = "postgres"; // Treat PGlite as PostgreSQL for ORM dialect purposes
  private pglite: PGlite;
  private ready: Promise<void>;
  private isConnected: boolean = false;

  constructor(options?: PgliteConnectionOptions | string) {
    const dataDir = typeof options === "string" ? options : options?.dataDir;
    this.pglite = new PGlite(dataDir);
    // PGlite's constructor is synchronous. `ready` can be a resolved promise.
    // Some PGlite operations might be async internally if they load extensions,
    // but the basic instance should be usable.
    this.ready = Promise.resolve();
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      console.log("PGlite adapter already connected/initialized.");
      return;
    }
    await this.ready; // Ensure any initial setup promise resolves
    // PGlite doesn't have an explicit connect method like a remote DB.
    // Being instantiated is considered 'connected' for basic operations.
    // We can do a simple query to confirm it's working.
    try {
      await this.pglite.query("SELECT 1;");
      this.isConnected = true;
      console.log("PGlite adapter initialized and ready.");
    } catch (error) {
      console.error("Error initializing PGlite adapter:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      console.log("PGlite adapter already disconnected/closed.");
      return;
    }
    await this.ready;
    if (typeof this.pglite.close === "function") {
      try {
        await this.pglite.close();
        this.isConnected = false;
        console.log("PGlite adapter closed.");
      } catch (error) {
        console.error("Error closing PGlite adapter:", error);
        throw error;
      }
    } else {
      this.isConnected = false; // Mark as disconnected even if no close method
      console.log(
        "PGlite adapter: close method not available or not needed. Marked as disconnected."
      );
    }
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.ready;
    try {
      // Use query for commands as well to support parameters, then discard results.
      // PGlite's `exec` is more for multi-statement SQL strings without direct param binding in the same call.
      await this.pglite.query(sql, params as any[] | undefined);
    } catch (error) {
      console.error("Error executing command with Pglite adapter:", error);
      throw error;
    }
  }

  async query<TResult extends AdapterQueryResultRow = AdapterQueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<TResult[]> {
    await this.ready;
    try {
      // `query` signature is <T>(sql: string, params?: any[]).
      const results = await this.pglite.query<TResult>(
        sql,
        params as any[] | undefined
      );
      return results.rows;
    } catch (error) {
      console.error("Error executing query with Pglite adapter:", error);
      throw error;
    }
  }

  async beginTransaction(): Promise<void> {
    await this.ready;
    await this.pglite.query("BEGIN");
  }

  async commitTransaction(): Promise<void> {
    await this.ready;
    await this.pglite.query("COMMIT");
  }

  async rollbackTransaction(): Promise<void> {
    await this.ready;
    await this.pglite.query("ROLLBACK");
  }

  async transaction<T>(
    callback: (txAdapter: PgliteTransactionAdapter) => Promise<T>
  ): Promise<T> {
    await this.ready;
    // PGlite supports transactions directly on the main instance.
    // The `transaction` method of PGlite itself could be used,
    // but to align with the adapter pattern, we manage BEGIN/COMMIT/ROLLBACK.
    try {
      await this.beginTransaction();

      const txExecutor: PgliteTransactionAdapter = {
        dialect: "postgres",
        execute: async (
          sqlCmd: string,
          paramsCmd?: unknown[]
        ): Promise<void> => {
          // Inside a transaction, use query for commands too
          await this.pglite.query(sqlCmd, paramsCmd as any[] | undefined);
        },
        query: async <
          TQuery extends AdapterQueryResultRow = AdapterQueryResultRow
        >(
          sqlQuery: string,
          paramsQuery?: unknown[]
        ): Promise<TQuery[]> => {
          // Inside a transaction, use the same pglite instance's query
          const result = await this.pglite.query<TQuery>(
            sqlQuery,
            paramsQuery as any[] | undefined
          );
          return result.rows;
        },
      };

      const result = await callback(txExecutor);
      await this.commitTransaction();
      return result;
    } catch (error) {
      await this.rollbackTransaction();
      console.error("Pglite transaction rolled back due to error:", error);
      throw error;
    }
  }
}
