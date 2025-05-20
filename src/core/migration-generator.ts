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

const SPANNER_DDL_BATCH_SIZE = 5; // Configurable batch size

// --- PostgreSQL DDL Generation Helpers ---
function escapeIdentifierPostgres(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function formatDefaultValuePostgres(
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
  let columnsSql: string[] = [];
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
    columnsSql.push(columnSql);
  }

  if (primaryKeyColumns.length > 0 && !table.compositePrimaryKey) {
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

  if (table.indexes) {
    for (const index of table.indexes) {
      if (index.unique && !index.name?.startsWith("pk_")) {
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
  const createTableSql = generatePgCreateTableDDL(table);
  ddlStatements.push(createTableSql);
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

function generatePgDdl(diffActions: TableDiffAction[]): string[] {
  const ddlStatements: string[] = [];
  for (const action of diffActions) {
    switch (action.action) {
      case "add":
        ddlStatements.push(
          ...generatePgCreateTableDDLWithForeignKeys(action.table)
        );
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
              case "add": {
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
                break;
              }
              case "remove":
                ddlStatements.push(
                  `ALTER TABLE ${tableName} DROP COLUMN ${escapeIdentifierPostgres(
                    colChange.columnName
                  )};`
                );
                break;
              case "change": {
                const columnName = escapeIdentifierPostgres(
                  colChange.columnName
                );
                const changes = colChange.changes;
                if (changes.type || changes.dialectTypes) {
                  const newType =
                    changes.dialectTypes?.postgres || changes.type;
                  if (newType) {
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
                  if (changes.unique) {
                    const constraintName = escapeIdentifierPostgres(
                      `uq_${action.tableName}_${colChange.columnName}`
                    );
                    ddlStatements.push(
                      `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} UNIQUE (${columnName});`
                    );
                  } else {
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
                if (changes.hasOwnProperty("references")) {
                  if (changes.references) {
                    console.warn(
                      `Changing foreign key for ${action.tableName}.${colChange.columnName}. ` +
                        `If an old FK existed and its name/definition changed, it should be explicitly dropped by a preceding diff action. ` +
                        `This operation will attempt to add the new/updated FK constraint.`
                    );
                    ddlStatements.push(
                      generatePgForeignKeyConstraintDDL(
                        action.tableName,
                        colChange.columnName,
                        changes.references as NonNullable<
                          ColumnSnapshot["references"]
                        >
                      )
                    );
                  } else if (changes.references === null) {
                    const fkNameToRemovePlaceholder = escapeIdentifierPostgres(
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
                break;
              }
            }
          }
        }
        if (action.indexChanges) {
          for (const idxChange of action.indexChanges) {
            const tableName = escapeIdentifierPostgres(action.tableName);
            switch (idxChange.action) {
              case "add": {
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
                break;
              }
              case "remove":
                ddlStatements.push(
                  `DROP INDEX ${escapeIdentifierPostgres(idxChange.indexName)};`
                );
                break;
              case "change":
                console.warn(
                  `Index change for "${idxChange.indexName}" on table "${action.tableName}" will be handled as DROP and ADD for PG.`
                );
                ddlStatements.push(
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
        if (action.interleaveChange) {
          console.warn(
            `Table "${action.tableName}" interleave change DDL generation not yet implemented for PG.`
          );
        }
        break;
    }
  }
  return ddlStatements;
}

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
  columnName: string
): string {
  if (columnDefault === undefined) return "";
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    "sql" in columnDefault
  ) {
    const sqlValue = columnDefault.sql as string;
    return `DEFAULT (${
      sqlValue.toUpperCase() === "CURRENT_TIMESTAMP"
        ? "CURRENT_TIMESTAMP()"
        : sqlValue
    })`;
  }
  if (typeof columnDefault === "string")
    return `DEFAULT ('${columnDefault.replace(/'/g, "''")}')`;
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    !("function" in columnDefault)
  ) {
    return `DEFAULT (JSON '${JSON.stringify(columnDefault).replace(
      /'/g,
      "''"
    )}')`;
  }
  if (typeof columnDefault === "number") return `DEFAULT (${columnDefault})`;
  if (typeof columnDefault === "boolean")
    return `DEFAULT (${columnDefault ? "TRUE" : "FALSE"})`;
  if (
    typeof columnDefault === "object" &&
    columnDefault !== null &&
    "function" in columnDefault
  ) {
    console.warn(
      `Function default for Spanner column "${columnName}" cannot be directly represented in DDL.`
    );
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
    let columnSql = `${escapeIdentifierSpanner(column.name)} ${
      column.dialectTypes.spanner
    }`;
    if (column.notNull || column.primaryKey) columnSql += " NOT NULL";
    const defaultSql = formatDefaultValueSpanner(column.default, column.name);
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
  ddlStatements.push(`${createTableSql};`);

  for (const columnName in table.columns) {
    const column = table.columns[columnName];
    if (column.unique) {
      const uniqueIndexName = escapeIdentifierSpanner(
        `uq_${table.name}_${column.name}`
      );
      ddlStatements.push(
        `CREATE UNIQUE INDEX ${uniqueIndexName} ON ${tableName} (${escapeIdentifierSpanner(
          column.name
        )});`
      );
    }
  }

  if (table.indexes) {
    for (const index of table.indexes) {
      const indexName = index.name
        ? escapeIdentifierSpanner(index.name)
        : escapeIdentifierSpanner(
            `${index.unique ? "uq" : "idx"}_${table.name}_${index.columns.join(
              "_"
            )}`
          );
      const columns = index.columns.map(escapeIdentifierSpanner).join(", ");
      ddlStatements.push(
        `CREATE ${
          index.unique ? "UNIQUE " : ""
        }INDEX ${indexName} ON ${tableName} (${columns});`
      );
    }
  }
  return ddlStatements;
}

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
  )} (${escapeIdentifierSpanner(fk.referencedColumn)})${onDeleteAction};`;
}

function generateSpannerCreateTableDDLWithForeignKeys(
  table: TableSnapshot
): string[] {
  const ddlStatements = generateSpannerCreateTableDDL(table);
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

// Helper to identify DDL statements that are likely "validating" or "long-running" in Spanner
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
  // CREATE TABLE is generally not long-running unless it has very complex definitions or inline indexes,
  // but our generator creates indexes separately.
  // DROP statements are generally not considered long-running/validating in the same way.
  return false;
}

function generateSpannerDdl(diffActions: TableDiffAction[]): string[][] {
  const allDdlStatements: string[] = [];
  for (const action of diffActions) {
    switch (action.action) {
      case "add":
        allDdlStatements.push(
          ...generateSpannerCreateTableDDLWithForeignKeys(action.table)
        );
        break;
      case "remove":
        allDdlStatements.push(
          `DROP TABLE ${escapeIdentifierSpanner(action.tableName)};`
        );
        break;
      case "change":
        if (action.columnChanges) {
          for (const colChange of action.columnChanges) {
            const tableName = escapeIdentifierSpanner(action.tableName);
            switch (colChange.action) {
              case "add": {
                const column = colChange.column;
                let colSql = `ALTER TABLE ${tableName} ADD COLUMN ${escapeIdentifierSpanner(
                  column.name
                )} ${column.dialectTypes.spanner}`;
                if (column.notNull) colSql += " NOT NULL";
                const defaultSql = formatDefaultValueSpanner(
                  column.default,
                  column.name
                );
                if (defaultSql) colSql += ` ${defaultSql}`;
                allDdlStatements.push(`${colSql};`);
                if (column.unique) {
                  allDdlStatements.push(
                    `CREATE UNIQUE INDEX ${escapeIdentifierSpanner(
                      `uq_${action.tableName}_${column.name}`
                    )} ON ${tableName} (${escapeIdentifierSpanner(
                      column.name
                    )});`
                  );
                }
                if (colChange.column.references) {
                  allDdlStatements.push(
                    generateSpannerForeignKeyConstraintDDL(
                      action.tableName,
                      colChange.column.name,
                      colChange.column.references
                    )
                  );
                }
                break;
              }
              case "remove":
                allDdlStatements.push(
                  `ALTER TABLE ${tableName} DROP COLUMN ${escapeIdentifierSpanner(
                    colChange.columnName
                  )};`
                );
                break;
              case "change": {
                const columnName = escapeIdentifierSpanner(
                  colChange.columnName
                );
                const changes = colChange.changes;
                if (changes.type || changes.dialectTypes) {
                  const newType = changes.dialectTypes?.spanner || changes.type;
                  if (newType) {
                    allDdlStatements.push(
                      `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} ${newType};`
                    );
                    console.warn(
                      `Spanner DDL for changing column type for ${tableName}.${columnName} to ${newType} generated. Review for compatibility.`
                    );
                  }
                }
                if (changes.hasOwnProperty("notNull")) {
                  allDdlStatements.push(
                    `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} ${
                      changes.notNull ? "NOT NULL" : "DROP NOT NULL"
                    };`
                  );
                  if (!changes.notNull)
                    console.warn(
                      `Spanner DDL for making ${tableName}.${columnName} nullable may require re-specifying type.`
                    );
                }
                if (changes.hasOwnProperty("default"))
                  console.warn(
                    `Spanner does not support ALTER COLUMN SET DEFAULT for ${tableName}.${columnName}.`
                  );
                if (changes.hasOwnProperty("unique"))
                  console.warn(
                    `Spanner 'unique' constraint changes for ${tableName}.${columnName} handled via index diffs.`
                  );
                if (changes.hasOwnProperty("references")) {
                  if (changes.references) {
                    console.warn(
                      `Changing FK for ${action.tableName}.${colChange.columnName}. Ensure old FK is dropped if name changed.`
                    );
                    allDdlStatements.push(
                      generateSpannerForeignKeyConstraintDDL(
                        action.tableName,
                        colChange.columnName,
                        changes.references as NonNullable<
                          ColumnSnapshot["references"]
                        >
                      )
                    );
                  } else if (changes.references === null) {
                    console.warn(
                      `Dropping FK for ${action.tableName}.${colChange.columnName}. Constraint name needed.`
                    );
                    allDdlStatements.push(
                      `ALTER TABLE ${tableName} DROP CONSTRAINT ${escapeIdentifierSpanner(
                        `FK_${action.tableName}_${colChange.columnName}_TO_BE_DROPPED`
                      )};`
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
            const tableName = escapeIdentifierSpanner(action.tableName);
            switch (idxChange.action) {
              case "add": {
                const index = idxChange.index;
                const indexName = index.name
                  ? escapeIdentifierSpanner(index.name)
                  : escapeIdentifierSpanner(
                      `${index.unique ? "uq" : "idx"}_${
                        action.tableName
                      }_${index.columns.join("_")}`
                    );
                allDdlStatements.push(
                  `CREATE ${
                    index.unique ? "UNIQUE " : ""
                  }INDEX ${indexName} ON ${tableName} (${index.columns
                    .map(escapeIdentifierSpanner)
                    .join(", ")});`
                );
                break;
              }
              case "remove":
                allDdlStatements.push(
                  `DROP INDEX ${escapeIdentifierSpanner(idxChange.indexName)};`
                );
                break;
              case "change":
                console.warn(
                  `Index change for "${idxChange.indexName}" on ${tableName} handled as DROP/ADD.`
                );
                allDdlStatements.push(
                  `DROP INDEX ${escapeIdentifierSpanner(idxChange.indexName)};`
                );
                if (idxChange.changes && idxChange.changes.columns) {
                  const newIndexName = escapeIdentifierSpanner(
                    idxChange.indexName
                  );
                  const newColumns = (idxChange.changes.columns as string[])
                    .map(escapeIdentifierSpanner)
                    .join(", ");
                  allDdlStatements.push(
                    `CREATE ${
                      idxChange.changes.unique ? "UNIQUE " : ""
                    }INDEX ${newIndexName} ON ${tableName} (${newColumns});`
                  );
                } else {
                  console.error(
                    `Cannot regenerate index ${idxChange.indexName} on ${tableName}.`
                  );
                }
                break;
            }
          }
        }
        if (action.primaryKeyChange)
          console.warn(
            `Spanner does not support altering PKs on existing table "${action.tableName}".`
          );
        if (action.interleaveChange)
          console.warn(
            `Spanner does not support altering interleave for table "${action.tableName}".`
          );
        break;
    }
  }

  const finalBatches: string[][] = [];
  let currentBatch: string[] = [];
  // Tracks if the current batch is designated for validating DDLs.
  // A batch becomes "validating" if it contains at least one validating DDL.
  let currentBatchContainsValidatingDdl = false;

  for (const ddl of allDdlStatements) {
    const isCurrentDdlValidating = isSpannerDdlValidating(ddl);

    if (currentBatch.length === 0) {
      // First statement in a new batch
      currentBatch.push(ddl);
      currentBatchContainsValidatingDdl = isCurrentDdlValidating;
    } else {
      // Current batch is not empty
      if (isCurrentDdlValidating) {
        if (!currentBatchContainsValidatingDdl) {
          // Current batch was for non-validating DDLs, but this one is validating.
          // Flush the non-validating batch and start a new one for validating DDLs.
          finalBatches.push(currentBatch);
          currentBatch = [ddl];
          currentBatchContainsValidatingDdl = true;
        } else {
          // Current batch is already for validating DDLs. Add if not full.
          if (currentBatch.length < SPANNER_DDL_BATCH_SIZE) {
            currentBatch.push(ddl);
          } else {
            // Validating batch is full. Flush it and start a new one.
            finalBatches.push(currentBatch);
            currentBatch = [ddl];
            currentBatchContainsValidatingDdl = true; // New batch starts with a validating DDL
          }
        }
      } else {
        // Current DDL is non-validating
        if (currentBatchContainsValidatingDdl) {
          // Current batch was for validating DDLs, but this one is non-validating.
          // Flush the validating batch and start a new one for non-validating DDLs.
          finalBatches.push(currentBatch);
          currentBatch = [ddl];
          currentBatchContainsValidatingDdl = false;
        } else {
          // Current batch is for non-validating DDLs. Add to it.
          // Non-validating DDLs can be in larger batches, but for simplicity and to align with
          // the previous behavior of batching everything, we'll still use SPANNER_DDL_BATCH_SIZE here.
          // This could be relaxed if a different batching strategy for non-validating DDLs is desired.
          if (currentBatch.length < SPANNER_DDL_BATCH_SIZE) {
            currentBatch.push(ddl);
          } else {
            finalBatches.push(currentBatch);
            currentBatch = [ddl];
            currentBatchContainsValidatingDdl = false; // New batch starts with non-validating
          }
        }
      }
    }
  }

  // Push any remaining statements in currentBatch
  if (currentBatch.length > 0) {
    finalBatches.push(currentBatch);
  }

  return finalBatches;
}

export function generateMigrationDDL(
  schemaDiff: SchemaDiff,
  dialect: Dialect
): string[] | string[][] {
  // Return type updated for Spanner
  if (!schemaDiff || !schemaDiff.tableChanges) {
    return [];
  }

  switch (dialect) {
    case "postgres":
      return generatePgDdl(schemaDiff.tableChanges);
    case "spanner":
      return generateSpannerDdl(schemaDiff.tableChanges); // This now returns string[][]
    default:
      throw new Error(`Unsupported dialect for DDL generation: ${dialect}`);
  }
}
