// src/core/migration-generator.ts

import type {
  SchemaDiff,
  TableDiffAction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ColumnDiffAction, // Ensuring this is not disabled
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
        if (action.columnChanges) {
          for (const colChange of action.columnChanges) {
            const tableName = escapeIdentifierPostgres(action.tableName);
            switch (colChange.action) {
              case "add":
                {
                  const column = colChange.column;
                  let colSql = `ALTER TABLE ${tableName} ADD COLUMN ${escapeIdentifierPostgres(
                    column.name
                  )} ${column.dialectTypes.postgres}`;
                  if (column.notNull) colSql += " NOT NULL";
                  if (column.unique) colSql += " UNIQUE";
                  const defaultSql = formatDefaultValuePostgres(
                    column.default,
                    column.name
                  );
                  if (defaultSql) colSql += ` ${defaultSql}`;
                  // TODO: Handle primaryKey on add? Usually part of table creation or specific ALTER.
                  // TODO: Handle references on add.
                  ddlStatements.push(`${colSql};`);
                }
                break;
              case "remove":
                ddlStatements.push(
                  `ALTER TABLE ${tableName} DROP COLUMN ${escapeIdentifierPostgres(
                    colChange.columnName
                  )};`
                );
                break;
              case "change":
                {
                  const columnName = escapeIdentifierPostgres(
                    colChange.columnName
                  );
                  const changes = colChange.changes;
                  if (changes.type || changes.dialectTypes) {
                    // Assuming dialectTypes.postgres is the target type string
                    const newType =
                      changes.dialectTypes?.postgres || changes.type;
                    if (newType) {
                      // USING clause might be needed for some type changes
                      ddlStatements.push(
                        `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} SET DATA TYPE ${newType};`
                      );
                    }
                  }
                  if (changes.hasOwnProperty("notNull")) {
                    if (changes.notNull) {
                      ddlStatements.push(
                        `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} SET NOT NULL;`
                      );
                    } else {
                      ddlStatements.push(
                        `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} DROP NOT NULL;`
                      );
                    }
                  }
                  if (changes.hasOwnProperty("default")) {
                    if (changes.default !== undefined) {
                      const defaultSql = formatDefaultValuePostgres(
                        changes.default,
                        colChange.columnName
                      );
                      ddlStatements.push(
                        `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} ${
                          defaultSql ? defaultSql : "DROP DEFAULT"
                        };`
                      );
                    } else {
                      ddlStatements.push(
                        `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} DROP DEFAULT;`
                      );
                    }
                  }
                  if (changes.hasOwnProperty("unique")) {
                    // Adding/dropping unique constraints often requires constraint names.
                    // This is a simplified version. A real implementation would need to manage constraint names.
                    if (changes.unique) {
                      const constraintName = escapeIdentifierPostgres(
                        `uq_${action.tableName}_${colChange.columnName}`
                      );
                      ddlStatements.push(
                        `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} UNIQUE (${columnName});`
                      );
                    } else {
                      // Dropping unique constraint needs its name. This is a placeholder.
                      // Assuming a convention like uq_tableName_columnName
                      const constraintName = escapeIdentifierPostgres(
                        `uq_${action.tableName}_${colChange.columnName}`
                      );
                      ddlStatements.push(
                        `ALTER TABLE ${tableName} DROP CONSTRAINT ${constraintName};`
                      );
                      console.warn(
                        `Dropping unique constraint on ${action.tableName}.${colChange.columnName} requires knowing the constraint name. Placeholder DDL generated.`
                      );
                    }
                  }
                  // TODO: Handle changes to primaryKey (complex, often involves dropping/recreating PK constraint)
                  // TODO: Handle changes to references (FKs)
                }
                break;
            }
          }
        }
        // TODO: Implement index, pk, interleave changes for PG
        if (
          action.indexChanges ||
          action.primaryKeyChange ||
          action.interleaveChange
        ) {
          console.warn(
            `Table "${action.tableName}" index, PK, or interleave change DDL generation not yet implemented for PG.`
          );
        }
        if (
          !action.columnChanges &&
          !action.indexChanges &&
          !action.primaryKeyChange &&
          !action.interleaveChange
        ) {
          console.warn(
            `Table "${action.tableName}" had a 'change' action but no specific changes were processed for PG.`
          );
        }
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
        if (action.columnChanges) {
          for (const colChange of action.columnChanges) {
            const tableName = escapeIdentifierSpanner(action.tableName);
            switch (colChange.action) {
              case "add":
                {
                  const column = colChange.column;
                  let colSql = `ALTER TABLE ${tableName} ADD COLUMN ${escapeIdentifierSpanner(
                    column.name
                  )} ${column.dialectTypes.spanner}`;
                  if (column.notNull) colSql += " NOT NULL";
                  // Spanner DEFAULT is part of column definition: DEFAULT (expression)
                  const defaultSql = formatDefaultValueSpanner(
                    column.default,
                    column.name
                  );
                  if (defaultSql) colSql += ` ${defaultSql}`;
                  // Unique constraints are handled by separate CREATE UNIQUE INDEX statements.
                  ddlStatements.push(`${colSql};`);
                }
                break;
              case "remove":
                ddlStatements.push(
                  `ALTER TABLE ${tableName} DROP COLUMN ${escapeIdentifierSpanner(
                    colChange.columnName
                  )};`
                );
                break;
              case "change":
                {
                  const columnName = escapeIdentifierSpanner(
                    colChange.columnName
                  );
                  const changes = colChange.changes;

                  // Spanner ALTER COLUMN has limitations.
                  // Type changes: ALTER TABLE <table> ALTER COLUMN <col> <new_type>
                  // Nullability: ALTER TABLE <table> ALTER COLUMN <col> [NOT NULL | DROP NOT NULL] (DROP NOT NULL is effectively allowing NULLs)
                  // Default: Spanner does not support ALTER COLUMN ... SET DEFAULT directly.
                  //          Changing a default value typically requires dropping and re-adding the column or other workarounds.
                  //          For now, we will not generate DDL for default changes on existing columns for Spanner.

                  if (changes.type || changes.dialectTypes) {
                    const newType =
                      changes.dialectTypes?.spanner || changes.type;
                    if (newType) {
                      ddlStatements.push(
                        `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} ${newType};`
                      );
                      console.warn(
                        `Spanner DDL for changing column type for ${tableName}.${columnName} to ${newType} generated. Review for compatibility and potential data conversion needs.`
                      );
                    }
                  }
                  if (changes.hasOwnProperty("notNull")) {
                    if (changes.notNull) {
                      ddlStatements.push(
                        `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} NOT NULL;`
                      );
                    } else {
                      // Spanner doesn't have an explicit "DROP NOT NULL" in the same way as PG.
                      // To make a column nullable, you alter its type definition to not include NOT NULL.
                      // This often means re-specifying the type.
                      // This is a simplified approach. A more robust solution would require the original column definition.
                      // For now, we'll issue a warning. The user might need to provide the full type definition.
                      // A common DDL would be: ALTER TABLE <table> ALTER COLUMN <col> <type> (where <type> does not include NOT NULL)
                      console.warn(
                        `Spanner DDL for making ${tableName}.${columnName} nullable may require re-specifying the full column type without NOT NULL. Automatic generation is limited here.`
                      );
                      // Placeholder: ddlStatements.push(`ALTER TABLE ${tableName} ALTER COLUMN ${columnName} <EXISTING_TYPE_WITHOUT_NOT_NULL>;`);
                    }
                  }
                  if (changes.hasOwnProperty("default")) {
                    console.warn(
                      `Spanner does not support ALTER COLUMN SET DEFAULT directly for ${tableName}.${columnName}. Default value changes require manual DDL or column recreation.`
                    );
                  }
                  if (changes.hasOwnProperty("unique")) {
                    // Unique constraints in Spanner are managed via UNIQUE INDEXES.
                    // This change should be handled by indexChanges.
                    console.warn(
                      `Spanner 'unique' constraint changes for ${tableName}.${columnName} should be handled via index diffs (CREATE/DROP UNIQUE INDEX).`
                    );
                  }
                }
                break;
            }
          }
        }
        // TODO: Implement index, pk, interleave changes for Spanner
        if (
          action.indexChanges ||
          action.primaryKeyChange ||
          action.interleaveChange
        ) {
          console.warn(
            `Table "${action.tableName}" index, PK, or interleave change DDL generation not yet implemented for Spanner.`
          );
        }
        if (
          !action.columnChanges &&
          !action.indexChanges &&
          !action.primaryKeyChange &&
          !action.interleaveChange
        ) {
          console.warn(
            `Table "${action.tableName}" had a 'change' action but no specific changes were processed for Spanner.`
          );
        }
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
