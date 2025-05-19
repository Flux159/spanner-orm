// src/core/schema.ts

import type {
  ColumnConfig,
  TableConfig,
  // TableColumns, // Unused
  IndexConfig,
  SQL,
} from "../types/common.js";
import { sql } from "../types/common.js"; // Import the sql tagged template literal

// --- Column Builder ---

// Base class for all column builders to provide common methods
abstract class BaseColumnBuilder<
  TDataType,
  TName extends string,
  TConfig extends ColumnConfig<TDataType, TName> = ColumnConfig<
    TDataType,
    TName
  >
> {
  protected config: TConfig;

  constructor(
    name: TName,
    type: string,
    dialectTypes: TConfig["dialectTypes"]
  ) {
    this.config = {
      name,
      type,
      dialectTypes,
    } as TConfig;
  }

  notNull(): this {
    this.config.notNull = true;
    return this;
  }

  default(value: TDataType | (() => TDataType) | SQL): this {
    if (typeof value === "object" && value !== null && "_isSQL" in value) {
      this.config.default = { sql: (value as SQL).toSqlString("postgres") }; // Default to PG for now, DDL gen will pick correct
    } else {
      this.config.default = value;
    }
    return this;
  }

  primaryKey(): this {
    this.config.primaryKey = true;
    return this;
  }

  unique(): this {
    // This is for a single-column unique constraint.
    // For multi-column unique constraints, use uniqueIndex in table definition.
    this.config.unique = true;
    return this;
  }

  // Method to get the final column configuration
  build(): TConfig {
    return this.config;
  }

  // Placeholder for Drizzle-like .$type<VisibilityStatus>()
  // This would typically be a no-op at runtime for the builder itself,
  // but useful for type inference.
  $type<_TCustomType>(): this {
    // Prefixed TCustomType
    // This method doesn't change the config but helps with type assertions in user code.
    return this;
  }

  // Placeholder for Drizzle-like .$defaultFn()
  $defaultFn(fn: () => TDataType): this {
    this.config.default = fn;
    return this;
  }
}

// --- Specific Column Type Builders ---

class TextColumnBuilder<TName extends string> extends BaseColumnBuilder<
  string,
  TName
> {
  constructor(name: TName) {
    super(name, "text", { postgres: "TEXT", spanner: "STRING(MAX)" }); // Changed for Spanner
  }
}

class VarcharColumnBuilder<TName extends string> extends BaseColumnBuilder<
  string,
  TName
> {
  private length?: number;
  constructor(name: TName, options?: { length?: number }) {
    super(name, "varchar", {
      postgres: `VARCHAR${options?.length ? `(${options.length})` : ""}`,
      spanner: `STRING${options?.length ? `(${options.length})` : ""}`, // Spanner uses STRING(MAX) if length not specified or just STRING
    });
    this.length = options?.length;
    if (this.length) {
      // Update dialect types if length was actually provided
      this.config.dialectTypes.postgres = `VARCHAR(${this.length})`;
      this.config.dialectTypes.spanner = `STRING(${this.length})`;
    } else {
      this.config.dialectTypes.spanner = `STRING(MAX)`; // Spanner convention for unbounded string
    }
  }
}

class IntegerColumnBuilder<TName extends string> extends BaseColumnBuilder<
  number,
  TName
> {
  constructor(name: TName) {
    super(name, "integer", { postgres: "INTEGER", spanner: "INT64" });
  }
}

class BooleanColumnBuilder<TName extends string> extends BaseColumnBuilder<
  boolean,
  TName
> {
  constructor(name: TName) {
    super(name, "boolean", { postgres: "BOOLEAN", spanner: "BOOL" });
  }
}

class TimestampColumnBuilder<TName extends string> extends BaseColumnBuilder<
  Date,
  TName
> {
  constructor(name: TName, _options?: { withTimezone?: boolean }) {
    // Spanner TIMESTAMP always stores in UTC, akin to PG's TIMESTAMPTZ
    // PG 'timestamp' without timezone is generally discouraged.
    super(name, "timestamp", {
      postgres: "TIMESTAMP WITH TIME ZONE",
      spanner: "TIMESTAMP",
    });
  }
}

class JsonbColumnBuilder<
  TName extends string,
  TJsonType = unknown // Changed any to unknown
> extends BaseColumnBuilder<TJsonType, TName> {
  constructor(name: TName) {
    super(name, "jsonb", { postgres: "JSONB", spanner: "JSON" }); // Spanner has a JSON type
  }
}

// --- Column Functions (User-facing API) ---

export function text<TName extends string>(
  name: TName
): TextColumnBuilder<TName> {
  return new TextColumnBuilder(name);
}

export function varchar<TName extends string>(
  name: TName,
  options?: { length?: number }
): VarcharColumnBuilder<TName> {
  return new VarcharColumnBuilder(name, options);
}

export function integer<TName extends string>(
  name: TName
): IntegerColumnBuilder<TName> {
  return new IntegerColumnBuilder(name);
}

export function boolean<TName extends string>(
  name: TName
): BooleanColumnBuilder<TName> {
  return new BooleanColumnBuilder(name);
}

export function timestamp<TName extends string>(
  name: TName,
  options?: { withTimezone?: boolean } // Option kept for API compatibility, though behavior is fixed
): TimestampColumnBuilder<TName> {
  return new TimestampColumnBuilder(name, options);
}

export function jsonb<TName extends string, TJsonType = unknown>( // Changed any to unknown
  name: TName
): JsonbColumnBuilder<TName, TJsonType> {
  return new JsonbColumnBuilder<TName, TJsonType>(name);
}

// --- Table Definition ---

type ColumnBuilderToConfig<TBuilder> = TBuilder extends BaseColumnBuilder<
  infer _TDataType, // Prefixed TDataType
  infer _TName, // Prefixed TName
  infer TConfig
>
  ? TConfig
  : never;

type TableBuilderColumns<
  TColumns extends Record<
    string,
    BaseColumnBuilder<unknown, string, ColumnConfig<unknown, string>>
  >
> = {
  [K in keyof TColumns]: ColumnBuilderToConfig<TColumns[K]>;
};

export function table<
  TTableName extends string,
  TColumns extends Record<
    string,
    BaseColumnBuilder<unknown, string, ColumnConfig<unknown, string>>
  >
>(
  name: TTableName,
  columns: TColumns,
  extra?: (table: TableBuilderColumns<TColumns>) => { indexes?: IndexConfig[] } // For defining indexes, etc.
): TableConfig<TTableName, TableBuilderColumns<TColumns>> {
  const builtColumns = Object.fromEntries(
    Object.entries(columns).map(([key, builder]) => [key, builder.build()])
  ) as TableBuilderColumns<TColumns>;

  const tableConfig: TableConfig<TTableName, TableBuilderColumns<TColumns>> = {
    name,
    columns: builtColumns,
  };

  if (extra) {
    const extraConfig = extra(builtColumns);
    if (extraConfig.indexes) {
      tableConfig.indexes = extraConfig.indexes;
    }
    // Handle other extra configurations like Spanner's interleave here
  }

  return tableConfig;
}

// --- Index Functions ---

export function index(config: Omit<IndexConfig, "unique">): IndexConfig {
  return { ...config, unique: false };
}

export function uniqueIndex(config: Omit<IndexConfig, "unique">): IndexConfig {
  return { ...config, unique: true };
}

// Re-export sql for convenience when defining schemas
export { sql };
