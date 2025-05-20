// import { Table } from "./schema.js"; // This was incorrect
import type {
  TableConfig,
  ColumnConfig,
  SQL,
  InferModelType,
  Dialect,
} from "../types/common.js";
// import { sql } from "../types/common.js"; // Import for potential use in conditions

// Define a type for the selection.
// It's an object where keys are aliases and values are ColumnConfig or SQL objects.
export type SelectFields = Record<
  string,
  ColumnConfig<any, any> | SQL | string // string for '*' or direct column name
>;

// Define a type for conditions. For now, we'll assume SQL objects or raw strings.
// This will be expanded for complex conditions (eq, gt, lt, and, or, etc.)
export type WhereCondition = SQL | string;

// --- JOIN Types ---
export type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL";
export interface JoinClause {
  type: JoinType;
  targetTable: TableConfig<any, any>;
  onCondition: SQL;
}

// --- ORDER BY Types ---
export type OrderDirection = "ASC" | "DESC";
export interface OrderClause {
  field: ColumnConfig<any, any> | SQL;
  direction: OrderDirection;
}

// --- GROUP BY Types ---
export type GroupByField = ColumnConfig<any, any> | SQL;

type OperationType = "select" | "insert" | "update" | "delete";

// Type for values in INSERT
type InsertData<TTable extends TableConfig<any, any>> =
  | Partial<InferModelType<TTable>>
  | Partial<InferModelType<TTable>>[];

// Type for values in UPDATE's SET clause
type UpdateData<TTable extends TableConfig<any, any>> = {
  [K in keyof InferModelType<TTable>]?: InferModelType<TTable>[K] | SQL;
};

export class QueryBuilder<TTable extends TableConfig<any, any>> {
  private _operationType?: OperationType;
  private _targetTable?: TTable; // Used for all operations

  // SELECT specific
  private _selectedFields?: SelectFields;
  private _limit?: number;
  private _offset?: number;
  private _joins: JoinClause[] = [];
  private _orderBy: OrderClause[] = [];
  private _groupBy: GroupByField[] = [];

  // INSERT specific
  private _insertValues?: InsertData<TTable>;

  // UPDATE specific
  private _updateSetValues?: UpdateData<TTable>;

  // Common for SELECT, UPDATE, DELETE
  private _conditions: WhereCondition[] = [];

  constructor() {}

  private setOperation(type: OperationType, table: TTable) {
    if (this._operationType) {
      throw new Error(
        `Cannot change operation type. Current operation: ${this._operationType}, trying to set: ${type}.`
      );
    }
    this._operationType = type;
    this._targetTable = table;
  }

  // --- SELECT Operations ---
  select(fields: SelectFields | "*" = "*"): this {
    if (this._operationType && this._operationType !== "select") {
      throw new Error(
        `Cannot call .select() for an '${this._operationType}' operation.`
      );
    }
    this._operationType = "select"; // Can be called first

    if (fields === "*") {
      this._selectedFields = { "*": "*" };
    } else {
      this._selectedFields = fields;
    }
    return this;
  }

  from(table: TTable): this {
    if (this._operationType && this._operationType !== "select") {
      throw new Error(
        `Cannot call .from() for an '${this._operationType}' operation.`
      );
    }
    if (!this._operationType) this._operationType = "select"; // If select() wasn't called first
    this._targetTable = table;
    return this;
  }

  limit(count: number): this {
    if (this._operationType !== "select") {
      throw new Error(`.limit() is only applicable to SELECT queries.`);
    }
    this._limit = count;
    return this;
  }

  offset(count: number): this {
    if (this._operationType !== "select") {
      throw new Error(`.offset() is only applicable to SELECT queries.`);
    }
    this._offset = count;
    return this;
  }

  // --- INSERT Operations ---
  insert(table: TTable): this {
    this.setOperation("insert", table);
    return this;
  }

  values(data: InsertData<TTable>): this {
    if (this._operationType !== "insert") {
      throw new Error(
        `.values() can only be called after .insert() and for an INSERT operation.`
      );
    }
    if (!this._targetTable) {
      throw new Error(
        "Target table not set for INSERT. Call .insert(table) first."
      );
    }
    this._insertValues = data;
    return this;
  }

  // --- UPDATE Operations ---
  update(table: TTable): this {
    this.setOperation("update", table);
    return this;
  }

  set(data: UpdateData<TTable>): this {
    if (this._operationType !== "update") {
      throw new Error(
        `.set() can only be called after .update() and for an UPDATE operation.`
      );
    }
    if (!this._targetTable) {
      throw new Error(
        "Target table not set for UPDATE. Call .update(table) first."
      );
    }
    this._updateSetValues = data;
    return this;
  }

  // --- DELETE Operations ---
  deleteFrom(table: TTable): this {
    this.setOperation("delete", table);
    return this;
  }

  // --- Common WHERE clause for SELECT, UPDATE, DELETE ---
  where(condition: WhereCondition): this {
    if (
      !this._operationType ||
      !["select", "update", "delete"].includes(this._operationType)
    ) {
      throw new Error(
        `.where() is not applicable for '${this._operationType}' operations or operation type not set.`
      );
    }
    this._conditions.push(condition);
    return this;
  }

  orderBy(
    field: ColumnConfig<any, any> | SQL,
    direction: OrderDirection = "ASC"
  ): this {
    if (this._operationType !== "select") {
      throw new Error(`.orderBy() is only applicable to SELECT queries.`);
    }
    this._orderBy.push({ field, direction });
    return this;
  }

  groupBy(...fields: GroupByField[]): this {
    if (this._operationType !== "select") {
      throw new Error(`.groupBy() is only applicable to SELECT queries.`);
    }
    this._groupBy.push(...fields);
    return this;
  }

  toSQL(dialect: Dialect): string {
    if (!this._operationType) {
      throw new Error(
        "Operation type not set. Call .select(), .insert(), .update(), or .deleteFrom() first."
      );
    }
    if (
      !this._targetTable &&
      this._operationType !== "select" &&
      !this._selectedFields
    ) {
      // select can infer table from from()
      throw new Error("Target table not specified for the operation.");
    }
    // For select, from() sets the target table.
    if (
      this._operationType === "select" &&
      !this._targetTable &&
      !this._selectedFields?.["*"]
    ) {
      if (!this._targetTable)
        throw new Error(
          "Source table not specified for SELECT. Use .from() to set the table."
        );
    }

    if (dialect === "postgres") {
      return this.toPgSQL();
    } else if (dialect === "spanner") {
      return this.toSpannerSQL();
    } else {
      throw new Error(`Unsupported dialect: ${dialect}`);
    }
  }

  private toPgSQL(): string {
    const paramIndexState = { value: 1 };
    switch (this._operationType) {
      case "select":
        return this.buildSelectPgSQL(paramIndexState);
      case "insert":
        return this.buildInsertPgSQL(paramIndexState);
      case "update":
        return this.buildUpdatePgSQL(paramIndexState);
      case "delete":
        return this.buildDeletePgSQL(paramIndexState);
      default:
        throw new Error(`Unsupported operation type: ${this._operationType}`);
    }
  }

  private toSpannerSQL(): string {
    const paramIndexState = { value: 1 };
    switch (this._operationType) {
      case "select":
        return this.buildSelectSpannerSQL(paramIndexState);
      case "insert":
        return this.buildInsertSpannerSQL(paramIndexState);
      case "update":
        return this.buildUpdateSpannerSQL(paramIndexState);
      case "delete":
        return this.buildDeleteSpannerSQL(paramIndexState);
      default:
        throw new Error(`Unsupported operation type: ${this._operationType}`);
    }
  }

  private buildSelectPgSQL(paramIndexState: { value: number }): string {
    if (!this._targetTable)
      throw new Error("FROM clause is missing for SELECT.");

    let selectClause = "";
    if (this._selectedFields && this._selectedFields["*"] === "*") {
      selectClause = `SELECT *`;
    } else if (this._selectedFields) {
      const selectedParts = Object.entries(this._selectedFields).map(
        ([alias, field]) => {
          let fieldName: string;
          if (typeof field === "string") {
            fieldName = field; // e.g. count(*)
          } else if ("_isSQL" in field) {
            fieldName = (field as SQL).toSqlString("postgres", paramIndexState);
          } else if ("name" in field) {
            // When selecting specific columns, they might be from joined tables.
            // Users should use sql`${table.column}` or ensure aliases are unique.
            // For simplicity, we assume column names are unique or aliased if not.
            // If ColumnConfig included table info, we could prefix here.
            fieldName = `"${(field as ColumnConfig<any, any>).name}"`;
          } else {
            throw new Error(`Invalid field type in select: ${alias}`);
          }
          const sqlObject = field as SQL;
          if (
            alias !== fieldName &&
            !(
              sqlObject &&
              sqlObject._isSQL &&
              sqlObject.toSqlString("postgres").toLowerCase().includes(" as ")
            ) &&
            !fieldName.toLowerCase().includes(" as ") &&
            alias !== "*" // Don't alias '*'
          ) {
            return `${fieldName} AS "${alias}"`;
          }
          return fieldName;
        }
      );
      selectClause = `SELECT ${selectedParts.join(", ")}`;
    } else {
      selectClause = `SELECT *`; // Default to SELECT * if no fields specified
    }

    let fromClause = `FROM "${this._targetTable.name}"`;
    if (this._joins.length > 0) {
      const joinStrings = this._joins.map(
        (join) =>
          `${join.type} JOIN "${
            join.targetTable.name
          }" ON ${join.onCondition.toSqlString("postgres", paramIndexState)}`
      );
      fromClause += ` ${joinStrings.join(" ")}`;
    }

    const whereClause = this.buildWhereClause("postgres", paramIndexState);
    const groupByClause = this.buildGroupByClause("postgres", paramIndexState);
    const orderByClause = this.buildOrderByClause("postgres", paramIndexState);
    const limitClause = this._limit !== undefined ? `LIMIT ${this._limit}` : "";
    const offsetClause =
      this._offset !== undefined ? `OFFSET ${this._offset}` : "";

    return [
      selectClause,
      fromClause,
      whereClause,
      groupByClause,
      orderByClause,
      limitClause,
      offsetClause,
    ]
      .filter(Boolean)
      .join(" ");
  }

  private buildSelectSpannerSQL(paramIndexState: { value: number }): string {
    if (!this._targetTable)
      throw new Error("FROM clause is missing for SELECT.");

    let selectClause = "";
    if (this._selectedFields && this._selectedFields["*"] === "*") {
      selectClause = `SELECT *`;
    } else if (this._selectedFields) {
      const selectedParts = Object.entries(this._selectedFields).map(
        ([alias, field]) => {
          let fieldName: string;
          if (typeof field === "string") {
            fieldName = field;
          } else if ("_isSQL" in field) {
            fieldName = (field as SQL).toSqlString("spanner", paramIndexState);
          } else if ("name" in field) {
            fieldName = `\`${(field as ColumnConfig<any, any>).name}\``;
          } else {
            throw new Error(`Invalid field type in select: ${alias}`);
          }
          const sqlObject = field as SQL;
          if (
            alias !== fieldName &&
            !(
              sqlObject &&
              sqlObject._isSQL &&
              sqlObject.toSqlString("spanner").toLowerCase().includes(" as ")
            ) &&
            !fieldName.toLowerCase().includes(" as ") &&
            alias !== "*" // Don't alias '*'
          ) {
            return `${fieldName} AS \`${alias}\``;
          }
          return fieldName;
        }
      );
      selectClause = `SELECT ${selectedParts.join(", ")}`;
    } else {
      selectClause = `SELECT *`; // Default to SELECT *
    }

    let fromClause = `FROM \`${this._targetTable.name}\``;
    if (this._joins.length > 0) {
      const joinStrings = this._joins.map(
        (join) =>
          `${join.type} JOIN \`${
            join.targetTable.name
          }\` ON ${join.onCondition.toSqlString("spanner", paramIndexState)}`
      );
      fromClause += ` ${joinStrings.join(" ")}`;
    }

    const whereClause = this.buildWhereClause("spanner", paramIndexState);
    const groupByClause = this.buildGroupByClause("spanner", paramIndexState);
    const orderByClause = this.buildOrderByClause("spanner", paramIndexState);
    const limitClause = this._limit !== undefined ? `LIMIT ${this._limit}` : "";
    const offsetClause =
      this._offset !== undefined ? `OFFSET ${this._offset}` : "";

    return [
      selectClause,
      fromClause,
      whereClause,
      groupByClause,
      orderByClause,
      limitClause,
      offsetClause,
    ]
      .filter(Boolean)
      .join(" ");
  }

  private buildInsertPgSQL(paramIndexState: { value: number }): string {
    if (!this._targetTable) throw new Error("Target table not set for INSERT.");
    if (!this._insertValues) throw new Error("Values not set for INSERT.");

    let processedInsertData: Partial<InferModelType<TTable>>[];
    if (Array.isArray(this._insertValues)) {
      processedInsertData = this._insertValues.map((record) => ({ ...record }));
    } else {
      processedInsertData = [{ ...this._insertValues }];
    }

    if (processedInsertData.length === 0) {
      throw new Error("No values provided for INSERT.");
    }

    for (const record of processedInsertData) {
      for (const [columnName, columnConfigUnk] of Object.entries(
        this._targetTable.columns
      )) {
        const columnConfig = columnConfigUnk as ColumnConfig<any, any>;
        if (record[columnName as keyof typeof record] === undefined) {
          if (typeof columnConfig.default === "function") {
            const defaultValue = (columnConfig.default as () => any)();
            (record as Record<string, any>)[columnName] = defaultValue;
          } else if (
            columnConfig.default !== undefined &&
            typeof columnConfig.default === "object" &&
            (columnConfig.default as SQL)._isSQL
          ) {
            // If default is an SQL object, add it to the record to be processed
            (record as Record<string, any>)[columnName] = columnConfig.default;
          } else if (columnConfig.default !== undefined) {
            // For non-function, non-SQL direct default values
            (record as Record<string, any>)[columnName] = columnConfig.default;
          }
        }
      }
    }

    // Determine columns from ALL keys present in ANY processed record,
    // ensuring columns with only SQL defaults are included.
    const allKeys = new Set<string>();
    processedInsertData.forEach((record) => {
      Object.keys(record as Record<string, any>).forEach((key) =>
        allKeys.add(key)
      );
    });
    const orderedKeys = Array.from(allKeys).sort();
    const columns = orderedKeys.map((col) => `"${col}"`).join(", ");

    const valuePlaceholders = processedInsertData
      .map((record) => {
        const orderedValues = orderedKeys.map(
          (key) => (record as Record<string, any>)[key]
        );
        return `(${orderedValues
          .map((val) => {
            if (
              typeof val === "object" &&
              val !== null &&
              (val as SQL)._isSQL === true
            ) {
              return (val as SQL).toSqlString("postgres", paramIndexState);
            }
            return `$${paramIndexState.value++}`;
          })
          .join(", ")})`;
      })
      .join(", ");

    return `INSERT INTO "${this._targetTable.name}" (${columns}) VALUES ${valuePlaceholders}`;
  }

  private buildInsertSpannerSQL(paramIndexState: { value: number }): string {
    if (!this._targetTable) throw new Error("Target table not set for INSERT.");
    if (!this._insertValues) throw new Error("Values not set for INSERT.");

    let processedInsertData: Partial<InferModelType<TTable>>[];
    if (Array.isArray(this._insertValues)) {
      processedInsertData = this._insertValues.map((record) => ({ ...record }));
    } else {
      processedInsertData = [{ ...this._insertValues }];
    }

    if (processedInsertData.length === 0) {
      throw new Error("No values provided for INSERT.");
    }

    for (const record of processedInsertData) {
      for (const [columnName, columnConfigUnk] of Object.entries(
        this._targetTable.columns
      )) {
        const columnConfig = columnConfigUnk as ColumnConfig<any, any>;
        if (record[columnName as keyof typeof record] === undefined) {
          if (typeof columnConfig.default === "function") {
            const defaultValue = (columnConfig.default as () => any)();
            (record as Record<string, any>)[columnName] = defaultValue;
          } else if (
            columnConfig.default !== undefined &&
            typeof columnConfig.default === "object" &&
            (columnConfig.default as SQL)._isSQL
          ) {
            (record as Record<string, any>)[columnName] = columnConfig.default;
          } else if (columnConfig.default !== undefined) {
            (record as Record<string, any>)[columnName] = columnConfig.default;
          }
        }
      }
    }

    const allKeys = new Set<string>();
    processedInsertData.forEach((record) => {
      Object.keys(record as Record<string, any>).forEach((key) =>
        allKeys.add(key)
      );
    });
    const orderedKeys = Array.from(allKeys).sort();
    const columns = orderedKeys.map((col) => `\`${col}\``).join(", ");

    const valuePlaceholders = processedInsertData
      .map((record) => {
        const orderedValues = orderedKeys.map(
          (key) => (record as Record<string, any>)[key]
        );
        return `(${orderedValues
          .map((val) => {
            if (
              typeof val === "object" &&
              val !== null &&
              (val as SQL)._isSQL === true
            ) {
              return (val as SQL).toSqlString("spanner", paramIndexState);
            }
            return `@p${paramIndexState.value++}`;
          })
          .join(", ")})`;
      })
      .join(", ");
    return `INSERT INTO \`${this._targetTable.name}\` (${columns}) VALUES ${valuePlaceholders}`;
  }

  private buildUpdatePgSQL(paramIndexState: { value: number }): string {
    if (!this._targetTable) throw new Error("Target table not set for UPDATE.");
    if (!this._updateSetValues)
      throw new Error("SET values not provided for UPDATE.");

    const setParts = Object.entries(this._updateSetValues)
      .map(([column, value]) => {
        if (typeof value === "object" && value !== null && "_isSQL" in value) {
          return `"${column}" = ${(value as SQL).toSqlString(
            "postgres",
            paramIndexState
          )}`;
        }
        return `"${column}" = $${paramIndexState.value++}`;
      })
      .join(", ");
    const whereClause = this.buildWhereClause("postgres", paramIndexState);
    return `UPDATE "${this._targetTable.name}" SET ${setParts} ${whereClause}`.trim();
  }

  private buildUpdateSpannerSQL(paramIndexState: { value: number }): string {
    if (!this._targetTable) throw new Error("Target table not set for UPDATE.");
    if (!this._updateSetValues)
      throw new Error("SET values not provided for UPDATE.");

    const setParts = Object.entries(this._updateSetValues)
      .map(([column, value]) => {
        if (typeof value === "object" && value !== null && "_isSQL" in value) {
          return `\`${column}\` = ${(value as SQL).toSqlString(
            "spanner",
            paramIndexState
          )}`;
        }
        return `\`${column}\` = @p${paramIndexState.value++}`;
      })
      .join(", ");
    const whereClause = this.buildWhereClause("spanner", paramIndexState);
    return `UPDATE \`${this._targetTable.name}\` SET ${setParts} ${whereClause}`.trim();
  }

  private buildDeletePgSQL(paramIndexState: { value: number }): string {
    if (!this._targetTable) throw new Error("Target table not set for DELETE.");
    const whereClause = this.buildWhereClause("postgres", paramIndexState);
    return `DELETE FROM "${this._targetTable.name}" ${whereClause}`.trim();
  }

  private buildDeleteSpannerSQL(paramIndexState: { value: number }): string {
    if (!this._targetTable) throw new Error("Target table not set for DELETE.");
    const whereClause = this.buildWhereClause("spanner", paramIndexState);
    return `DELETE FROM \`${this._targetTable.name}\` ${whereClause}`.trim();
  }

  private buildWhereClause(
    dialect: Dialect,
    paramIndexState: { value: number }
  ): string {
    if (this._conditions.length === 0) return "";
    const conditionsStr = this._conditions
      .map((cond) => {
        if (typeof cond === "string") return cond;
        if ("_isSQL" in cond)
          return (cond as SQL).toSqlString(dialect, paramIndexState);
        throw new Error("Invalid condition type.");
      })
      .join(" AND ");
    return `WHERE ${conditionsStr}`;
  }

  private buildOrderByClause(
    dialect: Dialect,
    paramIndexState: { value: number }
  ): string {
    if (this._orderBy.length === 0) return "";
    const orderByParts = this._orderBy.map((item) => {
      let fieldSql: string;
      if ("_isSQL" in item.field) {
        fieldSql = (item.field as SQL).toSqlString(dialect, paramIndexState);
      } else {
        // It's a ColumnConfig
        const colConfig = item.field as ColumnConfig<any, any>;
        if (colConfig._tableName) {
          fieldSql =
            dialect === "postgres"
              ? `"${colConfig._tableName}"."${colConfig.name}"`
              : `\`${colConfig._tableName}\`.\`${colConfig.name}\``;
        } else {
          fieldSql =
            dialect === "postgres"
              ? `"${colConfig.name}"`
              : `\`${colConfig.name}\``;
        }
      }
      return `${fieldSql} ${item.direction}`;
    });
    return `ORDER BY ${orderByParts.join(", ")}`;
  }

  private buildGroupByClause(
    dialect: Dialect,
    paramIndexState: { value: number }
  ): string {
    if (this._groupBy.length === 0) return "";
    const groupByParts = this._groupBy.map((field) => {
      if ("_isSQL" in field) {
        return (field as SQL).toSqlString(dialect, paramIndexState);
      } else {
        // It's a ColumnConfig
        const colConfig = field as ColumnConfig<any, any>;
        if (colConfig._tableName) {
          return dialect === "postgres"
            ? `"${colConfig._tableName}"."${colConfig.name}"`
            : `\`${colConfig._tableName}\`.\`${colConfig.name}\``;
        } else {
          return dialect === "postgres"
            ? `"${colConfig.name}"`
            : `\`${colConfig.name}\``;
        }
      }
    });
    return `GROUP BY ${groupByParts.join(", ")}`;
  }

  getBoundParameters(): unknown[] {
    const allParams: unknown[] = [];

    if (this._operationType === "select" && this._selectedFields) {
      for (const field of Object.values(this._selectedFields)) {
        if (typeof field === "object" && field !== null && "_isSQL" in field) {
          allParams.push(...(field as SQL).getValues());
        }
      }
    }

    if (
      this._operationType === "insert" &&
      this._insertValues &&
      this._targetTable
    ) {
      let processedInsertDataForParams: Partial<InferModelType<TTable>>[];
      if (Array.isArray(this._insertValues)) {
        processedInsertDataForParams = this._insertValues.map((record) => ({
          ...record,
        }));
      } else {
        processedInsertDataForParams = [{ ...this._insertValues }];
      }

      for (const record of processedInsertDataForParams) {
        for (const [columnName, columnConfigUnk] of Object.entries(
          this._targetTable.columns
        )) {
          const columnConfig = columnConfigUnk as ColumnConfig<any, any>;
          if (record[columnName as keyof typeof record] === undefined) {
            if (typeof columnConfig.default === "function") {
              const defaultValue = (columnConfig.default as () => any)();
              (record as Record<string, any>)[columnName] = defaultValue;
            } else if (
              columnConfig.default !== undefined &&
              typeof columnConfig.default === "object" &&
              (columnConfig.default as SQL)._isSQL
            ) {
              // SQL defaults don't produce bound parameters themselves,
              // but ensure the column is present if it was added.
              // The actual SQL string is inlined.
              // However, if the SQL object itself contains parameters, they need to be extracted.
              // This part is tricky: if the default is sql`FUNC(${param})`, that param needs to be collected.
              // For now, we assume SQL defaults are parameter-less or their params are handled by their .getValues()
              // when they are eventually stringified.
              // The key is that the `record` now has the SQL object.
              (record as Record<string, any>)[columnName] =
                columnConfig.default;
            } else if (columnConfig.default !== undefined) {
              (record as Record<string, any>)[columnName] =
                columnConfig.default;
            }
          }
        }
      }

      // Extract parameters based on the final state of processedInsertDataForParams
      const allKeysForParams = new Set<string>();
      processedInsertDataForParams.forEach((record) => {
        Object.keys(record as Record<string, any>).forEach((key) =>
          allKeysForParams.add(key)
        );
      });
      // Ensure consistent order for parameter collection, matching column order in SQL
      const orderedColumnNames = Array.from(allKeysForParams).sort();

      for (const record of processedInsertDataForParams) {
        for (const columnName of orderedColumnNames) {
          const value = (record as Record<string, any>)[columnName];
          if (value === undefined) {
            // This case should ideally not be hit if defaults are processed correctly
            // and all columns in allKeysForParams have a value in each record.
            continue;
          }

          if (
            typeof value === "object" &&
            value !== null &&
            (value as SQL)._isSQL === true
          ) {
            allParams.push(...(value as SQL).getValues());
          } else {
            allParams.push(value);
          }
        }
      }
    }

    if (this._operationType === "update" && this._updateSetValues) {
      for (const value of Object.values(this._updateSetValues)) {
        if (typeof value === "object" && value !== null && "_isSQL" in value) {
          allParams.push(...(value as SQL).getValues());
        } else {
          allParams.push(value);
        }
      }
    }

    // Common for SELECT, UPDATE, DELETE
    if (this._conditions) {
      for (const condition of this._conditions) {
        if (
          typeof condition === "object" &&
          condition !== null &&
          "_isSQL" in condition
        ) {
          allParams.push(...(condition as SQL).getValues());
        }
      }
    }

    // Collect params from JOIN ON conditions
    if (this._joins) {
      for (const join of this._joins) {
        allParams.push(...join.onCondition.getValues());
      }
    }

    // Collect params from ORDER BY clauses (if any field is SQL with params)
    if (this._orderBy) {
      for (const orderItem of this._orderBy) {
        if (
          typeof orderItem.field === "object" &&
          orderItem.field !== null &&
          "_isSQL" in orderItem.field
        ) {
          allParams.push(...(orderItem.field as SQL).getValues());
        }
      }
    }

    // Collect params from GROUP BY clauses (if any field is SQL with params)
    if (this._groupBy) {
      for (const groupItem of this._groupBy) {
        if (
          typeof groupItem === "object" &&
          groupItem !== null &&
          "_isSQL" in groupItem
        ) {
          allParams.push(...(groupItem as SQL).getValues());
        }
      }
    }

    return allParams;
  }

  // Placeholder for executing the query - will be dialect-specific
  // This might eventually be moved to adapter-specific classes or a core execution handler.
  // For now, it's a conceptual placeholder.
  // async execute(adapter: PgAdapter | SpannerAdapter | SQLiteAdapter): Promise<any[]> {
  //   // Determine dialect from adapter
  //   const dialect = adapter.dialect; // Assuming adapter has a dialect property
  //   const sqlString = this.toSQL(dialect as "pg" | "spanner"); // Cast needed if dialect is wider union
  //   const params = this.getBoundParameters();

  //   // Spanner expects params as Record<string, any> if using named params like @p1
  //   // Our current SQL generator uses @p1, @p2, etc. which some drivers might map from an array.
  //   // If the Spanner driver strictly needs Record<string, any> for @p1, @p2,
  //   // we'd need to transform `params` array into { p1: value1, p2: value2, ... }
  //   // For now, assuming the adapter's execute method can handle array params if placeholders are positional.
  //   if (dialect === 'spanner') {
  //      const spannerParams: Record<string, any> = {};
  //      params.forEach((p, i) => spannerParams[`p${i + 1}`] = p);
  //      return adapter.execute(sqlString, spannerParams);
  //   }
  //   return adapter.execute(sqlString, params);
  // }

  // --- JOIN Methods ---
  private addJoin(
    type: JoinType,
    table: TableConfig<any, any>,
    onCondition: SQL
  ): this {
    if (this._operationType !== "select") {
      throw new Error(`JOIN operations are only applicable to SELECT queries.`);
    }
    this._joins.push({ type, targetTable: table, onCondition });
    return this;
  }

  innerJoin(table: TableConfig<any, any>, onCondition: SQL): this {
    return this.addJoin("INNER", table, onCondition);
  }

  leftJoin(table: TableConfig<any, any>, onCondition: SQL): this {
    return this.addJoin("LEFT", table, onCondition);
  }

  // rightJoin(table: TableConfig<any, any>, onCondition: SQL): this {
  //   return this.addJoin("RIGHT", table, onCondition);
  // }

  // fullJoin(table: TableConfig<any, any>, onCondition: SQL): this {
  //   return this.addJoin("FULL", table, onCondition);
  // }
}

// Example usage (conceptual, won't run without table definitions and adapters)
// import { table, text, integer } from './schema.js'; // Note .js extension
// const usersTable = table('users', {
//   id: integer('id').primaryKey(),
//   name: text('name').notNull(),
//   email: text('email'),
//   age: integer('age'),
// });

// const qb = new QueryBuilder<typeof usersTable>();

// Example 1: Select specific fields
// const query1 = qb
//   .select({ userId: usersTable.columns.id, userName: usersTable.columns.name })
//   .from(usersTable)
//   .innerJoin(postsTable, sql`${usersTable.columns.id} = ${postsTable.columns.userId}`) // Example Join
//   .where(sql`${usersTable.columns.age} > 30`) // Assuming sql tag and column access
//   .orderBy(usersTable.columns.age, "DESC") // Example Order By
//   .groupBy(usersTable.columns.name) // Example Group By
//   .limit(10)
//   .offset(5)
//   .toSQL('pg');
// console.log("Query 1:", query1);
// Expected: SELECT "id" AS "userId", "name" AS "userName" FROM "users" WHERE age > 30 LIMIT 10 OFFSET 5 (actual field names depend on ColumnConfig)

// Example 2: Select all
// const qb2 = new QueryBuilder<typeof usersTable>();
// const query2 = qb2.select("*").from(usersTable).toSQL('pg');
// console.log("Query 2:", query2);
// Expected: SELECT * FROM "users"

// Example 3: Select with raw SQL
// const qb3 = new QueryBuilder<typeof usersTable>();
// const query3 = qb3
//   .select({ complexField: sql`CONCAT(${usersTable.columns.name}, ' (', ${usersTable.columns.age}, ')')` })
//   .from(usersTable)
//   .toSQL('pg');
// console.log("Query 3:", query3);
// Expected: SELECT CONCAT(users.name, ' (', users.age, ')') AS "complexField" FROM "users" (actual field names depend on ColumnConfig and sql tag output)

// To make it more Drizzle-like, a central `db` object could provide the entry point:
// export function createDB() { // Or however you initialize your main DB interface
//   return {
//     select: <TFields extends SelectFields>(fields: TFields) => {
//       const qb = new QueryBuilder<any>(); // `any` here is problematic, needs proper table type inference
//       return qb.select(fields);
//     },
//     // from: ... not directly chainable this way, select usually returns a builder that needs a .from()
//   };
// }
// const db = createDB();
// const queryX = db
//   .select({ id: usersTable.columns.id })
//   // .from(usersTable) // .from would be called on the QueryBuilder instance returned by select
//   // .where(...)
//   // .toSQL('pg');

// A more common Drizzle pattern:
// const dbInstance = new DrizzleLikeDB(); // where DrizzleLikeDB has a .select() method
// dbInstance.select().from(users).where(...);
// or
// dbInstance.select({field: users.id}).from(users).where(...);
// This implies QueryBuilder might be instantiated by a top-level db object.
