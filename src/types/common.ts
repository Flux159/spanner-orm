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
              (dialect === "postgres" ? `"${colName}"` : `\`${colName}\``) +
              strings[i + 1];
          } else {
            // It's some other object, treat as a parameter
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
