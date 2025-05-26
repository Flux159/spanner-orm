// src/pglite/adapter.ts

// Import PGlite type for type checking, actual import will be dynamic
type PGliteType = import("@electric-sql/pglite").PGlite;

import type {
  DatabaseAdapter,
  QueryResultRow as AdapterQueryResultRow,
  ConnectionOptions,
  Transaction,
  AffectedRows,
} from "../types/adapter.js";
import type { PreparedQuery, TableConfig } from "../types/common.js"; // Added
import { shapeResults } from "../core/result-shaper.js"; // Added

// Define a more specific connection options type for PGlite
export interface PgliteConnectionOptions extends ConnectionOptions {
  dataDir?: string;
}

// PgliteTransactionAdapter is effectively replaced by the global Transaction interface

export class PgliteAdapter implements DatabaseAdapter {
  readonly dialect = "postgres"; // Treat PGlite as PostgreSQL for ORM dialect purposes
  private pglite!: PGliteType; // Definite assignment in constructor via this.ready
  private ready: Promise<void>;
  private isConnected: boolean = false;
  private PGliteClass?: typeof import("@electric-sql/pglite").PGlite;

  constructor(options?: PgliteConnectionOptions | string) {
    const dataDir = typeof options === "string" ? options : options?.dataDir;
    this.ready = this.initializePglite(dataDir);
  }

  private async initializePglite(dataDir?: string): Promise<void> {
    if (!this.PGliteClass) {
      const pgliteModule = await import("@electric-sql/pglite");
      this.PGliteClass = pgliteModule.PGlite;
    }
    this.pglite = new this.PGliteClass(dataDir);
    // PGlite's constructor is synchronous.
    // Some PGlite operations might be async internally if they load extensions,
    // but the basic instance should be usable after this.
  }

  async connect(): Promise<void> {
    await this.ready; // Ensure PGlite is initialized
    if (this.isConnected) {
      console.log("PGlite adapter already connected/initialized.");
      return;
    }
    // PGlite doesn't have an explicit connect method like a remote DB.
    // Being instantiated (after await this.ready) is considered 'connected' for basic operations.
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

  async execute(
    sql: string,
    params?: unknown[]
  ): Promise<number | AffectedRows> {
    await this.ready;
    try {
      const result = await this.pglite.query(sql, params as any[] | undefined);
      // PGLite's query result for DML doesn't directly give rowCount in the same way pg does.
      // It might be part of `result.affectedRows` or similar if the underlying driver provides it.
      // For simplicity, if `result.rows` is empty and no error, assume success.
      // A more robust way would be to check `result.command` and `result.rowCount` if available and reliable.
      // PGLite's `results.affectedRows` should be used for DML.
      return { count: result.affectedRows ?? 0 };
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

  async beginTransaction(): Promise<Transaction> {
    await this.ready;
    // PGlite's transaction model is callback-based.
    // Returning a fully independent Transaction object that controls
    // an external PGlite transaction is not straightforward.
    // This implementation will be a simplified one or throw an error,
    // guiding users towards the adapter's main `transaction` method.
    console.warn(
      "PGlite beginTransaction creates a transaction context that expects immediate execution via its callback. For ORM client transactions, use the OrmClient's transaction method."
    );
    // Return a dummy or throw, as PGlite's `pglite.transaction()` expects a callback.
    // This method, if called directly by OrmClient, won't work as expected with PGlite's model.
    // The OrmClient's transaction method should use the adapter's transaction method.
    return {
      execute: async (_sql, _params) => {
        throw new Error(
          "PGlite transaction via standalone Transaction object is not supported. Use adapter.transaction(callback)."
        );
      },
      query: async (_sql, _params) => {
        throw new Error(
          "PGlite transaction via standalone Transaction object is not supported. Use adapter.transaction(callback)."
        );
      },
      commit: async () => {
        throw new Error(
          "PGlite transaction via standalone Transaction object is not supported. Use adapter.transaction(callback)."
        );
      },
      rollback: async () => {
        throw new Error(
          "PGlite transaction via standalone Transaction object is not supported. Use adapter.transaction(callback)."
        );
      },
    };
  }

  async transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
    await this.ready;
    // Use PGlite's native transaction method which takes a callback
    return this.pglite.transaction<T>(async (pgliteTransaction) => {
      // pgliteTransaction is the PGlite instance scoped to this transaction
      const wrappedTx: Transaction = {
        execute: async (sqlCmd, paramsCmd) => {
          const res = await pgliteTransaction.query(
            sqlCmd,
            paramsCmd as any[] | undefined
          );
          return { count: res.affectedRows ?? 0 };
        },
        query: async (sqlQuery, paramsQuery) => {
          const res = await pgliteTransaction.query(
            sqlQuery,
            paramsQuery as any[] | undefined
          );
          return res.rows as any[];
        },
        // Commit and rollback are managed by PGlite's transaction callback wrapper.
        // These methods on our Transaction interface might not be called if PGlite handles it.
        // However, providing them for interface consistency.
        commit: async () => {
          // PGlite's transaction callback implicitly commits if the callback resolves.
          // Explicit call might not be needed or could be a no-op.
          // If PGlite's `pgliteTransaction` had a `.commit()` we'd call it.
          // For now, assume PGlite handles it.
          Promise.resolve();
        },
        rollback: async () => {
          // PGlite's transaction callback implicitly rolls back if the callback rejects.
          // Explicit call might not be needed.
          Promise.resolve();
        },
      };
      return callback(wrappedTx);
    });
  }

  async queryPrepared<TTable extends TableConfig<any, any>>(
    preparedQuery: PreparedQuery<TTable>
  ): Promise<any[]> {
    await this.ready;
    try {
      // PGlite expects parameters as an array.
      // If preparedQuery.parameters is an object, it's an issue for PGlite.
      // However, this adapter is for 'postgres' dialect, so parameters should be an array.
      // We cast to unknown[] to satisfy the PGlite .query method signature.
      // A runtime check could be added if cross-dialect parameter types were a concern here.
      const paramsForPglite = preparedQuery.parameters as unknown[];

      const rawResults = await this.query<AdapterQueryResultRow>(
        preparedQuery.sql,
        paramsForPglite
      );

      if (preparedQuery.includeClause && preparedQuery.primaryTable) {
        return shapeResults(
          rawResults,
          preparedQuery.primaryTable,
          preparedQuery.includeClause
        );
      }
      return rawResults;
    } catch (error) {
      console.error(
        "Error executing prepared query with Pglite adapter:",
        error
      );
      throw error;
    }
  }
}
