// src/pg/ddl.ts

import type { TableConfig, ColumnConfig } from "../types/common.js"; // Removed SQL import

function escapeIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function formatDefaultValue(column: ColumnConfig<unknown, string>): string {
  if (column.default === undefined) {
    return "";
  }
  if (
    typeof column.default === "object" &&
    column.default !== null &&
    "sql" in column.default
  ) {
    // For sql tagged literals like sql`CURRENT_TIMESTAMP`
    // The 'sql' property already holds the stringified SQL
    return `DEFAULT ${column.default.sql}`;
  }
  if (typeof column.default === "string") {
    return `DEFAULT '${column.default.replace(/'/g, "''")}'`;
  }
  if (typeof column.default === "object" && column.default !== null) {
    // For JSON/JSONB defaults that are objects
    return `DEFAULT '${JSON.stringify(column.default).replace(/'/g, "''")}'`;
  }
  if (
    typeof column.default === "number" ||
    typeof column.default === "boolean"
  ) {
    return `DEFAULT ${column.default}`;
  }
  if (typeof column.default === "function") {
    // For $defaultFn, we'd ideally execute it, but for DDL generation,
    // this might not be what we want unless it's a placeholder for a DB function.
    // For now, we'll skip function defaults in DDL, assuming they are app-level.
    // Or, the function itself should return an SQL object.
    console.warn(
      `Function default for column "${column.name}" cannot be directly represented in DDL. Use sql\`...\` or a literal value.`
    );
    return "";
  }
  return "";
}

export function generateCreateTablePostgres(tableConfig: TableConfig): string {
  const tableName = escapeIdentifier(tableConfig.name);
  const columnsSql: string[] = [];
  const primaryKeyColumns: string[] = []; // Changed to const

  for (const columnName in tableConfig.columns) {
    const column = tableConfig.columns[columnName];
    let columnSql = escapeIdentifier(column.name);

    columnSql += ` ${column.dialectTypes.postgres}`;

    if (column.notNull) {
      columnSql += " NOT NULL";
    }

    const defaultSql = formatDefaultValue(column);
    if (defaultSql) {
      columnSql += ` ${defaultSql}`;
    }

    // Add PRIMARY KEY directly to column definition if it's a single PK
    // The table-level PRIMARY KEY will handle composite keys or if preferred for single.
    // For now, let's add it here if it's the only PK for Drizzle-like output.
    // This might be redundant if a table-level PK is also generated for a single column.
    // We need to decide on one canonical way or make the table-level PK smarter.
    // For now, let's assume if column.primaryKey is true, it's part of the PK.
    // The table-level one will list all such columns.
    // Drizzle typically shows PRIMARY KEY on the column line for single PKs.
    // The complex block below handles adding "PRIMARY KEY" to the columnSql if it's a single PK.
    // The primaryKeyColumns array is always populated for the table-level constraint.
    // The previous complex block for this was removed due to introducing an error.

    if (column.unique) {
      columnSql += " UNIQUE";
    }

    if (column.primaryKey) {
      // Add to list for table-level constraint (handles single and composite)
      primaryKeyColumns.push(escapeIdentifier(column.name));
      // If it's a single column PK, also add to column def for Drizzle-like output
      // Check if this column is the *only* primary key
      let pkCount = 0;
      for (const c in tableConfig.columns) {
        if (tableConfig.columns[c].primaryKey) pkCount++;
      }
      if (pkCount === 1) {
        columnSql += " PRIMARY KEY";
      }
    }

    columnsSql.push(columnSql);
  }

  if (primaryKeyColumns.length > 0) {
    // If primary keys are defined on columns, add a table-level PRIMARY KEY constraint
    // This handles composite keys better if we extend it later.
    // For now, Drizzle-style often defines PK on the column itself.
    // If multiple columns are marked .primaryKey(), this will form a composite PK.
    columnsSql.push(`PRIMARY KEY (${primaryKeyColumns.join(", ")})`);
  }

  // Handle table-level indexes
  if (tableConfig.indexes) {
    for (const index of tableConfig.indexes) {
      const indexName = index.name
        ? escapeIdentifier(index.name)
        : escapeIdentifier(`uq_${tableConfig.name}_${index.columns.join("_")}`); // Ensure generated name is escaped
      // const uniqueKeyword = index.unique ? "UNIQUE " : ""; // Removed unused uniqueKeyword
      const columns = index.columns.map(escapeIdentifier).join(", ");
      // CREATE UNIQUE INDEX idx_name ON table_name (column1, column2);
      // For now, adding as part of table definition if possible, or separate statements later.
      // PostgreSQL allows UNIQUE constraints in table def, but general INDEX is separate.
      // We'll focus on constraints that can be inline first.
      if (index.unique) {
        columnsSql.push(`CONSTRAINT ${indexName} UNIQUE (${columns})`);
      }
      // Non-unique indexes need separate CREATE INDEX statements, will be handled by migration executor.
    }
  }

  return `CREATE TABLE ${tableName} (\n  ${columnsSql.join(",\n  ")}\n);`;
}
