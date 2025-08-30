# Fix Spanner Migration Error: "The code field is required for types" ✅ FIXED

## Error Description
When running migrations with Spanner adapter, the following error occurs:
```
Ensuring migration tracking table 'spanner_orm_migrations_log' exists...
error: 3 INVALID_ARGUMENT: The code field is required for types.
```

## Root Cause
The error occurs when querying the INFORMATION_SCHEMA.TABLES to check if the migration table exists. The Spanner adapter's `transformDdlHintsToParamTypes` function was incorrectly setting the `code` field in the paramTypes object to a string value (e.g., "STRING") instead of the numeric TypeCode enum value that Spanner's API expects (e.g., 6 for STRING).

## Actual Issue Location
The issue was in `/src/spanner/adapter.ts` in the `transformDdlHintsToParamTypes` function at line 152-153.

## Problem Analysis
The error "The code field is required for types" was happening because:

1. When the migration runner queries INFORMATION_SCHEMA.TABLES with a parameter `@tableName`
2. The Spanner adapter automatically infers the type as "STRING" 
3. The `transformDdlHintsToParamTypes` function was incorrectly setting `code: "STRING"` (a string)
4. Spanner's API expects `code: 6` (the numeric TypeCode enum value for STRING)

## Solution Implemented

Added a new helper function `getSpannerTypeCodeEnum` in `/src/spanner/adapter.ts` that maps type strings to their numeric TypeCode enum values:

```typescript
// Helper function to map type string to Spanner TypeCode enum number
function getSpannerTypeCodeEnum(typeString: string): number {
  const typeCodeMap: Record<string, number> = {
    'BOOL': 1,
    'INT64': 2,
    'FLOAT64': 3,
    'TIMESTAMP': 4,
    'DATE': 5,
    'STRING': 6,
    'BYTES': 7,
    'ARRAY': 8,
    'STRUCT': 9,
    'NUMERIC': 10,
    'JSON': 11,
    'PROTO': 13,
    'ENUM': 14,
    'FLOAT32': 15,
    'INTERVAL': 16,
    'UUID': 17,
  };
  return typeCodeMap[typeString] || 6; // Default to STRING (6) if unknown
}
```

Then updated the `transformDdlHintsToParamTypes` function to use numeric values:

```typescript
paramTypes[key] = {
  code: getSpannerTypeCodeEnum(typeCodeString), // Use numeric TypeCode enum value
  arrayElementType: null,
  structType: null,
};
```

### TypeCode Enum Values Reference
Based on the official Google Spanner proto definition:
- TYPE_CODE_UNSPECIFIED = 0
- BOOL = 1
- INT64 = 2
- FLOAT64 = 3
- TIMESTAMP = 4
- DATE = 5
- STRING = 6
- BYTES = 7
- ARRAY = 8
- STRUCT = 9
- NUMERIC = 10
- JSON = 11
- PROTO = 13
- ENUM = 14
- FLOAT32 = 15
- INTERVAL = 16
- UUID = 17

## Testing Fix
1. Delete the existing migrations log table if it exists
2. Run migrations again with the fixed code
3. Verify the table is created successfully
4. Check that migration records are inserted properly

## Related Files to Check
- Migration runner implementation
- Spanner adapter DDL generation
- Type mapping utilities
- Migration log table schema definition

## Notes
- This issue only affects Spanner, not PostgreSQL/PGLite
- The error occurs during table creation, not data insertion
- Spanner is strict about type definitions and doesn't accept undefined/missing type information