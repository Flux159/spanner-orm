// src/core/schema.ts
import crypto from "node:crypto"; // Added for uuid helper
import type {
  ColumnConfig,
  TableConfig,
  IndexConfig,
  SQL,
  // ForeignKeyConfig, // Not directly used as a type annotation here
  OnDeleteAction,
  CompositePrimaryKeyConfig,
  Dialect, // Added Dialect import
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
    // Store SQL objects directly, or functions, or literal values
    this.config.default = value;
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

  references(
    referencesFn: () => ColumnConfig<any, any>,
    options?: { onDelete?: OnDeleteAction }
  ): this {
    this.config.references = {
      referencesFn,
      onDelete: options?.onDelete,
    };
    return this;
  }

  // Method to allow setting specific dialect types externally if needed
  setDialectType(dialect: Dialect, type: string): this {
    if (dialect === "postgres") {
      this.config.dialectTypes.postgres = type;
    } else if (dialect === "spanner") {
      this.config.dialectTypes.spanner = type;
    }
    // Potentially extend for other dialects or throw error for unsupported
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
  extra?: (table: TableBuilderColumns<TColumns>) => {
    indexes?: IndexConfig[];
    primaryKey?: CompositePrimaryKeyConfig;
    interleave?: TableConfig<any, any>["interleave"]; // Spanner specific
  }
): TableConfig<TTableName, TableBuilderColumns<TColumns>> {
  const builtColumnsArray = Object.entries(columns).map(([key, builder]) => {
    const colConfig = builder.build();
    colConfig._tableName = name; // Assign table name to column config
    return [key, colConfig];
  });

  const builtColumns = Object.fromEntries(
    builtColumnsArray
  ) as TableBuilderColumns<TColumns>;

  const tableConfig: TableConfig<TTableName, TableBuilderColumns<TColumns>> = {
    name,
    columns: builtColumns,
    _isTable: true, // Added marker for CLI detection
  };

  if (extra) {
    const extraConfig = extra(builtColumns);
    if (extraConfig.indexes) {
      tableConfig.indexes = extraConfig.indexes;
    }
    if (extraConfig.primaryKey) {
      // Ensure no individual column is also marked as primaryKey if a composite one is defined
      const individualPks = Object.values(builtColumns).filter(
        (c) => c.primaryKey
      );
      if (individualPks.length > 0) {
        throw new Error(
          `Table "${name}" cannot have both a composite primary key and individual column primary keys (${individualPks
            .map((c) => c.name)
            .join(", ")}).`
        );
      }
      tableConfig.compositePrimaryKey = extraConfig.primaryKey;
    }
    if (extraConfig.interleave) {
      tableConfig.interleave = extraConfig.interleave;
    }
    // Handle other extra configurations here
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

// --- UUID Helper ---
export function uuid<TName extends string>(
  name: TName
): VarcharColumnBuilder<TName> {
  const builder = new VarcharColumnBuilder(name, { length: 36 });
  // Override dialect types for UUID
  builder.setDialectType("postgres", "UUID");
  // Spanner remains STRING(36) which is already set by VarcharColumnBuilder({length: 36})

  // Set default function using crypto
  // Need to import crypto at the top of the file for this to work.
  // For now, assuming crypto is available in the scope where this runs.
  // A better approach might be to pass crypto.randomUUID to $defaultFn if schema.ts can't import crypto directly.
  // However, the $defaultFn is executed by the QueryBuilder, which can import crypto.
  builder.$defaultFn(() => {
    // This function will be stringified and rehydrated or directly called by QueryBuilder.
    // Ensure QueryBuilder has access to 'crypto' or this function is self-contained.
    // For Node.js environment where QueryBuilder runs, crypto should be available.
    // For browser/other envs, this might need adjustment or a polyfill.
    // Dynamically importing crypto to avoid making it a hard dependency for users not using uuid().
    // This is a bit of a hack for the schema definition phase.
    // The actual execution of this function happens in QueryBuilder's context.
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback or error if crypto is not available in the execution context of $defaultFn
    // This part is tricky because the function is defined here but executed elsewhere.
    // The QueryBuilder will need to handle the execution environment of these functions.
    // For now, let's assume a Node-like environment for the QueryBuilder.
    // A more robust solution might involve the ORM providing a UUID generation mechanism.
    // For simplicity in this ORM, we rely on the runtime environment of the QueryBuilder.
    // This will be `import crypto from "node:crypto";` in query-builder.ts
    throw new Error(
      "crypto.randomUUID is not available in the execution environment for default value generation. Ensure 'crypto' module can be imported."
    );
  });
  return builder;
}
