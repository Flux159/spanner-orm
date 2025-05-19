// src/pglite/adapter.ts

// This is a placeholder for the Pglite adapter.
// Pglite provides a PostgreSQL-compatible interface over SQLite.

export interface PgliteAdapter {
  dialect: "pglite";

  /**
   * Executes a SQL query against the Pglite database.
   * @param sql The SQL string to execute.
   * @param params An array of parameters for prepared statements.
   * @returns A promise that resolves with the query results.
   */
  execute: <TResult = any>(sql: string, params?: any[]) => Promise<TResult[]>;

  // TODO: Add transaction methods: begin, commit, rollback
  // TODO: Add methods for batch operations if supported by the driver.
}

import { PGlite } from "@electric-sql/pglite";

export class ConcretePgliteAdapter implements PgliteAdapter {
  readonly dialect = "pglite" as const;
  private pglite: PGlite;
  private ready: Promise<void>;

  constructor(dataDir?: string) {
    // Pglite can be in-memory or file-backed
    // PGlite constructor is synchronous, but some operations might be async to 'fully' initialize
    // or if it involves loading extensions. For basic usage, it's often ready immediately.
    // Let's assume it's ready after construction for this basic adapter.
    this.pglite = new PGlite(dataDir);
    // PGlite v0.1.20 and later might return a promise from constructor or require an init step
    // For older versions or simple cases, it might be synchronous.
    // Assuming a simple synchronous setup or that PGlite handles its own internal ready state.
    // If PGlite().ready or similar exists and is needed:
    // this.ready = this.pglite.ready ? this.pglite.ready() : Promise.resolve();
    this.ready = Promise.resolve(); // Placeholder if no explicit ready promise needed from PGlite instance
  }

  async execute<TResult = any>(
    sql: string,
    params?: any[]
  ): Promise<TResult[]> {
    await this.ready; // Ensure PGlite is ready if it has an async initialization
    try {
      // PGlite's query method returns an object with a 'rows' property.
      // It also supports tagged template literals for queries directly.
      const results = await this.pglite.query<TResult>(sql, params);
      return results.rows;
    } catch (error) {
      console.error("Error executing query with Pglite adapter:", error);
      // TODO: Implement more specific error handling or logging
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.ready;
    // PGlite instances have a close method as of v0.1.18+
    if (typeof this.pglite.close === "function") {
      await this.pglite.close();
      console.log("Pglite adapter closed.");
    } else {
      console.log(
        "Pglite adapter: close method not available or not needed for this version/setup."
      );
    }
  }
}

// console.log("Pglite Adapter placeholder loaded."); // Remove or keep for debugging
