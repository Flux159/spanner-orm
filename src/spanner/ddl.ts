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

  // 1. Handle SQL objects from sql`` tag (e.g., sql`CURRENT_TIMESTAMP`)
  if (
    typeof column.default === "object" &&
    column.default !== null &&
    (column.default as SQL)._isSQL === true && // Check the marker
    typeof (column.default as SQL).toSqlString === "function" // Ensure it has the method
  ) {
    const sqlString = (column.default as SQL).toSqlString("spanner");
    // Spanner's CURRENT_TIMESTAMP() needs to be CURRENT_TIMESTAMP()
    if (sqlString.toUpperCase() === "CURRENT_TIMESTAMP") {
      return `DEFAULT (CURRENT_TIMESTAMP())`;
    }
    // Other SQL expressions also need to be wrapped in parentheses for Spanner DEFAULT
    return `DEFAULT (${sqlString})`;
  }

  // 2. Handle client-side default functions (e.g., from $defaultFn for UUIDs)
  if (column._hasClientDefaultFn && typeof column.default === "function") {
    // This is a client-side default, so no DDL representation.
    // The warning is suppressed because we've explicitly acknowledged it.
    return "";
  }

  // 3. Handle raw SQL provided as { sql: "RAW_SQL" }
  if (
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

  // 4. Handle literal string defaults
  if (typeof column.default === "string") {
    return `DEFAULT ('${column.default.replace(/'/g, "''")}')`;
  }

  // 5. Handle literal number defaults
  if (typeof column.default === "number") {
    return `DEFAULT (${column.default})`;
  }

  // 6. Handle literal boolean defaults
  if (typeof column.default === "boolean") {
    return `DEFAULT (${column.default ? "TRUE" : "FALSE"})`; // Spanner uses TRUE/FALSE keywords
  }

  // 7. Handle other function defaults (that are not client-side $defaultFn)
  if (typeof column.default === "function") {
    // This function default is not marked as _hasClientDefaultFn,
    // so it's unexpected here for DDL generation.
    console.warn(
      `Unrecognized function default for Spanner column "${column.name}" cannot be directly represented in DDL. Use sql\`...\`, a literal value, or $defaultFn for client-side defaults.`
    );
    return "";
  }

  // 8. Handle object defaults (e.g., for JSON) that are not SQL objects
  // This should come after SQL object check to avoid misinterpreting SQL objects.
  if (typeof column.default === "object" && column.default !== null) {
    // Spanner JSON type takes a string representation of JSON, often with JSON keyword.
    return `DEFAULT (JSON '${JSON.stringify(column.default).replace(
      /'/g,
      "''"
    )}')`;
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
