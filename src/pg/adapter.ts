// src/pg/adapter.ts

import {
  Pool,
  QueryResult,
  PoolConfig,
  PoolClient,
  QueryResultRow as PgQueryResultRow,
} from "pg";
import type {
  DatabaseAdapter,
  QueryResultRow as AdapterQueryResultRow,
  ConnectionOptions,
  Transaction,
  AffectedRows,
} from "../types/adapter.js"; // Adjusted path
import type { PreparedQuery, TableConfig } from "../types/common.js"; // Corrected path
import { shapeResults } from "../core/result-shaper.js"; // Corrected path

// Define a more specific connection options type for PostgreSQL
export type PgConnectionOptions = PoolConfig | string | ConnectionOptions;

/**
 * Represents the execution context within a PostgreSQL transaction,
 * conforming to a subset of DatabaseAdapter for transactional operations.
 */
// PgTransactionAdapter is effectively replaced by the global Transaction interface
// export interface PgTransactionAdapter {
//   dialect: "postgres";
//   execute(sql: string, params?: unknown[]): Promise<number | AffectedRows>;
//   query<T extends AdapterQueryResultRow = AdapterQueryResultRow>(
//     sql: string,
//     params?: unknown[]
//   ): Promise<T[]>;
// }

export class PostgresAdapter implements DatabaseAdapter {
  readonly dialect = "postgres";
  private pool: Pool;
  private isConnected: boolean = false;

  constructor(config: PgConnectionOptions) {
    if (typeof config === "string") {
      this.pool = new Pool({ connectionString: config });
    } else {
      this.pool = new Pool(config as PoolConfig);
    }
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      console.log("PostgreSQL adapter already connected.");
      return;
    }
    try {
      const client = await this.pool.connect();
      client.release();
      this.isConnected = true;
      console.log("PostgreSQL adapter connected successfully.");
    } catch (error) {
      console.error("Error connecting PostgreSQL adapter:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      console.log("PostgreSQL adapter already disconnected.");
      return;
    }
    try {
      await this.pool.end();
      this.isConnected = false;
      console.log("PostgreSQL adapter disconnected.");
    } catch (error) {
      console.error("Error disconnecting PostgreSQL adapter pool:", error);
      throw error;
    }
  }

  async execute(
    sql: string,
    params?: unknown[]
  ): Promise<number | AffectedRows> {
    try {
      const result = await this.pool.query(sql, params);
      return { count: result.rowCount ?? 0 };
    } catch (error) {
      console.error("Error executing command with pg adapter:", error);
      throw error;
    }
  }

  async query<TResult extends AdapterQueryResultRow = AdapterQueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<TResult[]> {
    try {
      const result: QueryResult<TResult & PgQueryResultRow> =
        await this.pool.query<TResult & PgQueryResultRow>(sql, params);
      return result.rows;
    } catch (error) {
      console.error("Error executing query with pg adapter:", error);
      throw error;
    }
  }

  async queryPrepared<TTable extends TableConfig<any, any>>(
    preparedQuery: PreparedQuery<TTable>
  ): Promise<any[]> {
    try {
      const rawResults = await this.query<AdapterQueryResultRow>( // Use the existing query method
        preparedQuery.sql,
        preparedQuery.parameters
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
      console.error("Error executing prepared query with pg adapter:", error);
      throw error;
    }
  }

  async beginTransaction(): Promise<Transaction> {
    const client: PoolClient = await this.pool.connect();
    await client.query("BEGIN");

    return {
      execute: async (
        sqlCmd: string,
        paramsCmd?: unknown[]
      ): Promise<number | AffectedRows> => {
        const res = await client.query(sqlCmd, paramsCmd);
        return { count: res.rowCount ?? 0 };
      },
      query: async <
        TQuery extends AdapterQueryResultRow = AdapterQueryResultRow
      >(
        sqlQuery: string,
        paramsQuery?: unknown[]
      ): Promise<TQuery[]> => {
        const result: QueryResult<TQuery & PgQueryResultRow> =
          await client.query<TQuery & PgQueryResultRow>(sqlQuery, paramsQuery);
        return result.rows;
      },
      commit: async (): Promise<void> => {
        try {
          await client.query("COMMIT");
        } finally {
          client.release();
        }
      },
      rollback: async (): Promise<void> => {
        try {
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      },
    };
  }

  // The main transaction method on the adapter can be simplified or removed
  // if OrmClient directly uses beginTransaction and the returned Transaction object.
  // For now, let's keep a similar structure if it's used by other parts of the ORM (e.g. migrations).
  async transaction<T>(
    callback: (tx: Transaction) => Promise<T> // Callback now receives a Transaction object
  ): Promise<T> {
    const tx = await this.beginTransaction(); // This already connects and starts
    try {
      const result = await callback(tx);
      await tx.commit(); // This now releases the client
      return result;
    } catch (error) {
      await tx.rollback(); // This now releases the client
      console.error("Transaction rolled back due to error:", error);
      throw error;
    }
    // No finally client.release() here as it's handled by commit/rollback
  }
}
