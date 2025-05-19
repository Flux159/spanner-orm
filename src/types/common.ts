// src/types/common.ts

export type Dialect = "pg" | "spanner"; // Changed "postgres" to "pg" for consistency

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
    pg: string; // e.g., 'TEXT', 'INTEGER', 'TIMESTAMP WITH TIME ZONE'
    spanner: string; // e.g., 'STRING', 'INT64', 'TIMESTAMP'
  };
  notNull?: boolean;
  default?: T | (() => T) | { sql: string }; // SQL string for default like sql`CURRENT_TIMESTAMP`
  primaryKey?: boolean; // For single column primary key
  unique?: boolean; // For unique constraints on a single column
  references?: ForeignKeyConfig;
  _tableName?: string; // Internal: Name of the table this column belongs to
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
  name: TName;
  columns: TColumns;
  indexes?: IndexConfig[];
  compositePrimaryKey?: CompositePrimaryKeyConfig;
  interleave?: {
    parentTable: string; // Name of the parent table
    onDelete: "cascade" | "no action";
  };
  _isTable?: boolean; // Added for CLI detection
}

// Utility type to infer the TS type from a ColumnConfig
export type InferColumnType<C extends ColumnConfig<unknown, string>> =
  C["default"] extends undefined
    ? C["notNull"] extends true
      ? NonNullable<C extends ColumnConfig<infer T, string> ? T : never>
      : (C extends ColumnConfig<infer T, string> ? T : never) | null
    : NonNullable<C extends ColumnConfig<infer T, string> ? T : never>;

// Utility type to infer the TS type for a whole table
export type InferModelType<T extends TableConfig<string, TableColumns>> = {
  [K in keyof T["columns"]]: InferColumnType<T["columns"][K]>;
};

// For SQL tagged template literal
export interface SQL {
  /**
   * Generates the SQL string for the specified dialect.
   * @param dialect The SQL dialect ('postgres' or 'spanner').
   * @param currentParamIndex An object holding the current parameter index, passed by reference to be incremented.
   * @returns The SQL string with placeholders.
   */
  toSqlString(dialect: Dialect, currentParamIndex?: { value: number }): string;
  /**
   * Gets the array of parameter values corresponding to the placeholders in the SQL string.
   * @returns An array of parameter values.
   */
  getValues(): unknown[];
  readonly _isSQL: true;
}

export function sql(strings: TemplateStringsArray, ...values: unknown[]): SQL {
  const getValuesRecursive = (vals: unknown[]): unknown[] => {
    const params: unknown[] = [];
    for (const val of vals) {
      if (typeof val === "object" && val !== null) {
        if ("_isSQL" in val) {
          // Check if it's an SQL object
          params.push(...(val as SQL).getValues());
        } else if (
          // Check if it's NOT a ColumnConfig object
          // A ColumnConfig has 'name', 'type', and 'dialectTypes'
          !(
            "name" in val &&
            typeof (val as any).name === "string" &&
            "type" in val &&
            typeof (val as any).type === "string" &&
            "dialectTypes" in val &&
            typeof (val as any).dialectTypes === "object"
          )
        ) {
          params.push(val); // It's some other object, treat as parameter
        }
        // If it is a ColumnConfig, it's not a parameter, so it's skipped here.
      } else {
        params.push(val); // Primitives are parameters
      }
    }
    return params;
  };

  return {
    _isSQL: true,
    getValues: () => getValuesRecursive(values),
    toSqlString: (
      dialect: Dialect,
      currentParamIndex?: { value: number }
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
              (value as SQL).toSqlString(dialect, paramIndexState) +
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
            const colName = (value as ColumnConfig<any, any>).name;
            result +=
              (dialect === "pg" ? `"${colName}"` : `\`${colName}\``) + // Changed "postgres" to "pg"
              strings[i + 1];
          } else {
            // It's some other object, treat as a parameter
            result +=
              (dialect === "pg" // Changed "postgres" to "pg"
                ? `$${paramIndexState.value++}`
                : `@p${paramIndexState.value++}`) + strings[i + 1];
          }
        } else {
          // Primitives are parameters
          result +=
            (dialect === "pg" // Changed "postgres" to "pg"
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
  dialectTypes: { pg: string; spanner: string }; // Changed postgres to pg
  notNull?: boolean;
  default?: unknown | { sql: string } | { function: string }; // Store actual value, SQL, or a marker for function
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
  name: string;
  columns: Record<string, ColumnSnapshot>;
  indexes?: IndexSnapshot[];
  compositePrimaryKey?: CompositePrimaryKeySnapshot;
  interleave?: InterleaveSnapshot; // Spanner specific
  // Future: checks?: CheckConstraintSnapshot[];
}

export interface SchemaSnapshot {
  version: string; // Version of the spanner-orm snapshot format
  dialect: "pg" | "spanner" | "common"; // Or maybe this isn't needed if snapshot is dialect-agnostic before generation
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

// --- Migration Types ---

// Placeholder for DB client types, replace with actual types from 'pg', '@google-cloud/spanner', etc.
export type PgClient = any;
export type SpannerClient = any; // This would be Spanner.Database from '@google-cloud/spanner'

export interface MigrationActions {
  pg: (db: PgClient) => Promise<void>;
  spanner: (db: SpannerClient) => Promise<void>;
}

export interface Migration {
  up: MigrationActions;
  down: MigrationActions;
}
