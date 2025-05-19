**Task: Implement Runtime `$defaultFn` Execution for INSERT Statements**

**Goal:** Modify the `QueryBuilder` to automatically execute column default functions (`$defaultFn`) during INSERT operations when no explicit value is supplied for those columns.

**Affected Files:**

- `src/core/query-builder.ts` (Primary logic changes)
- `test/core/query-builder.test.ts` (New unit tests)

**Plan Details:**

1. **Modify `QueryBuilder`'s INSERT SQL Generation Methods (`buildInsertPgSQL` and `buildInsertSpannerSQL`):**

   - **Location:** Inside `buildInsertPgSQL` and `buildInsertSpannerSQL` methods in `src/core/query-builder.ts`.

   - **Timing:** This processing should occur _before_ the list of columns and value placeholders are constructed, specifically after `this._insertValues` is confirmed to exist and before `valuesArray` is finalized for iteration.

   - **Logic:**

     1. Retrieve the raw insert data (`this._insertValues`). This can be a single object or an array of objects.

     2. Create a mutable copy of this data. Let's call it `processedInsertData`. If `this._insertValues` is an array, map over it, creating shallow copies of each record (`{ ...record }`). If it's a single object, create a shallow copy.

     3. Iterate through each `record` in `processedInsertData`:

        - Access the target table's column definitions: `this._targetTable!.columns`.

        - For each `columnName` and `columnConfig` in `this._targetTable!.columns`:

          - Check if the current `record` **does not** have an explicit value for this `columnName` (i.e., `record[columnName as keyof typeof record] === undefined`).

          - Check if `columnConfig.config.default` is a function (`typeof columnConfig.config.default === 'function'`).

          - If both conditions are true:

            - Execute the default function: `const defaultValue = (columnConfig.config.default as Function)();`
            - Assign the `defaultValue` to the record: `record[columnName as keyof typeof record] = defaultValue;`

     4. The rest of the `buildInsertPgSQL` and `buildInsertSpannerSQL` logic will then use this `processedInsertData` (which is now an array of records with defaults applied) to determine column names for the SQL (from the first record) and to generate value placeholders.

2. **Modify `QueryBuilder.getBoundParameters()` for INSERTs:**

   - **Location:** Inside the `if (this._operationType === "insert" && this._insertValues)` block within `getBoundParameters`.

   - **Logic:**

     1. Similar to the SQL generation methods, this part needs to work with values that have had their defaults applied.
     2. Repeat the same processing logic as in Step 1 to create a `processedInsertDataForParams` from `this._insertValues`. This involves iterating through records and columns, checking for undefined values, and executing `config.default` functions.
     3. Use this `processedInsertDataForParams` to extract the actual parameter values that will be sent with the query. This ensures that the parameters align with the SQL generated (which also considers these defaults).

3. **Add Unit Tests:**

   - **File:** `test/core/query-builder.test.ts`

   - **Setup:**

     - Define a sample table schema (e.g., `users`) with at least one column using `$defaultFn`. For example, a `uuid` column with `config.default = () => crypto.randomUUID()` and perhaps a `createdAt` column with `config.default = () => new Date()`.
     - Import `crypto` if needed for the test default function.

   - **Test Cases:**

     - **TC1: Single Insert with `$defaultFn`**:

       - Insert a single record without providing a value for the `uuid` column.
       - Verify that `toPgSQL()` and `toSpannerSQL()` generate the correct INSERT statement.
       - Verify that `getBoundParameters()` includes the generated UUID.

     - **TC2: Single Insert Overriding `$defaultFn`**:

       - Insert a single record _with_ an explicit value for the `uuid` column.
       - Verify that the SQL and parameters use the explicitly provided UUID, not the one from `$defaultFn`.

     - **TC3: Batch Insert with `$defaultFn`**:

       - Insert multiple records, some omitting the `uuid`, some providing it.
       - Verify SQL and parameters for all records correctly.

     - **TC4: Multiple `$defaultFn` Columns**:

       - Test with a table having multiple columns with `$defaultFn` (e.g., `uuid` and `createdAt`).
       - Ensure all default functions are called correctly when values are not provided.

     - **TC5: `$defaultFn` with `SQL` Object (Advanced/Optional)**:
       - If a `$defaultFn` could return an `SQL` tagged template literal (e.g., `sql<backtick>CURRENT_TIMESTAMP<backtick>`), ensure this is handled correctly by the existing SQL generation and parameter binding logic. (This might already work if the `SQL` object is correctly placed into the `processedInsertData`).

**Considerations:**

- **Immutability:** The process should operate on copies of the input data to avoid side effects on the original objects passed by the user to the `.values()` method.
- **Order of Operations:** The default value generation must happen before column lists are derived from the data (as new columns might be added) and before values are extracted for parameter binding.
- **Type Safety:** Ensure that type assertions (e.g., `as Function`, `as keyof typeof record`) are used carefully and are justified by the logic.

This plan should provide a clear path to implementing the desired `$defaultFn` behavior.
