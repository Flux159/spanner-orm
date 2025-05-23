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
  SchemaSnapshot, // Added for FK generation
} from "../types/common.js";
import { reservedKeywords } from "../spanner/reservedKeywords.js";

const SPANNER_DDL_BATCH_SIZE = 5; // Configurable batch size

// --- PostgreSQL DDL Generation Helpers ---
function escapeIdentifierPostgres(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function formatDefaultValuePostgres(
  columnDefault: ColumnSnapshot["default"],
  columnName: string, // For warning messages
  hasClientDefaultFn?: boolean
): string {
  if (columnDefault === undefined) {
    return "";
  }

  // 1. Handle client-side default functions (UUIDs etc.)
  if (
    hasClientDefaultFn &&
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    (columnDefault as { function?: string }).function === "[FUNCTION_DEFAULT]"
  ) {
    return ""; // No DDL, no warning
  }

  // 2. Handle SQL objects from sql`` tag
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    (columnDefault as any)._isSQL === true && // Check for SQL marker
    typeof (columnDefault as any).toSqlString === "function"
  ) {
    return `DEFAULT ${(columnDefault as any).toSqlString("postgres")}`;
  }

  // 3. Handle raw SQL provided as { sql: "RAW_SQL" }
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    "sql" in columnDefault &&
    typeof (columnDefault as { sql: string }).sql === "string"
  ) {
    return `DEFAULT ${(columnDefault as { sql: string }).sql}`;
  }

  // 4. Handle literal string defaults
  if (typeof columnDefault === "string") {
    return `DEFAULT '${columnDefault.replace(/'/g, "''")}'`;
  }

  // 5. Handle literal number or boolean defaults
  if (typeof columnDefault === "number" || typeof columnDefault === "boolean") {
    return `DEFAULT ${columnDefault}`;
  }

  // 6. Handle function marker for non-client-side functions (should warn)
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    (columnDefault as { function?: string }).function === "[FUNCTION_DEFAULT]"
  ) {
    // TODO: See if we want to warn here - it's kinda annoying if user already knows its going to be client side $defaultFn
    // console.warn(
    //   `Function default for column "${columnName}" cannot be directly represented in DDL. Use sql\`...\` or a literal value.`
    // );
    return "";
  }

  // 7. Handle other object defaults (e.g., for JSON/JSONB)
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null // Ensure it's not an SQL object or function marker already handled
  ) {
    return `DEFAULT '${JSON.stringify(columnDefault).replace(/'/g, "''")}'`;
  }

  return "";
}

function generatePgCreateTableDDL(table: TableSnapshot): string {
  const tableName = escapeIdentifierPostgres(table.name);
  // eslint-disable-next-line prefer-const
  let columnsSql: string[] = [];
  const primaryKeyColumns: string[] = [];

  for (const columnName in table.columns) {
    const column = table.columns[columnName];
    let columnSql = escapeIdentifierPostgres(column.name);
    columnSql += ` ${column.dialectTypes.postgres}`;
    if (column.notNull || column.primaryKey) {
      columnSql += " NOT NULL";
    }
    const defaultSql = formatDefaultValuePostgres(
      column.default,
      column.name,
      column._hasClientDefaultFn
    );
    if (defaultSql) {
      columnSql += ` ${defaultSql}`;
    }
    // Unique constraints (non-PK) will be handled separately as ALTER TABLE or CREATE UNIQUE INDEX
    // if (column.unique) {
    //   columnSql += " UNIQUE";
    // }
    if (column.primaryKey) {
      primaryKeyColumns.push(escapeIdentifierPostgres(column.name));
    }
    columnsSql.push(columnSql);
  }

  if (primaryKeyColumns.length > 0 && !table.compositePrimaryKey) {
    if (primaryKeyColumns.length === 1) {
      // Find the column definition and append PRIMARY KEY
      const pkColNameForSearch = primaryKeyColumns[0]; // Already escaped
      const colIndex = columnsSql.findIndex((csql) =>
        csql.startsWith(pkColNameForSearch + " ")
      );
      if (colIndex !== -1 && !columnsSql[colIndex].includes(" PRIMARY KEY")) {
        columnsSql[colIndex] += " PRIMARY KEY";
      } else if (colIndex === -1) {
        // This case should ideally not happen if primaryKeyColumns is populated correctly
        console.warn(
          `Primary key column ${primaryKeyColumns[0]} not found in SQL definitions for table ${table.name}. Adding PRIMARY KEY clause separately.`
        );
        columnsSql.push(`PRIMARY KEY (${primaryKeyColumns.join(", ")})`);
      }
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

  // Inline unique constraints and other indexes are removed from here.
  // They will be generated as separate CREATE INDEX or ALTER TABLE ADD CONSTRAINT statements.
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

function generatePgDdl(
  diffActions: TableDiffAction[],
  newSchemaSnapshot: SchemaSnapshot
): string[] {
  let tableNameEsc: string; // Declare once here for the whole function scope
  const createTableStatements: string[] = [];
  const addColumnStatements: string[] = [];
  const createIndexStatements: string[] = []; // Includes unique constraints via ADD CONSTRAINT or CREATE UNIQUE INDEX
  const addForeignKeyStatements: string[] = [];
  const alterColumnStatements: string[] = []; // For type, nullability, default changes

  const dropForeignKeyStatements: string[] = [];
  const dropIndexStatements: string[] = []; // Includes unique constraints
  const dropColumnStatements: string[] = [];
  const dropTableStatements: string[] = [];

  // Other alteration statements (like PK changes, though these are complex)
  const otherAlterations: string[] = [];

  for (const action of diffActions) {
    // Determine and assign tableNameEsc based on the action type before the switch
    if (action.action === "add") {
      tableNameEsc = escapeIdentifierPostgres(action.table.name);
    } else {
      // For 'remove' or 'change', action.tableName is available
      tableNameEsc = escapeIdentifierPostgres(action.tableName);
    }

    switch (action.action) {
      case "add": {
        const table = action.table;
        // tableNameEsc is already set using table.name for the 'add' case
        createTableStatements.push(generatePgCreateTableDDL(table));

        // Collect FKs for later
        for (const propKey in table.columns) {
          const column = table.columns[propKey];
          if (column.references) {
            addForeignKeyStatements.push(
              generatePgForeignKeyConstraintDDL(
                table.name, // Use original table name for FK definition
                column.name, // Use actual DB column name
                column.references
              )
            );
          }
          // Handle column-level unique constraints (not part of PK)
          if (column.unique && !column.primaryKey) {
            const constraintName = escapeIdentifierPostgres(
              `uq_${table.name}_${column.name}`
            );
            createIndexStatements.push(
              // Using createIndexStatements for unique constraints too
              `ALTER TABLE ${escapeIdentifierPostgres(
                table.name
              )} ADD CONSTRAINT ${constraintName} UNIQUE (${escapeIdentifierPostgres(
                column.name
              )});`
            );
          }
        }

        // Collect table-level indexes (unique and non-unique)
        if (table.indexes) {
          for (const index of table.indexes) {
            const indexName = index.name
              ? escapeIdentifierPostgres(index.name)
              : escapeIdentifierPostgres(
                  `${index.unique ? "uq" : "idx"}_${
                    table.name
                  }_${index.columns.join("_")}`
                );
            const columns = index.columns
              .map(escapeIdentifierPostgres)
              .join(", ");
            if (index.unique) {
              // Prefer CREATE UNIQUE INDEX over ALTER TABLE ADD CONSTRAINT for multi-column unique indexes defined in table.indexes
              createIndexStatements.push(
                `CREATE UNIQUE INDEX ${indexName} ON ${escapeIdentifierPostgres(
                  table.name
                )} (${columns});`
              );
            } else {
              createIndexStatements.push(
                `CREATE INDEX ${indexName} ON ${escapeIdentifierPostgres(
                  table.name
                )} (${columns});`
              );
            }
          }
        }
        break;
      }
      case "remove":
        // tableNameEsc is correctly set before this switch from action.tableName
        dropTableStatements.push(`DROP TABLE ${tableNameEsc};`);
        // Note: Associated FKs and Indexes on other tables referencing/using this table
        // should ideally be handled by their own 'remove' or 'change' diff actions.
        // PostgreSQL's `DROP TABLE ... CASCADE` could also be an option but makes explicit DDL harder.
        break;
      case "change":
        // tableNameEsc is correctly set before this switch from action.tableName
        if (action.columnChanges) {
          for (const colChange of action.columnChanges) {
            let currentColumnName: string;
            const originalTableNameForChange = action.tableName; // Use action.tableName for changes

            if (colChange.action === "add") {
              currentColumnName = colChange.column.name;
            } else {
              currentColumnName = colChange.columnName;
            }
            const columnNameEsc = escapeIdentifierPostgres(currentColumnName);

            switch (colChange.action) {
              case "add": {
                const column = colChange.column;
                let colSql = `ALTER TABLE ${tableNameEsc} ADD COLUMN ${escapeIdentifierPostgres(
                  column.name
                )} ${column.dialectTypes.postgres}`;
                // Nullability and default are part of ADD COLUMN
                if (column.notNull) colSql += " NOT NULL";
                const defaultSql = formatDefaultValuePostgres(
                  column.default,
                  column.name,
                  column._hasClientDefaultFn
                );
                if (defaultSql) colSql += ` ${defaultSql}`;
                addColumnStatements.push(`${colSql};`);

                if (column.unique && !column.primaryKey) {
                  const constraintName = escapeIdentifierPostgres(
                    `uq_${originalTableNameForChange}_${column.name}`
                  );
                  createIndexStatements.push(
                    `ALTER TABLE ${tableNameEsc} ADD CONSTRAINT ${constraintName} UNIQUE (${escapeIdentifierPostgres(
                      column.name
                    )});`
                  );
                }
                if (column.references) {
                  addForeignKeyStatements.push(
                    generatePgForeignKeyConstraintDDL(
                      originalTableNameForChange,
                      column.name,
                      column.references
                    )
                  );
                }
                break;
              }
              case "remove":
                dropColumnStatements.push(
                  `ALTER TABLE ${tableNameEsc} DROP COLUMN ${columnNameEsc};`
                );
                break;
              case "change": {
                const changes = colChange.changes;
                if (changes.type || changes.dialectTypes) {
                  const newType =
                    changes.dialectTypes?.postgres || changes.type;
                  if (newType) {
                    alterColumnStatements.push(
                      `ALTER TABLE ${tableNameEsc} ALTER COLUMN ${columnNameEsc} SET DATA TYPE ${newType};`
                    );
                  }
                }
                if (changes.hasOwnProperty("notNull")) {
                  if (changes.notNull) {
                    alterColumnStatements.push(
                      `ALTER TABLE ${tableNameEsc} ALTER COLUMN ${columnNameEsc} SET NOT NULL;`
                    );
                  } else {
                    alterColumnStatements.push(
                      `ALTER TABLE ${tableNameEsc} ALTER COLUMN ${columnNameEsc} DROP NOT NULL;`
                    );
                  }
                }
                if (changes.hasOwnProperty("default")) {
                  if (changes.default !== undefined) {
                    const defaultSql = formatDefaultValuePostgres(
                      changes.default,
                      currentColumnName, // Use currentColumnName which is unescaped
                      (colChange.changes as ColumnSnapshot)._hasClientDefaultFn
                    );
                    alterColumnStatements.push(
                      `ALTER TABLE ${tableNameEsc} ALTER COLUMN ${columnNameEsc} ${
                        defaultSql ? defaultSql : "DROP DEFAULT"
                      };`
                    );
                  } else {
                    alterColumnStatements.push(
                      `ALTER TABLE ${tableNameEsc} ALTER COLUMN ${columnNameEsc} DROP DEFAULT;`
                    );
                  }
                }
                if (changes.hasOwnProperty("unique")) {
                  const constraintName = escapeIdentifierPostgres(
                    `uq_${originalTableNameForChange}_${currentColumnName}`
                  );
                  if (changes.unique) {
                    createIndexStatements.push(
                      `ALTER TABLE ${tableNameEsc} ADD CONSTRAINT ${constraintName} UNIQUE (${columnNameEsc});`
                    );
                  } else {
                    dropIndexStatements.push(
                      `ALTER TABLE ${tableNameEsc} DROP CONSTRAINT ${constraintName};`
                    );
                    console.warn(
                      `Dropping unique constraint on ${originalTableNameForChange}.${currentColumnName}. Assumed constraint name ${constraintName}. Verify if correct.`
                    );
                  }
                }
                if (changes.hasOwnProperty("references")) {
                  if (changes.references) {
                    console.warn(
                      `Changing foreign key for ${originalTableNameForChange}.${currentColumnName}. ` +
                        `If an old FK existed and its name/definition changed, it should be explicitly dropped by a preceding diff action. ` +
                        `This operation will attempt to add the new/updated FK constraint.`
                    );
                    addForeignKeyStatements.push(
                      generatePgForeignKeyConstraintDDL(
                        originalTableNameForChange,
                        // Use the actual DB column name from the new schema snapshot
                        newSchemaSnapshot.tables[originalTableNameForChange]
                          .columns[currentColumnName].name,
                        changes.references as NonNullable<
                          ColumnSnapshot["references"]
                        >
                      )
                    );
                  } else if (changes.references === null) {
                    const fkNameToRemovePlaceholder = escapeIdentifierPostgres(
                      `fk_${originalTableNameForChange}_${currentColumnName}_TO_BE_DROPPED` // Standardizing to _TO_BE_DROPPED
                    );
                    dropForeignKeyStatements.push(
                      `ALTER TABLE ${tableNameEsc} DROP CONSTRAINT ${fkNameToRemovePlaceholder};`
                    );
                    console.warn(
                      `Attempting to DROP foreign key for ${originalTableNameForChange}.${currentColumnName}. ` +
                        `The specific constraint name is required. Using placeholder: ${fkNameToRemovePlaceholder}. This will likely FAIL.`
                    );
                  }
                }
                break;
              }
            }
          }
        }
        if (action.indexChanges) {
          for (const idxChange of action.indexChanges) {
            const originalTableNameForIndexChange = action.tableName;
            switch (idxChange.action) {
              case "add": {
                const index = idxChange.index;
                const indexName = index.name
                  ? escapeIdentifierPostgres(index.name)
                  : escapeIdentifierPostgres(
                      `${
                        index.unique ? "uq" : "idx"
                      }_${originalTableNameForIndexChange}_${index.columns.join(
                        "_"
                      )}`
                    );
                const columns = index.columns
                  .map(escapeIdentifierPostgres)
                  .join(", ");
                const uniqueKeyword = index.unique ? "UNIQUE " : "";
                createIndexStatements.push(
                  `CREATE ${uniqueKeyword}INDEX ${indexName} ON ${tableNameEsc} (${columns});`
                );
                break;
              }
              case "remove":
                dropIndexStatements.push(
                  `DROP INDEX ${escapeIdentifierPostgres(idxChange.indexName)};`
                );
                break;
              case "change":
                console.warn(
                  // Re-adding the warning
                  `Index change for "${idxChange.indexName}" on table "${originalTableNameForIndexChange}" will be handled as DROP and ADD for PG.`
                );
                dropIndexStatements.push(
                  `DROP INDEX ${escapeIdentifierPostgres(idxChange.indexName)};`
                );
                if (idxChange.changes && idxChange.changes.columns) {
                  const newIndexName = escapeIdentifierPostgres(
                    idxChange.indexName
                  );
                  const newColumns = (idxChange.changes.columns as string[])
                    .map(escapeIdentifierPostgres)
                    .join(", ");
                  const newUniqueKeyword = idxChange.changes.unique
                    ? "UNIQUE "
                    : "";
                  createIndexStatements.push(
                    `CREATE ${newUniqueKeyword}INDEX ${newIndexName} ON ${tableNameEsc} (${newColumns});`
                  );
                } else {
                  console.error(
                    `Cannot regenerate index ${idxChange.indexName} on ${originalTableNameForIndexChange} due to insufficient change data for PG.`
                  );
                }
                break;
            }
          }
        }
        if (action.primaryKeyChange) {
          const originalTableNameForPkChange = action.tableName;
          const pkChange = action.primaryKeyChange;
          if (pkChange.action === "set") {
            const newPk = pkChange.pk;
            const newPkName = newPk.name
              ? escapeIdentifierPostgres(newPk.name)
              : escapeIdentifierPostgres(`pk_${originalTableNameForPkChange}`);
            const newPkColumns = newPk.columns
              .map(escapeIdentifierPostgres)
              .join(", ");
            otherAlterations.push(
              `ALTER TABLE ${tableNameEsc} ADD CONSTRAINT ${newPkName} PRIMARY KEY (${newPkColumns});`
            );
          } else if (pkChange.action === "remove") {
            const pkNameToRemove = pkChange.pkName
              ? escapeIdentifierPostgres(pkChange.pkName)
              : escapeIdentifierPostgres(`pk_${originalTableNameForPkChange}`);
            if (!pkChange.pkName) {
              console.warn(
                `Primary key name for DROP PK on "${originalTableNameForPkChange}" not provided. Assuming default "${pkNameToRemove}".`
              );
            }
            otherAlterations.push(
              `ALTER TABLE ${tableNameEsc} DROP CONSTRAINT ${pkNameToRemove};`
            );
          }
        }
        if (action.interleaveChange) {
          console.warn(
            `Table "${action.tableName}" interleave change DDL generation not yet implemented for PG.`
          );
        }
        break;
    }
  }

  // Assemble DDL statements in the correct order
  const finalDdlStatements: string[] = [
    ...dropForeignKeyStatements,
    ...dropIndexStatements,
    ...dropColumnStatements,
    ...dropTableStatements,
    ...createTableStatements,
    ...addColumnStatements,
    ...alterColumnStatements, // Apply non-structural column changes
    ...createIndexStatements, // Create indexes and unique constraints
    ...addForeignKeyStatements,
    ...otherAlterations, // Other alterations like PK changes
  ];

  return finalDdlStatements;
}

// --- Spanner DDL Generation Helpers --- (Similar changes as for PG)

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
  columnName: string,
  hasClientDefaultFn?: boolean
): string {
  if (columnDefault === undefined) return "";

  // 1. Handle client-side default functions (UUIDs etc.)
  if (
    hasClientDefaultFn &&
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    (columnDefault as { function?: string }).function === "[FUNCTION_DEFAULT]"
  ) {
    return ""; // No DDL, no warning
  }

  // 2. Handle SQL objects from sql`` tag
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    (columnDefault as any)._isSQL === true && // Check for SQL marker
    typeof (columnDefault as any).toSqlString === "function"
  ) {
    const sqlString = (columnDefault as any).toSqlString("spanner");
    if (sqlString.toUpperCase() === "CURRENT_TIMESTAMP") {
      return `DEFAULT (CURRENT_TIMESTAMP())`;
    }
    return `DEFAULT (${sqlString})`;
  }

  // 3. Handle raw SQL provided as { sql: "RAW_SQL" }
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    "sql" in columnDefault &&
    typeof (columnDefault as { sql: string }).sql === "string"
  ) {
    const sqlValue = (columnDefault as { sql: string }).sql;
    return `DEFAULT (${
      sqlValue.toUpperCase() === "CURRENT_TIMESTAMP"
        ? "CURRENT_TIMESTAMP()"
        : sqlValue
    })`;
  }

  // 4. Handle literal string defaults
  if (typeof columnDefault === "string")
    return `DEFAULT ('${columnDefault.replace(/'/g, "''")}')`;

  // 5. Handle literal number defaults
  if (typeof columnDefault === "number") return `DEFAULT (${columnDefault})`;

  // 6. Handle literal boolean defaults
  if (typeof columnDefault === "boolean")
    return `DEFAULT (${columnDefault ? "TRUE" : "FALSE"})`;

  // 7. Handle function marker for non-client-side functions (should warn)
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    (columnDefault as { function?: string }).function === "[FUNCTION_DEFAULT]"
  ) {
    console.warn(
      `Function default for Spanner column "${columnName}" cannot be directly represented in DDL.`
    );
    return "";
  }

  // 8. Handle other object defaults (e.g., for JSON)
  if (typeof columnDefault === "object" && columnDefault !== null) {
    return `DEFAULT (JSON '${JSON.stringify(columnDefault).replace(
      /'/g,
      "''"
    )}')`;
  }
  return "";
}

function generateSpannerJustCreateTableDDL(table: TableSnapshot): string {
  const tableName = escapeIdentifierSpanner(table.name);
  const columnsSql: string[] = [];
  const primaryKeyColumns: string[] = [];

  for (const columnName in table.columns) {
    const column = table.columns[columnName];
    let columnSql = `${escapeIdentifierSpanner(column.name)} ${
      column.dialectTypes.spanner
    }`;
    if (column.notNull || column.primaryKey) columnSql += " NOT NULL";
    const defaultSql = formatDefaultValueSpanner(
      column.default,
      column.name,
      column._hasClientDefaultFn
    );
    if (defaultSql) columnSql += ` ${defaultSql}`;
    if (column.primaryKey)
      primaryKeyColumns.push(escapeIdentifierSpanner(column.name));
    columnsSql.push(columnSql);
  }

  let createTableSql = `CREATE TABLE ${tableName} (\n  ${columnsSql.join(
    ",\n  "
  )}\n)`;
  if (
    table.compositePrimaryKey &&
    table.compositePrimaryKey.columns.length > 0
  ) {
    createTableSql += ` PRIMARY KEY (${table.compositePrimaryKey.columns
      .map(escapeIdentifierSpanner)
      .join(", ")})`;
  } else if (primaryKeyColumns.length > 0) {
    createTableSql += ` PRIMARY KEY (${primaryKeyColumns.join(", ")})`;
  }
  if (table.interleave) {
    createTableSql += `,\n  INTERLEAVE IN PARENT ${escapeIdentifierSpanner(
      table.interleave.parentTable
    )} ON DELETE ${table.interleave.onDelete.toUpperCase()}`;
  }
  return createTableSql;
}

// Note: generateSpannerForeignKeyConstraintDDL itself is fine, the issue is what's passed to it.

function generateSpannerForeignKeyConstraintDDL(
  tableName: string,
  columnName: string,
  fk: NonNullable<ColumnSnapshot["references"]>
): string {
  const constraintName = fk.name
    ? escapeIdentifierSpanner(fk.name)
    : escapeIdentifierSpanner(
        `FK_${tableName}_${columnName}_${fk.referencedTable}`
      );
  const onDeleteAction = fk.onDelete
    ? ` ON DELETE ${fk.onDelete.toUpperCase()}`
    : "";
  return `ALTER TABLE ${escapeIdentifierSpanner(
    tableName
  )} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${escapeIdentifierSpanner(
    columnName
  )}) REFERENCES ${escapeIdentifierSpanner(
    fk.referencedTable
  )} (${escapeIdentifierSpanner(fk.referencedColumn)})${onDeleteAction}`;
}

function isSpannerDdlValidating(ddl: string): boolean {
  const upperDdl = ddl.toUpperCase().trim();
  if (upperDdl.startsWith("CREATE INDEX")) return true;
  if (upperDdl.startsWith("CREATE UNIQUE INDEX")) return true;
  if (upperDdl.startsWith("ALTER TABLE") && upperDdl.includes("ADD COLUMN"))
    return true;
  if (upperDdl.startsWith("ALTER TABLE") && upperDdl.includes("ALTER COLUMN"))
    return true;
  if (
    upperDdl.startsWith("ALTER TABLE") &&
    upperDdl.includes("ADD CONSTRAINT") &&
    upperDdl.includes("FOREIGN KEY")
  )
    return true;
  return false;
}

function generateSpannerDdl(
  diffActions: TableDiffAction[],
  newSchemaSnapshot: SchemaSnapshot
): string[][] {
  const createTableStatements: string[] = [];
  const addColumnStatements: string[] = [];
  const createIndexStatements: string[] = [];
  const addForeignKeyStatements: string[] = [];
  const alterColumnStatements: string[] = [];
  const dropForeignKeyStatements: string[] = [];
  const dropIndexStatements: string[] = [];
  const dropColumnStatements: string[] = [];
  const dropTableStatements: string[] = [];
  const otherAlterations: string[] = []; // For things like interleave changes (currently unsupported)

  for (const action of diffActions) {
    let currentTableNameEsc: string;
    if (action.action === "add") {
      currentTableNameEsc = escapeIdentifierSpanner(action.table.name);
    } else {
      currentTableNameEsc = escapeIdentifierSpanner(action.tableName);
    }

    switch (action.action) {
      case "add": {
        const table = action.table;
        createTableStatements.push(generateSpannerJustCreateTableDDL(table));

        for (const propKey in table.columns) {
          const column = table.columns[propKey];
          if (column.unique && !column.primaryKey) {
            const uniqueIndexName = escapeIdentifierSpanner(
              `uq_${table.name}_${column.name}`
            );
            createIndexStatements.push(
              `CREATE UNIQUE INDEX ${uniqueIndexName} ON ${currentTableNameEsc} (${escapeIdentifierSpanner(
                column.name
              )})`
            );
          }
          if (column.references) {
            addForeignKeyStatements.push(
              generateSpannerForeignKeyConstraintDDL(
                table.name,
                column.name, // Use actual DB column name
                column.references
              )
            );
          }
        }

        if (table.indexes) {
          for (const index of table.indexes) {
            const indexName = index.name
              ? escapeIdentifierSpanner(index.name)
              : escapeIdentifierSpanner(
                  `${index.unique ? "uq" : "idx"}_${
                    table.name
                  }_${index.columns.join("_")}`
                );
            const columns = index.columns
              .map(escapeIdentifierSpanner)
              .join(", ");
            createIndexStatements.push(
              `CREATE ${
                index.unique ? "UNIQUE " : ""
              }INDEX ${indexName} ON ${currentTableNameEsc} (${columns})`
            );
          }
        }
        break;
      }
      case "remove":
        dropTableStatements.push(`DROP TABLE ${currentTableNameEsc}`);
        break;
      case "change": {
        const originalTableName = action.tableName;
        if (action.columnChanges) {
          for (const colChange of action.columnChanges) {
            let currentColumnName: string;
            if (colChange.action === "add") {
              currentColumnName = colChange.column.name;
            } else {
              currentColumnName = colChange.columnName;
            }
            const columnNameEsc = escapeIdentifierSpanner(currentColumnName);

            switch (colChange.action) {
              case "add": {
                const column = colChange.column;
                let colSql = `ALTER TABLE ${currentTableNameEsc} ADD COLUMN ${escapeIdentifierSpanner(
                  column.name
                )} ${column.dialectTypes.spanner}`;
                if (column.notNull) colSql += " NOT NULL";
                const defaultSql = formatDefaultValueSpanner(
                  column.default,
                  column.name,
                  column._hasClientDefaultFn
                );
                if (defaultSql) colSql += ` ${defaultSql}`;
                addColumnStatements.push(colSql);
                if (column.unique && !column.primaryKey) {
                  createIndexStatements.push(
                    `CREATE UNIQUE INDEX ${escapeIdentifierSpanner(
                      `uq_${originalTableName}_${column.name}`
                    )} ON ${currentTableNameEsc} (${escapeIdentifierSpanner(
                      column.name
                    )})`
                  );
                }
                if (column.references) {
                  addForeignKeyStatements.push(
                    generateSpannerForeignKeyConstraintDDL(
                      originalTableName,
                      column.name,
                      column.references
                    )
                  );
                }
                break;
              }
              case "remove":
                dropColumnStatements.push(
                  `ALTER TABLE ${currentTableNameEsc} DROP COLUMN ${columnNameEsc}`
                );
                break;
              case "change": {
                const changes = colChange.changes;
                if (changes.type || changes.dialectTypes) {
                  const newType = changes.dialectTypes?.spanner || changes.type;
                  if (newType) {
                    alterColumnStatements.push(
                      `ALTER TABLE ${currentTableNameEsc} ALTER COLUMN ${columnNameEsc} ${newType}`
                    );
                    console.warn(
                      `Spanner DDL for changing column type for ${originalTableName}.${currentColumnName} to ${newType} generated. Review for compatibility.`
                    );
                  }
                }
                if (changes.hasOwnProperty("notNull")) {
                  alterColumnStatements.push(
                    `ALTER TABLE ${currentTableNameEsc} ALTER COLUMN ${columnNameEsc} ${
                      changes.notNull ? "NOT NULL" : "DROP NOT NULL"
                    }`
                  );
                  if (!changes.notNull) {
                    console.warn(
                      `Spanner DDL for making ${originalTableName}.${currentColumnName} nullable may require re-specifying type and 'DROP NOT NULL' is not standard; typically, you just omit NOT NULL.`
                    );
                  }
                }
                if (changes.hasOwnProperty("default")) {
                  console.warn(
                    `Spanner does not support ALTER COLUMN SET DEFAULT for ${originalTableName}.${currentColumnName}. Default changes require table recreation or other strategies.`
                  );
                }
                if (changes.hasOwnProperty("unique")) {
                  console.warn(
                    `Spanner 'unique' constraint changes for ${originalTableName}.${currentColumnName} are typically handled via separate CREATE/DROP UNIQUE INDEX operations. Ensure index diffs cover this.`
                  );
                }
                if (changes.hasOwnProperty("references")) {
                  if (changes.references) {
                    console.warn(
                      `Changing FK for ${originalTableName}.${currentColumnName}. Ensure old FK is dropped if name/definition changed.`
                    );
                    addForeignKeyStatements.push(
                      generateSpannerForeignKeyConstraintDDL(
                        originalTableName,
                        // Use the actual DB column name from the new schema snapshot
                        newSchemaSnapshot.tables[originalTableName].columns[
                          currentColumnName
                        ].name,
                        changes.references as NonNullable<
                          ColumnSnapshot["references"]
                        >
                      )
                    );
                  } else if (changes.references === null) {
                    const fkNameToRemovePlaceholder = escapeIdentifierSpanner(
                      `FK_${originalTableName}_${currentColumnName}_TO_BE_DROPPED`
                    );
                    dropForeignKeyStatements.push(
                      `ALTER TABLE ${currentTableNameEsc} DROP CONSTRAINT ${fkNameToRemovePlaceholder}`
                    );
                    console.warn(
                      `Attempting to DROP foreign key for ${originalTableName}.${currentColumnName}. ` +
                        `The specific constraint name is required. Using placeholder: ${fkNameToRemovePlaceholder}. This will likely FAIL.`
                    );
                  }
                }
                break;
              }
            }
          }
        }
        if (action.indexChanges) {
          for (const idxChange of action.indexChanges) {
            const currentTableNameForIndex = action.tableName;
            switch (idxChange.action) {
              case "add": {
                const index = idxChange.index;
                const indexName = index.name
                  ? escapeIdentifierSpanner(index.name)
                  : escapeIdentifierSpanner(
                      `${
                        index.unique ? "uq" : "idx"
                      }_${currentTableNameForIndex}_${index.columns.join("_")}`
                    );
                createIndexStatements.push(
                  `CREATE ${
                    index.unique ? "UNIQUE " : ""
                  }INDEX ${indexName} ON ${escapeIdentifierSpanner(
                    currentTableNameForIndex
                  )} (${index.columns.map(escapeIdentifierSpanner).join(", ")})`
                );
                break;
              }
              case "remove":
                dropIndexStatements.push(
                  `DROP INDEX ${escapeIdentifierSpanner(idxChange.indexName)}`
                );
                break;
              case "change":
                console.warn(
                  `Index change for "${idxChange.indexName}" on ${currentTableNameForIndex} handled as DROP/ADD for Spanner.`
                );
                dropIndexStatements.push(
                  `DROP INDEX ${escapeIdentifierSpanner(idxChange.indexName)}`
                );
                if (idxChange.changes && idxChange.changes.columns) {
                  const newIndexName = escapeIdentifierSpanner(
                    idxChange.indexName
                  );
                  const newColumns = (idxChange.changes.columns as string[])
                    .map(escapeIdentifierSpanner)
                    .join(", ");
                  createIndexStatements.push(
                    `CREATE ${
                      idxChange.changes.unique ? "UNIQUE " : ""
                    }INDEX ${newIndexName} ON ${escapeIdentifierSpanner(
                      currentTableNameForIndex
                    )} (${newColumns})`
                  );
                } else {
                  console.error(
                    `Cannot regenerate index ${idxChange.indexName} on ${currentTableNameForIndex} for Spanner due to insufficient change data.`
                  );
                }
                break;
            }
          }
        }
        if (action.primaryKeyChange) {
          console.warn(
            `Spanner does not support altering Primary Keys on existing table "${action.tableName}". This requires table recreation.`
          );
        }
        if (action.interleaveChange) {
          console.warn(
            `Spanner does not support altering interleave for table "${action.tableName}". This requires table recreation.`
          );
        }
        break;
      }
    }
  }

  const orderedDdlStatements: string[] = [
    ...dropForeignKeyStatements,
    ...dropIndexStatements,
    ...dropColumnStatements,
    ...dropTableStatements,
    ...createTableStatements,
    ...addColumnStatements,
    ...alterColumnStatements,
    ...createIndexStatements,
    ...addForeignKeyStatements,
    ...otherAlterations,
  ];

  const finalBatches: string[][] = [];
  let currentBatch: string[] = [];
  let currentBatchContainsValidatingDdl = false;

  for (const ddl of orderedDdlStatements) {
    // Iterate over the globally ordered DDL statements
    const isCurrentDdlValidating = isSpannerDdlValidating(ddl);

    if (currentBatch.length === 0) {
      currentBatch.push(ddl);
      currentBatchContainsValidatingDdl = isCurrentDdlValidating;
    } else {
      if (isCurrentDdlValidating) {
        if (!currentBatchContainsValidatingDdl) {
          finalBatches.push(currentBatch);
          currentBatch = [ddl];
          currentBatchContainsValidatingDdl = true;
        } else {
          if (currentBatch.length < SPANNER_DDL_BATCH_SIZE) {
            currentBatch.push(ddl);
          } else {
            finalBatches.push(currentBatch);
            currentBatch = [ddl];
            currentBatchContainsValidatingDdl = true;
          }
        }
      } else {
        if (currentBatchContainsValidatingDdl) {
          finalBatches.push(currentBatch);
          currentBatch = [ddl];
          currentBatchContainsValidatingDdl = false;
        } else {
          if (currentBatch.length < SPANNER_DDL_BATCH_SIZE) {
            currentBatch.push(ddl);
          } else {
            finalBatches.push(currentBatch);
            currentBatch = [ddl];
            currentBatchContainsValidatingDdl = false;
          }
        }
      }
    }
  }

  if (currentBatch.length > 0) {
    finalBatches.push(currentBatch);
  }

  return finalBatches;
}

export function generateMigrationDDL(
  schemaDiff: SchemaDiff,
  newSchemaSnapshot: SchemaSnapshot, // Added newSchemaSnapshot
  dialect: Dialect
): string[] | string[][] {
  // Return type updated for Spanner
  if (!schemaDiff || !schemaDiff.tableChanges) {
    return [];
  }

  switch (dialect) {
    case "postgres":
      return generatePgDdl(schemaDiff.tableChanges, newSchemaSnapshot);
    case "spanner":
      return generateSpannerDdl(schemaDiff.tableChanges, newSchemaSnapshot); // This now returns string[][]
    default:
      throw new Error(`Unsupported dialect for DDL generation: ${dialect}`);
  }
}
