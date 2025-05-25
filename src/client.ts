import type {
  DatabaseAdapter,
  Dialect,
  Transaction,
  AffectedRows, // Make sure this is exported from adapter.js
} from "./types/adapter.js";
import type {
  TableConfig,
  InferModelType,
  SelectFields, // Now defined in common.ts
  EnhancedIncludeClause,
  ShapedResultItem,
  SQL, // SQL is defined in common.ts
  PreparedQuery, // PreparedQuery is defined in common.ts
  ColumnConfig, // For orderBy/groupBy casts
} from "./types/common.js";
import { sql } from "./types/common.js"; // Import sql as a value
import { QueryBuilder } from "./core/query-builder.js";
import { shapeResults } from "./core/result-shaper.js";
import {
  runPendingMigrations,
  revertLastMigration,
} from "./core/migration-runner.js"; // Added for programmatic migrations

// AffectedRows is now imported from adapter.js, so remove local definition
// export interface AffectedRows {
//   count: number;
// }

/**
 * Represents a query that can be executed and its result awaited.
 * It's chainable for building queries and thenable for execution.
 */
export class ExecutableQuery<
  TResult,
  TPrimaryTable extends TableConfig,
  // TFields uses SelectFields from common.ts. It's a map of selections.
  TFields extends SelectFields<TPrimaryTable> = SelectFields<TPrimaryTable>,
  // EnhancedIncludeClause is not generic.
  TInclude extends EnhancedIncludeClause | undefined = undefined,
  // Add TReturningResult to represent the type when .returning() is used
  TReturningResult = TResult // Defaults to TResult if not specified
> {
  // QueryBuilder is generic on TTable (which is TPrimaryTable here)
  protected internalQueryBuilder: QueryBuilder<TPrimaryTable>;
  protected client: OrmClient;
  // Flag to indicate if returning was called, to help with type inference and execution logic
  private _hasReturning: boolean = false;

  constructor(
    client: OrmClient,
    // Pass operation type to guide internalQueryBuilder setup
    operation: "select" | "insert" | "update" | "delete",
    initialTable?: TPrimaryTable, // Table for insert, update, delete, or from() for select
    initialFields?: TFields // Fields for select
  ) {
    this.client = client;
    this.internalQueryBuilder = new QueryBuilder<TPrimaryTable>();

    if (operation === "select") {
      if (initialFields) {
        // Type assertion needed as QueryBuilder's SelectFields is slightly different
        this.internalQueryBuilder.select(initialFields as any);
      }
      if (initialTable) {
        // This would be for a db.select().from(table) scenario if table passed early
        this.internalQueryBuilder.from(initialTable);
      }
    } else if (operation === "insert" && initialTable) {
      this.internalQueryBuilder.insert(initialTable);
    } else if (operation === "update" && initialTable) {
      this.internalQueryBuilder.update(initialTable);
    } else if (operation === "delete" && initialTable) {
      this.internalQueryBuilder.deleteFrom(initialTable);
    }
  }

  // --- Query Building Methods (delegating to QueryBuilder) ---

  from(
    table: TPrimaryTable
  ): ExecutableQuery<
    TResult,
    TPrimaryTable,
    TFields,
    TInclude,
    TReturningResult
  > {
    this.internalQueryBuilder.from(table);
    return this as any; // Cast needed due to TReturningResult
  }

  where(
    condition: SQL
  ): ExecutableQuery<
    TResult,
    TPrimaryTable,
    TFields,
    TInclude,
    TReturningResult
  > {
    this.internalQueryBuilder.where(condition);
    return this as any;
  }

  limit(
    count: number
  ): ExecutableQuery<
    TResult,
    TPrimaryTable,
    TFields,
    TInclude,
    TReturningResult
  > {
    this.internalQueryBuilder.limit(count);
    return this as any;
  }

  offset(
    count: number
  ): ExecutableQuery<
    TResult,
    TPrimaryTable,
    TFields,
    TInclude,
    TReturningResult
  > {
    this.internalQueryBuilder.offset(count);
    return this as any;
  }

  orderBy(
    column: SQL | keyof TPrimaryTable["columns"],
    direction: "ASC" | "DESC" = "ASC"
  ): ExecutableQuery<
    TResult,
    TPrimaryTable,
    TFields,
    TInclude,
    TReturningResult
  > {
    // QueryBuilder's orderBy expects ColumnConfig or SQL.
    // If keyof TPrimaryTable["columns"] is passed, it needs to be resolved or QueryBuilder needs to handle it.
    // For now, assume it's handled by SQL template or direct ColumnConfig usage.
    this.internalQueryBuilder.orderBy(
      column as SQL | ColumnConfig<any, any>,
      direction
    );
    return this as any;
  }

  groupBy(
    ...columns: (SQL | keyof TPrimaryTable["columns"])[]
  ): ExecutableQuery<
    TResult,
    TPrimaryTable,
    TFields,
    TInclude,
    TReturningResult
  > {
    this.internalQueryBuilder.groupBy(
      ...(columns as (SQL | ColumnConfig<any, any>)[])
    );
    return this as any;
  }

  include<NewInclude extends EnhancedIncludeClause>( // EnhancedIncludeClause is not generic
    clause: NewInclude
  ): ExecutableQuery<
    ShapedResultItem<TPrimaryTable, NewInclude>[], // ShapedResultItem takes TPrimaryTable and NewInclude
    TPrimaryTable,
    TFields, // TFields from original select
    NewInclude // TInclude is updated
  > {
    // QueryBuilder's include method expects the old IncludeClause type.
    // This might require an update to QueryBuilder or careful casting.
    this.internalQueryBuilder.include(clause as any);
    return this as unknown as ExecutableQuery<
      ShapedResultItem<TPrimaryTable, NewInclude>[],
      TPrimaryTable,
      TFields,
      NewInclude
    >;
  }

  // values and set methods are part of the chain after insert() or update()
  // which are initiated by OrmClient.

  values(
    data:
      | Partial<InferModelType<TPrimaryTable>> // InferModelType takes one generic arg
      | Partial<InferModelType<TPrimaryTable>>[]
  ): ExecutableQuery<
    AffectedRows,
    TPrimaryTable,
    undefined,
    undefined,
    AffectedRows
  > {
    this.internalQueryBuilder.values(data);
    // When .values() is called, the result type is AffectedRows unless .returning() is called later.
    // The TReturningResult here is the default for this specific chain link.
    return this as unknown as ExecutableQuery<
      AffectedRows,
      TPrimaryTable,
      undefined,
      undefined,
      AffectedRows
    >;
  }

  set(
    data: Partial<InferModelType<TPrimaryTable>> // InferModelType takes one generic arg
  ): ExecutableQuery<
    AffectedRows,
    TPrimaryTable,
    undefined,
    undefined,
    AffectedRows
  > {
    this.internalQueryBuilder.set(data);
    return this as unknown as ExecutableQuery<
      AffectedRows,
      TPrimaryTable,
      undefined,
      undefined,
      AffectedRows
    >;
  }

  returning(fields?: SelectFields<TPrimaryTable> | true): ExecutableQuery<
    InferModelType<TPrimaryTable>[], // This becomes the TResult
    TPrimaryTable,
    TFields, // TFields from original select (or undefined for DML)
    undefined, // TInclude is undefined for DML returning
    InferModelType<TPrimaryTable>[] // This is the TReturningResult
  > {
    this.internalQueryBuilder.returning(fields);
    this._hasReturning = true;
    // The key is to cast 'this' to a new ExecutableQuery with updated TResult and TReturningResult
    return this as unknown as ExecutableQuery<
      InferModelType<TPrimaryTable>[],
      TPrimaryTable,
      TFields,
      undefined,
      InferModelType<TPrimaryTable>[]
    >;
  }

  // --- Thenable Implementation ---
  // TData is the type of the resolved value from onFulfilled
  // TResult is the type this ExecutableQuery instance is supposed to yield (could be AffectedRows or Model[])
  then<TData = TReturningResult, TError = never>(
    onFulfilled?: (value: TReturningResult) => TData | PromiseLike<TData>,
    onRejected?: (reason: any) => TError | PromiseLike<TError>
  ): Promise<TData | TError> {
    // prepare() returns PreparedQuery<TPrimaryTable, EnhancedIncludeClause | undefined>
    // TInclude is EnhancedIncludeClause | undefined, so this should be compatible with an assertion.
    const preparedQuery = this.internalQueryBuilder.prepare(
      this.client.dialect
    ) as PreparedQuery<TPrimaryTable, TInclude>;

    let executionPromise: Promise<TReturningResult>; // Use TReturningResult here

    switch (preparedQuery.action) {
      case "select":
        executionPromise = this.client.adapter.query(
          preparedQuery.sql,
          preparedQuery.parameters
        ) as Promise<TReturningResult>; // Cast to TReturningResult
        if (preparedQuery.includeClause && preparedQuery.primaryTable) {
          executionPromise = executionPromise.then((rawData) =>
            shapeResults(
              rawData as any[], // rawData is TReturningResult, shapeResults expects any[]
              preparedQuery.primaryTable as TableConfig,
              preparedQuery.includeClause
            )
          ) as Promise<TReturningResult>; // Cast result of shapeResults
        }
        break;
      case "insert":
        if (this._hasReturning && this.client.dialect === "spanner") {
          executionPromise = this.executeSpannerInsertReturning(preparedQuery);
        } else if (this._hasReturning) {
          executionPromise = this.client.adapter.query(
            preparedQuery.sql,
            preparedQuery.parameters
          ) as Promise<TReturningResult>;
        } else {
          executionPromise = this.client.adapter
            .execute(preparedQuery.sql, preparedQuery.parameters)
            .then((res: number | AffectedRows) => ({
              count: typeof res === "number" ? res : res.count ?? 0,
            })) as Promise<TReturningResult>;
        }
        break;
      case "update":
        if (this._hasReturning && this.client.dialect === "spanner") {
          executionPromise = this.executeSpannerUpdateReturning(preparedQuery);
        } else if (this._hasReturning) {
          executionPromise = this.client.adapter.query(
            preparedQuery.sql,
            preparedQuery.parameters
          ) as Promise<TReturningResult>;
        } else {
          executionPromise = this.client.adapter
            .execute(preparedQuery.sql, preparedQuery.parameters)
            .then((res: number | AffectedRows) => ({
              count: typeof res === "number" ? res : res.count ?? 0,
            })) as Promise<TReturningResult>;
        }
        break;
      case "delete":
        if (this._hasReturning && this.client.dialect === "spanner") {
          executionPromise = this.executeSpannerDeleteReturning(preparedQuery);
        } else if (this._hasReturning) {
          executionPromise = this.client.adapter.query(
            preparedQuery.sql,
            preparedQuery.parameters
          ) as Promise<TReturningResult>;
        } else {
          executionPromise = this.client.adapter
            .execute(preparedQuery.sql, preparedQuery.parameters)
            .then((res: number | AffectedRows) => ({
              count: typeof res === "number" ? res : res.count ?? 0,
            })) as Promise<TReturningResult>;
        }
        break;
      default:
        // This cast for onFulfilled might be problematic if TData is not Promise<never>
        return Promise.reject(
          new Error(`Unsupported query action: ${preparedQuery.action}`)
        ).then(onFulfilled as any, onRejected);
    }
    // The final promise should resolve to TData or TError
    return executionPromise.then(onFulfilled, onRejected);
  }

  catch<TError = never>(
    onRejected?: (reason: any) => TError | PromiseLike<TError>
  ): Promise<TReturningResult | TError> {
    // Result type is TReturningResult
    return this.then(undefined, onRejected);
  }

  // Utility to get SQL and parameters, e.g., for logging or debugging
  // The return type of prepare() is already generic and should be fine.
  toSQL(): PreparedQuery<TPrimaryTable, TInclude> {
    // PreparedQuery is generic. prepare() returns with TInclude as EnhancedIncludeClause | undefined.
    return this.internalQueryBuilder.prepare(
      this.client.dialect
    ) as PreparedQuery<TPrimaryTable, TInclude>;
  }

  private async executeSpannerInsertReturning(
    dmlPreparedQuery: PreparedQuery<TPrimaryTable, TInclude>
  ): Promise<TReturningResult> {
    await this.client.adapter.execute(
      dmlPreparedQuery.sql,
      dmlPreparedQuery.parameters
    );

    const table = this.internalQueryBuilder["_targetTable"];
    const insertValues = this.internalQueryBuilder["_insertValues"];
    if (!table || !insertValues) {
      throw new Error(
        "Spanner INSERT RETURNING: Target table or values missing."
      );
    }

    const pkColumns = Object.values(table.columns).filter((c) => c.primaryKey);
    if (pkColumns.length === 0) {
      throw new Error(
        `Spanner INSERT RETURNING: No primary key defined for table ${table.tableName}. Cannot fetch inserted rows.`
      );
    }

    const records = Array.isArray(insertValues) ? insertValues : [insertValues];
    if (records.length === 0) return [] as unknown as TReturningResult;

    // Assuming all records have PKs defined in the input
    const pkConditions: SQL[] = [];

    for (const record of records) {
      const recordPkConditions: SQL[] = [];
      for (const pkCol of pkColumns) {
        const pkValue = (record as any)[pkCol.name];
        if (pkValue === undefined) {
          throw new Error(
            `Spanner INSERT RETURNING: Primary key value for ${pkCol.name} is missing in one of the records.`
          );
        }
        recordPkConditions.push(sql`${pkCol} = ${pkValue}`);
      }
      if (recordPkConditions.length > 1) {
        // Manually construct AND conditions for composite PKs
        let andClause = recordPkConditions[0];
        for (let k = 1; k < recordPkConditions.length; k++) {
          andClause = sql`${andClause} AND ${recordPkConditions[k]}`;
        }
        pkConditions.push(sql`(${andClause})`);
      } else if (recordPkConditions.length === 1) {
        pkConditions.push(recordPkConditions[0]);
      }
    }

    let finalWhereCondition: SQL;
    if (pkConditions.length > 1) {
      // Manually construct OR conditions for multiple records
      let orClause = pkConditions[0];
      for (let k = 1; k < pkConditions.length; k++) {
        orClause = sql`${orClause} OR ${pkConditions[k]}`;
      }
      finalWhereCondition = sql`(${orClause})`;
    } else if (pkConditions.length === 1) {
      finalWhereCondition = pkConditions[0];
    } else {
      return [] as unknown as TReturningResult; // Should not happen if records.length > 0
    }

    const selectQb = new QueryBuilder<TPrimaryTable>();
    const returningFields = this.internalQueryBuilder["_returningFields"];

    if (returningFields === true) {
      selectQb.select("*");
    } else if (returningFields && typeof returningFields === "object") {
      // QueryBuilder.select expects the local SelectFields type, not CommonSelectFields
      selectQb.select(returningFields as any);
    } else {
      selectQb.select("*"); // Default to all if not specified
    }
    selectQb.from(table).where(finalWhereCondition);

    const selectPreparedQuery = selectQb.prepare(this.client.dialect);
    return this.client.adapter.query(
      selectPreparedQuery.sql,
      selectPreparedQuery.parameters
    ) as Promise<TReturningResult>;
  }

  private async executeSpannerUpdateReturning(
    dmlPreparedQuery: PreparedQuery<TPrimaryTable, TInclude>
  ): Promise<TReturningResult> {
    await this.client.adapter.execute(
      dmlPreparedQuery.sql,
      dmlPreparedQuery.parameters
    );

    const table = this.internalQueryBuilder["_targetTable"];
    if (!table) {
      throw new Error("Spanner UPDATE RETURNING: Target table missing.");
    }
    const originalConditions = this.internalQueryBuilder["_conditions"];

    const selectQb = new QueryBuilder<TPrimaryTable>();
    const returningFields = this.internalQueryBuilder["_returningFields"];

    if (returningFields === true) {
      selectQb.select("*");
    } else if (returningFields && typeof returningFields === "object") {
      selectQb.select(returningFields as any);
    } else {
      selectQb.select("*");
    }
    selectQb.from(table);
    if (originalConditions && originalConditions.length > 0) {
      originalConditions.forEach((cond) => selectQb.where(cond));
    } else {
      // Updating all rows, so select all rows. This might be dangerous / unintended.
      // Consider if a warning or error is more appropriate if WHERE clause is missing for UPDATE RETURNING.
    }

    const selectPreparedQuery = selectQb.prepare(this.client.dialect);
    return this.client.adapter.query(
      selectPreparedQuery.sql,
      selectPreparedQuery.parameters
    ) as Promise<TReturningResult>;
  }

  private async executeSpannerDeleteReturning(
    dmlPreparedQuery: PreparedQuery<TPrimaryTable, TInclude>
  ): Promise<TReturningResult> {
    const table = this.internalQueryBuilder["_targetTable"];
    if (!table) {
      throw new Error("Spanner DELETE RETURNING: Target table missing.");
    }
    const originalConditions = this.internalQueryBuilder["_conditions"];

    // 1. Select the rows that are about to be deleted
    const selectQb = new QueryBuilder<TPrimaryTable>();
    const returningFields = this.internalQueryBuilder["_returningFields"];

    if (returningFields === true) {
      selectQb.select("*");
    } else if (returningFields && typeof returningFields === "object") {
      selectQb.select(returningFields as any);
    } else {
      selectQb.select("*"); // Default to all
    }
    selectQb.from(table);
    if (originalConditions && originalConditions.length > 0) {
      originalConditions.forEach((cond) => selectQb.where(cond));
    } else {
      // Deleting all rows. This is a significant operation.
      // Fetching all rows first could be memory intensive.
    }

    const selectPreparedQuery = selectQb.prepare(this.client.dialect);
    const rowsToDelete = (await this.client.adapter.query(
      selectPreparedQuery.sql,
      selectPreparedQuery.parameters
    )) as TReturningResult;

    // 2. Execute the DELETE DML
    await this.client.adapter.execute(
      dmlPreparedQuery.sql,
      dmlPreparedQuery.parameters
    );

    // 3. Return the previously fetched rows
    return rowsToDelete;
  }
}

/**
 * Represents a raw SQL query that can be executed.
 */
export class ExecutableRawQuery<TResult = any[]> {
  constructor(protected client: OrmClient, protected sqlTemplate: SQL) {}

  then<TData = TResult, TError = never>(
    onFulfilled?: (value: TResult) => TData | PromiseLike<TData>,
    onRejected?: (reason: any) => TError | PromiseLike<TError>
  ): Promise<TData | TError> {
    // For raw queries, we assume they might return results, so use `query`
    // If a raw query is known not to return results (e.g., raw DDL),
    // the user should handle it or we might need a `executeRaw` on OrmClient.
    // SQL interface has toSqlString and getValues methods
    return this.client.adapter
      .query(
        this.sqlTemplate.toSqlString(this.client.dialect),
        this.sqlTemplate.getValues(this.client.dialect)
      )
      .then(onFulfilled as any, onRejected); // Cast onFulfilled due to TResult vs QueryResultRow[]
  }

  catch<TError = never>(
    onRejected?: (reason: any) => TError | PromiseLike<TError>
  ): Promise<TResult | TError> {
    return this.then(undefined, onRejected);
  }

  // Utility to get SQL and parameters
  getQueryParts(): { sql: string; parameters: unknown[] } {
    return {
      sql: this.sqlTemplate.toSqlString(this.client.dialect),
      parameters: this.sqlTemplate.getValues(this.client.dialect) || [],
    };
  }
}

/**
 * OrmClient is the main entry point for fluent database interactions.
 */
export class OrmClient {
  constructor(
    public adapter: DatabaseAdapter, // Made public for direct access if needed
    public dialect: Dialect // Made public for direct access if needed
  ) {}

  /**
   * Applies all pending migrations.
   * @param options Optional parameters.
   * @param options.migrationsPath Path to the migrations directory. Defaults to "./spanner-orm-migrations".
   */
  async migrateLatest(options?: { migrationsPath?: string }): Promise<void> {
    // Default migrationsPath can be handled by runPendingMigrations itself
    await runPendingMigrations(
      this.adapter,
      this.dialect,
      options?.migrationsPath
    );
  }

  /**
   * Reverts the last applied migration.
   * @param options Optional parameters.
   * @param options.migrationsPath Path to the migrations directory. Defaults to "./spanner-orm-migrations".
   */
  async migrateDown(options?: { migrationsPath?: string }): Promise<void> {
    // Default migrationsPath can be handled by revertLastMigration itself
    await revertLastMigration(
      this.adapter,
      this.dialect,
      options?.migrationsPath
    );
  }

  select<
    TPrimaryTable extends TableConfig,
    // TFields uses SelectFields from common.ts
    TSelectedFields extends SelectFields<TPrimaryTable>
  >(
    fields: TSelectedFields
  ): ExecutableQuery<
    // Result type needs to be based on TSelectedFields and TPrimaryTable
    // Using InferSelectedModelType or similar from common.ts might be appropriate
    // For now, using InferModelType<TPrimaryTable>[] as a placeholder, to be refined
    InferModelType<TPrimaryTable>[],
    TPrimaryTable,
    TSelectedFields, // Pass TSelectedFields as TFields for ExecutableQuery
    undefined
  > {
    // Pass "select" operation type, no initial table (set by .from()), and selected fields
    return new ExecutableQuery<
      InferModelType<TPrimaryTable>[],
      TPrimaryTable,
      TSelectedFields,
      undefined
    >(this, "select", undefined, fields);
  }

  insert<TPrimaryTable extends TableConfig>(
    table: TPrimaryTable
  ): ExecutableQuery<AffectedRows, TPrimaryTable, undefined, undefined> {
    // Pass "insert" operation type and the target table
    return new ExecutableQuery<
      AffectedRows,
      TPrimaryTable,
      undefined,
      undefined
    >(this, "insert", table);
  }

  update<TPrimaryTable extends TableConfig>(
    table: TPrimaryTable
  ): ExecutableQuery<AffectedRows, TPrimaryTable, undefined, undefined> {
    // Pass "update" operation type and the target table
    return new ExecutableQuery<
      AffectedRows,
      TPrimaryTable,
      undefined,
      undefined
    >(this, "update", table);
  }

  deleteFrom<TPrimaryTable extends TableConfig>(
    table: TPrimaryTable
  ): ExecutableQuery<AffectedRows, TPrimaryTable, undefined, undefined> {
    // Pass "delete" operation type and the target table
    return new ExecutableQuery<
      AffectedRows,
      TPrimaryTable,
      undefined,
      undefined
    >(this, "delete", table);
  }

  // raw<TResult = any[]>(sqlTemplate: SQL): ExecutableRawQuery<TResult> {
  //   return query; // This was the duplicated line
  // }

  raw<TResult = any[]>(sqlTemplate: SQL): ExecutableRawQuery<TResult> {
    return new ExecutableRawQuery<TResult>(this, sqlTemplate);
  }

  // Basic transaction support
  async transaction<T>(
    callback: (txClient: OrmClient) => Promise<T>
    // TODO: Add transaction options if needed by adapters
  ): Promise<T> {
    if (!this.adapter.beginTransaction) {
      throw new Error("This adapter does not support beginTransaction method.");
    }

    const tx: Transaction = await this.adapter.beginTransaction();
    // Create a new adapter instance that uses the transaction's query/execute methods
    const txAdapter: DatabaseAdapter = {
      ...this.adapter, // Copy other properties like dialect
      query: (sqlQuery: string, params?: unknown[]) =>
        tx.query(sqlQuery, params),
      execute: (sqlQuery: string, params?: unknown[]) =>
        tx.execute(sqlQuery, params),
      // Prevent nested transactions on this specific adapter instance
      beginTransaction: undefined,
    };
    const txClient = new OrmClient(txAdapter, this.dialect);

    try {
      const result = await callback(txClient);
      await tx.commit(); // Commit using the transaction object
      return result;
    } catch (error) {
      await tx.rollback(); // Rollback using the transaction object
      throw error;
    }
  }
}
