// src/spanner/adapter.ts

// This is a placeholder for the Google Spanner adapter.
// It would typically wrap the '@google-cloud/spanner' library.

export interface SpannerAdapter {
  dialect: "spanner";

  /**
   * Executes a SQL query or DML statement against the Spanner database.
   * @param sql The SQL string to execute.
   * @param params An object mapping parameter names (e.g., '@paramName') to their values for Spanner queries.
   * @returns A promise that resolves with the query results (e.g., rows for SELECT, row counts for DML).
   */
  execute: <TResult = any>(
    sql: string,
    params?: Record<string, any>
  ) => Promise<TResult[]>; // Spanner typically returns rows as arrays of objects or arrays of arrays.

  // TODO: Add transaction methods (Spanner has specific transaction types: read-only, read-write)
  // TODO: Add methods for batch DML, partitioned DML, etc.
  // TODO: Handle Spanner-specific types like SpannerDate, SpannerStruct, etc.

  transaction: <T>(
    callback: (tx: SpannerTransaction) => Promise<T>
  ) => Promise<T>;
}

/**
 * Represents the execution context within a Spanner transaction.
 * Note: Spanner transactions can be read-only or read-write.
 * This basic interface assumes read-write for DML.
 */
export interface SpannerTransaction {
  dialect: "spanner";
  /**
   * Executes a SQL query. For DML (INSERT, UPDATE, DELETE), use runUpdate.
   */
  execute: <TResult = any>(
    sql: string,
    params?: Record<string, any>
  ) => Promise<TResult[]>;
  /**
   * Executes a DML statement (INSERT, UPDATE, DELETE).
   * Returns the number of affected rows.
   */
  runUpdate: (sql: string, params?: Record<string, any>) => Promise<number>;
}

import { Spanner, Database, Transaction } from "@google-cloud/spanner";
// import { protos } from "@google-cloud/spanner"; // protos was unused
// type IRunQueryOptions = protos.google.spanner.v1.ExecuteSqlRequest.IQueryOptions; // For more advanced options
// type IRequestOptions = protos.google.spanner.v1.ExecuteSqlRequest.IRequestOptions; // For more advanced options

export class ConcreteSpannerAdapter implements SpannerAdapter {
  readonly dialect = "spanner" as const;
  private spannerClient: Spanner; // The top-level Spanner client
  private instanceId: string;
  private databaseId: string;
  private db: Database; // The Database object for operations

  constructor(projectId: string, instanceId: string, databaseId: string) {
    this.spannerClient = new Spanner({ projectId });
    this.instanceId = instanceId;
    this.databaseId = databaseId;
    // Get a Database object. This can be used for multiple operations.
    this.db = this.spannerClient
      .instance(this.instanceId)
      .database(this.databaseId);
  }

  async execute<TResult = any>(
    sql: string,
    params?: Record<string, any> // Spanner uses named parameters, e.g., { p1: value1, p2: value2 }
  ): Promise<TResult[]> {
    try {
      // For SELECT queries, database.run() is appropriate.
      // It returns [rows] for queries.
      // For DML statements (INSERT, UPDATE, DELETE), they are typically run within a transaction.
      // database.runTransactionAsync(async (transaction) => { ... transaction.runUpdate(...); await transaction.commit(); });
      // This basic execute method will focus on SELECT for now.
      // The QueryBuilder's toSQL currently generates @p1, @p2 style placeholders.
      const [rows] = await this.db.run({
        sql,
        params,
        json: true, // Automatically convert Spanner data types to JSON where possible
      });
      return rows as TResult[]; // Casting, ensure TResult matches expected row structure
    } catch (error) {
      console.error("Error executing query with Spanner adapter:", error);
      // TODO: Implement more specific error handling or logging
      throw error;
    }
  }

  async transaction<T>(
    callback: (tx: SpannerTransaction) => Promise<T>
  ): Promise<T> {
    try {
      const result = await this.db.runTransactionAsync(
        async (transaction: Transaction) => {
          const txExecutor: SpannerTransaction = {
            dialect: "spanner" as const,
            execute: async <TResult = any>(
              sql: string,
              params?: Record<string, any>
            ): Promise<TResult[]> => {
              const [rows] = await transaction.run({ sql, params, json: true });
              return rows as TResult[];
            },
            runUpdate: async (
              sql: string,
              params?: Record<string, any>
            ): Promise<number> => {
              const [rowCount] = await transaction.runUpdate({ sql, params });
              return rowCount;
            },
          };
          const cbResult = await callback(txExecutor);
          // Commit is handled by runTransactionAsync if callback resolves
          return cbResult;
        }
      );
      return result;
    } catch (error) {
      console.error("Spanner transaction failed:", error);
      // Rollback is handled by runTransactionAsync if callback throws
      throw error;
    }
  }

  async close(): Promise<void> {
    // Close the main Spanner client. This will close all sessions managed by it.
    // Individual Database or Instance objects don't need separate closing if the main client is closed.
    try {
      await this.spannerClient.close();
      console.log("Spanner adapter closed.");
    } catch (error) {
      console.error("Error closing Spanner adapter:", error);
      // Potentially log and ignore, or rethrow depending on desired behavior
    }
  }
}

// console.log("Spanner Adapter placeholder loaded."); // Remove or keep for debugging
