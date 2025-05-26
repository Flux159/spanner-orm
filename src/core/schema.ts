// src/core/schema.ts
import crypto from "node:crypto"; // Ensure crypto is imported for default UUIDs
import type {
  ColumnConfig,
  TableConfig, // Base config type
  Table, // User-facing table type with direct column access
  IndexConfig,
  SQL,
  OnDeleteAction,
  CompositePrimaryKeyConfig,
  Dialect,
} from "../types/common.js";
import { sql } from "../types/common.js"; // Import the sql tagged template literal

// Global registry for table configurations
// Stores the fully constructed table objects (Table type)
const tableRegistry = new Map<string, Table<any, any>>();

export function getTableConfig(tableName: string): Table<any, any> | undefined {
  // Return type changed to Table
  return tableRegistry.get(tableName);
}

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
    this.config._autoDefaultedUuid = false; // User is setting an explicit default
    return this;
  }

  primaryKey(): this {
    this.config.primaryKey = true;
    // Automatically apply default UUID for primary keys of type uuid,
    // if no default is already set and it's not a foreign key.
    if (
      this.config._isUuidTypeForDefault &&
      this.config.default === undefined &&
      this.config.references === undefined
    ) {
      // Type assertion needed because TDataType might not always be string for BaseColumnBuilder,
      // but for uuid() it will be.
      // We know TDataType is string here because _isUuidTypeForDefault is only set by uuid() which uses VarcharColumnBuilder<string>
      this.$defaultFn(crypto.randomUUID as () => TDataType);
      this.config._autoDefaultedUuid = true; // Mark that this default was auto-applied
    }
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
    // If this column was a UUID PK that got an auto-default, remove it because it's now an FK.
    if (this.config._autoDefaultedUuid) {
      this.config.default = undefined;
      this.config._hasClientDefaultFn = undefined; // Or false
      this.config._autoDefaultedUuid = undefined; // Or false
    }
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
    this.config._hasClientDefaultFn = true; // Set the flag
    this.config._autoDefaultedUuid = false; // User is setting an explicit default function
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
    this.config.spannerQueryApiTypeCode = "STRING";
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
    this.config.spannerQueryApiTypeCode = "STRING";
  }
}

class IntegerColumnBuilder<TName extends string> extends BaseColumnBuilder<
  number,
  TName
> {
  constructor(name: TName) {
    super(name, "integer", { postgres: "INTEGER", spanner: "INT64" });
    this.config.spannerQueryApiTypeCode = "INT64";
  }
}

class BooleanColumnBuilder<TName extends string> extends BaseColumnBuilder<
  boolean,
  TName
> {
  constructor(name: TName) {
    super(name, "boolean", { postgres: "BOOLEAN", spanner: "BOOL" });
    this.config.spannerQueryApiTypeCode = "BOOL";
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
    this.config.spannerQueryApiTypeCode = "TIMESTAMP";
  }
}

class JsonbColumnBuilder<
  TName extends string,
  TJsonType = unknown // Changed any to unknown
> extends BaseColumnBuilder<TJsonType, TName> {
  constructor(name: TName) {
    super(name, "jsonb", { postgres: "JSONB", spanner: "JSON" }); // Spanner has a JSON type
    this.config.spannerQueryApiTypeCode = "JSON";
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
  tableNameInput: TTableName, // Renamed from name to tableNameInput to avoid conflict
  columnsInput: TColumns, // Renamed from columns to columnsInput
  extra?: (table: TableBuilderColumns<TColumns>) => {
    indexes?: IndexConfig[]; // This will be mapped to tableIndexes
    primaryKey?: CompositePrimaryKeyConfig;
    interleave?: TableConfig<any, any>["interleave"]; // Spanner specific
  }
): Table<TTableName, TableBuilderColumns<TColumns>> {
  // Return type changed to user-facing Table
  const builtColumnsArray = Object.entries(columnsInput).map(
    ([key, builder]) => {
      const colConfig = { ...builder.build() }; // Clone the config
      colConfig._tableName = tableNameInput; // Assign table name to column config
      return [key, colConfig];
    }
  );

  const builtColumns = Object.fromEntries(
    builtColumnsArray
  ) as TableBuilderColumns<TColumns>;

  // Start with the base TableConfig structure
  const baseTableConfig: TableConfig<
    TTableName,
    TableBuilderColumns<TColumns>
  > = {
    tableName: tableNameInput,
    columns: builtColumns,
    _isTable: true,
  };

  // Apply extra configurations
  if (extra) {
    const extraConfig = extra(builtColumns);
    if (extraConfig.indexes) {
      baseTableConfig.tableIndexes = extraConfig.indexes; // Assign to tableIndexes
    }
    if (extraConfig.primaryKey) {
      const individualPks = Object.values(builtColumns).filter(
        (c) => c.primaryKey
      );
      if (individualPks.length > 0) {
        throw new Error(
          `Table "${tableNameInput}" cannot have both a composite primary key and individual column primary keys (${individualPks
            .map((c) => c.name)
            .join(", ")}).`
        );
      }
      baseTableConfig.compositePrimaryKey = extraConfig.primaryKey;
    }
    if (extraConfig.interleave) {
      baseTableConfig.interleave = extraConfig.interleave;
    }
  }

  // Create the final table object by mixing in columns directly
  // Use 'as any' for the initial object to allow dynamic property assignment
  const finalTableObject = { ...baseTableConfig } as any;

  const reservedKeys = [
    "tableName",
    "columns",
    "tableIndexes",
    "compositePrimaryKey",
    "interleave",
    "_isTable",
  ];

  for (const colKey in builtColumns) {
    if (Object.prototype.hasOwnProperty.call(builtColumns, colKey)) {
      if (reservedKeys.includes(colKey) || colKey in baseTableConfig) {
        console.warn(
          `Column name "${colKey}" on table "${tableNameInput}" conflicts with a reserved table property. Access this column via ".columns.${colKey}".`
        );
      } else {
        finalTableObject[colKey] = builtColumns[colKey];
      }
    }
  }

  // Cast to the final Table type
  const fullyTypedTable = finalTableObject as Table<
    TTableName,
    TableBuilderColumns<TColumns>
  >;

  tableRegistry.set(tableNameInput, fullyTypedTable); // Register the fully typed table
  return fullyTypedTable;
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
  // NOTE: The $defaultFn for UUIDs is no longer automatically applied by the uuid() helper.
  // It should be explicitly chained if client-side UUID generation is desired, for example:
  // export const myTable = table("myTable", {
  //   id: uuid("id").$defaultFn(() => crypto.randomUUID()).primaryKey(), // This is now automatic if .primaryKey() is called on uuid()
  //   // ... other columns
  // });
  // Set the flag indicating this is a UUID type eligible for auto-default on PK
  (builder as any).config._isUuidTypeForDefault = true;
  return builder;
}
