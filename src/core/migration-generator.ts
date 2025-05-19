// src/core/migration-generator.ts

import type {
  SchemaDiff,
  TableDiffAction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ColumnDiffAction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  IndexDiffAction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  PrimaryKeyDiffAction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  InterleaveDiffAction,
  Dialect,
  ColumnSnapshot,
  TableSnapshot,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  IndexSnapshot,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  CompositePrimaryKeySnapshot,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ColumnConfig, // Added for formatDefaultValuePostgres
} from "../types/common.js";
import { reservedKeywords } from "../spanner/reservedKeywords.js";

// --- PostgreSQL DDL Generation Helpers ---
function escapeIdentifierPostgres(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function formatDefaultValuePostgres(
  // Using ColumnSnapshot as it's what the diff will provide
  // but the original function used ColumnConfig. We need to align or adapt.
  // For now, let's assume we can adapt ColumnSnapshot for this.
  columnDefault: ColumnSnapshot["default"],
  columnName: string // For warning messages
): string {
  if (columnDefault === undefined) {
    return "";
  }
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    "sql" in columnDefault
  ) {
    return `DEFAULT ${columnDefault.sql}`;
  }
  if (typeof columnDefault === "string") {
    return `DEFAULT '${columnDefault.replace(/'/g, "''")}'`;
  }
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    !("sql" in columnDefault) &&
    !("function" in columnDefault)
  ) {
    // For JSON/JSONB defaults that are objects
    return `DEFAULT '${JSON.stringify(columnDefault).replace(/'/g, "''")}'`;
  }
  if (typeof columnDefault === "number" || typeof columnDefault === "boolean") {
    return `DEFAULT ${columnDefault}`;
  }
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    "function" in columnDefault
  ) {
    console.warn(
      `Function default for column "${columnName}" cannot be directly represented in DDL. Use sql\`...\` or a literal value.`
    );
    return "";
  }
  return "";
}

function generatePgCreateTableDDL(table: TableSnapshot): string {
  const tableName = escapeIdentifierPostgres(table.name);
  let columnsSql: string[] = []; // Changed const to let
  const primaryKeyColumns: string[] = [];

  for (const columnName in table.columns) {
    const column = table.columns[columnName];
    let columnSql = escapeIdentifierPostgres(column.name);

    columnSql += ` ${column.dialectTypes.postgres}`;

    if (column.notNull || column.primaryKey) {
      columnSql += " NOT NULL";
    }

    const defaultSql = formatDefaultValuePostgres(column.default, column.name);
    if (defaultSql) {
      columnSql += ` ${defaultSql}`;
    }

    if (column.unique) {
      columnSql += " UNIQUE";
    }

    if (column.primaryKey) {
      primaryKeyColumns.push(escapeIdentifierPostgres(column.name));
    }
    // References (FKs) will be handled as separate ALTER TABLE ADD CONSTRAINT statements
    // to manage dependencies and allow for forward references.
    columnsSql.push(columnSql);
  }

  if (primaryKeyColumns.length > 0 && !table.compositePrimaryKey) {
    // If individual columns are marked as PK and no composite PK is defined at table level
    if (primaryKeyColumns.length === 1) {
      const pkColName = primaryKeyColumns[0];
      columnsSql = columnsSql.map((csql) =>
        csql.startsWith(pkColName) && !csql.includes(" PRIMARY KEY")
          ? `${csql} PRIMARY KEY`
          : csql
      );
    } else {
      columnsSql.push(`PRIMARY KEY (${primaryKeyColumns.join(", ")})`);
    }
  } else if (
    table.compositePrimaryKey &&
    table.compositePrimaryKey.columns.length > 0
  ) {
    const pkCols = table.compositePrimaryKey.columns.map(
      escapeIdentifierPostgres
    );
    columnsSql.push(`PRIMARY KEY (${pkCols.join(", ")})`);
  }

  // Table-level unique constraints from indexes marked as unique
  if (table.indexes) {
    for (const index of table.indexes) {
      if (index.unique && !index.name?.startsWith("pk_")) {
        // Assuming pk_ prefix for PK constraints
        const indexName = index.name
          ? escapeIdentifierPostgres(index.name)
          : escapeIdentifierPostgres(
              `uq_${table.name}_${index.columns.join("_")}`
            );
        const uniqueColumns = index.columns
          .map(escapeIdentifierPostgres)
          .join(", ");
        columnsSql.push(`CONSTRAINT ${indexName} UNIQUE (${uniqueColumns})`);
      }
    }
  }

  return `CREATE TABLE ${tableName} (\n  ${columnsSql.join(",\n  ")}\n);`;
}

// Placeholder for PG DDL generation functions (to be expanded)
function generatePgDdl(diffActions: TableDiffAction[]): string[] {
  const ddlStatements: string[] = [];
  for (const action of diffActions) {
    switch (action.action) {
      case "add":
        ddlStatements.push(generatePgCreateTableDDL(action.table));
        // Non-unique indexes for new tables
        if (action.table.indexes) {
          for (const index of action.table.indexes) {
            if (!index.unique) {
              const indexName = index.name
                ? escapeIdentifierPostgres(index.name)
                : escapeIdentifierPostgres(
                    `idx_${action.table.name}_${index.columns.join("_")}`
                  );
              const columns = index.columns
                .map(escapeIdentifierPostgres)
                .join(", ");
              ddlStatements.push(
                `CREATE INDEX ${indexName} ON ${escapeIdentifierPostgres(
                  action.table.name
                )} (${columns});`
              );
            }
          }
        }
        break;
      case "remove":
        ddlStatements.push(
          `DROP TABLE ${escapeIdentifierPostgres(action.tableName)};`
        );
        break;
      case "change":
        // TODO: Implement column, index, pk, interleave changes for PG
        console.warn(
          `Table "${action.tableName}" change DDL generation not fully implemented for PG.`
        );
        break;
    }
  }
  return ddlStatements;
}

// --- Spanner DDL Generation Helpers ---
// TODO: Import from spanner/reservedKeywords.js or make it a shared utility
const spannerReservedKeywords = reservedKeywords;

function escapeIdentifierSpanner(name: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    if (spannerReservedKeywords.has(name.toUpperCase())) {
      return `\`${name}\``;
    }
    return name;
  }
  return `\`${name}\``;
}

function formatDefaultValueSpanner(
  columnDefault: ColumnSnapshot["default"],
  columnName: string // For warning messages
): string {
  if (columnDefault === undefined) {
    return "";
  }
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    "sql" in columnDefault
  ) {
    const sqlValue = columnDefault.sql as string;
    if (sqlValue.toUpperCase() === "CURRENT_TIMESTAMP") {
      return `DEFAULT (CURRENT_TIMESTAMP())`;
    }
    return `DEFAULT (${sqlValue})`;
  }
  if (typeof columnDefault === "string") {
    return `DEFAULT ('${columnDefault.replace(/'/g, "''")}')`;
  }
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    !("sql" in columnDefault) &&
    !("function" in columnDefault)
  ) {
    return `DEFAULT (JSON '${JSON.stringify(columnDefault).replace(
      /'/g,
      "''"
    )}')`;
  }
  if (typeof columnDefault === "number") {
    return `DEFAULT (${columnDefault})`;
  }
  if (typeof columnDefault === "boolean") {
    return `DEFAULT (${columnDefault ? "TRUE" : "FALSE"})`;
  }
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    "function" in columnDefault
  ) {
    console.warn(
      `Function default for Spanner column "${columnName}" cannot be directly represented in DDL. Use sql\`...\` or a literal value.`
    );
    return "";
  }
  return "";
}

function generateSpannerCreateTableDDL(table: TableSnapshot): string[] {
  const ddlStatements: string[] = [];
  const tableName = escapeIdentifierSpanner(table.name);
  const columnsSql: string[] = [];
  const primaryKeyColumns: string[] = [];

  for (const columnName in table.columns) {
    const column = table.columns[columnName];
    let columnSql = escapeIdentifierSpanner(column.name);
    columnSql += ` ${column.dialectTypes.spanner}`;

    if (column.notNull || column.primaryKey) {
      columnSql += " NOT NULL";
    }

    const defaultSql = formatDefaultValueSpanner(column.default, column.name);
    if (defaultSql) {
      columnSql += ` ${defaultSql}`;
    }

    if (column.primaryKey) {
      primaryKeyColumns.push(escapeIdentifierSpanner(column.name));
    }
    columnsSql.push(columnSql);
  }

  let createTableSql = `CREATE TABLE ${tableName} (\n  ${columnsSql.join(
    ",\n  "
  )}\n)`;

  if (
    table.compositePrimaryKey &&
    table.compositePrimaryKey.columns.length > 0
  ) {
    const pkCols = table.compositePrimaryKey.columns.map(
      escapeIdentifierSpanner
    );
    createTableSql += ` PRIMARY KEY (${pkCols.join(", ")})`;
  } else if (primaryKeyColumns.length > 0) {
    createTableSql += ` PRIMARY KEY (${primaryKeyColumns.join(", ")})`;
  }

  if (table.interleave) {
    createTableSql += `,\n  INTERLEAVE IN PARENT ${escapeIdentifierSpanner(
      table.interleave.parentTable
    )} ON DELETE ${
      table.interleave.onDelete === "cascade" ? "CASCADE" : "NO ACTION"
    }`;
  }

  ddlStatements.push(`${createTableSql};`);

  // Add CREATE UNIQUE INDEX statements for unique constraints defined in indexes
  if (table.indexes) {
    for (const index of table.indexes) {
      if (index.unique) {
        const indexName = index.name
          ? escapeIdentifierSpanner(index.name)
          : escapeIdentifierSpanner(
              `uq_${table.name}_${index.columns.join("_")}`
            );
        const uniqueColumns = index.columns
          .map(escapeIdentifierSpanner)
          .join(", ");
        // Spanner specific: NULL_FILTERED for nullable unique columns if desired (not directly in snapshot yet)
        ddlStatements.push(
          `CREATE UNIQUE INDEX ${indexName} ON ${tableName} (${uniqueColumns});`
        );
      }
    }
  }
  // Non-unique indexes
  if (table.indexes) {
    for (const index of table.indexes) {
      if (!index.unique) {
        const indexName = index.name
          ? escapeIdentifierSpanner(index.name)
          : escapeIdentifierSpanner(
              `idx_${table.name}_${index.columns.join("_")}`
            );
        const columns = index.columns.map(escapeIdentifierSpanner).join(", ");
        ddlStatements.push(
          `CREATE INDEX ${indexName} ON ${tableName} (${columns});`
        );
      }
    }
  }

  return ddlStatements;
}

// Placeholder for Spanner DDL generation functions (to be expanded)
function generateSpannerDdl(diffActions: TableDiffAction[]): string[] {
  const ddlStatements: string[] = [];
  for (const action of diffActions) {
    switch (action.action) {
      case "add":
        ddlStatements.push(...generateSpannerCreateTableDDL(action.table));
        break;
      case "remove":
        ddlStatements.push(
          `DROP TABLE ${escapeIdentifierSpanner(action.tableName)};`
        );
        break;
      case "change":
        // TODO: Implement column, index, pk, interleave changes for Spanner
        console.warn(
          `Table "${action.tableName}" change DDL generation not fully implemented for Spanner.`
        );
        break;
    }
  }
  // Remember Spanner's DDL batch limits.
  // For simplicity now, just returning all. A real implementation would batch.
  return ddlStatements;
}

export function generateMigrationDDL(
  schemaDiff: SchemaDiff,
  dialect: Dialect
): string[] {
  if (!schemaDiff || !schemaDiff.tableChanges) {
    return [];
  }

  switch (dialect) {
    case "postgres":
      return generatePgDdl(schemaDiff.tableChanges);
    case "spanner":
      return generateSpannerDdl(schemaDiff.tableChanges);
    default:
      throw new Error(`Unsupported dialect for DDL generation: ${dialect}`);
  }
}

// Example of how a more specific generator might look (conceptual)
/*
function generatePgCreateTableDDL(table: TableSnapshot): string {
    // ... logic from src/pg/ddl.ts ...
    return `CREATE TABLE "${table.name}" (...);`;
}

function generatePgAddColumnDDL(tableName: string, column: ColumnSnapshot): string {
    return `ALTER TABLE "${tableName}" ADD COLUMN "${column.name}" ${column.dialectTypes.postgres} ...;`;
}
*/
