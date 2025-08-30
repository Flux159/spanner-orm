# Fix JSON Type Handling and Error Messages for Spanner

## Problem

When Spanner encounters `undefined` values in JSON columns or `null` values without proper type information, it returns a misleading error message:

```
error: 3 INVALID_ARGUMENT: The code field is required for types.
```

This error message is confusing and doesn't clearly indicate the actual problem.

## Actual Issues

1. **Undefined values in JSON objects**: Spanner doesn't accept `undefined` values within JSON objects
2. **Null values without type information**: When passing `null` for nullable columns, Spanner needs type information

## Example of the Problem

When inserting this data:
```javascript
{
  metadata: {
    claude_session_id: "4849e17c-5f44-4e50-ae5d-c15f21d6f92a",
    create_mirror: true,
    env_vars: null,
    startup_process_pid: null,
    startup_log_path: null,
    startup_port: null,
    version: undefined,  // <-- This causes the error!
  }
}
```

Spanner throws: `The code field is required for types.`

## Proposed Solutions

### 1. Clean JSON Data Before Sending to Spanner

In the spanner-orm adapter, automatically clean JSON data:

```typescript
// In spanner/adapter.ts or similar
function cleanJsonForSpanner(value: any): any {
  if (value === null || value === undefined) {
    return null;
  }
  
  if (typeof value === 'object' && !Array.isArray(value)) {
    const cleaned: any = {};
    for (const key in value) {
      if (value[key] !== undefined) {
        cleaned[key] = cleanJsonForSpanner(value[key]);
      }
      // Skip undefined values entirely
    }
    return cleaned;
  }
  
  if (Array.isArray(value)) {
    return value.map(item => cleanJsonForSpanner(item));
  }
  
  return value;
}
```

### 2. Provide Type Information for Null Values

When building queries with null values, include type information:

```typescript
// When executing queries with null parameters
const [rows] = await transaction.run({
  sql,
  params,
  json: true,
  types: {
    // Provide types for all nullable parameters
    p1: 'STRING',
    p2: 'TIMESTAMP',
    p3: 'JSON',
    // etc.
  }
});
```

### 3. Improve Error Messages

Catch Spanner's cryptic error messages and provide better context:

```typescript
try {
  // Execute query
} catch (error) {
  if (error.message?.includes('The code field is required for types')) {
    // Check for undefined values in JSON
    const hasUndefined = checkForUndefinedInParams(params);
    if (hasUndefined) {
      throw new Error(
        'Spanner Error: JSON columns cannot contain undefined values. ' +
        'Found undefined in parameters. Please use null instead of undefined.'
      );
    }
    
    // Check for null values without types
    const nullParams = findNullParams(params);
    if (nullParams.length > 0) {
      throw new Error(
        'Spanner Error: Null values require type information. ' +
        `Parameters with null values: ${nullParams.join(', ')}`
      );
    }
  }
  throw error;
}
```

## Implementation Priority

1. **High Priority**: Clean JSON data to remove undefined values (prevents most common errors)
2. **Medium Priority**: Better error messages (helps developers debug issues)
3. **Low Priority**: Automatic type inference for null values (complex but would eliminate the need for manual type hints)

## Testing

Test cases should include:
- Inserting JSON with undefined values
- Inserting JSON with null values
- Inserting null for nullable columns
- Mixed scenarios with both issues

## Notes

- This issue only affects Spanner, not PostgreSQL
- The error message "The code field is required for types" is from Spanner's internal type system and is not related to any actual "code" field in the user's schema
- This is a common issue that affects many developers using Spanner with JSON columns