import type {
  DatabaseAdapter,
  Dialect,
  Transaction,
  AffectedRows, // Make sure this is exported from adapter.js
} from "./types/adapter.js";
import type {
  TableConfig,
  InferModelType,
  SelectFields,
  EnhancedIncludeClause,
  ShapedResultItem,
  SQL,
  PreparedQuery,
  ColumnConfig,
  ReturningObject, // Added
  // ReturningColumnSpec, // Not directly used in ExecutableQuery signature, but good to be aware of
} from "./types/common.js";
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
  TInclude extends EnhancedIncludeClause | undefined = undefined,
  _TReturning extends  // Prefixed with underscore
    | ReturningObject<TPrimaryTable>
    | true
    | undefined = undefined // For returning type
> {
  protected internalQueryBuilder: QueryBuilder<TPrimaryTable>;
  protected client: OrmClient;

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
  ): ExecutableQuery<TResult, TPrimaryTable, TFields, TInclude> {
    this.internalQueryBuilder.from(table);
    return this;
  }

  where(
    condition: SQL
  ): ExecutableQuery<TResult, TPrimaryTable, TFields, TInclude> {
    this.internalQueryBuilder.where(condition);
    return this;
  }

  limit(
    count: number
  ): ExecutableQuery<TResult, TPrimaryTable, TFields, TInclude> {
    this.internalQueryBuilder.limit(count);
    return this;
  }

  offset(
    count: number
  ): ExecutableQuery<TResult, TPrimaryTable, TFields, TInclude> {
    this.internalQueryBuilder.offset(count);
    return this;
  }

  orderBy(
    column: SQL | keyof TPrimaryTable["columns"],
    direction: "ASC" | "DESC" = "ASC"
  ): ExecutableQuery<TResult, TPrimaryTable, TFields, TInclude> {
    // QueryBuilder's orderBy expects ColumnConfig or SQL.
    // If keyof TPrimaryTable["columns"] is passed, it needs to be resolved or QueryBuilder needs to handle it.
    // For now, assume it's handled by SQL template or direct ColumnConfig usage.
    this.internalQueryBuilder.orderBy(
      column as SQL | ColumnConfig<any, any>,
      direction
    );
    return this;
  }

  groupBy(
    ...columns: (SQL | keyof TPrimaryTable["columns"])[]
  ): ExecutableQuery<TResult, TPrimaryTable, TFields, TInclude> {
    this.internalQueryBuilder.groupBy(
      ...(columns as (SQL | ColumnConfig<any, any>)[])
    );
    return this;
  }

  // --- Join Methods ---
  leftJoin(
    table: TableConfig<any, any>,
    onCondition: SQL
  ): ExecutableQuery<TResult, TPrimaryTable, TFields, TInclude> {
    this.internalQueryBuilder.leftJoin(table, onCondition);
    return this;
  }

  // Add other join methods (innerJoin, rightJoin, fullJoin, joinRelation, etc.) here
  // in a similar fashion if they should be part of the fluent API.
  // For example:
  // innerJoin(table: TableConfig<any, any>, onCondition: SQL): this {
  //   this.internalQueryBuilder.innerJoin(table, onCondition);
  //   return this;
  // }
  // joinRelation(relationName: string, joinType?: "INNER" | "LEFT" | "RIGHT" | "FULL"): this {
  //   this.internalQueryBuilder.joinRelation(relationName, joinType);
  //   return this;
  // }
  // leftJoinRelation(relationName: string): this {
  //   this.internalQueryBuilder.leftJoinRelation(relationName);
  //   return this;
  // }
  // innerJoinRelation(relationName: string): this {
  //   this.internalQueryBuilder.innerJoinRelation(relationName);
  //   return this;
  // }

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
  ): ExecutableQuery<AffectedRows, TPrimaryTable, undefined, undefined> {
    this.internalQueryBuilder.values(data);
    return this as unknown as ExecutableQuery<
      AffectedRows,
      TPrimaryTable,
      undefined,
      undefined
    >;
  }

  set(
    data: Partial<InferModelType<TPrimaryTable>>
  ): ExecutableQuery<
    AffectedRows,
    TPrimaryTable,
    undefined,
    undefined,
    undefined
  > {
    this.internalQueryBuilder.set(data);
    return this as unknown as ExecutableQuery<
      AffectedRows,
      TPrimaryTable,
      undefined,
      undefined,
      undefined
    >;
  }

  returning(
    fields?: ReturningObject<TPrimaryTable> | "*" | true
  ): ExecutableQuery<
    InferModelType<TPrimaryTable>[], // Placeholder, will be more specific
    TPrimaryTable,
    TFields,
    TInclude,
    ReturningObject<TPrimaryTable> | true // Update TReturning
  > {
    this.internalQueryBuilder.returning(fields);
    // The actual TResult type will depend on the 'fields' argument.
    // For now, let's assume it returns an array of the full model type.
    // This cast is a simplification; true type safety requires more complex generics.
    return this as unknown as ExecutableQuery<
      InferModelType<TPrimaryTable>[],
      TPrimaryTable,
      TFields,
      TInclude,
      ReturningObject<TPrimaryTable> | true
    >;
  }

  debug(): this {
    this.internalQueryBuilder.debug();
    return this;
  }

  // --- Thenable Implementation ---
  then<TData = TResult, TError = never>(
    onFulfilled?: (value: TResult) => TData | PromiseLike<TData>,
    onRejected?: (reason: any) => TError | PromiseLike<TError>
  ): Promise<TData | TError> {
    const preparedQuery = this.internalQueryBuilder.prepare(
      this.client.dialect
    ) as PreparedQuery<TPrimaryTable, TInclude>; // TInclude should be fine

    let executionPromise: Promise<any>;

    switch (preparedQuery.action) {
      case "select":
        executionPromise = this.client.adapter.query(
          preparedQuery.sql,
          // Parameters are passed directly; adapter handles array vs object
          preparedQuery.parameters as any // Cast to any to satisfy adapter.query, which might expect unknown[]
        );
        if (preparedQuery.includeClause && preparedQuery.primaryTable) {
          executionPromise = executionPromise.then((rawData) =>
            shapeResults(
              rawData,
              preparedQuery.primaryTable as TableConfig, // primaryTable is TPrimaryTable
              preparedQuery.includeClause // includeClause is TInclude
            )
          );
        }
        break;
      case "insert":
      case "update":
      case "delete":
        if (preparedQuery.returning) {
          // If returning clause is present, use adapter.query to get rows back
          executionPromise = this.client.adapter.query(
            preparedQuery.sql,
            preparedQuery.parameters as any // Cast to any
          );
          // Here, TResult should ideally be Array<InferReturningType<TPrimaryTable, TReturning>>
          // For now, it will be Array<InferModelType<TPrimaryTable>> or Array<Partial<...>>
          // based on the ExecutableQuery's TResult generic.
        } else {
          // Original behavior: get affected rows count
          executionPromise = this.client.adapter
            .execute(preparedQuery.sql, preparedQuery.parameters as any) // Cast to any
            .then((res: number | AffectedRows) => ({
              count:
                typeof res === "number"
                  ? res
                  : (res as AffectedRows).count ?? 0,
            }));
        }
        break;
      default:
        return Promise.reject(
          new Error(`Unsupported query action: ${preparedQuery.action}`)
        ).then(onFulfilled, onRejected);
    }

    return executionPromise.then(onFulfilled, onRejected);
  }

  catch<TError = never>(
    onRejected?: (reason: any) => TError | PromiseLike<TError>
  ): Promise<TResult | TError> {
    return this.then(undefined, onRejected);
  }

  // Utility to get SQL and parameters, e.g., for logging or debugging
  toSQL(): PreparedQuery<TPrimaryTable, TInclude> {
    // PreparedQuery is generic. prepare() returns with TInclude as EnhancedIncludeClause | undefined.
    return this.internalQueryBuilder.prepare(
      this.client.dialect
    ) as PreparedQuery<TPrimaryTable, TInclude>;
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
    // The SQL interface's getValues currently returns unknown[].
    // Adapters need to handle this. PG-like adapters expect unknown[].
    // Spanner adapter might expect Record<string, unknown>.
    // For raw queries, we'll pass what getValues provides.
    // If Spanner adapter's query/execute methods are strict about Record<string, unknown>,
    // then raw SQL with parameters for Spanner might need a different handling
    // or the SQL.getValues() needs to be dialect-aware for its return type.
    // For now, assume adapter.query can handle unknown[] for raw queries.
    const paramsForAdapter = this.sqlTemplate.getValues(this.client.dialect);

    return this.client.adapter
      .query(
        this.sqlTemplate.toSqlString(this.client.dialect),
        paramsForAdapter as any // Cast to any to satisfy adapter methods
      )
      .then(onFulfilled as any, onRejected); // Cast onFulfilled due to TResult vs QueryResultRow[]
  }

  catch<TError = never>(
    onRejected?: (reason: any) => TError | PromiseLike<TError>
  ): Promise<TResult | TError> {
    return this.then(undefined, onRejected);
  }

  // Utility to get SQL and parameters
  getQueryParts(): {
    sql: string;
    parameters: unknown[] | Record<string, unknown>;
  } {
    // SQL.getValues() returns unknown[]. If dialect is spanner, this might be an issue
    // if the expectation is Record<string, unknown> for display/debugging.
    // However, for execution, the adapter will handle it.
    // For consistency in what this method returns for "parameters",
    // we might need SQL.getValues to be more flexible or this method to adapt.
    // For now, returning what SQL.getValues gives.
    const rawParams = this.sqlTemplate.getValues(this.client.dialect);
    if (this.client.dialect === "spanner") {
      // Convert array to Spanner-like object for display consistency if desired,
      // but SQL.getValues() itself doesn't do this.
      // This is more about what getQueryParts() should show.
      // Let's return the object form for Spanner for clarity.
      const spannerParams: Record<string, unknown> = {};
      (rawParams as unknown[]).forEach((val, idx) => {
        spannerParams[`p${idx + 1}`] = val;
      });
      return {
        sql: this.sqlTemplate.toSqlString(this.client.dialect),
        parameters: spannerParams,
      };
    }
    return {
      sql: this.sqlTemplate.toSqlString(this.client.dialect),
      parameters: rawParams || [],
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
    TSelectedFields extends SelectFields<TPrimaryTable>
  >(
    fields: TSelectedFields
  ): ExecutableQuery<
    InferModelType<TPrimaryTable>[], // Placeholder, refine with InferSelectedModelType
    TPrimaryTable,
    TSelectedFields,
    undefined,
    undefined // No returning for select initially
  > {
    return new ExecutableQuery<
      InferModelType<TPrimaryTable>[],
      TPrimaryTable,
      TSelectedFields,
      undefined,
      undefined
    >(this, "select", undefined, fields);
  }

  insert<TPrimaryTable extends TableConfig>(
    table: TPrimaryTable
  ): ExecutableQuery<
    AffectedRows,
    TPrimaryTable,
    undefined,
    undefined,
    undefined
  > {
    return new ExecutableQuery<
      AffectedRows,
      TPrimaryTable,
      undefined,
      undefined,
      undefined
    >(this, "insert", table);
  }

  update<TPrimaryTable extends TableConfig>(
    table: TPrimaryTable
  ): ExecutableQuery<
    AffectedRows,
    TPrimaryTable,
    undefined,
    undefined,
    undefined
  > {
    return new ExecutableQuery<
      AffectedRows,
      TPrimaryTable,
      undefined,
      undefined,
      undefined
    >(this, "update", table);
  }

  deleteFrom<TPrimaryTable extends TableConfig>(
    table: TPrimaryTable
  ): ExecutableQuery<
    AffectedRows,
    TPrimaryTable,
    undefined,
    undefined,
    undefined
  > {
    return new ExecutableQuery<
      AffectedRows,
      TPrimaryTable,
      undefined,
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
