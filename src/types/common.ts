// src/types/common.ts

export type Dialect = "postgres" | "spanner";

export type OnDeleteAction =
  | "cascade"
  | "restrict"
  | "no action"
  | "set null"
  | "set default";

export interface ForeignKeyConfig {
  // Using a function to avoid circular dependencies and ensure table is defined
  referencesFn: () => ColumnConfig<any, any>; // Function that returns the target column config
  onDelete?: OnDeleteAction;
  // Internally resolved fields after all tables are processed by DDL generator:
  // _referencedTableName?: string;
  // _referencedColumnName?: string;
}

export interface ColumnConfig<T, TName extends string = string> {
  name: TName;
  type: string; // Abstract type, e.g., 'text', 'integer', 'timestamp'
  dialectTypes: {
    postgres: string; // e.g., 'TEXT', 'INTEGER', 'TIMESTAMP WITH TIME ZONE'
    spanner: string; // e.g., 'STRING', 'INT64', 'TIMESTAMP'
  };
  notNull?: boolean;
  default?: T | (() => T) | SQL | { sql: string }; // Added SQL here, {sql: string} is for DDL representation of raw SQL
  primaryKey?: boolean; // For single column primary key
  unique?: boolean; // For unique constraints on a single column
  references?: ForeignKeyConfig;
  _tableName?: string; // Internal: Name of the table this column belongs to
  _hasClientDefaultFn?: boolean; // Internal: Flag for client-side default functions
  _isUuidTypeForDefault?: boolean; // Internal: Flag to indicate this column type is a candidate for auto-default UUID on PK
  _autoDefaultedUuid?: boolean; // Internal: Flag to indicate if the default was auto-applied by primaryKey() for a UUID type
  // Placeholder for more advanced properties like $onUpdate, $type from example
}

export interface IndexConfig {
  name?: string;
  columns: string[];
  unique?: boolean;
  // Spanner specific: nullFiltered, interleaveIn
}

export interface CompositePrimaryKeyConfig {
  columns: string[];
  name?: string; // Optional name for the constraint
}

export type TableColumns = Record<string, ColumnConfig<unknown, string>>;

export interface TableConfig<
  TName extends string = string,
  TColumns extends TableColumns = TableColumns
> {
  tableName: TName; // Renamed from name
  columns: TColumns; // Retained for internal use and fallback
  tableIndexes?: IndexConfig[]; // Renamed from indexes
  compositePrimaryKey?: CompositePrimaryKeyConfig;
  interleave?: {
    parentTable: string; // Name of the parent table
    onDelete: "cascade" | "no action";
  };
  _isTable?: boolean; // Added for CLI detection
}

// Represents the user-facing table object with columns as direct properties
export type Table<
  TName extends string,
  TColumns extends TableColumns
> = TableConfig<TName, TColumns> & {
  [K in keyof TColumns]: TColumns[K];
};

// Utility type to infer the TS type from a ColumnConfig
export type InferColumnType<C extends ColumnConfig<unknown, string>> =
  C["default"] extends undefined
    ? C["notNull"] extends true
      ? NonNullable<C extends ColumnConfig<infer T, string> ? T : never>
      : (C extends ColumnConfig<infer T, string> ? T : never) | null
    : NonNullable<C extends ColumnConfig<infer T, string> ? T : never>;

// Utility type to infer the TS type for a whole table
// Note: This infers from the .columns property, which is correct as it holds the full column definitions.
export type InferModelType<
  T extends TableConfig<string, TableColumns> | Table<string, TableColumns>
> = {
  [K in keyof T["columns"]]: InferColumnType<T["columns"][K]>;
};

// Type for selecting specific fields, used by QueryBuilder and OrmClient
export type SelectFields<
  TTable extends TableConfig<any, any> | Table<any, any>
> =
  | Partial<Record<keyof InferModelType<TTable>, boolean>>
  | { [columnAlias: string]: SQL | ColumnConfig<any, any> | true } // Allow SQL expressions or column configs for aliasing
  | undefined;

// --- Eager Loading / Include Types ---
export type IncludeRelationOptions =
  | boolean
  | {
      select?: Record<string, boolean>; // Select specific columns from the related table
      // where?: any; // Future: conditions for the related data
      // include?: IncludeClause; // Future: nested includes
    };

export type IncludeClause = Record<string, IncludeRelationOptions>;

// --- Types for Advanced Eager Loading Result Shaping ---

// Infers the type of a model based on a TableConfig or Table, optionally picking specific columns.
export type InferSelectedModelType<
  TTable extends TableConfig<any, any> | Table<any, any>,
  TSelect extends
    | Partial<Record<keyof InferModelType<TTable>, boolean>>
    | undefined
> = TSelect extends undefined
  ? InferModelType<TTable>
  : Pick<InferModelType<TTable>, keyof TSelect & keyof InferModelType<TTable>>;

// Options for including a related table, generic on the related table's config.
export type TypedIncludeRelationOptions<
  TRelatedTable extends TableConfig<any, any> | Table<any, any>
> =
  | boolean
  | {
      select?: Partial<Record<keyof InferModelType<TRelatedTable>, boolean>>;
      // where?: any; // Future: conditions for the related data
      // include?: EnhancedIncludeClause; // Future: nested includes, using EnhancedIncludeClause
    };

// An entry in the enhanced include clause, specifying the related table and options.
export interface EnhancedIncludeClauseEntry<
  TRelatedTable extends TableConfig<any, any> | Table<any, any>
> {
  relationTable: TRelatedTable;
  options: TypedIncludeRelationOptions<TRelatedTable>;
  // relationName: string; // The key in EnhancedIncludeClause will be the relationName
}

// The enhanced include clause, mapping relation names to their typed entries.
export type EnhancedIncludeClause = Record<
  string,
  EnhancedIncludeClauseEntry<TableConfig<any, any> | Table<any, any>>
>;

// Infers the model type for a single included relation based on EnhancedIncludeClauseEntry
export type InferIncludedRelationModel<
  TEntry extends EnhancedIncludeClauseEntry<
    TableConfig<any, any> | Table<any, any>
  >
> = TEntry["options"] extends { select: infer TSelect }
  ? TSelect extends Partial<
      Record<keyof InferModelType<TEntry["relationTable"]>, boolean>
    >
    ? InferSelectedModelType<TEntry["relationTable"], TSelect>
    : InferModelType<TEntry["relationTable"]> // Fallback for malformed TSelect
  : InferModelType<TEntry["relationTable"]>;

// Represents a single item in the shaped result array.
// TPrimaryTable: The main table being queried.
// TInclude: The EnhancedIncludeClause describing what relations to include.
export type ShapedResultItem<
  TPrimaryTable extends TableConfig<any, any> | Table<any, any>,
  TInclude extends EnhancedIncludeClause | undefined
> = InferModelType<TPrimaryTable> &
  (TInclude extends EnhancedIncludeClause
    ? {
        [K in keyof TInclude]: TInclude[K] extends EnhancedIncludeClauseEntry<
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          infer TRelatedTable
        >
          ? Array<InferIncludedRelationModel<TInclude[K]>>
          : never;
      }
    : {});

// --- Function Descriptors ---
export type FunctionArg =
  | ColumnConfig<any, any>
  | SQL
  | string
  | number
  | boolean
  | Date;

export interface BaseFunctionDescriptor {
  readonly _isOrmFunctionDescriptor: true; // Marker property
  readonly functionName: string; // e.g., 'LOWER', 'CONCAT', 'COUNT'
}

export interface UnaryFunctionDescriptor extends BaseFunctionDescriptor {
  readonly argument: FunctionArg;
}

export interface VariadicFunctionDescriptor extends BaseFunctionDescriptor {
  readonly args: FunctionArg[];
}

// Specific descriptor examples (can be expanded)
export interface LowerFunctionDescriptor extends UnaryFunctionDescriptor {
  readonly functionName: "LOWER";
}
export interface UpperFunctionDescriptor extends UnaryFunctionDescriptor {
  readonly functionName: "UPPER";
}
export interface CountFunctionDescriptor extends UnaryFunctionDescriptor {
  readonly functionName: "COUNT";
  readonly argument: FunctionArg | "*"; // COUNT can take '*'
}
export interface ConcatFunctionDescriptor extends VariadicFunctionDescriptor {
  readonly functionName: "CONCAT";
}
export interface LikeFunctionDescriptor extends BaseFunctionDescriptor {
  readonly functionName: "LIKE" | "ILIKE";
  readonly column: FunctionArg; // Column or SQL expression
  readonly pattern: string;
  readonly escapeChar?: string;
}
export interface RegexpContainsFunctionDescriptor
  extends BaseFunctionDescriptor {
  readonly functionName: "REGEXP_CONTAINS";
  readonly column: FunctionArg; // Column or SQL expression
  readonly pattern: string;
}

// Union of all possible function descriptors
export type OrmFunctionDescriptor =
  | LowerFunctionDescriptor
  | UpperFunctionDescriptor
  | CountFunctionDescriptor
  | ConcatFunctionDescriptor
  | LikeFunctionDescriptor
  | RegexpContainsFunctionDescriptor;
// Add other aggregate/string function descriptors here (SUM, AVG, etc.)

// For SQL tagged template literal
export interface SQL {
  /**
   * Generates the SQL string for the specified dialect.
   * @param dialect The SQL dialect ('postgres' or 'spanner').
   * @param currentParamIndex An object holding the current parameter index, passed by reference to be incremented.
   * @param aliasMap An optional map of original table names to their query-specific aliases.
   * @returns The SQL string with placeholders.
   */
  toSqlString(
    dialect: Dialect,
    currentParamIndex?: { value: number },
    aliasMap?: Map<string, string>
  ): string;
  /**
   * Gets the array of parameter values corresponding to the placeholders in the SQL string.
   * @param dialect The SQL dialect ('postgres' or 'spanner').
   * @returns An array of parameter values.
   */
  getValues(dialect: Dialect): unknown[];
  readonly _isSQL: true;
}

export function sql(strings: TemplateStringsArray, ...values: unknown[]): SQL {
  const getValuesRecursive = (vals: unknown[], dialect: Dialect): unknown[] => {
    const params: unknown[] = [];
    for (const val of vals) {
      if (typeof val === "object" && val !== null) {
        if ("_isSQL" in val) {
          // Check if it's an SQL object
          params.push(...(val as SQL).getValues(dialect));
        } else if (
          // Check if it's NOT a ColumnConfig object AND NOT a TableConfig object
          // A ColumnConfig has 'name', 'type', and 'dialectTypes'
          // A TableConfig has 'tableName', 'columns', and '_isTable'
          !(
            // ColumnConfig check
            (
              "name" in val && // Column still has 'name'
              typeof (val as any).name === "string" &&
              "type" in val &&
              typeof (val as any).type === "string" &&
              "dialectTypes" in val &&
              typeof (val as any).dialectTypes === "object"
            )
          ) &&
          !(
            // TableConfig check
            (
              "tableName" in val && // Changed from name to tableName
              typeof (val as any).tableName === "string" &&
              "columns" in val &&
              typeof (val as any).columns === "object" &&
              "_isTable" in val &&
              (val as any)._isTable === true
            )
          )
        ) {
          params.push(val); // It's some other object (not SQL, not ColumnConfig, not TableConfig), treat as parameter
        }
        // If it is a ColumnConfig or TableConfig, it's not a parameter, so it's skipped here.
      } else {
        params.push(val); // Primitives are parameters
      }
    }
    return params;
  };

  return {
    _isSQL: true,
    getValues: (dialect: Dialect) => getValuesRecursive(values, dialect),
    toSqlString: (
      dialect: Dialect,
      currentParamIndex?: { value: number },
      aliasMap?: Map<string, string> // Ensure aliasMap is a parameter here
    ): string => {
      let result = strings[0];
      // Initialize paramIndex if it's the top-level call
      const paramIndexState = currentParamIndex || { value: 1 };

      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (typeof value === "object" && value !== null) {
          if ("_isSQL" in value) {
            // Nested SQL object
            result +=
              (value as SQL).toSqlString(dialect, paramIndexState, aliasMap) + // Pass aliasMap
              strings[i + 1];
          } else if (
            // Check if it IS a ColumnConfig object
            "name" in value &&
            typeof (value as any).name === "string" &&
            "type" in value &&
            typeof (value as any).type === "string" &&
            "dialectTypes" in value &&
            typeof (value as any).dialectTypes === "object"
          ) {
            // It's a ColumnConfig, interpolate its name as an identifier
            const colConfig = value as ColumnConfig<any, any>;
            const colName = colConfig.name;
            const originalTableNameFromCol = colConfig._tableName; // Table name from column's context
            let tableQualifier: string | undefined = originalTableNameFromCol;

            if (aliasMap && originalTableNameFromCol) {
              const alias = aliasMap.get(originalTableNameFromCol);
              if (alias) {
                tableQualifier = alias;
              }
            }

            let identifier = "";
            if (tableQualifier) {
              identifier =
                dialect === "postgres"
                  ? `"${tableQualifier}"."${colName}"`
                  : `\`${tableQualifier}\`.\`${colName}\``;
            } else {
              // Fallback: just use column name if no table context (e.g. in SELECT COUNT(col) FROM table)
              // This case should be less common if columns are always associated with tables.
              identifier =
                dialect === "postgres" ? `"${colName}"` : `\`${colName}\``;
            }
            result += identifier + strings[i + 1];
          } else if (
            // Check if it IS a TableConfig object
            "tableName" in value && // Changed from name to tableName
            typeof (value as any).tableName === "string" &&
            "columns" in value && // Check for 'columns' to differentiate from ColumnConfig
            typeof (value as any).columns === "object" &&
            "_isTable" in value &&
            (value as any)._isTable === true
          ) {
            // It's a TableConfig, interpolate its tableName as an identifier
            const tableConfig = value as TableConfig<any, any>; // Type cast will be to the modified TableConfig
            const originalTableName = tableConfig.tableName; // Changed from .name
            // Table names themselves are not typically aliased in the aliasMap in the same way
            // columns are qualified by aliases. The aliasMap is for `OriginalName -> QueryAlias`.
            // When a TableConfig is used directly like `FROM ${myTable}`, we use its actual name.
            // If it's `FROM ${myTable} AS t_alias`, the `AS t_alias` is part of the raw string.
            const tableNameToUse = originalTableName; // For now, direct table references use their defined name.
            // Aliasing like `FROM ${myTable} AS someAlias` is handled by the string part.

            const identifier =
              dialect === "postgres"
                ? `"${tableNameToUse}"`
                : `\`${tableNameToUse}\``;
            result += identifier + strings[i + 1];
          } else {
            // It's some other object (not SQL, not ColumnConfig, not TableConfig), treat as a parameter
            result +=
              (dialect === "postgres"
                ? `$${paramIndexState.value++}`
                : `@p${paramIndexState.value++}`) + strings[i + 1];
          }
        } else {
          // Primitives are parameters
          result +=
            (dialect === "postgres"
              ? `$${paramIndexState.value++}`
              : `@p${paramIndexState.value++}`) + strings[i + 1];
        }
      }
      return result.trim();
    },
  };
}

// --- Schema Snapshot Types ---

export interface ColumnSnapshot {
  name: string;
  type: string; // Generic type e.g., 'text', 'varchar'
  dialectTypes: { postgres: string; spanner: string };
  notNull?: boolean;
  default?: unknown | SQL | { sql: string } | { function: string }; // Explicitly include SQL type
  _hasClientDefaultFn?: boolean; // Added to snapshot for client-side default functions
  primaryKey?: boolean;
  unique?: boolean;
  references?: {
    name?: string; // Optional name for the FK constraint
    referencedTable: string;
    referencedColumn: string;
    onDelete?: OnDeleteAction;
  } | null; // Allow null to signify removal at the snapshot level
}

export interface IndexSnapshot {
  name?: string; // Index name might be optional if auto-generated
  columns: string[];
  unique: boolean;
  // Future: using?: string; // e.g., GIN, GIST for PG
  // Future: predicate?: string; // For partial indexes
}

export interface CompositePrimaryKeySnapshot {
  name?: string; // Constraint name
  columns: string[];
}

export interface InterleaveSnapshot {
  parentTable: string;
  onDelete: "cascade" | "no action";
}

export interface TableSnapshot {
  tableName: string; // Renamed from name
  columns: Record<string, ColumnSnapshot>;
  tableIndexes?: IndexSnapshot[]; // Renamed from indexes
  compositePrimaryKey?: CompositePrimaryKeySnapshot;
  interleave?: InterleaveSnapshot; // Spanner specific
  // Future: checks?: CheckConstraintSnapshot[];
}

export interface SchemaSnapshot {
  version: string; // Version of the spanner-orm snapshot format
  dialect: "postgres" | "spanner" | "common"; // Or maybe this isn't needed if snapshot is dialect-agnostic before generation
  tables: Record<string, TableSnapshot>;
  // Potentially other schema-level info in the future (e.g., custom types, extensions)
}

// --- Schema Diff Types ---

export type ColumnDiffAction =
  | { action: "add"; column: ColumnSnapshot }
  | { action: "remove"; columnName: string }
  | {
      action: "change";
      columnName: string;
      changes: Partial<Omit<ColumnSnapshot, "name">>; // All fields except name can change
    };

export type IndexDiffAction =
  | { action: "add"; index: IndexSnapshot }
  | { action: "remove"; indexName: string } // Assuming indexes are named for removal
  | {
      action: "change";
      indexName: string;
      changes: Partial<Omit<IndexSnapshot, "name">>;
    }; // Less common for indexes, usually drop and recreate

export type PrimaryKeyDiffAction =
  | { action: "set"; pk: CompositePrimaryKeySnapshot } // Can be add or change
  | { action: "remove"; pkName?: string }; // Name might be optional

export type InterleaveDiffAction =
  | { action: "set"; interleave: InterleaveSnapshot }
  | { action: "remove" };

export type TableDiffAction =
  | { action: "add"; table: TableSnapshot }
  | { action: "remove"; tableName: string }
  | {
      action: "change";
      tableName: string;
      columnChanges?: ColumnDiffAction[];
      indexChanges?: IndexDiffAction[];
      primaryKeyChange?: PrimaryKeyDiffAction;
      interleaveChange?: InterleaveDiffAction;
    };

export interface SchemaDiff {
  fromVersion: string; // Snapshot version of the 'old' schema
  toVersion: string; // Snapshot version of the 'new' schema
  tableChanges: TableDiffAction[];
}

// --- Migration Executor Type ---
// The executeSql function should align with DatabaseAdapter['execute']
export type MigrationExecuteSql = (
  sql: string,
  params?: unknown[] | { [key: string]: string }
) => Promise<number | import("./adapter.js").AffectedRows>;

export type MigrationExecutor = (
  executeSql: MigrationExecuteSql,
  dialect: Dialect
) => Promise<void>;

// --- Prepared Query Type ---
export interface PreparedQuery<
  // TPrimaryTable can now be the more specific Table type or the base TableConfig
  TPrimaryTable extends TableConfig<any, any> | Table<any, any>,
  TInclude extends EnhancedIncludeClause | undefined = undefined
> {
  sql: string;
  parameters: unknown[];
  dialect: Dialect;
  action: "select" | "insert" | "update" | "delete"; // Added action
  includeClause?: TInclude; // Updated to use EnhancedIncludeClause
  primaryTable?: TPrimaryTable; // For result shaping
  // Potentially add selectedFields map here if needed for more advanced shaping or type inference
  fields?: SelectFields<TPrimaryTable>; // Added to carry selected fields info
  returning?: ReturningObject<TPrimaryTable> | true; // For INSERT/UPDATE/DELETE RETURNING
}

// --- Types for RETURNING clause ---
export type ReturningColumnSpec<
  TTable extends TableConfig<any, any> | Table<any, any>
> = SQL | ColumnConfig<any, any> | Extract<keyof TTable["columns"], string>;

export type ReturningObject<
  TTable extends TableConfig<any, any> | Table<any, any>
> = Record<string, ReturningColumnSpec<TTable>>;
