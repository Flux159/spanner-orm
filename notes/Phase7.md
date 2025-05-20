# Phase 7: Fluent Database Interaction API (`db` Object)

## Objective

To significantly enhance the developer experience by introducing a high-level fluent API, exposed through a `db` (or `OrmClient`) object. This API will allow users to build and execute queries in a single, chainable, and directly `await`-able statement, abstracting away the manual steps of preparing a query and then passing it to an adapter.

## Core Concepts

### 1. The `OrmClient` (e.g., `SpannerOrmDb`, `Database`)

This will be the main entry point for all database interactions.

- **Initialization:**

  - Instantiated with a pre-configured and connected `DatabaseAdapter` instance (e.g., `PgAdapter`, `SpannerAdapter`, `PgliteAdapter`).
  - Example: `const db = new OrmClient(myPostgresAdapter);`

- **Responsibilities:**
  - Provides top-level methods to initiate queries:
    - `db.select(fields)`
    - `db.insert(table)`
    - `db.update(table)`
    - `db.deleteFrom(table)`
    - `db.raw(sqlTemplate)` (for raw SQL execution)
  - Internally holds the `DatabaseAdapter` to execute queries.

### 2. The `ExecutableQuery<TResult, TTable extends TableConfig, TInclude extends EnhancedIncludeClause | undefined>`

Each of the `OrmClient`'s query-initiating methods will return an instance of `ExecutableQuery` (or a similar name). This object is both chainable for query building and directly awaitable for execution.

- **Internal `QueryBuilder`:**

  - Each `ExecutableQuery` instance will internally create and manage a `QueryBuilder` instance.
  - Methods like `.from()`, `.where()`, `.values()`, `.set()`, `.limit()`, `.offset()`, `.orderBy()`, `.groupBy()`, `.include()`, `.joinRelation()` called on the `ExecutableQuery` will delegate to its internal `QueryBuilder`, returning `this` to allow chaining.

- **Thenable Interface (Directly Awaitable):**

  - `ExecutableQuery` will implement the "thenable" interface by providing a `.then(onFulfilled, onRejected)` method. This allows it to be used directly with `await`.
  - When `await executableQueryInstance` is encountered:
    1.  The `.then()` method is invoked.
    2.  Inside `.then()`, the query is prepared: `this.internalQueryBuilder.prepare(this.ormClient.adapter.dialect)`.
    3.  The prepared SQL and parameters are executed using the `OrmClient`'s adapter:
        - For SELECT: `this.ormClient.adapter.query(prepared.sql, prepared.parameters)`
        - For INSERT/UPDATE/DELETE: `this.ormClient.adapter.execute(prepared.sql, prepared.parameters)`
    4.  **Result Shaping (for SELECT):** If `prepared.includeClause` exists, the raw results are passed to `shapeResults(rawData, prepared.primaryTable, prepared.includeClause)`.
    5.  The (potentially shaped) result is used to resolve the promise (`onFulfilled(result)`). If an error occurs, the promise is rejected (`onRejected(error)`).

- **Type Safety (`TResult`):**
  - The `TResult` generic parameter of `ExecutableQuery` will ensure that the awaited result is strongly typed. This type will be inferred based on the `TableConfig`, selected fields, and any `IncludeClause` used, leveraging existing types like `InferModelType` and `ShapedResultItem`.
  - **SELECT:** `TResult` would typically be `ShapedResultItem<TTable, TInclude>[]`.
  - **INSERT:** `TResult` could be:
    - PostgreSQL: The inserted row(s) if `RETURNING *` is implemented (this would be an extension to the current `QueryBuilder`). Otherwise, number of affected rows.
    - Spanner: Number of affected rows (as Spanner's `INSERT` DML doesn't return rows).
    - A common abstraction might be to return affected row count by default, with an optional `.returning()` method for PG.
  - **UPDATE/DELETE:** `TResult` would typically be the number of affected rows.

### 3. Example Usage (Thenable)

```typescript
// Assuming 'usersTable', 'postsTable' are TableConfig objects
// Assuming 'myAdapter' is a configured DatabaseAdapter instance
const db = new OrmClient(myAdapter);

async function getUsers() {
  const users = await db
    .select({ id: usersTable.columns.id, name: usersTable.columns.name })
    .from(usersTable)
    .where(sql`${usersTable.columns.age} > ${30}`)
    .orderBy(usersTable.columns.name, "ASC")
    .limit(10);

  // users is typed as: Array<{ id: number; name: string; }>
  console.log(users);
}

async function createUser() {
  // Assuming insert returns affected row count or similar standard response
  const result = await db
    .insert(usersTable)
    .values({ name: "Alice", email: "alice@example.com", age: 28 });

  console.log(result); // e.g., { affectedRows: 1 }
}

async function getPostsWithAuthors() {
  const postsWithAuthors = await db
    .select({ title: postsTable.columns.title })
    .from(postsTable)
    .include({
      user: { relationTable: usersTable, options: { select: { name: true } } },
    }); // Assuming 'user' is the relation name

  // postsWithAuthors will be typed as:
  // Array<{ title: string; user: Array<{ name: string }> }>
  console.log(postsWithAuthors);
}

async function runRawQuery() {
  // TResult for raw queries might need to be specified or default to any[]
  const result: { count: number }[] = await db.raw(
    sql`SELECT COUNT(*) as count FROM ${usersTable} WHERE ${
      usersTable.columns.age
    } > ${30}`
  );
  console.log(result[0].count);
}
```

### 4. Raw SQL Method

- `db.raw(sqlTemplate: SQL): ExecutableRawQuery<TResult>`
- `ExecutableRawQuery` would also be thenable.
- `TResult` for raw queries would likely default to `any[]` or allow the user to provide an expected result shape via a generic argument (e.g., `db.raw<MyExpectedType[]>(...)`).

## Implementation Considerations

- **Return Types for Write Operations:** Standardize what `insert`, `update`, `delete` resolve to (e.g., affected row count). Consider adding a `.returning()` method for PostgreSQL to fetch inserted/updated data, which would change `TResult`.
- **Transaction Integration:** How this API interacts with transactions (`db.transaction(async (txDb) => { await txDb.insert(...); })`). The `txDb` would be an `OrmClient` instance bound to the transaction.
- **Error Handling:** Ensure errors from the adapter or query preparation are correctly propagated and cause the promise to reject.
- **Complexity of `ExecutableQuery`:** This class will encapsulate a fair bit of logic (delegation to QueryBuilder, thenable implementation, adapter interaction, result shaping).

## Files to be Created/Modified

- **New File:** `src/client.ts` (or `src/db.ts`) for `OrmClient` and `ExecutableQuery` (and `ExecutableRawQuery`).
- **Updates:**
  - `src/index.ts`: To export the new `OrmClient`.
  - `src/types/common.ts`: Potentially new types if `ExecutableQuery` needs more specific supporting types beyond what `PreparedQuery` offers.
- **New Tests:**
  - `test/client.test.ts` (unit tests for `OrmClient` and `ExecutableQuery` logic, possibly mocking `QueryBuilder` and `DatabaseAdapter`).
  - `test/client.integration.test.ts` (integration tests covering the fluent API end-to-end with actual adapters or more robust mocks).
