// src/core/query-builder.ts
import type {
  TableConfig,
  ColumnConfig,
  SQL,
  InferModelType,
  Dialect,
  IncludeClause, // Old type, kept for include() method parameter for now
  IncludeRelationOptions, // Added
  EnhancedIncludeClause, // New type
  PreparedQuery,
  ReturningObject,
  Table, // Added
  TypedIncludeRelationOptions, // Added
  EnhancedIncludeClauseEntry, // Added
  // ReturningColumnSpec, // Not directly used as type annotation here
} from "../types/common.js";
import { sql } from "../types/common.js";
import { getTableConfig } from "./schema.js";

export type SelectFields = Record<
  string,
  ColumnConfig<any, any> | SQL | string
>;
export type WhereCondition = SQL | string;
export type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL";
export interface JoinClause {
  type: JoinType;
  targetTable: TableConfig<any, any>;
  alias?: string;
  onCondition: SQL;
}
export type OrderDirection = "ASC" | "DESC";
export interface OrderClause {
  field: ColumnConfig<any, any> | SQL;
  direction: OrderDirection;
}
export type GroupByField = ColumnConfig<any, any> | SQL;
type OperationType = "select" | "insert" | "update" | "delete";
type InsertData<TTable extends TableConfig<any, any>> =
  | Partial<InferModelType<TTable>>
  | Partial<InferModelType<TTable>>[];
type UpdateData<TTable extends TableConfig<any, any>> = {
  [K in keyof InferModelType<TTable>]?: InferModelType<TTable>[K] | SQL;
};

export class QueryBuilder<TTable extends TableConfig<any, any>> {
  private _operationType?: OperationType;
  private _targetTable?: TTable;
  private _targetTableAlias?: string;

  private _tableAliases: Map<TableConfig<any, any>, string> = new Map();
  private _aliasCounter: number = 0;

  private _selectedFields?: SelectFields;
  private _limit?: number;
  private _offset?: number;
  private _joins: JoinClause[] = [];
  private _orderBy: OrderClause[] = [];
  private _groupBy: GroupByField[] = [];
  private _insertValues?: InsertData<TTable>;
  private _updateSetValues?: UpdateData<TTable>;
  private _conditions: WhereCondition[] = [];
  private _includeClause?: EnhancedIncludeClause; // Changed to EnhancedIncludeClause
  private _returningClause?: ReturningObject<TTable> | true; // Use ReturningObject
  private _debugMode: boolean = false;

  constructor() {}

  debug(): this {
    this._debugMode = true;
    return this;
  }

  private generateTableAlias(table: TableConfig<any, any>): string {
    if (!this._tableAliases.has(table)) {
      this._aliasCounter++;
      const newAlias = `t${this._aliasCounter}`;
      this._tableAliases.set(table, newAlias);
      return newAlias;
    }
    return this._tableAliases.get(table)!;
  }

  private setOperation(type: OperationType, table: TTable) {
    if (this._operationType) {
      throw new Error(
        `Cannot change operation type. Current operation: ${this._operationType}, trying to set: ${type}.`
      );
    }
    this._operationType = type;
    this._targetTable = table;
    this._targetTableAlias = this.generateTableAlias(table);
  }

  select(fields: SelectFields | "*" = "*"): this {
    if (this._operationType && this._operationType !== "select") {
      throw new Error(
        `Cannot call .select() for an '${this._operationType}' operation.`
      );
    }
    this._operationType = "select";
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
    if (!this._operationType) this._operationType = "select";
    this._targetTable = table;
    this._targetTableAlias = this.generateTableAlias(table);
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

  deleteFrom(table: TTable): this {
    this.setOperation("delete", table);
    return this;
  }

  returning(fields?: ReturningObject<TTable> | "*" | true): this {
    if (
      this._operationType !== "insert" &&
      this._operationType !== "update" &&
      this._operationType !== "delete"
    ) {
      throw new Error(
        `.returning() is only applicable to INSERT, UPDATE, or DELETE queries.`
      );
    }
    if (fields === "*" || fields === true || fields === undefined) {
      this._returningClause = true; // Means return all columns
    } else {
      // Now fields is ReturningObject<TTable>
      this._returningClause = fields;
    }
    return this;
  }

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

  include(clause: IncludeClause | EnhancedIncludeClause): this {
    if (this._operationType && this._operationType !== "select") {
      throw new Error(
        `Cannot call .include() for an '${this._operationType}' operation.`
      );
    }
    if (!this._operationType) this._operationType = "select";

    const currentEnhancedInclude = this._includeClause || {};

    for (const [relationName, relationValue] of Object.entries(clause)) {
      let targetTable: TableConfig<any, any> | Table<any, any> | undefined;
      let selectOptions: TypedIncludeRelationOptions<any>; // 'any' here is a placeholder, will be inferred

      // Check if relationValue directly provides relationTable (like EnhancedIncludeClauseEntry)
      if (
        typeof relationValue === "object" &&
        relationValue !== null &&
        "relationTable" in relationValue &&
        relationValue.relationTable // Ensure it's not undefined
      ) {
        // Input is like: { user: { relationTable: usersTableConfig, options: true } }
        // or { user: { relationTable: usersTableConfig, options: { select: { name: true } } } }
        const entry = relationValue as EnhancedIncludeClauseEntry<any>;
        targetTable = entry.relationTable;
        selectOptions = entry.options;
      } else {
        // Input is like: { user: true } or { user: { select: { name: true } } } (original IncludeClause)
        targetTable = getTableConfig(relationName);
        selectOptions = relationValue as IncludeRelationOptions; // Cast to the simpler options type
      }

      if (!targetTable) {
        console.warn(
          `QueryBuilder: Table configuration for relation "${relationName}" not found or not provided. Skipping include.`
        );
        continue;
      }

      // Ensure selectOptions is in the TypedIncludeRelationOptions format
      // If it was a simple boolean, it's fine. If it was {select: ...}, it's also fine.
      currentEnhancedInclude[relationName] = {
        relationTable: targetTable,
        options: selectOptions,
      };
    }
    this._includeClause = currentEnhancedInclude;
    return this;
  }

  /**
   * Prepares the query for execution, returning an object with SQL, parameters, and metadata.
   * @param dialect The SQL dialect.
   * @returns A PreparedQuery object.
   */
  prepare(
    dialect: Dialect
  ): PreparedQuery<TTable, EnhancedIncludeClause | undefined> {
    if (!this._operationType) {
      throw new Error("Operation type not set.");
    }
    if (
      !this._targetTable &&
      this._operationType !== "select" &&
      !this._selectedFields
    ) {
      throw new Error("Target table not specified.");
    }
    if (
      this._operationType === "select" &&
      !this._targetTable &&
      !this._selectedFields?.["*"]
    ) {
      if (!this._targetTable)
        throw new Error("Source table not specified for SELECT.");
    }

    const finalAliasMap = new Map<string, string>();
    this._tableAliases.forEach((alias, tableConfig) => {
      finalAliasMap.set(tableConfig.tableName, alias);
    });
    if (
      this._targetTable &&
      this._targetTableAlias &&
      !finalAliasMap.has(this._targetTable.tableName)
    ) {
      finalAliasMap.set(this._targetTable.tableName, this._targetTableAlias);
    }

    let sqlString: string;
    if (dialect === "postgres") {
      sqlString = this.toPgSQL(finalAliasMap);
    } else if (dialect === "spanner") {
      sqlString = this.toSpannerSQL(finalAliasMap);
    } else {
      throw new Error(`Unsupported dialect: ${dialect}`);
    }

    if (!this._operationType) {
      // Should have been caught earlier, but as a safeguard
      throw new Error("Operation type is undefined during prepare.");
    }

    const { values: paramValues, spannerTypes: paramSpannerTypes } =
      this.getBoundParametersAndTypes(dialect);

    let finalParams: unknown[] | Record<string, unknown>;
    let finalSpannerParamTypeHints: Record<string, string> | undefined;

    if (dialect === "spanner") {
      const spannerP: Record<string, unknown> = {};
      const spannerTH: Record<string, string> = {};
      paramValues.forEach((val, idx) => {
        const pName = `p${idx + 1}`;
        spannerP[pName] = val;
        if (paramSpannerTypes && paramSpannerTypes[idx]) {
          spannerTH[pName] = paramSpannerTypes[idx]!;
        }
      });
      finalParams = spannerP;
      finalSpannerParamTypeHints =
        Object.keys(spannerTH).length > 0 ? spannerTH : undefined;
    } else {
      finalParams = paramValues;
      finalSpannerParamTypeHints = undefined;
    }

    if (this._debugMode) {
      console.log("--- SQL Query ---");
      console.log(sqlString);
      console.log("--- Parameters ---");
      console.log(finalParams);
      if (finalSpannerParamTypeHints) {
        console.log("--- Spanner Type Hints ---");
        console.log(finalSpannerParamTypeHints);
      }
      console.log("-----------------");
    }

    return {
      sql: sqlString,
      parameters: finalParams,
      dialect: dialect,
      action: this._operationType, // Add the action here
      includeClause:
        this._operationType === "select" ? this._includeClause : undefined,
      primaryTable: this._targetTable, // Keep primaryTable for all operations for returning()
      fields:
        this._operationType === "select"
          ? (this._selectedFields as any)
          : undefined, // Add selected fields
      returning: this._returningClause, // Add returning clause info
      spannerParamTypeHints: finalSpannerParamTypeHints,
    };
  }

  private toPgSQL(aliasMap: Map<string, string>): string {
    const paramIndexState = { value: 1 };
    switch (this._operationType) {
      case "select":
        return this.buildSelectPgSQL(paramIndexState, aliasMap);
      case "insert":
        return this.buildInsertPgSQL(paramIndexState, aliasMap);
      case "update":
        return this.buildUpdatePgSQL(paramIndexState, aliasMap);
      case "delete":
        return this.buildDeletePgSQL(paramIndexState, aliasMap);
      default:
        throw new Error(`Unsupported operation type: ${this._operationType}`);
    }
  }

  private toSpannerSQL(aliasMap: Map<string, string>): string {
    const paramIndexState = { value: 1 };
    switch (this._operationType) {
      case "select":
        return this.buildSelectSpannerSQL(paramIndexState, aliasMap);
      case "insert":
        return this.buildInsertSpannerSQL(paramIndexState, aliasMap);
      case "update":
        return this.buildUpdateSpannerSQL(paramIndexState, aliasMap);
      case "delete":
        return this.buildDeleteSpannerSQL(paramIndexState, aliasMap);
      default:
        throw new Error(`Unsupported operation type: ${this._operationType}`);
    }
  }

  private buildSelectPgSQL(
    paramIndexState: { value: number },
    aliasMap: Map<string, string>
  ): string {
    if (!this._targetTable || !this._targetTableAlias)
      throw new Error("FROM clause or its alias is missing for SELECT.");

    const originalJoins = [...this._joins];
    const includeJoins: JoinClause[] = [];
    const selectedFieldsFromIncludes: SelectFields = {};

    if (this._includeClause) {
      for (const [relationName, enhancedIncludeEntry] of Object.entries(
        this._includeClause
      )) {
        // const relatedTableConfig = getTableConfig(relationName); // Now directly available
        const relatedTableConfig = enhancedIncludeEntry.relationTable;
        const includeOptions = enhancedIncludeEntry.options; // This is the boolean or {select?: ...}

        if (!relatedTableConfig) {
          // Should not happen if include() worked correctly
          console.warn(
            `Warning: Could not find table config for relation "${relationName}" to include.`
          );
          continue;
        }

        let foreignKeyColumn: ColumnConfig<any, any> | undefined;
        let referencedColumnInParent: ColumnConfig<any, any> | undefined;

        for (const col of Object.values(relatedTableConfig.columns)) {
          const colConfig = col as ColumnConfig<any, any>;
          if (colConfig.references) {
            const referencedCol = colConfig.references.referencesFn();
            if (referencedCol._tableName === this._targetTable.tableName) {
              foreignKeyColumn = colConfig;
              referencedColumnInParent = referencedCol;
              break;
            }
          }
        }

        if (!foreignKeyColumn || !referencedColumnInParent) {
          console.warn(
            `Warning: Could not determine foreign key relationship between "${this._targetTable.tableName}" and "${relationName}".`
          );
          continue;
        }

        const relatedTableAlias = this.generateTableAlias(relatedTableConfig);
        aliasMap.set(relatedTableConfig.tableName, relatedTableAlias);

        const onCondition = sql`${foreignKeyColumn} = ${referencedColumnInParent}`;

        includeJoins.push({
          type: "LEFT",
          targetTable: relatedTableConfig,
          alias: relatedTableAlias,
          onCondition: onCondition,
        });

        const relationOpts =
          typeof includeOptions === "object" && includeOptions !== null
            ? includeOptions
            : {};
        const selectAllRelated =
          includeOptions === true ||
          (typeof includeOptions === "object" && !includeOptions.select);

        for (const [relatedColKey, relatedColConfigUntyped] of Object.entries(
          relatedTableConfig.columns
        )) {
          const relatedColConfig = relatedColConfigUntyped as ColumnConfig<
            any,
            any
          >;
          if (
            selectAllRelated ||
            (relationOpts.select && relationOpts.select[relatedColKey])
          ) {
            const actualColumnName = relatedColConfig.name;
            const selectAlias = `${relationName}__${actualColumnName}`;
            selectedFieldsFromIncludes[selectAlias] = relatedColConfig;
          }
        }
      }
    }

    const allJoins = [...originalJoins, ...includeJoins];

    let selectClause = "";
    const explicitUserSelectedFields = { ...(this._selectedFields || {}) };
    const allSelectedParts: string[] = [];

    if (explicitUserSelectedFields["*"] === "*") {
      allSelectedParts.push(`"${this._targetTableAlias}".*`);
      if (
        Object.keys(explicitUserSelectedFields).length > 1 ||
        Object.keys(selectedFieldsFromIncludes).length > 0
      ) {
        delete explicitUserSelectedFields["*"];
      }
    }

    Object.entries(explicitUserSelectedFields).map(([alias, field]) => {
      let fieldName: string;
      if (typeof field === "string") {
        fieldName = field;
      } else if ("_isSQL" in field) {
        fieldName = (field as SQL).toSqlString(
          "postgres",
          paramIndexState,
          aliasMap
        );
      } else if ("name" in field) {
        const colConfig = field as ColumnConfig<any, any>;
        const tableAlias = colConfig._tableName
          ? aliasMap.get(colConfig._tableName)
          : this._targetTableAlias;
        if (!tableAlias) {
          throw new Error(
            `PG Alias not found for table of column: ${colConfig.name} (table: ${colConfig._tableName})`
          );
        }
        fieldName = `"${tableAlias}"."${colConfig.name}"`;
      } else {
        throw new Error(`Invalid field type in select: ${alias}`);
      }
      if (alias !== "*" && !fieldName.toLowerCase().includes(" as ")) {
        allSelectedParts.push(`${fieldName} AS "${alias}"`);
      } else {
        allSelectedParts.push(fieldName);
      }
    });

    Object.entries(selectedFieldsFromIncludes).map(([alias, field]) => {
      const colConfig = field as ColumnConfig<any, any>;
      const tableAlias = aliasMap.get(colConfig._tableName!);
      if (!tableAlias) {
        throw new Error(
          `PG Alias not found for included column's table: ${colConfig._tableName}`
        );
      }
      const fieldName = `"${tableAlias}"."${colConfig.name}"`;
      allSelectedParts.push(`${fieldName} AS "${alias}"`);
    });

    if (!selectClause && allSelectedParts.length > 0) {
      selectClause = `SELECT ${allSelectedParts.join(", ")}`;
    } else if (
      !selectClause &&
      Object.keys(explicitUserSelectedFields).length === 0 &&
      Object.keys(selectedFieldsFromIncludes).length === 0
    ) {
      if (
        this._selectedFields === undefined ||
        Object.keys(this._selectedFields).length === 0
      ) {
        selectClause = `SELECT "${this._targetTableAlias}".*`;
      }
    }

    if (!selectClause) {
      selectClause = `SELECT "${this._targetTableAlias}".*`;
    }

    if (
      this._selectedFields &&
      this._selectedFields["*"] === "*" &&
      Object.keys(this._selectedFields).length === 1 &&
      allJoins.length === 0 &&
      Object.keys(selectedFieldsFromIncludes).length === 0
    ) {
      selectClause = `SELECT *`;
    } else if (
      this._selectedFields &&
      this._selectedFields["*"] === "*" &&
      Object.keys(this._selectedFields).length === 1 &&
      allJoins.length > 0 &&
      Object.keys(selectedFieldsFromIncludes).length === 0
    ) {
      selectClause = `SELECT "${this._targetTableAlias}".*`;
    }

    let fromClause = `FROM "${this._targetTable.tableName}" AS "${this._targetTableAlias}"`;
    if (allJoins.length > 0) {
      const joinStrings = allJoins.map((join) => {
        const joinTableAlias = aliasMap.get(join.targetTable.tableName);
        if (!joinTableAlias)
          throw new Error(
            `Alias not found for join table: ${
              join.targetTable.tableName
            }. Alias map: ${JSON.stringify(Array.from(aliasMap.entries()))}`
          );
        return `${join.type} JOIN "${
          join.targetTable.tableName
        }" AS "${joinTableAlias}" ON ${join.onCondition.toSqlString(
          "postgres",
          paramIndexState,
          aliasMap
        )}`;
      });
      fromClause += ` ${joinStrings.join(" ")}`;
    }

    const whereClause = this.buildWhereClause(
      "postgres",
      paramIndexState,
      aliasMap
    );
    const groupByClause = this.buildGroupByClause(
      "postgres",
      paramIndexState,
      aliasMap
    );
    const orderByClause = this.buildOrderByClause(
      "postgres",
      paramIndexState,
      aliasMap
    );
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

  private buildSelectSpannerSQL(
    paramIndexState: { value: number },
    aliasMap: Map<string, string>
  ): string {
    if (!this._targetTable || !this._targetTableAlias)
      throw new Error("FROM clause or its alias is missing for SELECT.");

    const originalJoins = [...this._joins];
    const includeJoins: JoinClause[] = [];
    const selectedFieldsFromIncludes: SelectFields = {};

    if (this._includeClause) {
      for (const [relationName, enhancedIncludeEntry] of Object.entries(
        this._includeClause
      )) {
        // const relatedTableConfig = getTableConfig(relationName); // Now directly available
        const relatedTableConfig = enhancedIncludeEntry.relationTable;
        const includeOptions = enhancedIncludeEntry.options; // This is the boolean or {select?: ...}

        if (!relatedTableConfig) {
          // Should not happen if include() worked correctly
          console.warn(
            `Warning: Spanner - Could not find table config for relation "${relationName}" to include.`
          );
          continue;
        }

        let foreignKeyColumn: ColumnConfig<any, any> | undefined;
        let referencedColumnInParent: ColumnConfig<any, any> | undefined;

        for (const col of Object.values(relatedTableConfig.columns)) {
          const colConfig = col as ColumnConfig<any, any>;
          if (colConfig.references) {
            const referencedCol = colConfig.references.referencesFn();
            if (referencedCol._tableName === this._targetTable.tableName) {
              foreignKeyColumn = colConfig;
              referencedColumnInParent = referencedCol;
              break;
            }
          }
        }

        if (!foreignKeyColumn || !referencedColumnInParent) {
          console.warn(
            `Warning: Spanner - Could not determine foreign key relationship between "${this._targetTable.tableName}" and "${relationName}".`
          );
          continue;
        }

        const relatedTableAlias = this.generateTableAlias(relatedTableConfig);
        aliasMap.set(relatedTableConfig.tableName, relatedTableAlias);

        const onCondition = sql`${foreignKeyColumn} = ${referencedColumnInParent}`;
        includeJoins.push({
          type: "LEFT",
          targetTable: relatedTableConfig,
          alias: relatedTableAlias,
          onCondition: onCondition,
        });

        const relationOpts =
          typeof includeOptions === "object" && includeOptions !== null
            ? includeOptions
            : {};
        const selectAllRelated =
          includeOptions === true ||
          (typeof includeOptions === "object" && !includeOptions.select);

        for (const [relatedColKey, relatedColConfigUntyped] of Object.entries(
          relatedTableConfig.columns
        )) {
          const relatedColConfig = relatedColConfigUntyped as ColumnConfig<
            any,
            any
          >;
          if (
            selectAllRelated ||
            (relationOpts.select && relationOpts.select[relatedColKey])
          ) {
            const actualColumnName = relatedColConfig.name;
            const selectAlias = `${relationName}__${actualColumnName}`;
            selectedFieldsFromIncludes[selectAlias] = relatedColConfig;
          }
        }
      }
    }
    const allJoins = [...originalJoins, ...includeJoins];

    let selectClause = "";
    const explicitUserSelectedFieldsSpanner = {
      ...(this._selectedFields || {}),
    };
    const allSelectedPartsSpanner: string[] = [];

    if (explicitUserSelectedFieldsSpanner["*"] === "*") {
      allSelectedPartsSpanner.push(`\`${this._targetTableAlias}\`.*`);
      if (
        Object.keys(explicitUserSelectedFieldsSpanner).length > 1 ||
        Object.keys(selectedFieldsFromIncludes).length > 0
      ) {
        delete explicitUserSelectedFieldsSpanner["*"];
      }
    }

    Object.entries(explicitUserSelectedFieldsSpanner).map(([alias, field]) => {
      let fieldName: string;
      if (typeof field === "string") {
        fieldName = field;
      } else if ("_isSQL" in field) {
        fieldName = (field as SQL).toSqlString(
          "spanner",
          paramIndexState,
          aliasMap
        );
      } else if ("name" in field) {
        const colConfig = field as ColumnConfig<any, any>;
        const tableAlias = colConfig._tableName
          ? aliasMap.get(colConfig._tableName)
          : this._targetTableAlias;
        if (!tableAlias)
          throw new Error(
            `Spanner Alias not found for table of column: ${colConfig.name} (table: ${colConfig._tableName})`
          );
        fieldName = `\`${tableAlias}\`.\`${colConfig.name}\``;
      } else {
        throw new Error(`Invalid field type in select: ${alias}`);
      }
      if (alias !== "*" && !fieldName.toLowerCase().includes(" as ")) {
        allSelectedPartsSpanner.push(`${fieldName} AS \`${alias}\``);
      } else {
        allSelectedPartsSpanner.push(fieldName);
      }
    });

    Object.entries(selectedFieldsFromIncludes).map(([alias, field]) => {
      const colConfig = field as ColumnConfig<any, any>;
      const tableAlias = aliasMap.get(colConfig._tableName!);
      if (!tableAlias) {
        throw new Error(
          `Spanner Alias not found for included column's table: ${colConfig._tableName}`
        );
      }
      const fieldName = `\`${tableAlias}\`.\`${colConfig.name}\``;
      allSelectedPartsSpanner.push(`${fieldName} AS \`${alias}\``);
    });

    if (!selectClause && allSelectedPartsSpanner.length > 0) {
      selectClause = `SELECT ${allSelectedPartsSpanner.join(", ")}`;
    } else if (
      !selectClause &&
      Object.keys(explicitUserSelectedFieldsSpanner).length === 0 &&
      Object.keys(selectedFieldsFromIncludes).length === 0
    ) {
      if (
        this._selectedFields === undefined ||
        Object.keys(this._selectedFields).length === 0
      ) {
        selectClause = `SELECT \`${this._targetTableAlias}\`.*`;
      }
    }

    if (!selectClause) {
      selectClause = `SELECT \`${this._targetTableAlias}\`.*`;
    }

    if (
      this._selectedFields &&
      this._selectedFields["*"] === "*" &&
      Object.keys(this._selectedFields).length === 1 &&
      allJoins.length === 0 &&
      Object.keys(selectedFieldsFromIncludes).length === 0
    ) {
      selectClause = `SELECT *`;
    } else if (
      this._selectedFields &&
      this._selectedFields["*"] === "*" &&
      Object.keys(this._selectedFields).length === 1 &&
      allJoins.length > 0 &&
      Object.keys(selectedFieldsFromIncludes).length === 0
    ) {
      selectClause = `SELECT \`${this._targetTableAlias}\`.*`;
    }

    let fromClause = `FROM \`${this._targetTable.tableName}\` AS \`${this._targetTableAlias}\``;
    if (allJoins.length > 0) {
      const joinStrings = allJoins.map((join) => {
        const joinTableAlias = aliasMap.get(join.targetTable.tableName);
        if (!joinTableAlias)
          throw new Error(
            `Alias not found for join table: ${join.targetTable.tableName}`
          );
        return `${join.type} JOIN \`${
          join.targetTable.tableName
        }\` AS \`${joinTableAlias}\` ON ${join.onCondition.toSqlString(
          "spanner",
          paramIndexState,
          aliasMap
        )}`;
      });
      fromClause += ` ${joinStrings.join(" ")}`;
    }

    const whereClause = this.buildWhereClause(
      "spanner",
      paramIndexState,
      aliasMap
    );
    const groupByClause = this.buildGroupByClause(
      "spanner",
      paramIndexState,
      aliasMap
    );
    const orderByClause = this.buildOrderByClause(
      "spanner",
      paramIndexState,
      aliasMap
    );
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

  private buildInsertPgSQL(
    paramIndexState: { value: number },
    aliasMap: Map<string, string>
  ): string {
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
    const columns = orderedKeys
      .map((tsKey) => {
        const columnConfig = this._targetTable!.columns[tsKey] as ColumnConfig<
          any,
          any
        >;
        if (!columnConfig)
          throw new Error(
            `Column config not found for key ${tsKey} in table ${
              this._targetTable!.tableName
            }`
          );
        return `"${columnConfig.name}"`;
      })
      .join(", ");

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
              return (val as SQL).toSqlString(
                "postgres",
                paramIndexState,
                aliasMap
              );
            }
            return `$${paramIndexState.value++}`;
          })
          .join(", ")})`;
      })
      .join(", ");

    let sql = `INSERT INTO "${this._targetTable.tableName}" (${columns}) VALUES ${valuePlaceholders}`;
    if (this._returningClause) {
      if (this._returningClause === true) {
        sql += ` RETURNING *`;
      } else {
        // this._returningClause is ReturningObject<TTable>
        const returningColumns = Object.entries(this._returningClause)
          .map(([alias, fieldSpec]) => {
            // fieldSpec is ReturningColumnSpec<TTable>
            if (typeof fieldSpec === "string") {
              // It's a TypeScript key string, used as alias
              const tsKey = fieldSpec as string;
              const columnConfig = this._targetTable!.columns[
                tsKey
              ] as ColumnConfig<any, any>;
              if (!columnConfig)
                throw new Error(
                  `Column config not found for returning key ${tsKey} in table ${
                    this._targetTable!.tableName
                  }`
                );
              return `"${columnConfig.name}" AS "${alias}"`;
            } else if ("_isSQL" in fieldSpec) {
              // It's an SQL object
              return `${(fieldSpec as SQL).toSqlString(
                "postgres",
                paramIndexState,
                aliasMap
              )} AS "${alias}"`;
            } else {
              // It's a ColumnConfig object
              const colConfig = fieldSpec as ColumnConfig<any, any>;
              return `"${colConfig.name}" AS "${alias}"`;
            }
          })
          .join(", ");
        if (returningColumns) {
          sql += ` RETURNING ${returningColumns}`;
        } else {
          // Default to RETURNING * if _returningClause is an empty object (edge case)
          sql += ` RETURNING *`;
        }
      }
    }
    return sql;
  }

  private buildInsertSpannerSQL(
    paramIndexState: { value: number },
    aliasMap: Map<string, string>
  ): string {
    if (!this._targetTable) throw new Error("Target table not set for INSERT.");
    if (!this._insertValues) throw new Error("Values not set for INSERT.");

    let processedInsertData: Partial<InferModelType<TTable>>[];
    if (Array.isArray(this._insertValues)) {
      processedInsertData = this._insertValues.map((record) => ({ ...record }));
    } else {
      processedInsertData = [{ ...this._insertValues }];
    }
    if (processedInsertData.length === 0)
      throw new Error("No values provided for INSERT.");

    for (const record of processedInsertData) {
      for (const [columnName, columnConfigUnk] of Object.entries(
        this._targetTable.columns
      )) {
        const columnConfig = columnConfigUnk as ColumnConfig<any, any>;
        if (record[columnName as keyof typeof record] === undefined) {
          if (typeof columnConfig.default === "function") {
            (record as Record<string, any>)[columnName] = (
              columnConfig.default as () => any
            )();
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
    const columns = orderedKeys
      .map((tsKey) => {
        const columnConfig = this._targetTable!.columns[tsKey] as ColumnConfig<
          any,
          any
        >;
        if (!columnConfig)
          throw new Error(
            `Column config not found for key ${tsKey} in table ${
              this._targetTable!.tableName
            }`
          );
        return `\`${columnConfig.name}\``;
      })
      .join(", ");

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
              return (val as SQL).toSqlString(
                "spanner",
                paramIndexState,
                aliasMap
              );
            }
            return `@p${paramIndexState.value++}`;
          })
          .join(", ")})`;
      })
      .join(", ");

    let sql = `INSERT INTO \`${this._targetTable.tableName}\` (${columns}) VALUES ${valuePlaceholders}`;
    if (this._returningClause) {
      if (this._returningClause === true) {
        sql += ` THEN RETURN *`;
      } else {
        // this._returningClause is ReturningObject<TTable>
        const returningColumns = Object.entries(this._returningClause)
          .map(([alias, fieldSpec]) => {
            // fieldSpec is ReturningColumnSpec<TTable>
            if (typeof fieldSpec === "string") {
              const tsKey = fieldSpec as string;
              const columnConfig = this._targetTable!.columns[
                tsKey
              ] as ColumnConfig<any, any>;
              if (!columnConfig)
                throw new Error(
                  `Column config not found for returning key ${tsKey} in table ${
                    this._targetTable!.tableName
                  }`
                );
              return `\`${columnConfig.name}\` AS \`${alias}\``;
            } else if ("_isSQL" in fieldSpec) {
              return `${(fieldSpec as SQL).toSqlString(
                "spanner",
                paramIndexState,
                aliasMap
              )} AS \`${alias}\``;
            } else {
              const colConfig = fieldSpec as ColumnConfig<any, any>;
              return `\`${colConfig.name}\` AS \`${alias}\``;
            }
          })
          .join(", ");
        if (returningColumns) {
          sql += ` THEN RETURN ${returningColumns}`;
        } else {
          sql += ` THEN RETURN *`;
        }
      }
    }
    return sql;
  }

  private buildUpdatePgSQL(
    paramIndexState: { value: number },
    aliasMap: Map<string, string>
  ): string {
    if (!this._targetTable) throw new Error("Target table not set for UPDATE.");
    if (!this._updateSetValues)
      throw new Error("SET values not provided for UPDATE.");

    const setParts = Object.entries(this._updateSetValues)
      .map(([tsKey, value]) => {
        const columnConfig = this._targetTable!.columns[tsKey] as ColumnConfig<
          any,
          any
        >;
        if (!columnConfig)
          throw new Error(
            `Column config not found for key ${tsKey} in table ${
              this._targetTable!.tableName
            }`
          );
        const sqlColumnName = columnConfig.name;
        if (typeof value === "object" && value !== null && "_isSQL" in value) {
          return `"${sqlColumnName}" = ${(value as SQL).toSqlString(
            "postgres",
            paramIndexState,
            aliasMap
          )}`;
        }
        return `"${sqlColumnName}" = $${paramIndexState.value++}`;
      })
      .join(", ");
    const whereClause = this.buildWhereClause(
      "postgres",
      paramIndexState,
      aliasMap
    );
    let sql =
      `UPDATE "${this._targetTable.tableName}" SET ${setParts} ${whereClause}`.trim();
    if (this._returningClause) {
      if (this._returningClause === true) {
        sql += ` RETURNING *`;
      } else {
        const returningColumns = Object.entries(this._returningClause)
          .map(([alias, fieldSpec]) => {
            if (typeof fieldSpec === "string") {
              const tsKey = fieldSpec as string;
              const columnConfig = this._targetTable!.columns[
                tsKey
              ] as ColumnConfig<any, any>;
              if (!columnConfig)
                throw new Error(
                  `Column config not found for returning key ${tsKey} in table ${
                    this._targetTable!.tableName
                  }`
                );
              return `"${columnConfig.name}" AS "${alias}"`;
            } else if ("_isSQL" in fieldSpec) {
              return `${(fieldSpec as SQL).toSqlString(
                "postgres",
                paramIndexState,
                aliasMap
              )} AS "${alias}"`;
            } else {
              const colConfig = fieldSpec as ColumnConfig<any, any>;
              return `"${colConfig.name}" AS "${alias}"`;
            }
          })
          .join(", ");
        if (returningColumns) {
          sql += ` RETURNING ${returningColumns}`;
        } else {
          sql += ` RETURNING *`;
        }
      }
    }
    return sql;
  }

  private buildUpdateSpannerSQL(
    paramIndexState: { value: number },
    aliasMap: Map<string, string>
  ): string {
    if (!this._targetTable) throw new Error("Target table not set for UPDATE.");
    if (!this._updateSetValues)
      throw new Error("SET values not provided for UPDATE.");
    const setParts = Object.entries(this._updateSetValues)
      .map(([tsKey, value]) => {
        const columnConfig = this._targetTable!.columns[tsKey] as ColumnConfig<
          any,
          any
        >;
        if (!columnConfig)
          throw new Error(
            `Column config not found for key ${tsKey} in table ${
              this._targetTable!.tableName
            }`
          );
        const sqlColumnName = columnConfig.name;
        if (typeof value === "object" && value !== null && "_isSQL" in value) {
          return `\`${sqlColumnName}\` = ${(value as SQL).toSqlString(
            "spanner",
            paramIndexState,
            aliasMap
          )}`;
        }
        return `\`${sqlColumnName}\` = @p${paramIndexState.value++}`;
      })
      .join(", ");
    const whereClause = this.buildWhereClause(
      "spanner",
      paramIndexState,
      aliasMap
    );
    let sql =
      `UPDATE \`${this._targetTable.tableName}\` SET ${setParts} ${whereClause}`.trim();
    if (this._returningClause) {
      if (this._returningClause === true) {
        sql += ` THEN RETURN *`;
      } else {
        const returningColumns = Object.entries(this._returningClause)
          .map(([alias, fieldSpec]) => {
            if (typeof fieldSpec === "string") {
              const tsKey = fieldSpec as string;
              const columnConfig = this._targetTable!.columns[
                tsKey
              ] as ColumnConfig<any, any>;
              if (!columnConfig)
                throw new Error(
                  `Column config not found for returning key ${tsKey} in table ${
                    this._targetTable!.tableName
                  }`
                );
              return `\`${columnConfig.name}\` AS \`${alias}\``;
            } else if ("_isSQL" in fieldSpec) {
              return `${(fieldSpec as SQL).toSqlString(
                "spanner",
                paramIndexState,
                aliasMap
              )} AS \`${alias}\``;
            } else {
              const colConfig = fieldSpec as ColumnConfig<any, any>;
              return `\`${colConfig.name}\` AS \`${alias}\``;
            }
          })
          .join(", ");
        if (returningColumns) {
          sql += ` THEN RETURN ${returningColumns}`;
        } else {
          sql += ` THEN RETURN *`;
        }
      }
    }
    return sql;
  }

  private buildDeletePgSQL(
    paramIndexState: { value: number },
    aliasMap: Map<string, string>
  ): string {
    if (!this._targetTable) throw new Error("Target table not set for DELETE.");
    const whereClause = this.buildWhereClause(
      "postgres",
      paramIndexState,
      aliasMap
    );
    let sql =
      `DELETE FROM "${this._targetTable.tableName}" ${whereClause}`.trim();
    if (this._returningClause) {
      if (this._returningClause === true) {
        sql += ` RETURNING *`;
      } else {
        const returningColumns = Object.entries(this._returningClause)
          .map(([alias, fieldSpec]) => {
            if (typeof fieldSpec === "string") {
              const tsKey = fieldSpec as string;
              const columnConfig = this._targetTable!.columns[
                tsKey
              ] as ColumnConfig<any, any>;
              if (!columnConfig)
                throw new Error(
                  `Column config not found for returning key ${tsKey} in table ${
                    this._targetTable!.tableName
                  }`
                );
              return `"${columnConfig.name}" AS "${alias}"`;
            } else if ("_isSQL" in fieldSpec) {
              return `${(fieldSpec as SQL).toSqlString(
                "postgres",
                paramIndexState,
                aliasMap
              )} AS "${alias}"`;
            } else {
              const colConfig = fieldSpec as ColumnConfig<any, any>;
              return `"${colConfig.name}" AS "${alias}"`;
            }
          })
          .join(", ");
        if (returningColumns) {
          sql += ` RETURNING ${returningColumns}`;
        } else {
          sql += ` RETURNING *`;
        }
      }
    }
    return sql;
  }

  private buildDeleteSpannerSQL(
    paramIndexState: { value: number },
    aliasMap: Map<string, string>
  ): string {
    if (!this._targetTable) throw new Error("Target table not set for DELETE.");
    const whereClause = this.buildWhereClause(
      "spanner",
      paramIndexState,
      aliasMap
    );
    let sql =
      `DELETE FROM \`${this._targetTable.tableName}\` ${whereClause}`.trim();
    if (this._returningClause) {
      if (this._returningClause === true) {
        sql += ` THEN RETURN *`;
      } else {
        const returningColumns = Object.entries(this._returningClause)
          .map(([alias, fieldSpec]) => {
            if (typeof fieldSpec === "string") {
              const tsKey = fieldSpec as string;
              const columnConfig = this._targetTable!.columns[
                tsKey
              ] as ColumnConfig<any, any>;
              if (!columnConfig)
                throw new Error(
                  `Column config not found for returning key ${tsKey} in table ${
                    this._targetTable!.tableName
                  }`
                );
              return `\`${columnConfig.name}\` AS \`${alias}\``;
            } else if ("_isSQL" in fieldSpec) {
              return `${(fieldSpec as SQL).toSqlString(
                "spanner",
                paramIndexState,
                aliasMap
              )} AS \`${alias}\``;
            } else {
              const colConfig = fieldSpec as ColumnConfig<any, any>;
              return `\`${colConfig.name}\` AS \`${alias}\``;
            }
          })
          .join(", ");
        if (returningColumns) {
          sql += ` THEN RETURN ${returningColumns}`;
        } else {
          sql += ` THEN RETURN *`;
        }
      }
    }
    return sql;
  }

  private buildWhereClause(
    dialect: Dialect,
    paramIndexState: { value: number },
    aliasMap: Map<string, string>
  ): string {
    if (this._conditions.length === 0) return "";
    const conditionsStr = this._conditions
      .map((cond) => {
        if (typeof cond === "string") return cond;
        if ("_isSQL" in cond)
          return (cond as SQL).toSqlString(dialect, paramIndexState, aliasMap);
        throw new Error("Invalid condition type.");
      })
      .join(" AND ");
    return `WHERE ${conditionsStr}`;
  }

  private buildOrderByClause(
    dialect: Dialect,
    paramIndexState: { value: number },
    aliasMap: Map<string, string>
  ): string {
    if (this._orderBy.length === 0) return "";
    const orderByParts = this._orderBy.map((item) => {
      let fieldSql: string;
      if ("_isSQL" in item.field) {
        fieldSql = (item.field as SQL).toSqlString(
          dialect,
          paramIndexState,
          aliasMap
        );
      } else {
        const colConfig = item.field as ColumnConfig<any, any>;
        const tableAlias = colConfig._tableName
          ? aliasMap.get(colConfig._tableName)
          : this._targetTableAlias;
        if (!tableAlias && colConfig._tableName)
          throw new Error(
            `Alias not found for ORDER BY table: ${colConfig._tableName}`
          );

        if (tableAlias) {
          fieldSql =
            dialect === "postgres"
              ? `"${tableAlias}"."${colConfig.name}"`
              : `\`${tableAlias}\`.\`${colConfig.name}\``;
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
    paramIndexState: { value: number },
    aliasMap: Map<string, string>
  ): string {
    if (this._groupBy.length === 0) return "";
    const groupByParts = this._groupBy.map((field) => {
      if ("_isSQL" in field) {
        return (field as SQL).toSqlString(dialect, paramIndexState, aliasMap);
      } else {
        const colConfig = field as ColumnConfig<any, any>;
        const tableAlias = colConfig._tableName
          ? aliasMap.get(colConfig._tableName)
          : this._targetTableAlias;
        if (!tableAlias && colConfig._tableName)
          throw new Error(
            `Alias not found for GROUP BY table: ${colConfig._tableName}`
          );

        if (tableAlias) {
          return dialect === "postgres"
            ? `"${tableAlias}"."${colConfig.name}"`
            : `\`${tableAlias}\`.\`${colConfig.name}\``;
        } else {
          // This case implies _targetTableAlias was also not set, which would be unusual.
          // Using an unqualified column name here is a fallback but can be ambiguous.
          console.warn(
            `QueryBuilder: Alias for GROUP BY column '${
              colConfig.name
            }' could not be determined (table: ${
              colConfig._tableName || "unknown/primary"
            }). Using unqualified name. This might lead to SQL errors if the column name is ambiguous.`
          );
          return dialect === "postgres"
            ? `"${colConfig.name}"`
            : `\`${colConfig.name}\``;
        }
      }
    });
    return `GROUP BY ${groupByParts.join(", ")}`;
  }

  private getBoundParametersAndTypes(dialect: Dialect): {
    values: unknown[];
    spannerTypes: (string | undefined)[];
  } {
    const allParams: unknown[] = [];
    const allSpannerTypes: (string | undefined)[] = [];

    if (this._operationType === "select" && this._selectedFields) {
      Object.values(this._selectedFields).forEach((field) => {
        if (typeof field === "object" && field !== null && "_isSQL" in field) {
          const sqlValues = (field as SQL).getValues(dialect);
          allParams.push(...sqlValues);
          sqlValues.forEach(() => allSpannerTypes.push(undefined));
        }
      });
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
              (record as Record<string, any>)[columnName] = (
                columnConfig.default as () => any
              )();
            } else if (
              columnConfig.default !== undefined &&
              typeof columnConfig.default === "object" &&
              (columnConfig.default as SQL)._isSQL
            ) {
              (record as Record<string, any>)[columnName] =
                columnConfig.default;
            } else if (columnConfig.default !== undefined) {
              (record as Record<string, any>)[columnName] =
                columnConfig.default;
            }
          }
        }
      }

      const allKeysForParams = new Set<string>();
      processedInsertDataForParams.forEach((record) => {
        Object.keys(record as Record<string, any>).forEach((key) =>
          allKeysForParams.add(key)
        );
      });
      const orderedColumnNames = Array.from(allKeysForParams).sort();

      for (const record of processedInsertDataForParams) {
        for (const tsKey of orderedColumnNames) {
          const value = (record as Record<string, any>)[tsKey];
          const columnConfig = this._targetTable!.columns[
            tsKey
          ] as ColumnConfig<any, any>;
          const spannerType = columnConfig?.dialectTypes?.spanner;

          if (value === undefined) {
            allParams.push(null);
            allSpannerTypes.push(spannerType);
          } else if (
            typeof value === "object" &&
            value !== null &&
            (value as SQL)._isSQL === true
          ) {
            const sqlValues = (value as SQL).getValues(dialect);
            allParams.push(...sqlValues);
            sqlValues.forEach(() => allSpannerTypes.push(undefined));
          } else {
            allParams.push(value);
            allSpannerTypes.push(spannerType);
          }
        }
      }
    }

    if (
      this._operationType === "update" &&
      this._updateSetValues &&
      this._targetTable
    ) {
      // The order of parameters for UPDATE SET... needs to match the order in buildUpdateSpannerSQL
      // which iterates Object.entries(this._updateSetValues)
      for (const [tsKey, value] of Object.entries(this._updateSetValues)) {
        const columnConfig = this._targetTable!.columns[tsKey] as ColumnConfig<
          any,
          any
        >;
        const spannerType = columnConfig?.dialectTypes?.spanner;

        if (typeof value === "object" && value !== null && "_isSQL" in value) {
          const sqlValues = (value as SQL).getValues(dialect);
          allParams.push(...sqlValues);
          sqlValues.forEach(() => allSpannerTypes.push(undefined));
        } else {
          allParams.push(value);
          allSpannerTypes.push(spannerType);
        }
      }
    }

    if (this._conditions) {
      for (const condition of this._conditions) {
        if (
          typeof condition === "object" &&
          condition !== null &&
          "_isSQL" in condition
        ) {
          const sqlValues = (condition as SQL).getValues(dialect);
          allParams.push(...sqlValues);
          sqlValues.forEach(() => allSpannerTypes.push(undefined));
        }
      }
    }

    if (this._joins) {
      for (const join of this._joins) {
        const sqlValues = join.onCondition.getValues(dialect);
        allParams.push(...sqlValues);
        sqlValues.forEach(() => allSpannerTypes.push(undefined));
      }
    }

    if (this._orderBy) {
      for (const orderItem of this._orderBy) {
        if (
          typeof orderItem.field === "object" &&
          orderItem.field !== null &&
          "_isSQL" in orderItem.field
        ) {
          const sqlValues = (orderItem.field as SQL).getValues(dialect);
          allParams.push(...sqlValues);
          sqlValues.forEach(() => allSpannerTypes.push(undefined));
        }
      }
    }

    if (this._groupBy) {
      for (const groupItem of this._groupBy) {
        if (
          typeof groupItem === "object" &&
          groupItem !== null &&
          "_isSQL" in groupItem
        ) {
          const sqlValues = (groupItem as SQL).getValues(dialect);
          allParams.push(...sqlValues);
          sqlValues.forEach(() => allSpannerTypes.push(undefined));
        }
      }
    }
    return { values: allParams, spannerTypes: allSpannerTypes };
  }

  private addJoin(
    type: JoinType,
    table: TableConfig<any, any>,
    onCondition: SQL
  ): this {
    if (this._operationType !== "select") {
      throw new Error(`JOIN operations are only applicable to SELECT queries.`);
    }
    const alias = this.generateTableAlias(table);
    this._joins.push({ type, targetTable: table, alias, onCondition });
    return this;
  }

  innerJoin(table: TableConfig<any, any>, onCondition: SQL): this {
    return this.addJoin("INNER", table, onCondition);
  }

  leftJoin(table: TableConfig<any, any>, onCondition: SQL): this {
    return this.addJoin("LEFT", table, onCondition);
  }

  joinRelation(relationName: string, joinType: JoinType = "LEFT"): this {
    if (!this._targetTable) {
      throw new Error(
        "Cannot join relation: target table not set. Call .from() first."
      );
    }
    if (this._operationType !== "select") {
      throw new Error(`joinRelation() is only applicable to SELECT queries.`);
    }

    const relatedTableConfig = getTableConfig(relationName);
    if (!relatedTableConfig) {
      throw new Error(
        `Could not find table configuration for relation: ${relationName}`
      );
    }

    let fkColumn: ColumnConfig<any, any> | undefined;
    let pkColumn: ColumnConfig<any, any> | undefined;
    let joinTable = relatedTableConfig; // The table we are joining TO

    // Scenario 1: Current _targetTable is PARENT, relatedTableConfig is CHILD (e.g. users.joinRelation('posts'))
    // We look for an FK in relatedTableConfig (child) that points to _targetTable (parent)
    for (const col of Object.values(relatedTableConfig.columns)) {
      const colConfig = col as ColumnConfig<any, any>;
      if (colConfig.references) {
        const referencedPkColumn = colConfig.references.referencesFn();
        if (referencedPkColumn._tableName === this._targetTable.tableName) {
          fkColumn = colConfig; // FK in child table (relatedTableConfig)
          pkColumn = referencedPkColumn; // PK in parent table (_targetTable)
          joinTable = relatedTableConfig;
          break;
        }
      }
    }

    // Scenario 2: Current _targetTable is CHILD, relatedTableConfig is PARENT (e.g. posts.joinRelation('user'))
    // We look for an FK in _targetTable (child) that points to relatedTableConfig (parent)
    if (!fkColumn) {
      for (const col of Object.values(this._targetTable.columns)) {
        const colConfig = col as ColumnConfig<any, any>;
        if (colConfig.references) {
          const referencedPkColumn = colConfig.references.referencesFn();
          if (referencedPkColumn._tableName === relatedTableConfig.tableName) {
            fkColumn = colConfig; // FK in child table (_targetTable)
            pkColumn = referencedPkColumn; // PK in parent table (relatedTableConfig)
            joinTable = relatedTableConfig; // Still joining TO the relatedTableConfig
            break;
          }
        }
      }
    }

    if (fkColumn && pkColumn) {
      const onCondition = sql`${fkColumn} = ${pkColumn}`;
      return this.addJoin(joinType, joinTable, onCondition);
    }

    throw new Error(
      `Could not automatically determine relationship between ${this._targetTable.tableName} and ${relationName}. Please use explicit join with ON condition.`
    );
  }

  innerJoinRelation(relationName: string): this {
    return this.joinRelation(relationName, "INNER");
  }

  leftJoinRelation(relationName: string): this {
    return this.joinRelation(relationName, "LEFT");
  }
}
