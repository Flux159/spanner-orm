// src/spanner/adapter.ts

// Import types directly
import type {
  Database as SpannerDatabase,
  Transaction as SpannerNativeTransaction,
  Instance as SpannerInstance,
  // DatabaseAdminClient will be obtained via this.spannerClient.getDatabaseAdminClient()
  // google.longrunning.IOperation type will be inferred
} from "@google-cloud/spanner";

// Type for the Spanner class constructor
type SpannerClientClassType = typeof import("@google-cloud/spanner").Spanner;
// Type for Spanner instance
type SpannerClientInstanceType = import("@google-cloud/spanner").Spanner;

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

export class SpannerAdapter implements DatabaseAdapter {
  readonly dialect = "spanner";
  private spannerClient?: SpannerClientInstanceType;
  private instance?: SpannerInstance;
  private db?: SpannerDatabase;
  // private adminClient?: DatabaseAdminClient; // Removed, will be obtained on demand
  private dbPath?: string; // Kept
  private options: SpannerConnectionOptions;
  private isConnected: boolean = false;
  private ready: Promise<void>;
  private SpannerClientClass?: SpannerClientClassType;

  constructor(options: SpannerConnectionOptions) {
    if (!options.projectId || !options.instanceId || !options.databaseId) {
      throw new Error(
        "projectId, instanceId, and databaseId are required for Spanner adapter."
      );
    }
    this.options = options;
    this.ready = this.initializeSpannerClient();
  }

  private async initializeSpannerClient(): Promise<void> {
    if (!this.SpannerClientClass) {
      const spannerModule = await import("@google-cloud/spanner");
      this.SpannerClientClass = spannerModule.Spanner;
    }
  }

  async connect(): Promise<void> {
    await this.ready; // Ensure Spanner class is loaded
    if (this.isConnected) {
      console.log("Spanner adapter already connected.");
      return;
    }
    if (!this.SpannerClientClass) {
      // Should not happen if await this.ready worked
      throw new Error("Spanner client class not loaded.");
    }
    try {
      this.spannerClient = new this.SpannerClientClass({
        projectId: this.options.projectId,
        // Consider adding credentials if they are part of options
      });
      this.instance = this.spannerClient.instance(this.options.instanceId);
      this.db = this.instance.database(this.options.databaseId);

      // Construct the fully qualified database path
      this.dbPath = `projects/${this.options.projectId}/instances/${this.options.instanceId}/databases/${this.options.databaseId}`;

      // adminClient is no longer initialized here

      // Perform a simple query to verify connection and authentication
      await this.db.run("SELECT 1");
      this.isConnected = true;
      console.log("Spanner adapter connected successfully.");
    } catch (error) {
      console.error("Error connecting Spanner adapter:", error);
      this.spannerClient = undefined;
      this.instance = undefined;
      this.db = undefined;
      // this.adminClient = undefined; // Removed
      this.dbPath = undefined;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    // No need to await this.ready for disconnect, if spannerClient exists, try to close it.
    if (!this.isConnected || !this.spannerClient) {
      console.log("Spanner adapter already disconnected or not connected.");
      return;
    }
    try {
      // Close the main client
      if (this.spannerClient) {
        await this.spannerClient.close();
      }
      // adminClient is no longer a class member to close here
      this.isConnected = false;
      this.spannerClient = undefined;
      this.instance = undefined;
      this.db = undefined;
      // this.adminClient = undefined; // Removed
      this.dbPath = undefined;
      console.log("Spanner adapter disconnected.");
    } catch (error) {
      console.error("Error disconnecting Spanner adapter:", error);
      throw error;
    }
  }

  private ensureConnected(): SpannerDatabase {
    // this.ready should have been awaited by the calling public method or connect()
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
    const db = this.ensureConnected(); // Relies on connect() having awaited this.ready
    try {
      // Spanner's runUpdate returns an array where the first element is the affected row count.
      // The result of runTransactionAsync is the result of its callback.
      const rowCount = await db.runTransactionAsync(
        async (transaction: SpannerNativeTransaction) => {
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

  async executeDDL(
    sql: string,
    // params are ignored for Spanner DDL but kept for interface compatibility
    _params?: unknown[]
  ): Promise<number | AffectedRows> {
    this.ensureConnected(); // Ensures spannerClient and db are available

    if (!this.spannerClient) {
      // Should be caught by ensureConnected if db is not set, but good to be explicit
      throw new Error(
        "Spanner client is not initialized. Call connect() first."
      );
    }
    if (!this.dbPath) {
      throw new Error(
        "Spanner database path is not set. Call connect() first."
      );
    }

    const adminClient = this.spannerClient.getDatabaseAdminClient();

    // Remove trailing semicolon if present, as Spanner DDL API doesn't like it.
    let ddlSql = sql.trim();
    if (ddlSql.endsWith(";")) {
      ddlSql = ddlSql.slice(0, -1);
    }

    console.log(`Executing DDL for Spanner: ${ddlSql.substring(0, 200)}...`); // Log snippet

    try {
      const [operation] = await adminClient.updateDatabaseDdl({
        // Using the on-demand adminClient
        database: this.dbPath, // Using the fully qualified dbPath
        statements: [ddlSql], // Spanner API expects an array of statements
      });

      console.log(
        `DDL operation "${operation.name}" started. Waiting for completion...`
      );

      // Wait for the operation to complete.
      // The promise() method on the operation polls until it's done.
      // The result of promise() is an array, typically [response, metadata, finalOperation]
      // For updateDatabaseDdl, the response is often empty upon success.
      await operation.promise();

      console.log(`DDL operation "${operation.name}" completed successfully.`);
      return { count: 0 }; // DDLs don't have 'affected rows' like DML
    } catch (error) {
      console.error("Error executing DDL with Spanner adapter:", error);
      throw error;
    }
  }

  async query<TResult extends AdapterQueryResultRow = AdapterQueryResultRow>(
    sql: string,
    params?: Record<string, any>
  ): Promise<TResult[]> {
    const db = this.ensureConnected(); // Relies on connect() having awaited this.ready
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
    // ensureConnected will be called by this.query
    try {
      let spannerParams: Record<string, any> | undefined;

      if (preparedQuery.parameters) {
        if (Array.isArray(preparedQuery.parameters)) {
          // If it's an array (e.g., from raw SQL or a misconfigured call), convert it
          spannerParams = {};
          preparedQuery.parameters.forEach((val, i) => {
            spannerParams![`p${i + 1}`] = val;
          });
        } else {
          // If it's already an object (Record<string, unknown>), use it directly
          // Cast to Record<string, any> as Spanner client expects `any` for values
          spannerParams = preparedQuery.parameters as Record<string, any>;
        }
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

  async executeAndReturnRows<
    TResult extends AdapterQueryResultRow = AdapterQueryResultRow
  >(
    sql: string,
    params?: Record<string, any> // Spanner expects Record<string, any>
  ): Promise<TResult[]> {
    const db = this.ensureConnected();
    try {
      // Use runTransactionAsync to ensure a read-write transaction
      return await db.runTransactionAsync(
        async (transaction: SpannerNativeTransaction) => {
          // Use transaction.run() for DML with THEN RETURN
          const [rows] = await transaction.run({ sql, params, json: true });
          return rows as TResult[];
        }
      );
    } catch (error) {
      console.error(
        "Error executing DML and returning rows with Spanner adapter:",
        error
      );
      throw error;
    }
  }

  async beginTransaction(): Promise<OrmTransaction> {
    const db = this.ensureConnected(); // Relies on connect() having awaited this.ready
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
    const db = this.ensureConnected(); // Relies on connect() having awaited this.ready
    // Use Spanner's recommended runTransactionAsync pattern
    return db.runTransactionAsync(
      async (gcpTransaction: SpannerNativeTransaction) => {
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
      }
    );
  }
}
