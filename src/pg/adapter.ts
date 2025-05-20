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
} from "../types/adapter.js"; // Adjusted path
import type { PreparedQuery, TableConfig } from "../types/common.js"; // Corrected path
import { shapeResults } from "../core/result-shaper.js"; // Corrected path

// Define a more specific connection options type for PostgreSQL
export type PgConnectionOptions = PoolConfig | string | ConnectionOptions;

/**
 * Represents the execution context within a PostgreSQL transaction,
 * conforming to a subset of DatabaseAdapter for transactional operations.
 */
export interface PgTransactionAdapter {
  dialect: "postgres";
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T extends AdapterQueryResultRow = AdapterQueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]>;
}

export class ConcretePgAdapter implements DatabaseAdapter {
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

  async execute(sql: string, params?: unknown[]): Promise<void> {
    try {
      await this.pool.query(sql, params);
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

  async beginTransaction(): Promise<void> {
    console.warn(
      "beginTransaction not fully implemented for standalone use in this basic adapter. Use the transaction callback method."
    );
  }

  async commitTransaction(): Promise<void> {
    console.warn(
      "commitTransaction not fully implemented for standalone use in this basic adapter."
    );
  }

  async rollbackTransaction(): Promise<void> {
    console.warn(
      "rollbackTransaction not fully implemented for standalone use in this basic adapter."
    );
  }

  async transaction<T>(
    callback: (txAdapter: PgTransactionAdapter) => Promise<T>
  ): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const txExecutor: PgTransactionAdapter = {
        dialect: "postgres",
        execute: async (
          sqlCmd: string,
          paramsCmd?: unknown[]
        ): Promise<void> => {
          await client.query(sqlCmd, paramsCmd);
        },
        query: async <
          TQuery extends AdapterQueryResultRow = AdapterQueryResultRow
        >(
          sqlQuery: string,
          paramsQuery?: unknown[]
        ): Promise<TQuery[]> => {
          const result: QueryResult<TQuery & PgQueryResultRow> =
            await client.query<TQuery & PgQueryResultRow>(
              sqlQuery,
              paramsQuery
            );
          return result.rows;
        },
      };

      const result = await callback(txExecutor);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Transaction rolled back due to error:", error);
      throw error;
    } finally {
      client.release();
    }
  }
}
