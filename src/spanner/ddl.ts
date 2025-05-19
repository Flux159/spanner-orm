// src/spanner/ddl.ts

import type { TableConfig, ColumnConfig } from "../types/common.js";

// Spanner uses backticks for escaping, but often identifiers are unquoted if simple.
// For simplicity and safety, we can choose to always backtick or only when necessary.
// Let's try to use backticks only when the name isn't a simple identifier.
// A simple identifier is typically [A-Za-z_][A-Za-z0-9_]*.
// Spanner reserved keywords also need escaping. For now, a simpler check.
function escapeIdentifierSpanner(name: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    // Check against a list of common Spanner reserved keywords (not exhaustive)
    const reservedKeywords = new Set([
      "ALL",
      "AND",
      "ANY",
      "ARRAY",
      "AS",
      "ASC",
      "ASSERT_ROWS_MODIFIED",
      "AT",
      "BETWEEN",
      "BY",
      "CASE",
      "CAST",
      "COLLATE",
      "CONTAINS",
      "CREATE",
      "CROSS",
      "CUBE",
      "CURRENT",
      "DEFAULT",
      "DEFINE",
      "DESC",
      "DISTINCT",
      "ELSE",
      "END",
      "ENUM",
      "ESCAPE",
      "EXCEPT",
      "EXCLUDE",
      "EXISTS",
      "EXTRACT",
      "FALSE",
      "FETCH",
      "FOLLOWING",
      "FOR",
      "FROM",
      "FULL",
      "GROUP",
      "GROUPING",
      "GROUPS",
      "HASH",
      "HAVING",
      "IF",
      "IGNORE",
      "IN",
      "INNER",
      "INTERSECT",
      "INTERVAL",
      "INTO",
      "IS",
      "JOIN",
      "LATERAL",
      "LEFT",
      "LIKE",
      "LIMIT",
      "LOOKUP",
      "MERGE",
      "NATURAL",
      "NEW",
      "NO",
      "NOT",
      "NULL",
      "NULLS",
      "OF",
      "ON",
      "OR",
      "ORDER",
      "OUTER",
      "OVER",
      "PARTITION",
      "PRECEDING",
      "PROTO",
      "RANGE",
      "RECURSIVE",
      "RESPECT",
      "RIGHT",
      "ROLLUP",
      "ROWS",
      "SELECT",
      "SET",
      "SOME",
      "STRUCT",
      "TABLESAMPLE",
      "THEN",
      "TO",
      "TREAT",
      "TRUE",
      "UNBOUNDED",
      "UNION",
      "UNNEST",
      "USING",
      "WHEN",
      "WHERE",
      "WINDOW",
      "WITH",
      "WITHIN",
      // Common SQL keywords that might also be problematic
      "INDEX",
      "TABLE",
      "UPDATE",
      "DELETE",
      "INSERT",
      "ALTER",
      "DROP",
      "CONSTRAINT",
    ]);
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
    "sql" in column.default
  ) {
    // For sql tagged literals like sql\`CURRENT_TIMESTAMP\`
    // Spanner's CURRENT_TIMESTAMP()
    const sqlValue = column.default.sql as string;
    if (sqlValue.toUpperCase() === "CURRENT_TIMESTAMP") {
      return `DEFAULT (CURRENT_TIMESTAMP())`;
    }
    return `DEFAULT (${sqlValue})`; // General SQL default
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
    columnsSql.push(columnSql);
  }

  let createTableSql = `CREATE TABLE ${tableName} (\n  ${columnsSql.join(
    ",\n  "
  )}\n)`;

  if (primaryKeyColumns.length > 0) {
    createTableSql += ` PRIMARY KEY (${primaryKeyColumns.join(", ")})`;
  }

  createTableSql += ";";

  // Spanner unique indexes are separate statements: CREATE UNIQUE INDEX ...
  // These will be handled by the migration runner.
  // However, if a unique constraint is defined in tableConfig.indexes, we could note it.
  // For now, this generator focuses on CREATE TABLE + PRIMARY KEY.

  return createTableSql;
}
