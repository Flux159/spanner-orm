// src/core/result-shaper.ts
import type {
  IncludeClause,
  TableConfig,
  ColumnConfig,
} from "../types/common.js";

interface RawRow extends Record<string, any> {}

export function shapeResults(
  rawData: RawRow[],
  primaryTable: TableConfig<any, any>,
  includeClause?: IncludeClause
): any[] {
  if (
    !includeClause ||
    Object.keys(includeClause).length === 0 ||
    rawData.length === 0
  ) {
    return rawData; // No shaping needed or possible
  }

  const primaryKeyColumns = Object.values(primaryTable.columns)
    .filter((col) => (col as ColumnConfig<any, any>).primaryKey)
    .map((col) => (col as ColumnConfig<any, any>).name);

  if (primaryKeyColumns.length === 0) {
    // Cannot reliably group without a primary key on the main table
    console.warn(
      `Warning: Cannot shape results for table ${primaryTable.name} as it has no defined primary key. Returning raw data.`
    );
    return rawData;
  }
  // For simplicity, this initial version assumes a single primary key.
  // Composite PKs would require grouping by a composite key string.
  const primaryKeyName = primaryKeyColumns[0];

  const groupedResults: Map<any, RawRow> = new Map();

  for (const row of rawData) {
    const pkValue = row[primaryKeyName];
    if (pkValue === undefined || pkValue === null) {
      // Skip rows that don't have a primary key value from the main table,
      // or handle as an error, though LEFT JOIN might produce nulls if main table had no match (unlikely for primary query)
      continue;
    }

    if (!groupedResults.has(pkValue)) {
      const primaryRecord: RawRow = {};
      // Extract primary table fields
      for (const key in row) {
        if (!key.includes("__")) {
          // Columns not containing "__" are from the primary table
          primaryRecord[key] = row[key];
        }
      }
      // Initialize relation arrays
      for (const relationName in includeClause) {
        primaryRecord[relationName] = [];
      }
      groupedResults.set(pkValue, primaryRecord);
    }

    const currentPrimaryRecord = groupedResults.get(pkValue)!;

    // Populate related records
    for (const relationName in includeClause) {
      const relatedRecord: RawRow = {};
      let hasRelatedData = false;
      const prefix = `${relationName}__`;

      for (const key in row) {
        if (key.startsWith(prefix)) {
          const originalColumnName = key.substring(prefix.length);
          // Check if the related record's PK is present and not null.
          // This helps differentiate a "no related record" from "a related record with all null fields".
          // Assuming the related record's PK is aliased as relationName__<relatedPKName>
          // For this to work robustly, we'd need to know the PK of the related table.
          // For now, we check if *any* related column for this relation is non-null.
          if (row[key] !== null) {
            hasRelatedData = true;
          }
          relatedRecord[originalColumnName] = row[key];
        }
      }

      // Only add the related record if it actually contains data
      // This avoids adding empty objects if the LEFT JOIN found no related rows.
      if (hasRelatedData) {
        // Avoid duplicates if the primary row is repeated due to multiple relations
        // This simple check might not be robust enough for all scenarios (e.g. if related records are identical)
        // A more robust check would involve checking the PK of the relatedRecord if available.
        const existing = currentPrimaryRecord[relationName] as RawRow[];
        if (
          !existing.find(
            (r) => JSON.stringify(r) === JSON.stringify(relatedRecord)
          )
        ) {
          currentPrimaryRecord[relationName].push(relatedRecord);
        }
      }
    }
  }
  return Array.from(groupedResults.values());
}
