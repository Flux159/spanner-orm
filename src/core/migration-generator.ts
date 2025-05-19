// src/core/migration-generator.ts

import type {
  SchemaDiff,
  TableDiffAction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ColumnDiffAction, // Ensuring this is not disabled
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  IndexDiffAction, // Re-enabled
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  PrimaryKeyDiffAction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  InterleaveDiffAction,
  Dialect,
  ColumnSnapshot,
  TableSnapshot,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  IndexSnapshot, // Re-enabled
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

function generatePgForeignKeyConstraintDDL(
  tableName: string,
  columnName: string,
  fk: NonNullable<ColumnSnapshot["references"]>
): string {
  const constraintName = fk.name
    ? escapeIdentifierPostgres(fk.name)
    : escapeIdentifierPostgres(
        `fk_${tableName}_${columnName}_${fk.referencedTable}`
      );
  const onDeleteAction = fk.onDelete
    ? ` ON DELETE ${fk.onDelete.toUpperCase()}`
    : "";
  return `ALTER TABLE ${escapeIdentifierPostgres(
    tableName
  )} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${escapeIdentifierPostgres(
    columnName
  )}) REFERENCES ${escapeIdentifierPostgres(
    fk.referencedTable
  )} (${escapeIdentifierPostgres(fk.referencedColumn)})${onDeleteAction};`;
}

function generatePgCreateTableDDLWithForeignKeys(
  table: TableSnapshot
): string[] {
  const ddlStatements: string[] = [];
  const createTableSql = generatePgCreateTableDDL(table); // Existing function for base CREATE TABLE
  ddlStatements.push(createTableSql);

  // Add foreign key constraints
  for (const columnName in table.columns) {
    const column = table.columns[columnName];
    if (column.references) {
      ddlStatements.push(
        generatePgForeignKeyConstraintDDL(
          table.name,
          columnName,
          column.references
        )
      );
    }
  }
  return ddlStatements;
}

// Placeholder for PG DDL generation functions (to be expanded)
function generatePgDdl(diffActions: TableDiffAction[]): string[] {
  const ddlStatements: string[] = [];
  for (const action of diffActions) {
    switch (action.action) {
      case "add":
        ddlStatements.push(
          ...generatePgCreateTableDDLWithForeignKeys(action.table)
        );
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
                  ddlStatements.push(`${colSql};`);
                  if (colChange.column.references) {
                    ddlStatements.push(
                      generatePgForeignKeyConstraintDDL(
                        action.tableName,
                        colChange.column.name,
                        colChange.column.references
                      )
                    );
                  }
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
                  if (changes.hasOwnProperty("references")) {
                    if (changes.references) {
                      // Add or change/replace FK
                      console.warn(
                        `Changing foreign key for ${action.tableName}.${colChange.columnName}. ` +
                          `If an old FK existed and its name/definition changed, it should be explicitly dropped by a preceding diff action. ` +
                          `This operation will attempt to add the new/updated FK constraint.`
                      );
                      ddlStatements.push(
                        generatePgForeignKeyConstraintDDL(
                          action.tableName,
                          colChange.columnName, // colChange.columnName is valid here for action: "change"
                          changes.references as NonNullable<
                            ColumnSnapshot["references"]
                          >
                        )
                      );
                    } else if (changes.references === null) {
                      // Remove FK
                      // This signifies that the 'references' property of the column is now null.
                      // We need the name of the FK constraint that *was* on this column.
                      // This name isn't available in `changes.references` (it's null).
                      // The `differ` should ideally provide the name of the constraint to be dropped.
                      // For now, use a placeholder and a strong warning.
                      const fkNameToRemovePlaceholder =
                        escapeIdentifierPostgres(
                          `fk_${action.tableName}_${colChange.columnName}_TO_BE_DROPPED`
                        );
                      console.warn(
                        `Attempting to DROP foreign key for ${action.tableName}.${colChange.columnName} because its 'references' property was set to null. ` +
                          `The specific constraint name is required for PostgreSQL. Using placeholder name "${fkNameToRemovePlaceholder}". ` +
                          `This DDL will likely FAIL. The schema diff process should provide the exact name of the FK constraint to drop.`
                      );
                      ddlStatements.push(
                        `ALTER TABLE ${tableName} DROP CONSTRAINT ${fkNameToRemovePlaceholder};`
                      );
                    }
                  }
                }
                break;
            }
          }
        }
        if (action.indexChanges) {
          for (const idxChange of action.indexChanges) {
            const tableName = escapeIdentifierPostgres(action.tableName);
            switch (idxChange.action) {
              case "add":
                {
                  const index = idxChange.index;
                  const indexName = index.name
                    ? escapeIdentifierPostgres(index.name)
                    : escapeIdentifierPostgres(
                        `idx_${action.tableName}_${index.columns.join("_")}`
                      );
                  const columns = index.columns
                    .map(escapeIdentifierPostgres)
                    .join(", ");
                  const uniqueKeyword = index.unique ? "UNIQUE " : "";
                  ddlStatements.push(
                    `CREATE ${uniqueKeyword}INDEX ${indexName} ON ${tableName} (${columns});`
                  );
                }
                break;
              case "remove":
                // Dropping an index requires its name.
                // The IndexDiffAction for remove should provide `indexName`.
                ddlStatements.push(
                  `DROP INDEX ${escapeIdentifierPostgres(idxChange.indexName)};`
                );
                break;
              case "change":
                // Altering an index often means DROP and CREATE.
                // For simplicity, we'll generate DROP and ADD.
                // A more sophisticated approach might handle specific ALTER INDEX commands if available and simple.
                console.warn(
                  `Index change for "${idxChange.indexName}" on table "${action.tableName}" will be handled as DROP and ADD for PG.`
                );
                ddlStatements.push(
                  `DROP INDEX ${escapeIdentifierPostgres(idxChange.indexName)};`
                );
                // We need the full new index definition to re-create it.
                // This assumes the 'changes' part of IndexDiffAction for 'change' might not be enough,
                // and we'd ideally have the new IndexSnapshot.
                // This part needs the new full IndexSnapshot to be available from the diff.
                // For now, this is a placeholder. The diff logic might need to provide the full new index.
                // Let's assume for now `idxChange.changes` can be cast or contains enough to rebuild.
                // This is a simplification.
                if (idxChange.changes && idxChange.changes.columns) {
                  // Check if we have enough to rebuild
                  const newIndexName = escapeIdentifierPostgres(
                    idxChange.indexName
                  ); // Keep same name
                  const newColumns = (idxChange.changes.columns as string[])
                    .map(escapeIdentifierPostgres)
                    .join(", ");
                  const newUniqueKeyword = idxChange.changes.unique
                    ? "UNIQUE "
                    : "";
                  ddlStatements.push(
                    `CREATE ${newUniqueKeyword}INDEX ${newIndexName} ON ${tableName} (${newColumns});`
                  );
                } else {
                  console.error(
                    `Cannot regenerate index ${idxChange.indexName} on ${tableName} due to insufficient change data.`
                  );
                }
                break;
            }
          }
        }
        if (action.primaryKeyChange) {
          const tableNameEsc = escapeIdentifierPostgres(action.tableName);
          const pkChange = action.primaryKeyChange;
          if (pkChange.action === "set") {
            const newPk = pkChange.pk;
            const newPkName = newPk.name
              ? escapeIdentifierPostgres(newPk.name)
              : escapeIdentifierPostgres(`pk_${action.tableName}`);
            const newPkColumns = newPk.columns
              .map(escapeIdentifierPostgres)
              .join(", ");
            ddlStatements.push(
              `ALTER TABLE ${tableNameEsc} ADD CONSTRAINT ${newPkName} PRIMARY KEY (${newPkColumns});`
            );
          } else if (pkChange.action === "remove") {
            const pkNameToRemove = pkChange.pkName
              ? escapeIdentifierPostgres(pkChange.pkName)
              : escapeIdentifierPostgres(`pk_${action.tableName}`);
            if (!pkChange.pkName) {
              console.warn(
                `Primary key name for DROP operation on table "${action.tableName}" for PostgreSQL was not provided. Assuming default name "${pkNameToRemove}". This might fail.`
              );
            }
            ddlStatements.push(
              `ALTER TABLE ${tableNameEsc} DROP CONSTRAINT ${pkNameToRemove};`
            );
          }
        }
        // TODO: Implement interleave changes for PG
        if (action.interleaveChange) {
          console.warn(
            `Table "${action.tableName}" interleave change DDL generation not yet implemented for PG.`
          );
        }
        if (
          !action.columnChanges &&
          !action.indexChanges &&
          !action.primaryKeyChange &&
          !action.interleaveChange
        ) {
          // This condition might be too broad if only some changes are unimplemented.
          // console.warn(
          //   `Table "${action.tableName}" had a 'change' action but no specific changes were processed for PG.`
          // );
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

function generateSpannerForeignKeyConstraintDDL(
  tableName: string,
  columnName: string,
  fk: NonNullable<ColumnSnapshot["references"]>
): string {
  // Spanner constraint names are global to the schema.
  const constraintName = fk.name
    ? escapeIdentifierSpanner(fk.name)
    : escapeIdentifierSpanner(
        `FK_${tableName}_${columnName}_${fk.referencedTable}` // Ensure unique enough
      );
  const onDeleteAction = fk.onDelete
    ? ` ON DELETE ${fk.onDelete.toUpperCase()}`
    : ""; // Spanner defaults to NO ACTION if not specified

  return `ALTER TABLE ${escapeIdentifierSpanner(
    tableName
  )} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${escapeIdentifierSpanner(
    columnName
  )}) REFERENCES ${escapeIdentifierSpanner(
    fk.referencedTable
  )} (${escapeIdentifierSpanner(fk.referencedColumn)})${onDeleteAction};`;
}

function generateSpannerCreateTableDDLWithForeignKeys(
  table: TableSnapshot
): string[] {
  const ddlStatements = generateSpannerCreateTableDDL(table); // This already returns string[]

  // Add foreign key constraints separately
  for (const columnName in table.columns) {
    const column = table.columns[columnName];
    if (column.references) {
      ddlStatements.push(
        generateSpannerForeignKeyConstraintDDL(
          table.name,
          columnName,
          column.references
        )
      );
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
        ddlStatements.push(
          ...generateSpannerCreateTableDDLWithForeignKeys(action.table)
        );
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
                  if (colChange.column.references) {
                    ddlStatements.push(
                      generateSpannerForeignKeyConstraintDDL(
                        action.tableName,
                        colChange.column.name,
                        colChange.column.references
                      )
                    );
                  }
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
                  if (changes.hasOwnProperty("references")) {
                    if (changes.references) {
                      // Add or change/replace FK
                      console.warn(
                        `Changing foreign key for Spanner table ${action.tableName}.${colChange.columnName}. ` +
                          `If an old FK existed and its name/definition changed, it should be explicitly dropped by a preceding diff action. ` +
                          `This operation will attempt to add the new/updated FK constraint.`
                      );
                      ddlStatements.push(
                        generateSpannerForeignKeyConstraintDDL(
                          action.tableName,
                          colChange.columnName, // colChange.columnName is valid here
                          changes.references as NonNullable<
                            ColumnSnapshot["references"]
                          >
                        )
                      );
                    } else if (changes.references === null) {
                      // Remove FK
                      const fkNameToRemovePlaceholder = escapeIdentifierSpanner(
                        `FK_${action.tableName}_${colChange.columnName}_TO_BE_DROPPED`
                      );
                      console.warn(
                        `Attempting to DROP foreign key for Spanner table ${action.tableName}.${colChange.columnName} because its 'references' property was set to null. ` +
                          `The specific constraint name is required. Using placeholder name "${fkNameToRemovePlaceholder}". ` +
                          `This DDL will likely FAIL. The schema diff process should provide the correct constraint name.`
                      );
                      ddlStatements.push(
                        `ALTER TABLE ${tableName} DROP CONSTRAINT ${fkNameToRemovePlaceholder};`
                      );
                    }
                  }
                }
                break;
            }
          }
        }
        if (action.indexChanges) {
          for (const idxChange of action.indexChanges) {
            const tableName = escapeIdentifierSpanner(action.tableName);
            switch (idxChange.action) {
              case "add":
                {
                  const index = idxChange.index;
                  const indexName = index.name
                    ? escapeIdentifierSpanner(index.name)
                    : escapeIdentifierSpanner(
                        `idx_${action.tableName}_${index.columns.join("_")}`
                      );
                  const columns = index.columns
                    .map(escapeIdentifierSpanner)
                    .join(", ");
                  if (index.unique) {
                    ddlStatements.push(
                      `CREATE UNIQUE INDEX ${indexName} ON ${tableName} (${columns});`
                    );
                  } else {
                    ddlStatements.push(
                      `CREATE INDEX ${indexName} ON ${tableName} (${columns});`
                    );
                  }
                }
                break;
              case "remove":
                ddlStatements.push(
                  `DROP INDEX ${escapeIdentifierSpanner(idxChange.indexName)};`
                );
                break;
              case "change":
                console.warn(
                  `Index change for "${idxChange.indexName}" on table "${action.tableName}" will be handled as DROP and ADD for Spanner.`
                );
                ddlStatements.push(
                  `DROP INDEX ${escapeIdentifierSpanner(idxChange.indexName)};`
                );
                if (idxChange.changes && idxChange.changes.columns) {
                  const newIndexName = escapeIdentifierSpanner(
                    idxChange.indexName
                  );
                  const newColumns = (idxChange.changes.columns as string[])
                    .map(escapeIdentifierSpanner)
                    .join(", ");
                  if (idxChange.changes.unique) {
                    ddlStatements.push(
                      `CREATE UNIQUE INDEX ${newIndexName} ON ${tableName} (${newColumns});`
                    );
                  } else {
                    ddlStatements.push(
                      `CREATE INDEX ${newIndexName} ON ${tableName} (${newColumns});`
                    );
                  }
                } else {
                  console.error(
                    `Cannot regenerate index ${idxChange.indexName} on ${tableName} due to insufficient change data for Spanner.`
                  );
                }
                break;
            }
          }
        }
        if (action.primaryKeyChange) {
          // Spanner does not support altering primary keys on existing tables.
          console.warn(
            `Spanner does not support altering primary keys (add, remove, or change) on existing table "${action.tableName}". ` +
              `This operation usually requires table recreation and data migration. No DDL will be generated by the ORM for this PK change.`
          );
        }
        if (action.interleaveChange) {
          // Spanner does not support altering interleave on existing tables.
          console.warn(
            `Spanner does not support altering the interleave configuration (parent table or ON DELETE rule) for existing table "${action.tableName}". ` +
              `This operation usually requires table recreation and data migration. No DDL will be generated by the ORM for this interleave change.`
          );
        }
        if (
          !action.columnChanges &&
          !action.indexChanges &&
          !action.primaryKeyChange &&
          !action.interleaveChange
        ) {
          // This condition might be too broad if only some changes are unimplemented.
          // console.warn(
          //   `Table "${action.tableName}" had a 'change' action but no specific changes were processed for Spanner.`
          // );
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
