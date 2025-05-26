# spanner-orm

A TypeScript ORM for Google Spanner & PostgreSQL, designed for Node.js and Bun. Inspired by Drizzle ORM, `spanner-orm` aims to provide a single, elegant object model for defining your schema and querying your data across both database systems.

> [!NOTE]
> spanner-orm was almost entirely written by prompting Gemini 2.5 Pro via Cline. See notes/ProjectRoadmap.md, TaskPrefix.md and the other notes to understand how.

Read the published docs [here](https://flux159.github.io/spanner-orm) to get started.

## Key Requirements & Design Goals

`spanner-orm` is built to address the following key requirements for developers working with PostgreSQL and Google Spanner :

- **Single Object Model for PostgreSQL & Spanner:** Supports both postgres & google spanner with a single object model, inspired by Drizzle. This allows you to define your schema once and use it across both database systems.
- **Cross-Dialect Migrations:** Produces migrations for both postgres & spanner that can be run via a migrate command or via cli (specifically, the `spanner-orm-cli migrate` command), and also programmatically.
- **Flexible Querying:** Can build queries with a type-safe query builder or fallback to SQL (for instance, using the `sql` template literal tag when needed).
- **Dialect-Aware SQL:**
  - **Spanner:** Supports Google SQL as the dialect for Spanner.
  - **PostgreSQL/PGLite:** Uses almost equivalent SQL for PostgreSQL & PGLite.
  - This allows users to leverage PostgreSQL for non-Spanner deployments, PGLite for local development or embedded applications, and Spanner for global-scale web apps, all from a unified codebase.
- **Composable Schemas (Drizzle-Inspired):** Easily create and reuse schema components (e.g., common fields like `id`, `timestamps`, or base entity structures like `ownableResource`), promoting DRY (Don't Repeat Yourself) principles and leading to more maintainable and understandable data models.
- **Rich Query Conditions:** Provides a comprehensive set of SQL condition functions (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `and`, `or`, `not`, etc.) for building expressive `WHERE` clauses in the query builder.

## Core Features

`spanner-orm` provides a comprehensive suite of features for modern data management:

- **Unified Object Model:** Define schemas once for PostgreSQL (including Pglite) and Google Spanner using a Drizzle-inspired, composable syntax.
- **Dialect-Specific Migrations:** Generate and execute precise DDL migrations for both PostgreSQL and Spanner via CLI or programmatically.
- **Fluent Query API & Query Builder:** Enjoy a high-level fluent API (`db` object) for common database interactions, or use the powerful `QueryBuilder` for more granular control. Both support type-safe queries.
- **Raw SQL Fallback:** Seamlessly integrate raw SQL queries using the `sql` template tag when needed.

- **Optimized SQL for Each Dialect:**

  - **Google Spanner:** Generates Google SQL, leveraging Spanner's unique features and syntax for optimal performance and compatibility.
  - **PostgreSQL/Pglite:** Produces standard, highly compatible SQL, ensuring broad compatibility with PostgreSQL versions and Pglite.
  - This dual-dialect approach empowers developers to use the right database for the right job—Pglite for ultra-lightweight local development or client-side applications, PostgreSQL for traditional server-based deployments, and Google Spanner for applications requiring web-scale, global distribution—all managed from a single, consistent codebase.

- **Composable Schemas (Drizzle-Inspired):** Easily create and reuse schema components (e.g., for common fields like `id`, `createdAt`, `updatedAt`, or base entity structures like `ownableResource`), promoting DRY principles and highly maintainable data models.

- **Dynamic Default Value Generation:** Supports dynamic default values at the application level via `$defaultFn()`, allowing you to execute functions (e.g., `crypto.randomUUID()`) to generate default values during insert operations.

- **TypeScript First:** Built from the ground up with TypeScript, `spanner-orm` offers a robust, type-safe, and enjoyable developer experience, with strong type inference from your schema definitions to your query results.

## Why spanner-orm?

In today's diverse application landscape, developers often need to target multiple database backends. You might start with Pglite for rapid prototyping or local-first applications, move to PostgreSQL for self-hosted or managed deployments, and eventually require the massive scalability and global consistency of Google Spanner. `spanner-orm` addresses the critical challenge of managing data models and queries across these different systems without rewriting your data access layer.

The Node.js & Bun ecosystem lacked a dedicated ORM that elegantly bridges PostgreSQL and Google Spanner with a single, consistent object model and a unified migration strategy. `spanner-orm` fills this gap by:

- **Enabling a Single Codebase:** Define your schema and write your queries once. `spanner-orm` handles the dialect-specific SQL generation.
- **Streamlining Development & Deployment:** Simplify the transition between local development (Pglite/Postgres), testing, and production environments (Spanner or Postgres).
- **Reducing Complexity:** Abstract away the differences between Google SQL and PostgreSQL DDL/DML where possible, while still allowing access to dialect-specific features when needed.
- **Providing a Productive API:** Offer a familiar and productive Drizzle-inspired API that TypeScript developers will appreciate.

## Architecture Overview

```mermaid
graph TD
    A[User Code: Schema Definitions & Queries] --> B{ORM Core};
    B --> C[Abstract Schema Representation];
    C --> D1[PostgreSQL SQL Generator];
    C --> D2[Google Spanner SQL Generator];
    B --> E[Query Builder AST];
    E --> D1;
    E --> D2;
    D1 --> F1[PostgreSQL Adapter pg, pglite];
    D2 --> F2[Spanner Adapter @google-cloud/spanner];
    F1 --> G1[PostgreSQL/Pglite Database];
    F2 --> G2[Google Spanner Database];

    M[Migration Engine] --> C;
    M --> D1;
    M --> D2;
    M --> F1;
    M --> F2;

    style A fill:#fff,color:#000,stroke:#333,stroke-width:2px
    style B fill:#fff,color:#000,stroke:#333,stroke-width:2px
    style C fill:#lightgrey,stroke:#333,stroke-width:2px
    style E fill:#lightgrey,stroke:#333,stroke-width:2px
    style M fill:#fff,color:#000,stroke:#333,stroke-width:2px
```

## Getting Started

1.  **Installation:**

Using NPM:

```bash
npm install spanner-orm
```

Or using Bun:

```
bun install spanner-orm
```

Additionally, `spanner-orm` relies on peer dependencies for the specific database clients. You'll need to install the ones corresponding to the databases you intend to use:

- For **PostgreSQL**: `pg`
- For **Google Cloud Spanner**: `@google-cloud/spanner`
- For **PGLite** (optional, for local/embedded use): `@electric-sql/pglite`

You can install them like so:

Using NPM:

```bash
npm install pg @google-cloud/spanner @electric-sql/pglite # Install all, or pick the ones you need
```

Or using Bun:

```bash
bun add pg @google-cloud/spanner @electric-sql/pglite # Install all, or pick the ones you need
```

2.  **Define your schema (Drizzle-Inspired):** Create a `schema.ts` (or similar) file. `spanner-orm` allows you to define your data model in a way that's familiar to Drizzle ORM users, emphasizing composability and type safety.

    ```typescript
    // src/schema.ts
    import {
      table,
      text,
      timestamp,
      varchar,
      integer,
      boolean,
      jsonb,
      uuid,
      index,
      uniqueIndex,
      sql,
    } from "spanner-orm";

    export const users = table("users", {
      id: uuid("id").primaryKey(),
      email: text("email").notNull().unique(),
      name: text("name"),
      // ... other user fields
    });

    // --- Shared Schema Components (Example: place in 'src/lib/sharedSchemas.ts') ---

    // Common timestamp fields
    export const timestamps = {
      createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql`CURRENT_TIMESTAMP`) // Use backticks for sql template literal
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .default(sql`CURRENT_TIMESTAMP`) // Use backticks for sql template literal
        .notNull(),
    };

    // Base model with ID and timestamps
    export const baseModel = {
      id: uuid("id").primaryKey(),
      ...timestamps,
    };

    // For resources that are owned by a user
    export const ownableResource = {
      ...baseModel,
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    };

    // For resources that have visibility permissions
    type VisibilityStatus = "private" | "shared" | "public"; // Example type for visibility

    export const permissibleResource = {
      ...ownableResource,
      visibility: varchar("visibility", { length: 10 }) // e.g., 'private', 'shared', 'public'
        .default("private")
        .notNull()
        .$type<VisibilityStatus>(), // For type assertion if needed
    };

    // --- Example Table: Uploads (using shared components) ---
    export const uploads = table(
      "uploads",
      {
        ...permissibleResource, // Includes id, createdAt, updatedAt, userId, visibility
        gcsObjectName: text("gcs_object_name").notNull(), // Full path in GCS
        fileName: text("file_name").notNull(),
        fileType: text("file_type").notNull(), // General type: 'image', 'audio', etc.
        mimeType: text("mime_type").notNull(), // Specific MIME type: 'image/jpeg'
        size: integer("size").notNull(), // File size in bytes
        isProcessed: boolean("is_processed").default(false),
        metadata: jsonb("metadata"), // Example for JSONB
      },
      (t) => ({
        tableIndexes: [
          // Renamed from indexes
          index({ columns: [t.fileType.name] }), // t.fileType is already the column config
          uniqueIndex({
            name: "uq_gcs_object",
            columns: [t.gcsObjectName.name], // t.gcsObjectName is already the column config
          }),
        ],
      })
    );

    // Example with composite primary keys
    export const myTableWithCompositePk = table(
      "my_table",
      {
        partOne: text("part_one").notNull(),
        partTwo: integer("part_two").notNull(),
        data: text("data"),
      },
      (t) => ({
        // 't' provides access to the defined columns like t.partOne, t.partTwo
        primaryKey: {
          columns: [t.partOne.name, t.partTwo.name], // Use .name to get the actual column name string
          name: "my_table_pk", // Optional constraint name
        },
      })
    );

    // You can then use these definitions to generate DDL or build queries.
    ```

    This example demonstrates how you can compose schemas from shared building blocks, similar to patterns used in Drizzle ORM, and showcases the usage of new features like `uuid()`.

## Usage Examples

### Managing Migrations with the CLI

The CLI also provides tools to manage your database schema migrations. Migration files are stored in the `./spanner-orm-migrations` directory by default.

**1. Create a new migration:**

This command generates a single timestamped migration file (e.g., `YYYYMMDDHHMMSS-add-posts-table.ts`) containing dialect-specific `up` and `down` functions.

```bash
# Example: Create a migration file for adding a 'posts' table
npx spanner-orm-cli migrate create add-posts-table --schema ./dist/schema.js

# This will create a file like:
# ./spanner-orm-migrations/YYYYMMDDHHMMSS-add-posts-table.ts
```

This single file will contain the necessary DDL for both PostgreSQL and Spanner, organized into their respective functions. A `latest.snapshot.json` file is also created/updated to track the current schema state for future migrations.

**2. Apply pending migrations:**

This command applies all pending migrations to your database for the specified dialect.
(Requires database connection to be configured - e.g., via environment variables, specific adapter setup needed).

```bash
# Apply latest migrations to postgres database (dialect determined by DB_DIALECT environment variable)
npx spanner-orm-cli migrate latest --schema ./dist/schema.js DB_DIALECT=postgres DATABASE_URL=postgresql://user:pass@host:port/db

# Apply latest migrations for pglite - use postgres dialect with a local file for DATABASE_URL
npx spanner-orm-cli migrate latest --schema ./dist/schema.js DB_DIALECT=postgres DATABASE_URL="./spannerormtest.db"

# Example for Spanner
npx spanner-orm-cli migrate latest --schema ./dist/schema.js DB_DIALECT=spanner SPANNER_PROJECT_ID=my-gcp-project SPANNER_INSTANCE_ID=my-spanner-instance SPANNER_DATABASE_ID=my-spanner-database
```

**3. Revert the last applied migration:**

This command reverts the last applied migration (dialect determined by `DB_DIALECT` environment variable).

```bash
# Revert the last migration
npx spanner-orm-cli migrate down --schema ./dist/schema.js
```

_(Note: The migration CLI commands `migrate latest` and `migrate down` use environment variables such as `DB_DIALECT`, `DATABASE_URL` (for PG/Pglite), and Spanner-specific variables like `SPANNER_PROJECT_ID`, `SPANNER_INSTANCE_ID`, `SPANNER_DATABASE_ID` to connect to your database and apply/revert migrations.)_

### Querying Examples with Fluent API (`db` object)

The `OrmClient` (typically instantiated as `db`) provides a fluent, chainable API for database interactions.

```typescript
import { OrmClient, sql, users, posts, count } from "spanner-orm";
// Assuming 'users' and 'posts' tables are defined in your schema (e.g., from './schema.ts')

// Example: Initialize with a Pglite adapter in a module then reuse across app
// import { PGlite } from "@electric-sql/pglite";
// import { PgliteAdapter } from "spanner-orm"; // Or your specific adapter
// const pglite = new PGlite(); // In-memory, can also pass folder path to persist to disk
// const adapter = new PgliteAdapter(pglite);
// const db = new OrmClient(adapter, "postgres"); // 'postgres' is the dialect for PGlite

async function runFluentExamples(db: OrmClient) {
  // 1. Basic SELECT with WHERE, ORDER BY, LIMIT
  const recentUsers = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      sql`${users.createdAt} > ${new Date(Date.now() - 24 * 60 * 60 * 1000)}`
    ) // Using raw sql for date comparison
    .orderBy(users.createdAt, "DESC")
    .limit(10);
  console.log("Recent Users:", recentUsers);
  // recentUsers is typed as: Array<{ id: string; name: string; }> (assuming id is uuid/string)

  // 2. Debugging Queries
  // The `debug()` method can be chained into your fluent query to log the generated SQL and parameters.
  // This is useful for understanding what the ORM is generating or troubleshooting issues.
  const usersForDebugging = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.name, "Alice"))
    .debug() // Logs SQL and parameters to the console
    .limit(1);
  console.log("User for debugging:", usersForDebugging);
  // The console output from .debug() would look something like:
  // SQL: SELECT "id", "name" FROM "users" WHERE "name" = $1 LIMIT $2
  // Parameters: ["Alice", 1]

  // 2. INSERT a new user (with returning)
  const [insertedUser] = await db
    .insert(users)
    .values({ name: "Alice Wonderland", email: "alice@example.com" })
    .returning(); // Returns all columns by default
  console.log("Inserted User:", insertedUser);
  // insertedUser is typed as InferModelType<typeof users>
  // e.g., { id: 'uuid-string', name: "Alice Wonderland", email: "alice@example.com", ... }

  // Example of returning specific columns:
  const [insertedId] = await db
    .insert(users)
    .values({ name: "Bob The Second", email: "bob2@example.com" })
    .returning({ id: users.columns.id });
  console.log("Inserted User ID:", insertedId.id);

  // 3. UPDATE an existing user (with returning)
  const [updatedUser] = await db
    .update(users)
    .set({ name: "Alice in Chains" })
    .where(sql`${users.email} = ${"alice@example.com"}`)
    .returning({ name: users.columns.name, email: users.columns.email });
  console.log("Updated User Info:", updatedUser);
  // updatedUser is typed as { name: string; email: string; }

  // 4. SELECT with Eager Loading (include)
  // Assuming 'posts' table has a 'userId' column referencing 'users.id'
  // And your schema definitions correctly set up this relation for the ORM to understand.
  const usersWithPosts = await db
    .select({ id: users.id, userName: users.name })
    .from(users)
    .where(sql`${users.email} = ${"alice@example.com"}`)
    .include({
      posts: {
        // 'posts' is the relation name defined in your schema or inferred
        // relationTable: posts, // This might be needed if relation name isn't enough
        options: { select: { title: true, content: true } },
      },
    });
  console.log("User with Posts:", JSON.stringify(usersWithPosts, null, 2));
  // usersWithPosts would be typed, e.g.:
  // Array<{ id: string; userName: string; posts: Array<{ title: string; content: string; }> }>

  // 5. DELETE a user (with returning)
  const [deletedUser] = await db
    .deleteFrom(users)
    .where(sql`${users.email} = ${"alice@example.com"}`)
    .returning();
  console.log("Deleted User:", deletedUser);
  // deletedUser contains all columns of the deleted user

  // 6. Raw SQL Query
  const rawUsersCount = await db.raw<{ total_users: number }[]>(
    sql`SELECT COUNT(*) as total_users FROM ${users}`
  );
  console.log("Raw Users Count:", rawUsersCount[0].total_users);

  // 7. Transaction Example
  await db.transaction(async (txDb) => {
    const user = await txDb
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.name} = ${"Bob The Builder"}`)
      .limit(1);

    if (user.length > 0) {
      await txDb.insert(posts).values({
        userId: user[0].id,
        title: "My New Post",
        content: "Content here...",
      });
    } else {
      console.log("User Bob not found, post not created.");
    }
  });
  console.log("Transaction example completed.");

  // 8. Debugging with .sql and .params properties
  // For more direct access to the SQL and parameters without executing the query,
  // you can access the .sql and .params properties after preparing the query.
  // Note: This is more aligned with QueryBuilder, but debug() on the fluent API is the primary way.
  const preparedQuery = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.name, "Test User"))
    .prepare(); // Prepare the query

  console.log("Prepared SQL:", preparedQuery.sql);
  console.log("Prepared Params:", preparedQuery.params);
  // You can then execute this prepared query using an adapter if needed:
  // const result = await db.adapter.query(preparedQuery.sql, preparedQuery.params);
}

// To run these examples:
// 1. Set up your adapter and db instance as shown above.
// 2. Ensure your schema (users, posts tables) is defined and migrations are run.
// runFluentExamples(db).catch(console.error);
```

### Using Condition Functions in `where` Clauses

`spanner-orm` provides a rich set of functions to build expressive `WHERE` clauses, similar to Drizzle ORM. These functions can be imported from `spanner-orm` (or directly from `spanner-orm/core/functions` if you prefer more granular imports).

```typescript
import {
  OrmClient,
  sql,
  users,
  posts,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  not,
} from "spanner-orm";
// Assuming 'db' is an initialized OrmClient instance
// Assuming 'users' and 'posts' tables are defined

async function runConditionExamples(db: OrmClient) {
  // Example 1: Equal to (eq)
  const alice = await db.select().from(users).where(eq(users.name, "Alice"));
  console.log("Alice:", alice);

  // Example 2: Not equal to (ne)
  const notAlice = await db.select().from(users).where(ne(users.name, "Alice"));
  console.log("Not Alice:", notAlice);

  // Example 3: Greater than (gt)
  // Assuming 'posts' has a 'viewCount' column
  const popularPosts = await db
    .select()
    .from(posts)
    .where(gt(posts.viewCount, 1000));
  console.log("Popular Posts:", popularPosts);

  // Example 4: Greater than or equal to (gte)
  const postsGte100 = await db
    .select()
    .from(posts)
    .where(gte(posts.viewCount, 100));
  console.log("Posts with >= 100 views:", postsGte100);

  // Example 5: Less than (lt)
  const unpopularPosts = await db
    .select()
    .from(posts)
    .where(lt(posts.viewCount, 10));
  console.log("Unpopular Posts:", unpopularPosts);

  // Example 6: Less than or equal to (lte)
  const postsLte10 = await db
    .select()
    .from(posts)
    .where(lte(posts.viewCount, 10));
  console.log("Posts with <= 10 views:", postsLte10);

  // Example 7: AND operator
  const specificUser = await db
    .select()
    .from(users)
    .where(and(eq(users.name, "Bob"), eq(users.email, "bob@example.com")));
  console.log("Specific User (Bob):", specificUser);

  // Example 8: OR operator
  const usersAliceOrBob = await db
    .select()
    .from(users)
    .where(or(eq(users.name, "Alice"), eq(users.name, "Bob")));
  console.log("Users Alice or Bob:", usersAliceOrBob);

  // Example 9: NOT operator
  const usersNotCarol = await db
    .select()
    .from(users)
    .where(not(eq(users.name, "Carol")));
  console.log("Users not Carol:", usersNotCarol);

  // Example 10: Complex combination
  const complexQuery = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.status, "active"), // Assuming a 'status' column
        or(gt(users.age, 30), eq(users.department, "Sales")), // Assuming 'age' and 'department'
        not(eq(users.country, "US")) // Assuming 'country'
      )
    );
  console.log("Complex Query Users:", complexQuery);
}

// To run these examples:
// 1. Ensure your schema has the relevant tables (users, posts) and columns (name, email, viewCount, status, age, department, country).
// 2. Initialize and pass your `db` (OrmClient) instance.
// runConditionExamples(db).catch(console.error);
```

## Advanced

### Generating DDL manually with the CLI

Once you have defined your schema (e.g., in `src/schema.ts`), you can generate DDL for PostgreSQL or Spanner:

```bash
# Generate PostgreSQL DDL
npx spanner-orm-cli ddl --schema ./path/to/your/schema.js --dialect postgres

# Generate Spanner DDL
npx spanner-orm-cli ddl --schema ./dist/schema.js --dialect spanner
```

This will print the generated `CREATE TABLE` statements to standard output or the specified file.

Note if you're using bunx, you can write your schema files in Typescript without having to compile them to JS.

### Querying Examples with `QueryBuilder` (Lower-Level)

Here's how you can use the `QueryBuilder` to construct and execute queries. This is a lower-level API compared to the `db` object and requires manual execution via a database adapter.

```typescript
import { QueryBuilder, sql, users, posts, count } from "spanner-orm";
// import { PgliteAdapter } from "spanner-orm"; // Or your specific adapter
// import { PGlite } from "@electric-sql/pglite";

// const pglite = new PGlite();
// const adapter = new PgliteAdapter(pglite);
// await adapter.connect(); // Ensure adapter is connected

async function runQueryBuilderExamples(adapter) {
  // Pass a connected adapter
  const qb = new QueryBuilder(); // Generic QueryBuilder

  // 1. Basic SELECT with WHERE
  const recentUsersQuery = new QueryBuilder() // Create a new QB for each query
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      sql`${users.createdAt} > ${new Date(Date.now() - 24 * 60 * 60 * 1000)}`
    )
    .orderBy(users.createdAt, "DESC")
    .limit(10);

  const recentUsersPrepared = recentUsersQuery.prepare(adapter.dialect);
  // const recentUsers = await adapter.query(recentUsersPrepared.sql, recentUsersPrepared.parameters);
  // console.log("Recent Users (QB):", recentUsers);

  // ... (other QueryBuilder examples can be similarly adapted) ...
  // For INSERT, UPDATE, DELETE, use adapter.execute()
}

// runQueryBuilderExamples(adapter).catch(console.error);
```

### Managing Migrations Programmatically

In addition to the CLI, you can run migrations directly from your code using the `OrmClient` instance. This is useful for scenarios like automated deployments, programmatic setup, or embedding migration logic within your application.

The `OrmClient` (typically instantiated as `db`) provides the following methods:

- `db.migrateLatest(options?: { migrationsPath?: string }): Promise<void>`: Applies all pending "up" migrations.
- `db.migrateDown(options?: { migrationsPath?: string }): Promise<void>`: Reverts the last applied migration.

The optional `migrationsPath` parameter allows you to specify the directory where your migration files are stored. If omitted, it defaults to `./spanner-orm-migrations`.

**Example:**

```typescript
import { OrmClient, PgliteAdapter } from "spanner-orm";
import { PGlite } from "@electric-sql/pglite";

async function runProgrammaticMigrations() {
  // 1. Initialize your adapter and OrmClient
  const pglite = new PGlite(); // Or your preferred adapter (PostgresAdapter, SpannerAdapter)
  const adapter = new PgliteAdapter(pglite);
  await adapter.connect(); // Ensure the adapter is connected

  const db = new OrmClient(adapter, "postgres"); // Or "spanner"

  try {
    // 2. Apply all pending migrations
    console.log("Applying latest migrations programmatically...");
    await db.migrateLatest(); // Uses default migrations path "./spanner-orm-migrations"
    // Or specify a custom path:
    // await db.migrateLatest({ migrationsPath: "./my-custom-migrations-folder" });
    console.log("Latest migrations applied.");

    // 3. Optionally, revert the last migration
    // console.log("Reverting last migration programmatically...");
    // await db.migrateDown();
    // console.log("Last migration reverted.");
  } catch (error) {
    console.error("Error during programmatic migration:", error);
  } finally {
    await adapter.disconnect();
  }
}

// runProgrammaticMigrations().catch(console.error);
```

This approach gives you fine-grained control over when and how migrations are executed within your application's lifecycle.
