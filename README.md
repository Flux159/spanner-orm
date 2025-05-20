# spanner-orm

A TypeScript ORM for Google Spanner & PostgreSQL, designed for Node.js and Bun. Inspired by Drizzle ORM, `spanner-orm` aims to provide a single, elegant object model for defining your schema and querying your data across both database systems.

## Key Design Goals

`spanner-orm` is engineered to deliver a seamless experience across different database backends, focusing on these core requirements:

- **Single Object Model for PostgreSQL & Spanner:** Define your data structures once. `spanner-orm` supports both PostgreSQL (including Pglite) and Google Spanner using a consistent, Drizzle-inspired object model.
- **Cross-Dialect Migration Generation:** Automatically produce and manage migration files for both PostgreSQL and Google Spanner. Migrations can be executed via a dedicated CLI command or programmatically.
- **Flexible Query Construction:** Build your database queries using an intuitive query builder, or seamlessly fall back to raw SQL for complex operations or specific dialect features.
- **Optimized Multi-Dialect SQL Support:**
  - **Google Spanner:** Leverages Google SQL for optimal performance and feature utilization.
  - **PostgreSQL/Pglite:** Generates standard, highly compatible SQL.
    This approach empowers developers to use PostgreSQL for traditional or non-Spanner deployments, Pglite for local development or embedded applications, and Google Spanner for globally scalable web applications, all from a unified codebase.

## Core Features

`spanner-orm` is designed to provide a seamless and powerful experience for managing data across PostgreSQL and Google Spanner. Its core capabilities include:

- **Unified Object Model for Diverse Deployments:** Define your database schema _once_ using a Drizzle-inspired syntax. This single object model seamlessly supports both PostgreSQL (including Pglite for local/embedded use) and Google Spanner. This allows for consistent data modeling whether you're targeting a local SQLite database, a traditional PostgreSQL server, or a globally distributed Spanner instance.

- **Dialect-Specific Migration Generation & Execution:** Automatically produce migration files containing the precise DDL for both PostgreSQL and Google Spanner. These migrations can be executed via the `spanner-orm-cli migrate` command (e.g., `migrate latest`, `migrate down`) or programmatically, ensuring smooth and reliable schema evolution across all supported database systems.

- **Flexible Query Building with Raw SQL Fallback:** Construct type-safe queries using an intuitive query builder. For complex scenarios, dialect-specific optimizations, or when you simply prefer writing SQL, seamlessly fall back to raw SQL using the `sql` template literal tag. This offers maximum flexibility without sacrificing the benefits of the ORM.

- **Optimized SQL for Each Dialect:**

  - **Google Spanner:** Generates Google SQL, leveraging Spanner's unique features and syntax for optimal performance and compatibility.
  - **PostgreSQL/Pglite:** Produces standard, highly compatible SQL, ensuring broad compatibility with PostgreSQL versions and Pglite.
  - This dual-dialect approach empowers developers to use the right database for the right job—Pglite for ultra-lightweight local development or client-side applications, PostgreSQL for traditional server-based deployments, and Google Spanner for applications requiring web-scale, global distribution—all managed from a single, consistent codebase.

- **Composable Schemas (Drizzle-Inspired):** Easily create and reuse schema components (e.g., for common fields like `id`, `createdAt`, `updatedAt`, or base entity structures like `ownableResource`), promoting DRY principles and highly maintainable data models.

- **Dynamic Default Value Generation:** Supports dynamic default values at the application level via `$defaultFn()`, allowing you to execute functions (e.g., `crypto.randomUUID()`) to generate default values during insert operations.

- **TypeScript First:** Built from the ground up with TypeScript, `spanner-orm` offers a robust, type-safe, and enjoyable developer experience, with strong type inference from your schema definitions to your query results.

## Why spanner-orm?

In today's diverse application landscape, developers often need to target multiple database backends. You might start with Pglite for rapid prototyping or local-first applications, move to PostgreSQL for self-hosted or managed deployments, and eventually require the massive scalability and global consistency of Google Spanner. `spanner-orm` addresses the critical challenge of managing data models and queries across these different systems without rewriting your data access layer.

Currently, the Node.js/Bun ecosystem lacks a dedicated ORM that elegantly bridges PostgreSQL and Google Spanner with a single, consistent object model and a unified migration strategy. `spanner-orm` fills this gap by:

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

## Project Roadmap & TODOs

This project will be developed in phases. Here's a high-level overview:

### Phase 1: Core Schema Definition & Basic DDL

- [x] **T1.1: Core Schema Primitives:**
  - Implement `table()`, `text()`, `varchar()`, `integer()`, `boolean()`, `timestamp()`, `jsonb()` (and Spanner equivalents like `JSON` or `STRING`/`BYTES`).
  - Support for `notNull()`, `default()`, `primaryKey()`.
  - Basic `index()` and `uniqueIndex()`.
  - Enable schema composition (e.g., `baseModel`, `timestamps` patterns).
- [x] **T1.2: TypeScript Typing for Schema:**
  - Strong typing for schema definitions.
  - Infer TypeScript model types from schema.
- [x] **T1.3: PostgreSQL DDL Generator (Initial):**
  - Generate `CREATE TABLE` SQL for PostgreSQL from schema definitions.
- [x] **T1.4: Spanner DDL Generator (Initial):**
  - Generate `CREATE TABLE` SQL for Google Spanner, handling type and constraint differences.
- [x] **T1.5: Basic CLI for DDL Output:**
  - Command to output generated DDL for a specified dialect.

### Phase 2: Query Building & Execution (Read Operations) - COMPLETED

- [x] **T2.1: Basic Query Builder API:**
  - Implemented `select().from().where()` structure.
- [x] **T2.2: PostgreSQL DML Generator (SELECT):**
  - Translated query builder AST to PostgreSQL `SELECT` statements.
- [x] **T2.3: Spanner DML Generator (SELECT):**
  - Translated query builder AST to Spanner `SELECT` statements.
- [x] **T2.4: Database Adapters (Initial):**
  - Implemented PostgreSQL adapter (for `pg`/`postgres.js`).
  - Implemented Spanner adapter (for `@google-cloud/spanner`).
  - Implemented Pglite adapter.
- [x] **T2.5: `sql` Tag Function for Raw Queries.**
  - Implemented `sql` tag function for raw query execution.

### Phase 3: Advanced Schema Features & DML (Write Operations) - COMPLETED

- [x] **T3.1: Advanced Column Types & Constraints:**
  - Implemented foreign keys (`references()`, `onDelete`).
  - Implemented multiple primary keys (via `table` extra options).
  - Implemented Spanner-specific feature: `INTERLEAVE IN PARENT` (via `table` extra options).
  - Implemented enhanced default value functions (`.$defaultFn()`).
- [x] **T3.2: Query Builder Enhancements (Writes):**
  - Implemented `insert()`, `update()`, `deleteFrom()` methods in QueryBuilder.
- [x] **T3.3: DML Generators (INSERT, UPDATE, DELETE):**
  - Extended SQL generators in QueryBuilder for write operations (PostgreSQL & Spanner).
- [x] **T3.4: Transaction Support API.**
  - Implemented `transaction(callback)` method in PostgreSQL, Spanner, and Pglite adapters.

### Phase 4: Migration Engine - COMPLETED

- [x] **T4.1: Schema Snapshotting/Introspection.**
- [x] **T4.2: Schema Diffing Logic.**
- [x] **T4.3: Migration File Generation (DDL for both dialects).**

  - This engine will be responsible for generating the full set of DDL statements to align the database schema with the defined models.
  - For Spanner, this will include generating `CREATE UNIQUE INDEX` statements for any columns or sets of columns marked with `unique()` or `uniqueIndex()` in the schema definition.

  - Similarly, for PostgreSQL, if we decide to use `CREATE UNIQUE INDEX` for all unique constraints (for consistency or for features not available in inline constraints), the migration engine would handle that. It would also handle non-unique indexes (`CREATE INDEX`) for both dialects.

  - This also applies to other DDL like `ALTER TABLE` for adding/removing columns, constraints, etc.

  - Note that spanner has a limit of 10 on DDL statements that require validation or backfill. You can batch more without validation, but to be safe, we should just make our migration files be limited to 10 ddl statements at a time when adding indices, etc.

- [x] **T4.4: Migration CLI (`migrate latest`, `migrate down`, `migrate create`).**
  - `spanner-orm-cli migrate create <name> --schema <path>`: Fully implemented. Generates timestamped migration files for PostgreSQL and Spanner, automatically populated with `up` (from empty to current schema) and `down` (from current to empty schema) DDL statements.
  - `spanner-orm-cli migrate latest --schema <path> --dialect <pg|spanner>`: Core logic implemented. This includes creating the migration tracking table (if it doesn't exist), identifying pending migrations by comparing against the tracking table, dynamically importing migration modules, executing their `up` functions, and recording successful migrations in the tracking table. Full operation requires wiring up to concrete database adapters and connection configuration.
  - `spanner-orm-cli migrate down --schema <path> --dialect <pg|spanner>`: Core logic implemented. This includes identifying the last applied migration from the tracking table, dynamically importing its module, executing its `down` function, and removing its record from the tracking table on success. Full operation requires wiring up to concrete database adapters and connection configuration.
- [x] **T4.5: Migration Tracking Table.**
  - Schema for `_spanner_orm_migrations_log` defined.
  - DDL for table creation implemented in `src/core/migration-meta.ts`.
  - Functions for recording and querying applied migrations implemented in `src/core/migration-meta.ts`.
  - `migrate latest` command ensures this table is created on its first run.

### Phase 5: Advanced Features & Polish (Next Steps)

Make sure to read notes/Phase5.md and notes/GoogleSQLSpanner.md when working on Phase 5.

- [x] **T5.0: Integrate Database Adapters into Migration CLI:**
  - Implemented database connection configuration via environment variables (`DB_DIALECT`, `DATABASE_URL`, Spanner-specific vars).
  - Created `getDatabaseAdapter()` factory function in `src/cli.ts` for instantiating and connecting appropriate adapters.
  - Updated `handleMigrateLatest` and `handleMigrateDown` in `src/cli.ts` to use the live adapter.
  - Removed the `--dialect` CLI option from `migrate latest` and `migrate down`, relying on `DB_DIALECT`.
- [x] **T5.1: Advanced Querying:**
  - [x] Implemented Joins (INNER, LEFT), Aggregations (COUNT, SUM, AVG, MIN, MAX), Grouping (GROUP BY), Ordering (ORDER BY).
  - [x] Implemented Pagination (LIMIT, OFFSET).
  - [x] Implemented SQL functions: `like`, `ilike`, `regexpContains`, `concat`, `lower`, `upper`.
  - [x] Added querying examples to README.md for these features.
- [ ] **T5.2: Relational Mappings in Schema & Query Builder (To Be Broken Down):**
  - [x] Implemented `$defaultFn()` for dynamic default values during INSERT operations.
  - [x] Confirmed support for `boolean` and `jsonb` column types.
  - [x] Implemented `uuid()` helper function.
  - [x] Implemented Foreign Key DDL generation.
  - [x] **T5.2.1: Basic Relational Awareness in Query Builder:** Allow query methods to understand and correctly alias columns from tables with defined relationships. (Includes aliasing within SQL helper functions).
  - [~] **T5.2.2: Simple Eager Loading (One Level Deep):** Implement fetching of directly related data (e.g., user's posts). Start with one-to-many. (SQL generation complete; result shaping and full type safety pending).
    - [ ] The advanced TypeScript type safety for the shaped results remains a future enhancement for T5.2.2.
  - [ ] **T5.2.3: Fluent Join API based on Schema Relations:** Enable joins based on pre-defined schema relations for a more ORM-like experience.
- [x] **T5.3: Performance Optimizations (e.g., batching for Spanner).**
  - [x] Implemented selective DDL batching for Spanner, grouping validating DDLs (e.g., CREATE INDEX, ALTER TABLE ADD/ALTER COLUMN, ADD FOREIGN KEY) into batches of up to 5.
- [~] **T5.4: Comprehensive Documentation & Examples.** (Ongoing - README updates are part of this, docusaurus is also part of this).
- [~] **T5.5: Robust Testing Suite (unit & integration tests).** (Ongoing - Unit tests have been added for current features features, but new features will need more unit tests).
- [~] **T5.6: Setup Docusaurus Documentation:** Implement Docusaurus for comprehensive, versioned documentation, deployable to GitHub Pages. Started, but need to add comprehensive docs.
- [ ] **T5.7: Incremental Migration Generation:** Enhance `migrate create` to generate migrations based on the difference between the last applied schema state and the current schema definition, rather than always from an empty schema. This involves:
  - Storing a snapshot of the schema after each migration generation (e.g., `latest.snapshot.json`).
  - Using this snapshot as the "before" state for the next `migrate create` command.

### Beyond Phase 5: Future Considerations

- **Advanced Dialect-Specific Features:**
  - Support for Google Spanner Graph Queries.
  - Exploration of PostgreSQL extensions for feature parity (e.g., Apache AGE for graph capabilities).
- **Further Performance Enhancements.**
- **Community-Driven Features.**

## Getting Started

1.  **Installation:**

    ```bash
    # (Once published to npm)
    # npm install spanner-orm
    # bun install spanner-orm
    # yarn add spanner-orm

    # For now, clone and build locally:
    git clone https://github.com/your-repo/spanner-orm.git # Replace with actual repo
    cd spanner-orm
    bun install
    bun run build
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
      uuid, // New uuid helper
      index,
      uniqueIndex,
      sql,
    } from "spanner-orm"; // Adjust import path as per your project structure
    // No need to import crypto here if uuid() handles it internally via $defaultFn

    // --- Define a placeholder 'users' table for demonstrating references ---
    export const users = table("users", {
      id: uuid("id").primaryKey(), // Using the new uuid helper
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

    // Base model with ID (using uuid helper) and timestamps
    export const baseModel = {
      id: uuid("id").primaryKey(), // Automatically uses $defaultFn(() => crypto.randomUUID())
      ...timestamps,
    };

    // For resources that are owned by a user
    export const ownableResource = {
      ...baseModel,
      userId: uuid("user_id") // Assuming user_id is also a UUID
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
        .$type<VisibilityStatus>(), // For type assertion if needed, or rely on TS inference
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
        indexes: [
          index({ columns: [t.fileType] }), // Example non-unique index
          uniqueIndex({ name: "uq_gcs_object", columns: [t.gcsObjectName] }), // Example unique index
        ],
      })
    );

    // You can then use these definitions to generate DDL or build queries.
    ```

    This example demonstrates how you can compose schemas from shared building blocks, similar to patterns used in Drizzle ORM, and showcases the usage of new features like `uuid()` and `$defaultFn()` (implicitly used by `uuid()`).
    _(Note: The import paths and exact feature set of `spanner-orm` should be adjusted based on the library's actual implementation as development progresses.)_

## Usage Examples

### Generating DDL with the CLI

Once you have defined your schema (e.g., in `src/schema.ts`), you can generate DDL for PostgreSQL or Spanner:

```bash
# Ensure the project is built (bun run build)
# The CLI will be available via the 'bin' script in package.json

# Generate PostgreSQL DDL
npx spanner-orm-cli ddl --schema ./path/to/your/schema.ts --dialect pg

# Example with a schema file in dist (after build) and output to file
npx spanner-orm-cli ddl --schema ./dist/schema.js --dialect pg --output ./generated-pg.sql

# Generate Spanner DDL
npx spanner-orm-cli ddl --schema ./dist/schema.js --dialect spanner
```

This will print the generated `CREATE TABLE` statements to standard output or the specified file.

### Managing Migrations with the CLI

The CLI also provides tools to manage your database schema migrations. Migration files are stored in the `./spanner-orm-migrations` directory by default.

**1. Create a new migration:**

This command generates a pair of timestamped migration files (one for PostgreSQL, one for Spanner) with `up` and `down` function templates.

```bash
# Example: Create migration files for adding a 'posts' table
# This requires your schema file (e.g., dist/schema.js) to be built and specified.
npx spanner-orm-cli migrate create add-posts-table --schema ./dist/schema.js

# This will create files like:
# ./spanner-orm-migrations/YYYYMMDDHHMMSS-add-posts-table.pg.ts
# ./spanner-orm-migrations/YYYYMMDDHHMMSS-add-posts-table.spanner.ts
# Currently, these files are pre-populated with DDL based on changes detected against an empty schema.
# For true incremental migrations (diffing from the last known state), see task T5.7 in the roadmap.
```

**2. Apply pending migrations:**

This command applies all pending migrations to your database for the specified dialect.
(Requires database connection to be configured - e.g., via environment variables, specific adapter setup needed).

```bash
# Apply latest migrations (dialect determined by DB_DIALECT environment variable)
# Example: export DB_DIALECT=postgres
#          export DATABASE_URL=postgresql://user:pass@host:port/db
npx spanner-orm-cli migrate latest --schema ./dist/schema.js

# Example for Spanner:
# export DB_DIALECT=spanner
# export SPANNER_PROJECT_ID=my-gcp-project
# export SPANNER_INSTANCE_ID=my-spanner-instance
# export SPANNER_DATABASE_ID=my-spanner-database
npx spanner-orm-cli migrate latest --schema ./dist/schema.js
```

**3. Revert the last applied migration:**

This command reverts the last applied migration (dialect determined by `DB_DIALECT` environment variable).

```bash
# Revert the last migration
npx spanner-orm-cli migrate down --schema ./dist/schema.js
```

_(Note: The migration CLI commands `migrate latest` and `migrate down` now use environment variables such as `DB_DIALECT`, `DATABASE_URL` (for PG/Pglite), and Spanner-specific variables like `SPANNER_PROJECT_ID`, `SPANNER_INSTANCE_ID`, `SPANNER_DATABASE_ID` to connect to your database and apply/revert migrations.)_

### Querying Examples

Here's how you can use the `QueryBuilder` to construct and execute queries. Assume you have your schema defined (e.g., `usersTable`, `postsTable` from the "Getting Started" example) and an initialized database adapter.

```typescript
import { QueryBuilder, sql } from "spanner-orm";
import { usersTable, postsTable } from "./schema"; // Your schema definitions
import {
  count,
  sum,
  avg,
  like,
  ilike,
  regexpContains,
  concat,
  lower,
  upper,
} from "spanner-orm/functions"; // Aggregate and string functions
// import { getDbAdapter } from './your-adapter-setup'; // Your adapter setup

// const db = getDbAdapter(); // Your initialized adapter instance

async function runExamples() {
  const qb = new QueryBuilder(); // Generic QueryBuilder, table specified in methods

  // 1. Basic SELECT with WHERE
  const recentUsersQuery = qb
    .select({ id: usersTable.columns.id, name: usersTable.columns.name })
    .from(usersTable)
    .where(
      sql`${usersTable.columns.createdAt} > ${new Date(
        Date.now() - 24 * 60 * 60 * 1000
      )}`
    ) // Users created in the last 24 hours
    .orderBy(usersTable.columns.createdAt, "DESC")
    .limit(10);

  // const recentUsersSql = recentUsersQuery.toSQL("postgres");
  // console.log("Recent Users SQL:", recentUsersSql);
  // const recentUsers = await db.execute(recentUsersSql, recentUsersQuery.getBoundParameters());

  // 2. SELECT with INNER JOIN
  const usersWithPostsQuery = qb
    .select({
      userName: usersTable.columns.name,
      postTitle: postsTable.columns.title,
    })
    .from(usersTable)
    .innerJoin(
      postsTable,
      sql`${usersTable.columns.id} = ${postsTable.columns.userId}`
    )
    .where(sql`${usersTable.columns.email} = ${"example@user.com"}`);

  // const usersWithPostsSql = usersWithPostsQuery.toSQL("postgres");
  // console.log("Users with Posts SQL:", usersWithPostsSql);
  // const usersWithPosts = await db.execute(usersWithPostsSql, usersWithPostsQuery.getBoundParameters());

  // 3. SELECT with GROUP BY and Aggregates
  const userPostCountsQuery = qb
    .select({
      userId: usersTable.columns.id,
      userName: usersTable.columns.name,
      postCount: count(postsTable.columns.id),
    })
    .from(usersTable)
    .leftJoin(
      postsTable,
      sql`${usersTable.columns.id} = ${postsTable.columns.userId}`
    )
    .groupBy(usersTable.columns.id, usersTable.columns.name)
    .orderBy(sql`COUNT(${postsTable.columns.id})`, "DESC");

  // const userPostCountsSql = userPostCountsQuery.toSQL("postgres");
  // console.log("User Post Counts SQL:", userPostCountsSql);
  // const userPostCounts = await db.execute(userPostCountsSql, userPostCountsQuery.getBoundParameters());

  // 4. INSERT a new user
  const newUserQuery = qb
    .insert(usersTable)
    .values({ name: "New User", email: "new@user.com", age: 28 });
  // const newUserSql = newUserQuery.toSQL("postgres");
  // await db.execute(newUserSql, newUserQuery.getBoundParameters());

  // 5. UPDATE an existing user's age
  const updateUserQuery = qb
    .update(usersTable)
    .set({ age: 29 })
    .where(sql`${usersTable.columns.email} = ${"new@user.com"}`);
  // const updateUserSql = updateUserQuery.toSQL("postgres");
  // await db.execute(updateUserSql, updateUserQuery.getBoundParameters());

  // 6. DELETE a user
  const deleteUserQuery = qb
    .deleteFrom(usersTable)
    .where(sql`${usersTable.columns.email} = ${"new@user.com"}`);
  // const deleteUserSql = deleteUserQuery.toSQL("postgres");
  // await db.execute(deleteUserSql, deleteUserQuery.getBoundParameters("postgres"));

  // 7. SELECT with LIKE (PostgreSQL specific, translates to REGEXP_CONTAINS for Spanner)
  const usersLikeQuery = qb
    .select({ name: usersTable.columns.name })
    .from(usersTable)
    .where(like(usersTable.columns.name, "J%")); // Users whose name starts with J

  // const usersLikeSqlPg = usersLikeQuery.toSQL("postgres");
  // console.log("Users LIKE SQL (PG):", usersLikeSqlPg); // SELECT "name" AS "name" FROM "users" WHERE "users"."name" LIKE $1
  // const usersLikeParamsPg = usersLikeQuery.getBoundParameters("postgres");
  // console.log("Users LIKE Params (PG):", usersLikeParamsPg); // ["J%"]

  // const usersLikeSqlSpanner = usersLikeQuery.toSQL("spanner");
  // console.log("Users LIKE SQL (Spanner):", usersLikeSqlSpanner); // SELECT `name` AS `name` FROM `users` WHERE REGEXP_CONTAINS(`users`.`name`, @p1)
  // const usersLikeParamsSpanner = usersLikeQuery.getBoundParameters("spanner");
  // console.log("Users LIKE Params (Spanner):", usersLikeParamsSpanner); // ["^J.*"]

  // 8. SELECT with ILIKE (PostgreSQL specific, translates to REGEXP_CONTAINS with (?i) for Spanner)
  const usersILikeQuery = qb
    .select({ email: usersTable.columns.email })
    .from(usersTable)
    .where(ilike(usersTable.columns.email, "%@example.com"));

  // const usersILikeSqlPg = usersILikeQuery.toSQL("postgres");
  // console.log("Users ILIKE SQL (PG):", usersILikeSqlPg); // SELECT "email" AS "email" FROM "users" WHERE "users"."email" ILIKE $1
  // const usersILikeParamsPg = usersILikeQuery.getBoundParameters("postgres");
  // console.log("Users ILIKE Params (PG):", usersILikeParamsPg); // ["%@example.com"]

  // const usersILikeSqlSpanner = usersILikeQuery.toSQL("spanner");
  // console.log("Users ILIKE SQL (Spanner):", usersILikeSqlSpanner); // SELECT `email` AS `email` FROM `users` WHERE REGEXP_CONTAINS(`users`.`email`, @p1)
  // const usersILikeParamsSpanner = usersILikeQuery.getBoundParameters("spanner");
  // console.log("Users ILIKE Params (Spanner):", usersILikeParamsSpanner); // ["(?i).*@example\\.com$"]

  // 9. SELECT with REGEXP_CONTAINS (Spanner specific, translates to ~ for PostgreSQL)
  const usersRegexpQuery = qb
    .select({ name: usersTable.columns.name })
    .from(usersTable)
    .where(regexpContains(usersTable.columns.name, "^[A-C]")); // Names starting with A, B, or C

  // const usersRegexpSqlSpanner = usersRegexpQuery.toSQL("spanner");
  // console.log("Users REGEXP SQL (Spanner):", usersRegexpSqlSpanner); // SELECT `name` AS `name` FROM `users` WHERE REGEXP_CONTAINS(`users`.`name`, @p1)
  // const usersRegexpParamsSpanner = usersRegexpQuery.getBoundParameters("spanner");
  // console.log("Users REGEXP Params (Spanner):", usersRegexpParamsSpanner); // ["^[A-C]"]

  // const usersRegexpSqlPg = usersRegexpQuery.toSQL("postgres");
  // console.log("Users REGEXP SQL (PG):", usersRegexpSqlPg); // SELECT "name" AS "name" FROM "users" WHERE "users"."name" ~ $1
  // const usersRegexpParamsPg = usersRegexpQuery.getBoundParameters("postgres");
  // console.log("Users REGEXP Params (PG):", usersRegexpParamsPg); // ["^[A-C]"]

  // 10. SELECT with CONCAT
  const userFullNameQuery = qb
    .select({
      fullName: concat(
        usersTable.columns.name,
        " (",
        usersTable.columns.email,
        ")"
      ),
    })
    .from(usersTable)
    .where(sql`${usersTable.columns.id} = ${1}`);

  // const userFullNameSql = userFullNameQuery.toSQL("postgres");
  // console.log("User Full Name SQL (PG):", userFullNameSql); // SELECT CONCAT("users"."name", $1, "users"."email", $2) AS "fullName" FROM "users" WHERE "users"."id" = $3
  // const userFullNameParams = userFullNameQuery.getBoundParameters("postgres");
  // console.log("User Full Name Params (PG):", userFullNameParams); // [" (", ")", 1]

  // 11. SELECT with LOWER and UPPER
  const userCaseTransformedQuery = qb
    .select({
      lowerName: lower(usersTable.columns.name),
      upperEmail: upper(usersTable.columns.email),
      processedName: upper(concat("prefix-", lower(usersTable.columns.name))),
    })
    .from(usersTable)
    .where(sql`${usersTable.columns.id} = ${2}`);

  // const userCaseSql = userCaseTransformedQuery.toSQL("postgres");
  // console.log("User Case SQL (PG):", userCaseSql); // SELECT LOWER("users"."name") AS "lowerName", UPPER("users"."email") AS "upperEmail", UPPER(CONCAT($1, LOWER("users"."name"))) AS "processedName" FROM "users" WHERE "users"."id" = $2
  // const userCaseParams = userCaseTransformedQuery.getBoundParameters("postgres");
  // console.log("User Case Params (PG):", userCaseParams); // ["prefix-", 2]

  // 12. SELECT with Eager Loading (Include)
  // Assuming usersTable and postsTable are defined, and postsTable has a userId referencing usersTable.id
  const usersWithTheirPostsQuery = qb
    .select({
      userId: usersTable.columns.id,
      userName: usersTable.columns.name,
    })
    .from(usersTable)
    .include({ posts: { select: { title: true, content: true } } }) // Include posts, selecting specific columns
    .where(sql`${usersTable.columns.id} = ${1}`);

  // const usersWithPostsSql = usersWithTheirPostsQuery.toSQL("postgres");
  // console.log("Users with Posts (Include) SQL:", usersWithPostsSql);
  // Example PG SQL:
  // SELECT "t1"."id" AS "userId", "t1"."name" AS "userName", "t2"."title" AS "posts__title", "t2"."content" AS "posts__content"
  // FROM "users" AS "t1"
  // LEFT JOIN "posts" AS "t2" ON "t2"."user_id" = "t1"."id"
  // WHERE "t1"."id" = $1
  // const usersWithPostsData = await db.execute(usersWithPostsSql, usersWithTheirPostsQuery.getBoundParameters("postgres"));
  // Result shaping would be needed here to transform flat rows into nested objects, e.g.:
  // { userId: 1, userName: 'Alice', posts: [{ title: 'Post 1', content: '...' }, ...] }
}

// runExamples().catch(console.error);
```

These examples illustrate how to perform common database operations. The actual execution would depend on your specific database adapter setup.

---

_This project is under active development._
