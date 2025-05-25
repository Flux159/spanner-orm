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

  // Special handling for default values to avoid unnecessary diffs for SQL objects
  let defaultsAreEffectivelyEqual = false;
  if (
    typeof col1.default === "object" &&
    col1.default !== null &&
    (col1.default as any)._isSQL === true &&
    typeof col2.default === "object" &&
    col2.default !== null &&
    (col2.default as any)._isSQL === true
  ) {
    // Both are SQL objects (one from snapshot placeholder, one from new schema).
    // Consider them functionally equivalent if both are marked _isSQL.
    defaultsAreEffectivelyEqual = true;
  }

  if (!defaultsAreEffectivelyEqual && !isEqual(col1.default, col2.default)) {
    changes.default = col2.default;
  }

  if (col1.primaryKey !== col2.primaryKey) changes.primaryKey = col2.primaryKey;
  if (col1.unique !== col2.unique) changes.unique = col2.unique;
  // Use the new compareReferences helper
  if (!compareReferences(col1.references, col2.references)) {
    changes.references = col2.references;
  }
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

// Helper to compare two ReferenceSnapshot objects
function compareReferences(
  ref1?: ColumnSnapshot["references"],
  ref2?: ColumnSnapshot["references"]
): boolean {
  if (ref1 === ref2) return true; // Handles both being undefined or same object
  if (!ref1 || !ref2) return false; // One is undefined, the other is not

  return (
    ref1.referencedTable === ref2.referencedTable &&
    ref1.referencedColumn === ref2.referencedColumn &&
    (ref1.name || undefined) === (ref2.name || undefined) && // Treat undefined and missing name the same
    (ref1.onDelete || undefined) === (ref2.onDelete || undefined) // Treat undefined and missing onDelete the same
  );
}

// Helper to compare two PrimaryKeySnapshot objects
function comparePrimaryKeys(
  pk1?: TableSnapshot["compositePrimaryKey"],
  pk2?: TableSnapshot["compositePrimaryKey"]
): boolean {
  if (pk1 === pk2) return true; // Handles both being undefined or same object
  if (!pk1 || !pk2) return false; // One is undefined, the other is not

  // Check if columns are equal (order matters)
  if (!pk1.columns || !pk2.columns || pk1.columns.length !== pk2.columns.length)
    return false;
  for (let i = 0; i < pk1.columns.length; i++) {
    if (pk1.columns[i] !== pk2.columns[i]) return false;
  }

  return (pk1.name || undefined) === (pk2.name || undefined); // Treat undefined and missing name the same
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
    const oldIndexes = oldTable.tableIndexes || []; // Changed from indexes
    const newIndexes = newTable.tableIndexes || []; // Changed from indexes
    const oldIndexMap = new Map<string, IndexSnapshot>( // Added explicit typing
      oldIndexes.map((idx: IndexSnapshot) => [
        idx.name || JSON.stringify(idx.columns),
        idx,
      ])
    );
    const newIndexMap = new Map<string, IndexSnapshot>( // Added explicit typing
      newIndexes.map((idx: IndexSnapshot) => [
        idx.name || JSON.stringify(idx.columns),
        idx,
      ])
    );

    // Removed indexes
    for (const [idxIdentifier, oldIdxValue] of oldIndexMap) {
      const oldIdx = oldIdxValue as IndexSnapshot; // Ensure type
      if (!newIndexMap.has(idxIdentifier)) {
        // Prefer name for removal if available
        indexChanges.push({
          action: "remove",
          indexName: oldIdx.name || idxIdentifier,
        });
      }
    }
    // Added or changed indexes
    for (const [idxIdentifier, newIdxValue] of newIndexMap) {
      const newIdx = newIdxValue as IndexSnapshot; // Ensure type
      const oldIdx = oldIndexMap.get(idxIdentifier) as
        | IndexSnapshot
        | undefined; // Ensure type, can be undefined
      if (!oldIdx) {
        indexChanges.push({ action: "add", index: newIdx });
      } else {
        // Both oldIdx and newIdx are confirmed to be IndexSnapshot here
        const { name: _n1, ...oldIdxProps } = oldIdx;
        const { name: _n2, ...newIdxProps } = newIdx;
        const idxDiff = compareIndexes(oldIdxProps, newIdxProps);
        if (Object.keys(idxDiff).length > 0) {
          indexChanges.push({
            action: "change",
            indexName: newIdx.name || idxIdentifier,
            changes: idxDiff,
          });
        }
      }
    }

    let primaryKeyChange: PrimaryKeyDiffAction | undefined;
    // Use the new comparePrimaryKeys helper
    if (
      !comparePrimaryKeys(
        oldTable.compositePrimaryKey,
        newTable.compositePrimaryKey
      )
    ) {
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
