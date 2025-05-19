// src/types/common.ts

export type Dialect = "postgres" | "spanner";

export interface ColumnConfig<T, TName extends string = string> {
  name: TName;
  type: string; // Abstract type, e.g., 'text', 'integer', 'timestamp'
  dialectTypes: {
    postgres: string; // e.g., 'TEXT', 'INTEGER', 'TIMESTAMP WITH TIME ZONE'
    spanner: string; // e.g., 'STRING', 'INT64', 'TIMESTAMP'
  };
  notNull?: boolean;
  default?: T | (() => T) | { sql: string }; // SQL string for default like sql`CURRENT_TIMESTAMP`
  primaryKey?: boolean;
  unique?: boolean; // For unique constraints on a single column
  // Placeholder for more advanced properties like $onUpdate, $type from example
}

export interface IndexConfig {
  name?: string;
  columns: string[];
  unique?: boolean;
  // Spanner specific: nullFiltered, interleaveIn
}

export type TableColumns = Record<string, ColumnConfig<unknown, string>>;

export interface TableConfig<
  TName extends string = string,
  TColumns extends TableColumns = TableColumns
> {
  name: TName;
  columns: TColumns;
  indexes?: IndexConfig[];
  _isTable?: boolean; // Added for CLI detection
  // Spanner specific: interleave?: { parent: string; onDelete: 'cascade' | 'no action' }
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
  toSqlString(dialect: Dialect): string;
  getValues(): unknown[]; // For parameterized queries
  readonly _isSQL: true;
}

export function sql(strings: TemplateStringsArray, ...values: unknown[]): SQL {
  return {
    _isSQL: true,
    getValues: () => values,
    toSqlString: (dialect: Dialect): string => {
      // Basic implementation, dialect-specific handling might be needed for placeholders
      let result = strings[0];
      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (typeof value === "object" && value !== null && "_isSQL" in value) {
          result += (value as SQL).toSqlString(dialect) + strings[i + 1];
        } else {
          // This needs to be dialect-specific for placeholders ($1, ?, @p1)
          // For now, just a simple placeholder.
          // In a real scenario, the adapter would handle this.
          result +=
            (dialect === "postgres" ? `$${i + 1}` : `@p${i + 1}`) +
            strings[i + 1];
        }
      }
      return result.trim();
    },
  };
}
