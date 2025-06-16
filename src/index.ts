// Core ORM Client
export { OrmClient } from "./client.js";

// Schema Definition
export {
  table,
  text,
  varchar,
  integer,
  // bigint, // Not exported from schema.ts
  boolean,
  timestamp,
  // date, // Not exported from schema.ts
  json,
  jsonb,
  uuid,
  // array, // Not exported from schema.ts
  // customType, // Not exported from schema.ts
  // Base types for columns - these are not directly exported as named types
  // type ColumnType,
  // type ColumnDataType,
  index, // Exported from schema.ts
  uniqueIndex, // Exported from schema.ts
  sql, // Re-exported from schema.ts (originally from common.ts)
} from "./core/schema.js";

// SQL Tag & Query Builder (QueryBuilder might be internal, but SQL tag is useful)
// sql is already exported from ./core/schema.js which re-exports it from common.js
// export { sql } from "./types/common.js";
export { QueryBuilder } from "./core/query-builder.js"; // Exporting QB if users want to use it directly

// Adapters (Users might import specific adapters if not using a generic setup)
export { PostgresAdapter } from "./pg/adapter.js";
export { PgliteAdapter } from "./pglite/adapter.js";
export { SpannerAdapter } from "./spanner/adapter.js";

// Common Types (Exporting types that users might need for type safety)
export type {
  TableConfig,
  ColumnConfig,
  InferModelType,
  InferColumnType,
  Dialect,
  ForeignKeyConfig,
  IndexConfig,
  CompositePrimaryKeyConfig,
  SelectFields,
  EnhancedIncludeClause,
  ShapedResultItem,
  SQL, // Re-export SQL from types/index.js as well for direct import if schema isn't used
  // Adapter related types
  DatabaseAdapter,
  QueryResultRow,
  Transaction,
  AffectedRows,
  ConnectionOptions,
  // Common schema types also re-exported for clarity if needed directly
  PreparedQuery,
  OrmFunctionDescriptor,
  // Snapshot and Diff types if they are part of public API
  SchemaSnapshot,
  TableSnapshot,
  ColumnSnapshot,
  IndexSnapshot,
  SchemaDiff,
  TableDiffAction,
  ColumnDiffAction,
  IndexDiffAction,
} from "./types/index.js"; // Using the new barrel file

export type { MigrationExecutor } from "./types/index.js"; // Exporting MigrationExecutor for migration tasks

// Functions
export * from "./core/functions.js";

// Migration specific exports (if any are intended for programmatic use)
// export * from './core/migration-generator';
// export * from './core/migration-meta';
