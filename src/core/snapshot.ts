// src/core/snapshot.ts

import type {
  TableConfig,
  ColumnConfig,
  SchemaSnapshot,
  TableSnapshot,
  ColumnSnapshot,
  IndexSnapshot,
  CompositePrimaryKeySnapshot,
  InterleaveSnapshot,
  TableColumns,
} from "../types/common.js";

const ORM_SNAPSHOT_VERSION = "1.0.0";

function transformColumn(
  columnConfig: ColumnConfig<any, any>,
  allTableConfigs: Record<string, TableConfig<string, TableColumns>> // Used to resolve references
): ColumnSnapshot {
  const snapshot: ColumnSnapshot = {
    name: columnConfig.name,
    type: columnConfig.type,
    dialectTypes: columnConfig.dialectTypes,
  };

  if (columnConfig.notNull) snapshot.notNull = true;
  if (columnConfig.primaryKey) snapshot.primaryKey = true;
  if (columnConfig.unique) snapshot.unique = true;

  if (columnConfig.default !== undefined) {
    // Check for SQL object first
    if (
      typeof columnConfig.default === "object" &&
      columnConfig.default !== null &&
      (columnConfig.default as any)._isSQL === true // Check for SQL marker
    ) {
      snapshot.default = columnConfig.default; // Preserve the SQL object
    } else if (typeof columnConfig.default === "function") {
      // For client-side functions or other function defaults
      snapshot.default = { function: "[FUNCTION_DEFAULT]" }; // Represent as function marker
    } else if (
      typeof columnConfig.default === "object" &&
      columnConfig.default !== null &&
      "sql" in columnConfig.default // For { sql: "RAW_SQL" }
    ) {
      snapshot.default = { sql: (columnConfig.default as { sql: string }).sql };
    } else {
      snapshot.default = columnConfig.default; // Literals
    }
  }

  // Copy the _hasClientDefaultFn flag if it exists
  if (columnConfig._hasClientDefaultFn) {
    snapshot._hasClientDefaultFn = true;
  }

  if (columnConfig.references) {
    const fkConfig = columnConfig.references;
    try {
      const referencedColumnConfig = fkConfig.referencesFn();
      const referencedTableName = referencedColumnConfig._tableName;

      if (!referencedTableName) {
        throw new Error(
          `Could not determine referenced table name for column "${columnConfig.name}" in table "${columnConfig._tableName}". Ensure _tableName is set on referenced column's config.`
        );
      }
      // Ensure the referenced table exists in the provided configurations
      if (!allTableConfigs[referencedTableName]) {
        throw new Error(
          `Referenced table "${referencedTableName}" for column "${columnConfig.name}" in table "${columnConfig._tableName}" not found in schema.`
        );
      }

      snapshot.references = {
        referencedTable: referencedTableName,
        referencedColumn: referencedColumnConfig.name,
        onDelete: fkConfig.onDelete,
      };
    } catch (e: any) {
      throw new Error(
        `Error resolving foreign key for ${columnConfig._tableName}.${columnConfig.name}: ${e.message}`
      );
    }
  }

  return snapshot;
}

function transformTable(
  tableConfig: TableConfig<string, TableColumns>,
  allTableConfigs: Record<string, TableConfig<string, TableColumns>>
): TableSnapshot {
  const columns: Record<string, ColumnSnapshot> = {};
  for (const key in tableConfig) {
    if (Object.prototype.hasOwnProperty.call(tableConfig, key)) {
      // Filter out metadata properties and ensure it's a column config
      if (
        !key.startsWith("_") &&
        typeof tableConfig[key as keyof typeof tableConfig] === "object" &&
        tableConfig[key as keyof typeof tableConfig] !== null &&
        "dialectTypes" in tableConfig[key as keyof typeof tableConfig] // A good indicator of a ColumnConfig
      ) {
        const columnConfig = tableConfig[
          key as keyof typeof tableConfig
        ] as ColumnConfig<any, any>;
        columns[columnConfig.name] = transformColumn(
          columnConfig,
          allTableConfigs
        );
      }
    }
  }

  const indexes: IndexSnapshot[] = (tableConfig._indexes || []).map(
    (idx): IndexSnapshot => ({
      name: idx.name,
      columns: idx.columns,
      unique: idx.unique || false, // Ensure unique is always present
    })
  );

  let compositePrimaryKey: CompositePrimaryKeySnapshot | undefined;
  if (tableConfig._compositePrimaryKey) {
    compositePrimaryKey = {
      name: tableConfig._compositePrimaryKey.name,
      columns: tableConfig._compositePrimaryKey.columns,
    };
  }

  let interleave: InterleaveSnapshot | undefined;
  if (tableConfig._interleave) {
    interleave = {
      parentTable: tableConfig._interleave.parentTable,
      onDelete: tableConfig._interleave.onDelete,
    };
  }

  return {
    name: tableConfig._name,
    columns,
    indexes: indexes.length > 0 ? indexes : undefined,
    compositePrimaryKey,
    interleave,
  };
}

export function generateSchemaSnapshot(
  schemaTables: Record<string, TableConfig<string, TableColumns>> // Expect an object map of table configs
): SchemaSnapshot {
  const tables: Record<string, TableSnapshot> = {};
  for (const tableName in schemaTables) {
    tables[tableName] = transformTable(schemaTables[tableName], schemaTables);
  }

  return {
    version: ORM_SNAPSHOT_VERSION,
    dialect: "common", // Snapshot is dialect-agnostic at this stage
    tables,
  };
}
