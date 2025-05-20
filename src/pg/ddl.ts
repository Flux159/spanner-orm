// src/pg/ddl.ts

import type { TableConfig, ColumnConfig, SQL } from "../types/common.js"; // Added SQL import

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
    (column.default as SQL)._isSQL === true
  ) {
    // For SQL objects created by the sql`` tag
    return `DEFAULT ${(column.default as SQL).toSqlString("postgres")}`;
  }
  if (
    // This handles the { sql: "RAW_SQL" } case, which might be legacy or for direct use
    typeof column.default === "object" &&
    column.default !== null &&
    "sql" in column.default &&
    typeof (column.default as { sql: string }).sql === "string"
  ) {
    return `DEFAULT ${(column.default as { sql: string }).sql}`;
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

    if (column.notNull || column.primaryKey) {
      // Add NOT NULL if it's a primary key
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
      if (pkCount === 1 && !tableConfig.compositePrimaryKey) {
        // Also check no composite PK is defined
        columnSql += " PRIMARY KEY";
      }
    }

    if (column.references) {
      const referencedColumnConfig = column.references.referencesFn();
      const referencedTableName = referencedColumnConfig._tableName; // Assumes _tableName is populated
      const referencedColumnName = referencedColumnConfig.name;

      if (!referencedTableName) {
        console.warn(
          `Could not determine referenced table name for column "${column.name}" in table "${tableConfig.name}". FK constraint skipped.`
        );
      } else {
        columnSql += ` REFERENCES ${escapeIdentifier(
          referencedTableName
        )}(${escapeIdentifier(referencedColumnName)})`;
        if (column.references.onDelete) {
          columnSql += ` ON DELETE ${column.references.onDelete.toUpperCase()}`;
        }
      }
    }

    columnsSql.push(columnSql);
  }

  // Handle composite primary key if defined at table level
  if (
    tableConfig.compositePrimaryKey &&
    tableConfig.compositePrimaryKey.columns.length > 0
  ) {
    const compositePkCols =
      tableConfig.compositePrimaryKey.columns.map(escapeIdentifier);
    columnsSql.push(`PRIMARY KEY (${compositePkCols.join(", ")})`);
  } else if (primaryKeyColumns.length > 0 && !tableConfig.compositePrimaryKey) {
    // Fallback to primaryKeyColumns if no composite PK is explicitly set
    // This handles the case where PKs are only marked on columns.
    // If a composite PK is set, it takes precedence.
    if (
      primaryKeyColumns.length > 1 ||
      (primaryKeyColumns.length === 1 &&
        Object.values(tableConfig.columns).find(
          (c) =>
            c.name === primaryKeyColumns[0].replace(/"/g, "") &&
            c.primaryKey &&
            Object.values(tableConfig.columns).filter((c) => c.primaryKey)
              .length > 1
        ))
    ) {
      // Only add table-level PK if it's composite, or if single PK wasn't added inline
      // The inline PK is added if pkCount === 1. If pkCount > 1, it means multiple columns are marked primaryKey
      // but not as a composite key, which is an invalid state we should ideally prevent earlier.
      // For now, this ensures a table-level PK for multiple individually marked PKs.
      columnsSql.push(`PRIMARY KEY (${primaryKeyColumns.join(", ")})`);
    } else if (primaryKeyColumns.length === 1) {
      // Check if the single PK was already added inline
      const pkColName = primaryKeyColumns[0].replace(/"/g, "");
      const pkCol = Object.values(tableConfig.columns).find(
        (c) => c.name === pkColName
      );
      if (
        pkCol &&
        !columnsSql.find(
          (s) =>
            s.startsWith(escapeIdentifier(pkColName)) &&
            s.includes(" PRIMARY KEY")
        )
      ) {
        columnsSql.push(`PRIMARY KEY (${primaryKeyColumns.join(", ")})`);
      }
    }
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
