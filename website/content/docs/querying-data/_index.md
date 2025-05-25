---
title: "Querying Data"
weight: 40 # Order within the "Docs" section
---

# Querying Data with spanner-orm

`spanner-orm` provides two main ways to interact with your database:

1.  **Fluent API (`db` object / `OrmClient`)**: A high-level, chainable API for common database operations (SELECT, INSERT, UPDATE, DELETE), transactions, and raw SQL execution. This is the recommended approach for most use cases.
2.  **QueryBuilder**: A lower-level API for constructing SQL queries programmatically. This offers more granular control but requires manual execution via a database adapter.

## Initializing the Client (`OrmClient`)

Before you can query, you need an instance of `OrmClient`. This requires a database adapter and the dialect you're targeting.

```typescript
import {
  OrmClient,
  PgliteAdapter,
  SpannerAdapter,
  PgAdapter,
} from "spanner-orm";
// For PGLite
import { PGlite } from "@electric-sql/pglite";
// For Google Spanner
import { Spanner } from "@google-cloud/spanner";
// For PostgreSQL
import { Client as PgClient } from "pg"; // or Pool

// Example: PGLite
const pgliteDb = new PGlite(); // In-memory or file-based
const pgliteAdapter = new PgliteAdapter(pgliteDb);
await pgliteAdapter.connect(); // Important for PgliteAdapter
const dbPglite = new OrmClient(pgliteAdapter, "postgres"); // PGLite uses 'postgres' dialect

// Example: Google Spanner
// const spannerClient = new Spanner({ projectId: "your-project-id" });
// const instance = spannerClient.instance("your-instance-id");
// const database = instance.database("your-database-id");
// const spannerAdapter = new SpannerAdapter(database);
// await spannerAdapter.connect(); // Ensure tables/metadata are ready if needed
// const dbSpanner = new OrmClient(spannerAdapter, "spanner");

// Example: PostgreSQL
// const pgClient = new PgClient({ connectionString: "postgresql://user:pass@host:port/db" });
// await pgClient.connect();
// const pgAdapter = new PgAdapter(pgClient);
// await pgAdapter.connect(); // May not be needed if pgClient.connect() is sufficient
// const dbPostgres = new OrmClient(pgAdapter, "postgres");
```

Make sure to `await adapter.connect()` if the specific adapter requires an explicit connection step.

## 1. Fluent API (`db` object)

The `OrmClient` (typically instantiated as `db`) provides a fluent, chainable API.

```typescript
// Assuming 'db' is an initialized OrmClient instance
// and 'users', 'posts' tables are defined in your schema (e.g., from './schema.ts')
import { sql, users, posts } from "spanner-orm"; // Import your table definitions and sql helper
// import { count } from "spanner-orm/functions"; // If using aggregate functions

async function runFluentExamples(db: OrmClient) {
  // 1. Basic SELECT with WHERE, ORDER BY, LIMIT
  const recentUsers = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      sql`${users.createdAt} > ${new Date(Date.now() - 24 * 60 * 60 * 1000)}`
    )
    .orderBy(users.createdAt, "DESC")
    .limit(10);
  console.log("Recent Users:", recentUsers);
  // recentUsers is typed, e.g.: Array<{ id: string; name: string | null; }>

  // 2. INSERT a new user
  const insertResult = await db
    .insert(users)
    .values({ name: "Alice Wonderland", email: "alice@example.com" });
  console.log("Insert Result:", insertResult); // e.g., { count: 1 } or similar

  // 3. UPDATE an existing user
  const updateResult = await db
    .update(users)
    .set({ name: "Alice in Chains" })
    .where(sql`${users.email} = ${"alice@example.com"}`);
  console.log("Update Result:", updateResult); // e.g., { count: 1 } or similar

  // 4. SELECT with Eager Loading (include) - Feature dependent
  // This assumes your ORM supports a specific way to define and use relations for eager loading.
  // The exact syntax for '.include()' might vary or require specific schema relation setup.
  // const usersWithPosts = await db
  //   .select({ id: users.id, userName: users.name })
  //   .from(users)
  //   .where(sql`${users.email} = ${"alice@example.com"}`)
  //   .include({ // This is a conceptual example for eager loading
  //     posts: { // 'posts' is the relation name
  //       relationTable: posts, // May be needed to specify the related table object
  //       options: { select: { title: true, content: true } },
  //     },
  //   });
  // console.log("User with Posts:", JSON.stringify(usersWithPosts, null, 2));

  // 5. Debugging Queries
  // The `debug()` method can be chained into your fluent query to log the generated SQL and parameters
  // directly to the console before the query is executed. This is invaluable for understanding
  // the SQL spanner-orm generates or for troubleshooting unexpected query behavior.
  const userToDebug = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(sql`${users.name} = ${"Debug User"}`)
    .limit(1)
    .debug(); // Call .debug() here
  console.log("User fetched for debugging:", userToDebug);
  // When .debug() is called, you'll see output like this in your console:
  // SQL: SELECT "id", "name" FROM "users" WHERE "name" = $1 LIMIT $2
  // Parameters: ["Debug User", 1]

  // 5. DELETE a user
  const deleteResult = await db
    .deleteFrom(users)
    .where(sql`${users.email} = \${"alice@example.com"}`);
  console.log("Delete Result:", deleteResult); // e.g., { count: 1 } or similar

  // 6. Raw SQL Query
  // Use db.raw() for queries that return results
  const rawUsers = await db.raw<{ id: string; email: string }[]>(
    sql`SELECT id, email FROM ${users} WHERE ${
      users.name
    } = ${"Alice in Chains"}`
  );
  console.log("Raw Users:", rawUsers);

  // Use db.rawExecute() for statements that don't return results (DDL, some DML)
  // await db.rawExecute(sql`ALTER TABLE ${users} ADD COLUMN last_login TIMESTAMPTZ`);

  // 7. Transaction Example
  await db.transaction(async (txDb) => {
    // txDb is a new OrmClient instance that operates within the transaction
    const userResult = await txDb
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.name} = ${"Bob The Builder"}`)
      .limit(1);

    if (userResult.length > 0) {
      const bobId = userResult[0].id;
      await txDb.insert(posts).values({
        // Assuming 'posts' schema has 'userId', 'title', 'content'
        userId: bobId, // This assumes posts.userId is compatible with users.id type
        title: "My New Post by Bob",
        content: "Content of Bob's post...",
      });
      console.log("Post created for Bob in transaction.");
    } else {
      console.log("User Bob not found, post not created.");
      // Optionally throw an error to rollback the transaction:
      // throw new Error("User Bob not found, rolling back.");
    }
  });
  console.log("Transaction example completed.");

  // 8. Accessing SQL and Parameters without Execution
  // If you need to get the SQL string and parameters without executing the query,
  // you can use the `prepare()` method available on a query chain.
  // This is part of the underlying QueryBuilder capabilities accessible via the fluent API.
  const preparedSelectQuery = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(sql`${users.name} = ${"Prepared User"}`)
    .prepare(); // This finalizes the query definition

  console.log("Prepared SQL:", preparedSelectQuery.sql);
  console.log("Prepared Parameters:", preparedSelectQuery.params);
  // You could then execute this manually using the adapter if needed:
  // const result = await db.adapter.query(preparedSelectQuery.sql, preparedSelectQuery.params);
  // console.log("Result from prepared query:", result.rows);
}

// To run these examples:
// 1. Set up your adapter and db instance as shown at the beginning.
// 2. Ensure your schema (users, posts tables) is defined and migrations are run.
// runFluentExamples(dbPglite).catch(console.error); // Example with PGLite
```

## 2. QueryBuilder (Lower-Level API)

The `QueryBuilder` allows you to construct SQL queries step by step. This is useful for complex queries or when you need to build parts of a query conditionally. You then need to prepare the query for a specific dialect and execute it using a database adapter.

```typescript
import { QueryBuilder, sql, users } from "spanner-orm";
// Assuming 'pgliteAdapter' is an initialized and connected PgliteAdapter instance
// import { PgliteAdapter } from "spanner-orm"; // Or your specific adapter

async function runQueryBuilderExamples(adapter: PgliteAdapter) {
  // Or any other connected adapter
  // 1. Basic SELECT with WHERE
  const selectQuery = new QueryBuilder()
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      sql`${users.createdAt} > ${new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      )}`
    ) // Last 7 days
    .orderBy(users.createdAt, "DESC")
    .limit(5);

  // Prepare the query for the adapter's dialect
  const preparedSelect = selectQuery.prepare(adapter.dialect);
  console.log("Prepared SQL (QB):", preparedSelect.sql);
  console.log("Parameters (QB):", preparedSelect.parameters);

  // Execute the query using the adapter
  const selectedUsers = await adapter.query(
    preparedSelect.sql,
    preparedSelect.parameters
  );
  console.log("Selected Users (QB):", selectedUsers.rows); // Adapter.query usually returns { rows: ... }

  // 2. INSERT example
  const insertQuery = new QueryBuilder().insert(users).values([
    { name: "Charlie Brown", email: "charlie@example.com" },
    { name: "Snoopy Dog", email: "snoopy@example.com" },
  ]);

  const preparedInsert = insertQuery.prepare(adapter.dialect);
  // For INSERT, UPDATE, DELETE, adapters might have an 'execute' method
  const insertResultQb = await adapter.execute(
    preparedInsert.sql,
    preparedInsert.parameters
  );
  console.log("Insert Result (QB):", insertResultQb); // e.g., { rowCount: 2 } or similar

  // ... (other QueryBuilder examples for UPDATE, DELETE can be similarly constructed) ...
}

// To run QueryBuilder examples:
// 1. Ensure your adapter (e.g., pgliteAdapter) is initialized and connected.
// runQueryBuilderExamples(pgliteAdapter).catch(console.error);
```

**Key differences with QueryBuilder:**

- You instantiate `QueryBuilder` directly.
- You must call `.prepare(dialect)` on the built query, passing the target dialect (e.g., `adapter.dialect`).
- You execute the prepared SQL and parameters using the adapter's `query()` (for SELECT) or `execute()` (for INSERT/UPDATE/DELETE) methods.

Choose the API that best fits your needs. The fluent `db` object is generally more convenient, while `QueryBuilder` offers maximum flexibility.
