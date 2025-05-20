// src/core/query-builder.ts
import type {
  TableConfig,
  ColumnConfig,
  SQL,
  InferModelType,
  Dialect,
  IncludeClause, // Added for eager loading
} from "../types/common.js";
import { sql } from "../types/common.js"; // VALUE import for sql
import { getTableConfig } from "./schema.js"; // Assuming a way to get table configs

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
  private _includeClause?: IncludeClause; // Added for eager loading

  constructor() {}

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
      finalAliasMap.set(tableConfig.name, alias);
    });
    if (
      this._targetTable &&
      this._targetTableAlias &&
      !finalAliasMap.has(this._targetTable.name)
    ) {
      finalAliasMap.set(this._targetTable.name, this._targetTableAlias);
    }

    if (dialect === "postgres") {
      return this.toPgSQL(finalAliasMap);
    } else if (dialect === "spanner") {
      return this.toSpannerSQL(finalAliasMap);
    } else {
      throw new Error(`Unsupported dialect: ${dialect}`);
    }
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

    const originalJoins = [...this._joins]; // Preserve original explicit joins
    const includeJoins: JoinClause[] = [];
    const selectedFieldsFromIncludes: SelectFields = {};

    // Process includes for one-to-many relationships
    if (this._includeClause) {
      for (const [relationName, includeOptions] of Object.entries(
        this._includeClause
      )) {
        // This is a simplified assumption: relationName is the child table's actual name
        // A more robust solution would use a schema registry or relations defined in TableConfig
        const relatedTableConfig = getTableConfig(relationName); // Placeholder for actual lookup
        if (!relatedTableConfig) {
          console.warn(
            `Warning: Could not find table config for relation "${relationName}" to include.`
          );
          continue;
        }

        let foreignKeyColumn: ColumnConfig<any, any> | undefined;
        let referencedColumnInParent: ColumnConfig<any, any> | undefined;

        // Find the foreign key in the related (child) table that points to the parent table
        for (const col of Object.values(relatedTableConfig.columns)) {
          const colConfig = col as ColumnConfig<any, any>;
          if (colConfig.references) {
            const referencedCol = colConfig.references.referencesFn();
            if (referencedCol._tableName === this._targetTable.name) {
              foreignKeyColumn = colConfig;
              referencedColumnInParent = referencedCol;
              break;
            }
          }
        }

        if (!foreignKeyColumn || !referencedColumnInParent) {
          console.warn(
            `Warning: Could not determine foreign key relationship between "${this._targetTable.name}" and "${relationName}".`
          );
          continue;
        }

        const relatedTableAlias = this.generateTableAlias(relatedTableConfig); // Ensure alias is generated and stored
        aliasMap.set(relatedTableConfig.name, relatedTableAlias); // Update the aliasMap for this query

        const onCondition = sql`${foreignKeyColumn} = ${referencedColumnInParent}`;

        includeJoins.push({
          type: "LEFT", // Eager loading typically uses LEFT JOIN
          targetTable: relatedTableConfig,
          alias: relatedTableAlias,
          onCondition: onCondition,
        });

        // Determine columns to select from the related table
        const relationOpts =
          typeof includeOptions === "object" ? includeOptions : {};
        const selectAllRelated =
          includeOptions === true || !relationOpts.select;

        for (const [relatedColName, relatedColConfig] of Object.entries(
          relatedTableConfig.columns
        )) {
          if (
            selectAllRelated ||
            (relationOpts.select && relationOpts.select[relatedColName])
          ) {
            // Alias related columns to avoid collisions: relationName__columnName
            // Use relatedColConfig.name for the alias part to match DB column name
            const actualColumnName = (
              relatedColConfig as ColumnConfig<any, any>
            ).name;
            const selectAlias = `${relationName}__${actualColumnName}`;
            selectedFieldsFromIncludes[selectAlias] =
              relatedColConfig as ColumnConfig<any, any>;
          }
        }
      }
    }

    const allJoins = [...originalJoins, ...includeJoins];

    // Build SELECT clause
    let selectClause = "";
    const explicitUserSelectedFields = { ...(this._selectedFields || {}) };
    const allSelectedParts: string[] = [];

    // Handle primary table selections
    if (explicitUserSelectedFields["*"] === "*") {
      // If user explicitly asked for SELECT *
      allSelectedParts.push(`"${this._targetTableAlias}".*`);
      // Remove "*" so it's not processed as an aliased field if other fields are also explicitly selected
      if (
        Object.keys(explicitUserSelectedFields).length > 1 ||
        Object.keys(selectedFieldsFromIncludes).length > 0
      ) {
        delete explicitUserSelectedFields["*"];
      }
    }

    // Process other explicitly selected fields for the primary table or custom SQL fields
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
        // For explicitly selected fields, assume they are from the primary table if _tableName is not set,
        // or from a table already in aliasMap (e.g. from an explicit join).
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

    // Process selected fields from includes
    Object.entries(selectedFieldsFromIncludes).map(([alias, field]) => {
      const colConfig = field as ColumnConfig<any, any>;
      const tableAlias = aliasMap.get(colConfig._tableName!); // Should exist due to include logic
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
      // Default to SELECT primary_alias.* if nothing was selected at all (e.g. qb.from(usersTable).toSQL())
      // or if only .select() was called with no args
      if (
        this._selectedFields === undefined ||
        Object.keys(this._selectedFields).length === 0
      ) {
        selectClause = `SELECT "${this._targetTableAlias}".*`;
      }
    }

    // Fallback if selectClause is still empty (e.g. only .select() was called)
    if (!selectClause) {
      selectClause = `SELECT "${this._targetTableAlias}".*`;
    }

    // Correction for simple "SELECT *" case from tests
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
      // If SELECT * and there are joins, but no includes selecting fields, qualify with primary table alias
      selectClause = `SELECT "${this._targetTableAlias}".*`;
    }

    // Original logic for explicitly selected fields if not SELECT *
    // This part is now refactored above.
    // else if (Object.keys(finalSelectedFields).length > 0) {
    //   const selectedParts = Object.entries(finalSelectedFields).map(
    //     ([alias, field]) => {
    //       let fieldName: string;
    //       if (typeof field === "string") {
    //         fieldName = field;
    //       } else if ("_isSQL" in field) {
    //         fieldName = (field as SQL).toSqlString(
    //           "postgres",
    //           paramIndexState,
    //           aliasMap
    //         );
    //       } else if ("name" in field) {
    //         const colConfig = field as ColumnConfig<any, any>;
    //         const tableAlias = colConfig._tableName
    //           ? aliasMap.get(colConfig._tableName)
    //           : this._targetTableAlias;
    //         if (!tableAlias)
    //           throw new Error(
    //             `Alias not found for table of column: ${colConfig.name} (table: ${colConfig._tableName})`
    //           );
    //         fieldName = `"${tableAlias}"."${colConfig.name}"`;
    //       } else {
    //         throw new Error(`Invalid field type in select: ${alias}`);
    //       }
    //       if (alias !== "*" && !fieldName.toLowerCase().includes(" as ")) {
    //         return `${fieldName} AS "${alias}"`;
    //       }
    //       return fieldName;
    //     }
    //   );
    //   selectClause = `SELECT ${selectedParts.join(", ")}`;
    // } else {
    //   // Default if no fields specified and no includes.
    //   selectClause = `SELECT "${this._targetTableAlias}".*`;
    // }

    let fromClause = `FROM "${this._targetTable.name}" AS "${this._targetTableAlias}"`;
    if (allJoins.length > 0) {
      const joinStrings = allJoins.map((join) => {
        const joinTableAlias = aliasMap.get(join.targetTable.name); // Use aliasMap
        if (!joinTableAlias)
          throw new Error(
            `Alias not found for join table: ${
              join.targetTable.name
            }. Alias map: ${JSON.stringify(Array.from(aliasMap.entries()))}`
          );
        return `${join.type} JOIN "${
          join.targetTable.name
        }" AS "${joinTableAlias}" ON ${join.onCondition.toSqlString(
          "postgres",
          paramIndexState,
          aliasMap // Pass aliasMap to onCondition.toSqlString
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

    // --- Eager Loading Logic (similar to PgSQL) ---
    const originalJoins = [...this._joins];
    const includeJoins: JoinClause[] = [];
    const selectedFieldsFromIncludes: SelectFields = {};

    if (this._includeClause) {
      for (const [relationName, includeOptions] of Object.entries(
        this._includeClause
      )) {
        const relatedTableConfig = getTableConfig(relationName); // Placeholder
        if (!relatedTableConfig) {
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
            if (referencedCol._tableName === this._targetTable.name) {
              foreignKeyColumn = colConfig;
              referencedColumnInParent = referencedCol;
              break;
            }
          }
        }

        if (!foreignKeyColumn || !referencedColumnInParent) {
          console.warn(
            `Warning: Spanner - Could not determine foreign key relationship between "${this._targetTable.name}" and "${relationName}".`
          );
          continue;
        }

        const relatedTableAlias = this.generateTableAlias(relatedTableConfig);
        aliasMap.set(relatedTableConfig.name, relatedTableAlias);

        const onCondition = sql`${foreignKeyColumn} = ${referencedColumnInParent}`;
        includeJoins.push({
          type: "LEFT",
          targetTable: relatedTableConfig,
          alias: relatedTableAlias,
          onCondition: onCondition,
        });

        const relationOpts =
          typeof includeOptions === "object" ? includeOptions : {};
        const selectAllRelated =
          includeOptions === true || !relationOpts.select;

        for (const [relatedColName, relatedColConfig] of Object.entries(
          relatedTableConfig.columns
        )) {
          if (
            selectAllRelated ||
            (relationOpts.select && relationOpts.select[relatedColName])
          ) {
            const actualColumnName = (
              relatedColConfig as ColumnConfig<any, any>
            ).name;
            const selectAlias = `${relationName}__${actualColumnName}`;
            selectedFieldsFromIncludes[selectAlias] =
              relatedColConfig as ColumnConfig<any, any>;
          }
        }
      }
    }
    const allJoins = [...originalJoins, ...includeJoins];
    // --- End Eager Loading Logic ---

    // Build SELECT clause for Spanner (similar logic to PgSQL)
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
    // Original logic for explicitly selected fields if not SELECT *
    // else if (Object.keys(finalSelectedFields).length > 0) {
    //   const selectedParts = Object.entries(finalSelectedFields).map(
    //     ([alias, field]) => {
    //       let fieldName: string;
    //       if (typeof field === "string") {
    //         fieldName = field;
    //       } else if ("_isSQL" in field) {
    //         fieldName = (field as SQL).toSqlString(
    //           "spanner",
    //           paramIndexState,
    //           aliasMap
    //         );
    //       } else if ("name" in field) {
    //         const colConfig = field as ColumnConfig<any, any>;
    //         const tableAlias = colConfig._tableName
    //           ? aliasMap.get(colConfig._tableName)
    //           : this._targetTableAlias;
    //         if (!tableAlias)
    //           throw new Error(
    //             `Alias not found for table of column: ${colConfig.name} (table: ${colConfig._tableName})`
    //           );
    //         fieldName = `\`${tableAlias}\`.\`${colConfig.name}\``;
    //       } else {
    //         throw new Error(`Invalid field type in select: ${alias}`);
    //       }
    //       if (alias !== "*" && !fieldName.toLowerCase().includes(" as ")) {
    //         return `${fieldName} AS \`${alias}\``;
    //       }
    //       return fieldName;
    //     }
    //   );
    //   selectClause = `SELECT ${selectedParts.join(", ")}`;
    // } else {
    //   selectClause = `SELECT \`${this._targetTableAlias}\`.*`;
    // }

    let fromClause = `FROM \`${this._targetTable.name}\` AS \`${this._targetTableAlias}\``;
    if (allJoins.length > 0) {
      const joinStrings = allJoins.map((join) => {
        const joinTableAlias = aliasMap.get(join.targetTable.name);
        if (!joinTableAlias)
          throw new Error(
            `Alias not found for join table: ${join.targetTable.name}`
          );
        return `${join.type} JOIN \`${
          join.targetTable.name
        }\` AS \`${joinTableAlias}\` ON ${join.onCondition.toSqlString(
          "spanner",
          paramIndexState,
          aliasMap // Pass aliasMap
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

    return `INSERT INTO "${this._targetTable.name}" (${columns}) VALUES ${valuePlaceholders}`;
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
    return `INSERT INTO \`${this._targetTable.name}\` (${columns}) VALUES ${valuePlaceholders}`;
  }

  private buildUpdatePgSQL(
    paramIndexState: { value: number },
    aliasMap: Map<string, string>
  ): string {
    if (!this._targetTable) throw new Error("Target table not set for UPDATE.");
    if (!this._updateSetValues)
      throw new Error("SET values not provided for UPDATE.");

    const setParts = Object.entries(this._updateSetValues)
      .map(([column, value]) => {
        if (typeof value === "object" && value !== null && "_isSQL" in value) {
          return `"${column}" = ${(value as SQL).toSqlString(
            "postgres",
            paramIndexState,
            aliasMap
          )}`;
        }
        return `"${column}" = $${paramIndexState.value++}`;
      })
      .join(", ");
    const whereClause = this.buildWhereClause(
      "postgres",
      paramIndexState,
      aliasMap
    );
    return `UPDATE "${this._targetTable.name}" SET ${setParts} ${whereClause}`.trim();
  }

  private buildUpdateSpannerSQL(
    paramIndexState: { value: number },
    aliasMap: Map<string, string>
  ): string {
    if (!this._targetTable) throw new Error("Target table not set for UPDATE.");
    if (!this._updateSetValues)
      throw new Error("SET values not provided for UPDATE.");
    const setParts = Object.entries(this._updateSetValues)
      .map(([column, value]) => {
        if (typeof value === "object" && value !== null && "_isSQL" in value) {
          return `\`${column}\` = ${(value as SQL).toSqlString(
            "spanner",
            paramIndexState,
            aliasMap
          )}`;
        }
        return `\`${column}\` = @p${paramIndexState.value++}`;
      })
      .join(", ");
    const whereClause = this.buildWhereClause(
      "spanner",
      paramIndexState,
      aliasMap
    );
    return `UPDATE \`${this._targetTable.name}\` SET ${setParts} ${whereClause}`.trim();
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
    return `DELETE FROM "${this._targetTable.name}" ${whereClause}`.trim();
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
    return `DELETE FROM \`${this._targetTable.name}\` ${whereClause}`.trim();
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
          return dialect === "postgres"
            ? `"${colConfig.name}"`
            : `\`${colConfig.name}\``;
        }
      }
    });
    return `GROUP BY ${groupByParts.join(", ")}`;
  }

  getBoundParameters(dialect: Dialect): unknown[] {
    const allParams: unknown[] = [];
    if (this._operationType === "select" && this._selectedFields) {
      for (const field of Object.values(this._selectedFields)) {
        if (typeof field === "object" && field !== null && "_isSQL" in field) {
          allParams.push(...(field as SQL).getValues(dialect));
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
        for (const columnName of orderedColumnNames) {
          const value = (record as Record<string, any>)[columnName];
          if (value === undefined) continue;
          if (
            typeof value === "object" &&
            value !== null &&
            (value as SQL)._isSQL === true
          ) {
            allParams.push(...(value as SQL).getValues(dialect));
          } else {
            allParams.push(value);
          }
        }
      }
    }
    if (this._operationType === "update" && this._updateSetValues) {
      for (const value of Object.values(this._updateSetValues)) {
        if (typeof value === "object" && value !== null && "_isSQL" in value) {
          allParams.push(...(value as SQL).getValues(dialect));
        } else {
          allParams.push(value);
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
          allParams.push(...(condition as SQL).getValues(dialect));
        }
      }
    }
    if (this._joins) {
      for (const join of this._joins) {
        allParams.push(...join.onCondition.getValues(dialect));
      }
    }
    if (this._orderBy) {
      for (const orderItem of this._orderBy) {
        if (
          typeof orderItem.field === "object" &&
          orderItem.field !== null &&
          "_isSQL" in orderItem.field
        ) {
          allParams.push(...(orderItem.field as SQL).getValues(dialect));
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
          allParams.push(...(groupItem as SQL).getValues(dialect));
        }
      }
    }
    return allParams;
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

  include(clause: IncludeClause): this {
    if (this._operationType && this._operationType !== "select") {
      throw new Error(
        `Cannot call .include() for an '${this._operationType}' operation.`
      );
    }
    if (!this._operationType) this._operationType = "select"; // Default to select if no op type yet

    this._includeClause = { ...(this._includeClause || {}), ...clause };
    return this;
  }
}
