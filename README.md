# spanner-orm

A TypeScript ORM for Google Spanner & PostgreSQL, designed for Node.js and Bun. Inspired by Drizzle ORM, `spanner-orm` aims to provide a single, elegant object model for defining your schema and querying your data across both database systems.

## Core Features

`spanner-orm` is designed to provide a seamless and powerful experience for managing data across PostgreSQL and Google Spanner. Its core capabilities include:

- **Unified Object Model for PostgreSQL & Spanner:** Define your database schema once using a Drizzle-inspired syntax. This single object model seamlessly supports both PostgreSQL and Google Spanner, simplifying development and ensuring consistency across diverse database environments.

- **Comprehensive Migration Generation & Execution:** Automatically produce migration files with the appropriate DDL for both PostgreSQL and Spanner. These migrations can be run via the `spanner-orm-cli migrate` command (e.g., `migrate latest`, `migrate down`) or programmatically within your application, ensuring smooth schema evolution.

- **Versatile Query Building with SQL Fallback:** Construct type-safe queries using an intuitive query builder. For complex scenarios or dialect-specific needs, seamlessly fall back to raw SQL using the `sql` template literal tag, offering maximum flexibility.

- **Dialect-Optimized SQL for Flexible Deployments:**

  - Generates Google SQL specifically tailored for Spanner's unique architecture and capabilities.
  - Produces standard, highly compatible SQL for PostgreSQL.
  - This dual-dialect support empowers you to use PostgreSQL for non-Spanner deployments, Pglite for local development or embedded applications, and Google Spanner for demanding web-scale applications, all from a single, consistent codebase.

- **Composable Schemas (Drizzle-Inspired):** Easily create and reuse schema components (e.g., for common fields like `id`, `createdAt`, `updatedAt`, or base entity structures), promoting DRY principles and maintainable data models.

- **TypeScript First:** Built from the ground up with TypeScript, `spanner-orm` offers a robust, type-safe, and enjoyable developer experience, with strong type inference from your schema definitions.

## Why spanner-orm?

`spanner-orm` addresses a critical need for developers building applications that require the immense scalability of Google Spanner while also desiring the versatility of PostgreSQL for other deployment scenarios (e.g., non-Spanner enterprise deployments, local development with Pglite, or applications where data resides locally). Currently, the Node.js/Bun ecosystem lacks a dedicated ORM that elegantly bridges these two powerful database systems with a single, consistent object model. `spanner-orm` fills this gap by:

- Allowing a single codebase for data modeling across different database backends.
- Simplifying the transition between local/testing environments (using Pglite/Postgres) and production environments (using Spanner or Postgres).
- Providing a productive and familiar Drizzle-inspired API.

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

### Phase 4: Migration Engine

- [x] **T4.1: Schema Snapshotting/Introspection.**
- [x] **T4.2: Schema Diffing Logic.**
- [x] **T4.3: Migration File Generation (DDL for both dialects).**

  - This engine will be responsible for generating the full set of DDL statements to align the database schema with the defined models.
  - For Spanner, this will include generating `CREATE UNIQUE INDEX` statements for any columns or sets of columns marked with `unique()` or `uniqueIndex()` in the schema definition.

  - Similarly, for PostgreSQL, if we decide to use `CREATE UNIQUE INDEX` for all unique constraints (for consistency or for features not available in inline constraints), the migration engine would handle that. It would also handle non-unique indexes (`CREATE INDEX`) for both dialects.

  - This also applies to other DDL like `ALTER TABLE` for adding/removing columns, constraints, etc.

  - Note that spanner has a limit of 10 on DDL statements that require validation or backfill. You can batch more without validation, but to be safe, we should just make our migration files be limited to 10 ddl statements at a time when adding indices, etc.

- [~] **T4.4: Migration CLI (`migrate latest`, `migrate down`, `migrate create`).**
  - `spanner-orm-cli migrate create <name>`: Implemented. Generates timestamped migration files for both PostgreSQL and Spanner (`YYYYMMDDHHMMSS-name.pg.ts` and `YYYYMMDDHHMMSS-name.spanner.ts`) in the `./spanner-orm-migrations` directory. These files contain `up` and `down` function templates.
  - `spanner-orm-cli migrate latest --schema <path> --dialect <pg|spanner>`: Basic command structure implemented. Currently simulates applying migrations and logs placeholder steps. Full implementation depends on T4.1, T4.2, T4.3 (partially covered by `create`), and T4.5.
  - `spanner-orm-cli migrate down --schema <path> --dialect <pg|spanner>`: Basic command structure implemented. Currently simulates reverting the last migration and logs placeholder steps. Full implementation depends on T4.5.
- [ ] **T4.5: Migration Tracking Table.**

### Phase 5: Advanced Features & Polish

- [ ] **T5.1: Advanced Querying:** Joins, aggregations, grouping, ordering, pagination, sql functions like concat, like, ilike (like & ilike not available in Google SQL - see notes/GoogleSQLSpanner.md).
- [ ] **T5.2: Relational Mappings in Schema & Query Builder.**
- [ ] **T5.3: Performance Optimizations (e.g., batching for Spanner).**
- [ ] **T5.4: Comprehensive Documentation & Examples.**
- [ ] **T5.5: Robust Testing Suite (unit & integration tests).**

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
      table, // Replaces pgTable from Drizzle
      text,
      timestamp,
      varchar,
      integer,
      // boolean, // Assuming boolean is available or will be
      // uniqueIndex, // Assuming uniqueIndex is available or will be
      // primaryKey, // Often part of column definition, e.g., .primaryKey()
      // jsonb, // Assuming jsonb or equivalent (e.g., json for PG, JSON/STRING for Spanner)
      // index, // Assuming index is available or will be
      sql, // For raw SQL expressions like default values
    } from "spanner-orm"; // Adjust import path as per your project structure
    import crypto from "crypto"; // For generating UUIDs

    // --- Define a placeholder 'users' table for demonstrating references ---
    // This would typically be in your main schema file or imported.
    export const users = table("users", {
      id: varchar("id", { length: 36 }).primaryKey(), // Assuming user ID is a string UUID
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
      // Drizzle's .$onUpdate(() => new Date()) would require adapter-specific handling or triggers
    };

    // Base model with ID and timestamps
    export const baseModel = {
      id: varchar("id", { length: 36 })
        // .$defaultFn(() => crypto.randomUUID()) // .$defaultFn is Drizzle-specific;
        // For spanner-orm, default generation might be handled differently
        // or you might set it at application level before insert.
        // For this example, we'll assume a client-generated UUID or a DB default if supported.
        .primaryKey(), // crypto.randomUUID() can be used by application logic to generate default.
      ...timestamps,
    };

    // For resources that are owned by a user
    export const ownableResource = {
      // Removed 'any' type for better practice if possible
      ...baseModel,
      userId: varchar("user_id", { length: 36 }) // Assuming user_id is also a UUID
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }), // Ensure references() is implemented
    };

    // For resources that have visibility permissions
    // type VisibilityStatus = "private" | "shared" | "public"; // Example type for visibility

    export const permissibleResource = {
      // Removed 'any' type
      ...ownableResource,
      visibility: varchar("visibility", { length: 10 }) // e.g., 'private', 'shared', 'public'
        .default("private")
        .notNull(),
      // .$type<VisibilityStatus>() // .$type is a Drizzle-specific helper for type assertion.
      // In spanner-orm, this would be managed by TypeScript's inference.
    };

    // --- Example Table: Uploads (using shared components) ---
    export const uploads = table("uploads", {
      // Use `table` from spanner-orm
      ...permissibleResource, // Includes id, createdAt, updatedAt, userId, visibility
      gcsObjectName: text("gcs_object_name").notNull(), // Full path in GCS
      fileName: text("file_name").notNull(),
      fileType: text("file_type").notNull(), // General type: 'image', 'audio', etc.
      mimeType: text("mime_type").notNull(), // Specific MIME type: 'image/jpeg'
      size: integer("size").notNull(), // File size in bytes
    });

    // You can then use these definitions to generate DDL or build queries.
    ```

    This example demonstrates how you can compose schemas from shared building blocks, similar to patterns used in Drizzle ORM.
    _(Note: Features like `.references()`, `.$defaultFn()`, advanced indexing, and specific type mappings like `jsonb` are part of ongoing development as outlined in the roadmap. The import paths and exact feature set of `spanner-orm` should be adjusted based on the library's actual implementation.)_

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
npx spanner-orm-cli migrate create add-posts-table

# This will create files like:
# ./spanner-orm-migrations/YYYYMMDDHHMMSS-add-posts-table.pg.ts
# ./spanner-orm-migrations/YYYYMMDDHHMMSS-add-posts-table.spanner.ts
```

You then fill in the `up` and `down` functions in these files with the necessary SQL statements for each dialect.

**2. Apply pending migrations (Simulated):**

This command (currently in a simulated state) will eventually apply all pending migrations to your database for the specified dialect.

```bash
# Simulate applying latest migrations for PostgreSQL
npx spanner-orm-cli migrate latest --schema ./dist/schema.js --dialect pg

# Simulate applying latest migrations for Spanner
npx spanner-orm-cli migrate latest --schema ./dist/schema.js --dialect spanner
```

**3. Revert the last applied migration (Simulated):**

This command (currently in a simulated state) will eventually revert the last applied migration for the specified dialect.

```bash
# Simulate reverting the last PostgreSQL migration
npx spanner-orm-cli migrate down --schema ./dist/schema.js --dialect pg

# Simulate reverting the last Spanner migration
npx spanner-orm-cli migrate down --schema ./dist/schema.js --dialect spanner
```

_(Note: The `migrate latest` and `migrate down` commands are placeholders for now. Full functionality depends on schema snapshotting, diffing, and migration tracking features which are part of ongoing development.)_

---

_This project is under active development._
