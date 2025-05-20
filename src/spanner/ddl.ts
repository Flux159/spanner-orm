// src/spanner/ddl.ts

import type { TableConfig, ColumnConfig, SQL } from "../types/common.js"; // Added SQL import
import { reservedKeywords } from "./reservedKeywords.js";

// Spanner uses backticks for escaping, but often identifiers are unquoted if simple.
// For simplicity and safety, we can choose to always backtick or only when necessary.
// Let's try to use backticks only when the name isn't a simple identifier.
// A simple identifier is typically [A-Za-z_][A-Za-z0-9_]*.
// Spanner reserved keywords also need escaping. For now, a simpler check.
function escapeIdentifierSpanner(name: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    // Check against a list of common Spanner reserved keywords (not exhaustive)
    if (reservedKeywords.has(name.toUpperCase())) {
      return `\`${name}\``; // Use single backticks
    }
    return name; // No quotes if simple and not reserved
  }
  // If not simple, always escape with backticks.
  // Assuming names won't contain backticks themselves for this simplification.
  return `\`${name}\``;
}

function formatDefaultValueSpanner(
  column: ColumnConfig<unknown, string>
): string {
  if (column.default === undefined) {
    return "";
  }
  if (
    typeof column.default === "object" &&
    column.default !== null &&
    (column.default as SQL)._isSQL === true
  ) {
    // For SQL objects created by the sql`` tag
    // Spanner's CURRENT_TIMESTAMP() needs to be CURRENT_TIMESTAMP() not just CURRENT_TIMESTAMP
    const sqlString = (column.default as SQL).toSqlString("spanner");
    if (sqlString.toUpperCase() === "CURRENT_TIMESTAMP") {
      return `DEFAULT (CURRENT_TIMESTAMP())`;
    }
    return `DEFAULT (${sqlString})`;
  }
  if (
    // This handles the { sql: "RAW_SQL" } case
    typeof column.default === "object" &&
    column.default !== null &&
    "sql" in column.default &&
    typeof (column.default as { sql: string }).sql === "string"
  ) {
    const sqlValue = (column.default as { sql: string }).sql;
    if (sqlValue.toUpperCase() === "CURRENT_TIMESTAMP") {
      return `DEFAULT (CURRENT_TIMESTAMP())`;
    }
    return `DEFAULT (${sqlValue})`;
  }
  if (typeof column.default === "string") {
    // Spanner strings are typically single-quoted, but can use triple quotes.
    // Standard SQL string literals are single-quoted.
    return `DEFAULT ('${column.default.replace(/'/g, "''")}')`;
  }
  if (typeof column.default === "object" && column.default !== null) {
    // For JSON defaults that are objects
    // Spanner JSON type takes a string representation of JSON.
    return `DEFAULT (JSON '${JSON.stringify(column.default).replace(
      /'/g,
      "''"
    )}')`;
  }
  if (typeof column.default === "number") {
    return `DEFAULT (${column.default})`;
  }
  if (typeof column.default === "boolean") {
    return `DEFAULT (${column.default ? "TRUE" : "FALSE"})`; // Spanner uses TRUE/FALSE keywords
  }
  if (typeof column.default === "function") {
    console.warn(
      `Function default for Spanner column "${column.name}" cannot be directly represented in DDL. Use sql\`...\` or a literal value.`
    );
    return "";
  }
  return "";
}

export function generateCreateTableSpanner(tableConfig: TableConfig): string {
  const tableName = escapeIdentifierSpanner(tableConfig.name);
  const columnsSql: string[] = [];
  const primaryKeyColumns: string[] = [];
  const foreignKeySqls: string[] = [];

  for (const columnName in tableConfig.columns) {
    const column = tableConfig.columns[columnName];
    let columnSql = escapeIdentifierSpanner(column.name);

    columnSql += ` ${column.dialectTypes.spanner}`; // Use Spanner specific type

    // NOT NULL constraint
    if (column.notNull || column.primaryKey) {
      // PK columns are implicitly NOT NULL in Spanner, but explicit is fine
      columnSql += " NOT NULL";
    }

    // DEFAULT value
    const defaultSql = formatDefaultValueSpanner(column);
    if (defaultSql) {
      columnSql += ` ${defaultSql}`;
    }

    // Spanner does not have inline UNIQUE for columns in the same way PG does.
    // Unique constraints are via unique indexes.
    // Primary key columns are collected and defined at the table level.
    if (column.primaryKey) {
      primaryKeyColumns.push(escapeIdentifierSpanner(column.name));
    }

    if (column.references) {
      const referencedColumnConfig = column.references.referencesFn();
      const referencedTableName = referencedColumnConfig._tableName;
      const referencedColumnName = referencedColumnConfig.name;

      if (!referencedTableName) {
        console.warn(
          `Could not determine referenced table name for column "${column.name}" in table "${tableConfig.name}". FK constraint skipped for Spanner.`
        );
      } else {
        // Spanner FK constraint names are optional but good practice. Auto-generate one.
        const fkName = escapeIdentifierSpanner(
          `fk_${tableConfig.name}_${column.name}_${referencedTableName}`
        );
        let fkSql = `CONSTRAINT ${fkName} FOREIGN KEY (${escapeIdentifierSpanner(
          column.name
        )}) REFERENCES ${escapeIdentifierSpanner(
          referencedTableName
        )}(${escapeIdentifierSpanner(referencedColumnName)})`;

        // Spanner only supports ON DELETE CASCADE and ON DELETE NO ACTION (default)
        if (column.references.onDelete?.toLowerCase() === "cascade") {
          fkSql += ` ON DELETE CASCADE`;
        }
        // ON DELETE NO ACTION is the default and doesn't need to be specified.
        // Other actions like SET NULL, SET DEFAULT, RESTRICT are not directly supported by Spanner FKs.
        else if (
          column.references.onDelete &&
          column.references.onDelete.toLowerCase() !== "no action"
        ) {
          console.warn(
            `Spanner does not support ON DELETE ${column.references.onDelete.toUpperCase()} for FK on ${
              tableConfig.name
            }.${column.name}. Defaulting to NO ACTION.`
          );
        }
        foreignKeySqls.push(fkSql);
      }
    }
    columnsSql.push(columnSql);
  }

  const definitionParts = [...columnsSql]; // Changed to const

  if (
    tableConfig.compositePrimaryKey &&
    tableConfig.compositePrimaryKey.columns.length > 0
  ) {
    // Spanner defines PK as part of the table, not as a separate constraint line usually
    // The primaryKeyColumns array is used below.
    // const compositePkCols = tableConfig.compositePrimaryKey.columns.map(escapeIdentifierSpanner); // This was unused here
  } else if (primaryKeyColumns.length > 0 && !tableConfig.compositePrimaryKey) {
    // Handled by primaryKeyColumns below
  }

  // Add collected foreign keys as table-level constraints
  definitionParts.push(...foreignKeySqls);

  let createTableSql = `CREATE TABLE ${tableName} (\n  ${definitionParts.join(
    ",\n  "
  )}\n)`;

  // Spanner PRIMARY KEY is defined outside the parentheses of column definitions
  if (
    tableConfig.compositePrimaryKey &&
    tableConfig.compositePrimaryKey.columns.length > 0
  ) {
    const compositePkCols = tableConfig.compositePrimaryKey.columns.map(
      escapeIdentifierSpanner
    );
    createTableSql += ` PRIMARY KEY (${compositePkCols.join(", ")})`;
  } else if (primaryKeyColumns.length > 0) {
    createTableSql += ` PRIMARY KEY (${primaryKeyColumns.join(", ")})`;
  }

  // Spanner INTERLEAVE IN PARENT clause
  if (tableConfig.interleave) {
    createTableSql += `,\n  INTERLEAVE IN PARENT ${escapeIdentifierSpanner(
      tableConfig.interleave.parentTable
    )} ON DELETE ${tableConfig.interleave.onDelete.toUpperCase()}`;
  }

  createTableSql += ";";

  // Spanner unique indexes are separate statements: CREATE UNIQUE INDEX ...
  // These will be handled by the migration runner.
  // However, if a unique constraint is defined in tableConfig.indexes, we could note it.
  // For now, this generator focuses on CREATE TABLE + PRIMARY KEY.

  return createTableSql;
}
