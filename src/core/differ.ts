// src/core/differ.ts

import type {
  SchemaSnapshot,
  TableSnapshot,
  ColumnSnapshot,
  IndexSnapshot,
  SchemaDiff,
  TableDiffAction,
  ColumnDiffAction,
  IndexDiffAction,
  PrimaryKeyDiffAction,
  InterleaveDiffAction,
} from "../types/common.js";

// Custom deep equality check helper
function isEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!bKeys.includes(key) || !isEqual(a[key], b[key])) {
      return false;
    }
  }
  return true;
}

// Helper to compare two column snapshots (excluding name)
function compareColumns(
  col1: Omit<ColumnSnapshot, "name">,
  col2: Omit<ColumnSnapshot, "name">
): Partial<Omit<ColumnSnapshot, "name">> {
  const changes: Partial<Omit<ColumnSnapshot, "name">> = {};
  if (!isEqual(col1.type, col2.type)) changes.type = col2.type;
  if (!isEqual(col1.dialectTypes, col2.dialectTypes))
    changes.dialectTypes = col2.dialectTypes;
  if (col1.notNull !== col2.notNull) changes.notNull = col2.notNull;
  if (!isEqual(col1.default, col2.default)) changes.default = col2.default;
  if (col1.primaryKey !== col2.primaryKey) changes.primaryKey = col2.primaryKey;
  if (col1.unique !== col2.unique) changes.unique = col2.unique;
  if (!isEqual(col1.references, col2.references))
    changes.references = col2.references;
  return changes;
}

// Helper to compare two index snapshots (excluding name)
function compareIndexes(
  idx1: Omit<IndexSnapshot, "name">,
  idx2: Omit<IndexSnapshot, "name">
): Partial<Omit<IndexSnapshot, "name">> {
  const changes: Partial<Omit<IndexSnapshot, "name">> = {};
  if (!isEqual(idx1.columns, idx2.columns)) changes.columns = idx2.columns;
  if (idx1.unique !== idx2.unique) changes.unique = idx2.unique;
  // Add other index properties to compare here if they exist (e.g., using, predicate)
  return changes;
}

function diffTables(
  oldTables: Record<string, TableSnapshot>,
  newTables: Record<string, TableSnapshot>
): TableDiffAction[] {
  const changes: TableDiffAction[] = [];
  const oldTableNames = Object.keys(oldTables);
  const newTableNames = Object.keys(newTables);

  // Check for removed tables
  for (const tableName of oldTableNames) {
    if (!newTables[tableName]) {
      changes.push({ action: "remove", tableName });
    }
  }

  // Check for added or changed tables
  for (const tableName of newTableNames) {
    const oldTable = oldTables[tableName];
    const newTable = newTables[tableName];

    if (!oldTable) {
      changes.push({ action: "add", table: newTable });
      continue;
    }

    // Table exists in both, check for changes
    const columnChanges: ColumnDiffAction[] = [];
    const oldColumnNames = Object.keys(oldTable.columns);
    const newColumnNames = Object.keys(newTable.columns);

    // Removed columns
    for (const columnName of oldColumnNames) {
      if (!newTable.columns[columnName]) {
        columnChanges.push({ action: "remove", columnName });
      }
    }
    // Added or changed columns
    for (const columnName of newColumnNames) {
      const oldColumn = oldTable.columns[columnName];
      const newColumn = newTable.columns[columnName];
      if (!oldColumn) {
        columnChanges.push({ action: "add", column: newColumn });
      } else {
        // Compare existing columns for changes (excluding name)
        const { name: _n1, ...oldColProps } = oldColumn;
        const { name: _n2, ...newColProps } = newColumn;
        const colDiff = compareColumns(oldColProps, newColProps);
        if (Object.keys(colDiff).length > 0) {
          columnChanges.push({
            action: "change",
            columnName,
            changes: colDiff,
          });
        }
      }
    }

    const indexChanges: IndexDiffAction[] = [];
    const oldIndexes = oldTable.indexes || [];
    const newIndexes = newTable.indexes || [];
    const oldIndexMap = new Map(
      oldIndexes.map((idx) => [idx.name || JSON.stringify(idx.columns), idx])
    );
    const newIndexMap = new Map(
      newIndexes.map((idx) => [idx.name || JSON.stringify(idx.columns), idx])
    );

    // Removed indexes
    for (const [idxIdentifier, oldIdx] of oldIndexMap) {
      if (!newIndexMap.has(idxIdentifier)) {
        // Prefer name for removal if available
        indexChanges.push({
          action: "remove",
          indexName: oldIdx.name || idxIdentifier,
        });
      }
    }
    // Added or changed indexes
    for (const [idxIdentifier, newIdx] of newIndexMap) {
      const oldIdx = oldIndexMap.get(idxIdentifier);
      if (!oldIdx) {
        indexChanges.push({ action: "add", index: newIdx });
      } else {
        const { name: _n1, ...oldIdxProps } = oldIdx;
        const { name: _n2, ...newIdxProps } = newIdx;
        const idxDiff = compareIndexes(oldIdxProps, newIdxProps);
        if (Object.keys(idxDiff).length > 0) {
          // For simplicity, index changes are often handled as drop and recreate.
          // However, providing a "change" action can be useful for analysis.
          indexChanges.push({
            action: "change",
            indexName: newIdx.name || idxIdentifier, // Use name if available
            changes: idxDiff,
          });
        }
      }
    }

    let primaryKeyChange: PrimaryKeyDiffAction | undefined;
    if (!isEqual(oldTable.compositePrimaryKey, newTable.compositePrimaryKey)) {
      if (newTable.compositePrimaryKey) {
        primaryKeyChange = { action: "set", pk: newTable.compositePrimaryKey };
      } else if (oldTable.compositePrimaryKey) {
        // PK was removed
        primaryKeyChange = {
          action: "remove",
          pkName: oldTable.compositePrimaryKey.name,
        };
      }
    }

    let interleaveChange: InterleaveDiffAction | undefined;
    if (!isEqual(oldTable.interleave, newTable.interleave)) {
      if (newTable.interleave) {
        interleaveChange = { action: "set", interleave: newTable.interleave };
      } else {
        // Interleave was removed
        interleaveChange = { action: "remove" };
      }
    }

    if (
      columnChanges.length > 0 ||
      indexChanges.length > 0 ||
      primaryKeyChange ||
      interleaveChange
    ) {
      changes.push({
        action: "change",
        tableName,
        columnChanges: columnChanges.length > 0 ? columnChanges : undefined,
        indexChanges: indexChanges.length > 0 ? indexChanges : undefined,
        primaryKeyChange,
        interleaveChange,
      });
    }
  }
  return changes;
}

export function generateSchemaDiff(
  fromSnapshot: SchemaSnapshot,
  toSnapshot: SchemaSnapshot
): SchemaDiff {
  if (fromSnapshot.version !== toSnapshot.version) {
    // Potentially handle version mismatches, e.g., by trying to upgrade the old snapshot
    // For now, we'll assume they should ideally be the same for a direct diff.
    console.warn(
      `Attempting to diff schema snapshots with different versions: ${fromSnapshot.version} vs ${toSnapshot.version}`
    );
  }

  const tableChanges = diffTables(fromSnapshot.tables, toSnapshot.tables);

  return {
    fromVersion: fromSnapshot.version,
    toVersion: toSnapshot.version,
    tableChanges,
  };
}
