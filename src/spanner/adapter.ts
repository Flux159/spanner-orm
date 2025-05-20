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
  Transaction as OrmTransaction, // Renaming to avoid conflict with Spanner's Transaction
  AffectedRows,
} from "../types/adapter.js";
import type { PreparedQuery, TableConfig } from "../types/common.js"; // Corrected path
import { shapeResults } from "../core/result-shaper.js"; // Corrected path

export interface SpannerConnectionOptions extends ConnectionOptions {
  projectId: string;
  instanceId: string;
  databaseId: string;
  // Add other Spanner specific options if needed, e.g., credentials
}

// SpannerTransactionAdapter is effectively replaced by the global OrmTransaction interface

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

  async execute(
    sql: string,
    params?: Record<string, any>
  ): Promise<number | AffectedRows> {
    const db = this.ensureConnected();
    try {
      // Spanner's runUpdate returns an array where the first element is the affected row count.
      // The result of runTransactionAsync is the result of its callback.
      const rowCount = await db.runTransactionAsync(
        async (transaction: Transaction) => {
          const [count] = await transaction.runUpdate({ sql, params });
          // No explicit commit needed here, runTransactionAsync handles it.
          return count;
        }
      );
      return { count: typeof rowCount === "number" ? rowCount : 0 };
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
        json: true,
      });
      return rows as TResult[];
    } catch (error) {
      console.error("Error executing query with Spanner adapter:", error);
      throw error;
    }
  }

  async queryPrepared<TTable extends TableConfig<any, any>>(
    preparedQuery: PreparedQuery<TTable>
  ): Promise<any[]> {
    try {
      const spannerParams: Record<string, any> = {};
      if (preparedQuery.parameters) {
        preparedQuery.parameters.forEach((val, i) => {
          spannerParams[`p${i + 1}`] = val; // Spanner uses @p1, @p2 etc.
        });
      }

      const rawResults = await this.query<AdapterQueryResultRow>(
        preparedQuery.sql,
        spannerParams
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
        "Error executing prepared query with Spanner adapter:",
        error
      );
      throw error;
    }
  }

  async beginTransaction(): Promise<OrmTransaction> {
    const db = this.ensureConnected();
    // Spanner's transactions are typically managed via runTransactionAsync.
    // To return a Transaction object, we'd need to get a transaction object
    // from Spanner and wrap its methods. This is complex because Spanner
    // encourages the callback pattern for retries and context management.

    // For now, this will be a simplified version that might not support
    // all OrmTransaction capabilities perfectly or might rely on a single-use transaction.
    // The main `transaction` method below is preferred for Spanner.

    // This is a placeholder. A true Spanner transaction object for manual control
    // would require more careful handling of the Spanner Transaction object lifecycle.
    // The `runTransactionAsync` pattern is generally safer.
    const spannerTx = db.getTransaction(); // This gets a Transaction object but doesn't start it in the traditional sense.
    // It's more of a context for a single transaction attempt.

    return {
      execute: async (
        sqlCmd: string,
        paramsCmd?: Record<string, any>
      ): Promise<number | AffectedRows> => {
        // Note: Spanner transactions are usually committed as a whole.
        // Running individual DMLs and then a separate commit is not the typical pattern.
        // This is a simplified adaptation.
        // Spanner's client library Transaction object does not have a public `begin()` method.
        // Operations are typically run within the `runTransactionAsync` callback.
        // This manual begin/commit/rollback on a getTransaction() object is not standard.
        // We'll make these throw or return a conceptual failure.
        const txObject = spannerTx as any; // Cast to any to access internal-like methods if they existed
        if (typeof txObject.begin === "function") await txObject.begin();
        else
          console.warn(
            "Spanner: conceptual begin() called on transaction object"
          );

        const [rowCountFromRunUpdate] = await txObject.runUpdate({
          sql: sqlCmd,
          params: paramsCmd,
        });
        return { count: rowCountFromRunUpdate };
      },
      query: async <
        TQuery extends AdapterQueryResultRow = AdapterQueryResultRow
      >(
        sqlQuery: string,
        paramsQuery?: Record<string, any>
      ): Promise<TQuery[]> => {
        const txObjectQuery = spannerTx as any;
        const [rows] = await txObjectQuery.run({
          sql: sqlQuery,
          params: paramsQuery,
          json: true,
        });
        return rows as TQuery[];
      },
      commit: async (): Promise<void> => {
        const txObjectCommit = spannerTx as any;
        if (typeof txObjectCommit.commit === "function")
          await txObjectCommit.commit();
        else
          console.warn(
            "Spanner: conceptual commit() called on transaction object"
          );
      },
      rollback: async (): Promise<void> => {
        const txObjectRollback = spannerTx as any;
        if (typeof txObjectRollback.rollback === "function")
          await txObjectRollback.rollback();
        else
          console.warn(
            "Spanner: conceptual rollback() called on transaction object"
          );
      },
    };
  }

  async transaction<T>(
    callback: (txAdapter: OrmTransaction) => Promise<T>
  ): Promise<T> {
    const db = this.ensureConnected();
    // Use Spanner's recommended runTransactionAsync pattern
    return db.runTransactionAsync(async (gcpTransaction: Transaction) => {
      const txExecutor: OrmTransaction = {
        execute: async (cmdSql, cmdParams) => {
          const [rowCount] = await gcpTransaction.runUpdate({
            sql: cmdSql,
            params: cmdParams as Record<string, any> | undefined,
          });
          return { count: rowCount };
        },
        query: async (querySql, queryParams) => {
          const [rows] = await gcpTransaction.run({
            sql: querySql,
            params: queryParams as Record<string, any> | undefined,
            json: true,
          });
          return rows as any[];
        },
        commit: async () => {
          // Commit is handled by runTransactionAsync itself. This is a no-op.
          return Promise.resolve();
        },
        rollback: async () => {
          // Rollback is handled by runTransactionAsync if the callback throws. This is a no-op.
          return Promise.resolve();
        },
      };
      return callback(txExecutor);
    });
  }
}
