---
title: "Supported Dialects"
weight: 50 # Order within the "Docs" section
---

# Supported Dialects: PostgreSQL & Google Spanner

`spanner-orm` is uniquely designed to work with both **PostgreSQL** (including its lightweight variant **PGLite**) and **Google Spanner**, allowing you to use a single object model for your schema and queries across these distinct database systems.

## Core Philosophy: Single Object Model

The primary goal is to define your data structures and write your application logic once. `spanner-orm` then handles the translation to dialect-specific SQL for schema manipulation (DDL) and data querying (DML).

- **Schema Definition**: You define tables, columns, and relationships using `spanner-orm`'s Drizzle-inspired syntax. This definition is abstract and not tied to a specific SQL dialect at the point of definition.
- **Migration Generation**: When you create migrations, `spanner-orm` generates SQL appropriate for both PostgreSQL and Spanner, storing them in dialect-specific functions within the migration file (e.g., `migratePostgresUp`, `migrateSpannerUp`).
- **Query Execution**: When you build queries using the fluent API (`db` object) or the `QueryBuilder`, the ORM constructs an internal representation of the query. This is then translated into dialect-specific SQL by the appropriate adapter just before execution.

## PostgreSQL & PGLite

For PostgreSQL and PGLite, `spanner-orm` generates standard, highly compatible SQL.

- **Dialect Name**: When configuring the `OrmClient` or using CLI commands for PostgreSQL or PGLite, the dialect is specified as `"postgres"`.
- **PGLite**: PGLite is a WebAssembly build of PostgreSQL that runs directly in Node.js or the browser. `spanner-orm` treats PGLite as a PostgreSQL-compatible environment. The `PgliteAdapter` handles the specifics of interacting with a PGLite instance.
- **Features**: Most standard PostgreSQL features that can be expressed through the ORM's schema definition and query builder are supported. This includes common data types, constraints, indexes, and query operations.
- **SQL Generation**: The SQL generated aims for broad compatibility with common PostgreSQL versions.

**Example `OrmClient` Initialization for PGLite:**

```typescript
import { OrmClient, PgliteAdapter } from "spanner-orm";
import { PGlite } from "@electric-sql/pglite";

const pglite = new PGlite(); // In-memory or file-based
const adapter = new PgliteAdapter(pglite);
await adapter.connect();
const db = new OrmClient(adapter, "postgres");
```

## Google Spanner

Google Spanner uses a dialect of SQL known as "Google Standard SQL". While it shares many similarities with ANSI SQL, it has unique features, data types, and DDL syntax, particularly concerning schema design (e.g., interleaved tables, primary key constraints).

- **Dialect Name**: When configuring the `OrmClient` or using CLI commands for Spanner, the dialect is specified as `"spanner"`.
- **SQL Generation**: `spanner-orm` generates Google Standard SQL when targeting Spanner. This includes:
  - Correct DDL for `CREATE TABLE`, including Spanner-specific primary key definitions and options.
  - DML (SELECT, INSERT, UPDATE, DELETE) that adheres to Google Standard SQL syntax and conventions.
- **Spanner-Specific Features**:
  - **Interleaved Tables**: While the core schema definition aims for common ground, `spanner-orm` intends to provide mechanisms or conventions to define and utilize Spanner's interleaved tables for co-location of parent-child data. (See [Advanced Topics](./../advanced-topics/)).
  - **Data Types**: The ORM maps its abstract types to appropriate Spanner data types (e.g., `STRING`, `INT64`, `FLOAT64`, `BOOL`, `TIMESTAMP`, `DATE`, `JSON`, `BYTES`, `ARRAY`).
  - **Transactions**: Spanner's transaction model (especially read-write transactions) is respected by the `SpannerAdapter`.

**Example `OrmClient` Initialization for Spanner:**

```typescript
import { OrmClient, SpannerAdapter } from "spanner-orm";
import { Spanner } from "@google-cloud/spanner";

// const spannerClient = new Spanner({ projectId: "your-gcp-project" });
// const instance = spannerClient.instance("your-spanner-instance");
// const database = instance.database("your-spanner-database");
// const adapter = new SpannerAdapter(database);
// await adapter.connect(); // May involve specific Spanner setup/checks
// const db = new OrmClient(adapter, "spanner");
```

## Bridging the Differences

`spanner-orm` abstracts many common database operations. However, some features are unique to one dialect:

- **`jsonb` type**: This is primarily a PostgreSQL feature. When targeting Spanner, `spanner-orm` will map this to Spanner's `JSON` type. Functionality and indexing capabilities for JSON might differ between the two.
- **Advanced Spanner Features**: Features like interleaved tables or specific Spanner query hints might require special handling or syntax extensions within the ORM, or might be addressed through raw SQL escape hatches if direct ORM support is not yet mature.

The goal is to maximize code reusability while still allowing developers to leverage the unique strengths of each database system when necessary. Always refer to the specific documentation for adapters and advanced features for the most up-to-date information on how dialect differences are handled.
