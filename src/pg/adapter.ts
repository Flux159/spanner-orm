// src/pg/adapter.ts

// This is a placeholder for the PostgreSQL adapter.
// It would typically wrap a PostgreSQL driver like 'pg' or 'postgres'.

export interface PgAdapter {
  dialect: "pg";

  /**
   * Executes a SQL query against the PostgreSQL database.
   * @param sql The SQL string to execute.
   * @param params An array of parameters for prepared statements.
   * @returns A promise that resolves with the query results.
   */
  execute: <TResult extends QueryResultRow = any>(
    sql: string,
    params?: any[]
  ) => Promise<TResult[]>;

  // TODO: Add transaction methods: begin, commit, rollback
  // TODO: Add methods for streaming results, etc.
}

import { Pool, QueryResult, PoolConfig, QueryResultRow } from "pg";

export class ConcretePgAdapter implements PgAdapter {
  readonly dialect = "pg" as const;
  private pool: Pool;

  constructor(config: PoolConfig | string) {
    if (typeof config === "string") {
      this.pool = new Pool({ connectionString: config });
    } else {
      this.pool = new Pool(config);
    }
  }

  async execute<TResult extends QueryResultRow = any>(
    sql: string,
    params?: any[]
  ): Promise<TResult[]> {
    try {
      const result: QueryResult<TResult> = await this.pool.query<TResult>(
        sql,
        params
      );
      return result.rows;
    } catch (error) {
      console.error("Error executing query with pg adapter:", error);
      // TODO: Implement more specific error handling or logging
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      await this.pool.end();
      console.log("PostgreSQL adapter closed.");
    } catch (error) {
      console.error("Error closing PostgreSQL adapter pool:", error);
      throw error;
    }
  }
}

// console.log("PostgreSQL Adapter placeholder loaded."); // Remove or keep for debugging
