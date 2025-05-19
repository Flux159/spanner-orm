# spanner-orm

A TypeScript ORM for Google Spanner & PostgreSQL, designed for Node.js and Bun. Inspired by Drizzle ORM, `spanner-orm` aims to provide a single, elegant object model for defining your schema and querying your data across both database systems.

## Core Features

- **Unified Object Model:** Define your database schema once using a Drizzle-like syntax and use it for both PostgreSQL and Google Spanner.
- **Dual Dialect Support:**
  - Generates Google SQL for Spanner.
  - Generates standard SQL for PostgreSQL (and Pglite for local development).
- **Migration Generation:** Produces migration files with DDL for both PostgreSQL and Spanner.
- **Migration Execution:** Run migrations via a CLI tool or programmatically.
- **Flexible Querying:**
  - Powerful query builder for type-safe queries.
  - Fallback to raw SQL when needed.
- **Composable Schemas:** Easily create reusable schema components (e.g., for timestamps, base entity fields).
- **TypeScript First:** Designed for a strong, type-safe developer experience.

## Why spanner-orm?

Developing applications that need the global scale of Google Spanner but also want the flexibility of PostgreSQL for other deployments (or local development with Pglite) currently lacks a dedicated ORM solution in the Node.js/Bun ecosystem. `spanner-orm` aims to fill this gap by providing a seamless and productive development experience.

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
    D1 --> F1[PostgreSQL Adapter (pg, pglite)];
    D2 --> F2[Spanner Adapter (@google-cloud/spanner)];
    F1 --> G1[PostgreSQL/Pglite Database];
    F2 --> G2[Google Spanner Database];

    M[Migration Engine] --> C;
    M --> D1;
    M --> D2;
    M --> F1;
    M --> F2;

    style A fill:#f9f,stroke:#333,stroke-width:2px
    style B fill:#ccf,stroke:#333,stroke-width:2px
    style C fill:#lightgrey,stroke:#333,stroke-width:2px
    style E fill:#lightgrey,stroke:#333,stroke-width:2px
    style M fill:#ccf,stroke:#333,stroke-width:2px
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
- [ ] **T1.5: Basic CLI for DDL Output:**
  - Command to output generated DDL for a specified dialect.

### Phase 2: Query Building & Execution (Read Operations)

- [ ] **T2.1: Basic Query Builder API:**
  - Implement `select().from().where()` structure.
- [ ] **T2.2: PostgreSQL DML Generator (SELECT):**
  - Translate query builder AST to PostgreSQL `SELECT` statements.
- [ ] **T2.3: Spanner DML Generator (SELECT):**
  - Translate query builder AST to Spanner `SELECT` statements.
- [ ] **T2.4: Database Adapters (Initial):**
  - PostgreSQL adapter (for `pg`/`postgres.js`).
  - Spanner adapter (for `@google-cloud/spanner`).
  - Pglite adapter.
- [ ] **T2.5: `sql` Tag Function for Raw Queries.**

### Phase 3: Advanced Schema Features & DML (Write Operations)

- [ ] **T3.1: Advanced Column Types & Constraints:**
  - Foreign keys (`references()`, `onDelete`).
  - Spanner-specific features (e.g., `INTERLEAVE IN PARENT`).
  - Enhanced default value functions (`.$defaultFn()`).
- [ ] **T3.2: Query Builder Enhancements (Writes):**
  - Implement `insert()`, `update()`, `deleteFrom()`.
- [ ] **T3.3: DML Generators (INSERT, UPDATE, DELETE):**
  - Extend SQL generators for write operations.
- [ ] **T3.4: Transaction Support API.**

### Phase 4: Migration Engine

- [ ] **T4.1: Schema Snapshotting/Introspection.**
- [ ] **T4.2: Schema Diffing Logic.**
- [ ] **T4.3: Migration File Generation (DDL for both dialects).**

  - This engine will be responsible for generating the full set of DDL statements to align the database schema with the defined models.
  - For Spanner, this will include generating `CREATE UNIQUE INDEX` statements for any columns or sets of columns marked with `unique()` or `uniqueIndex()` in the schema definition.

  - Similarly, for PostgreSQL, if we decide to use `CREATE UNIQUE INDEX` for all unique constraints (for consistency or for features not available in inline constraints), the migration engine would handle that. It would also handle non-unique indexes (`CREATE INDEX`) for both dialects.

  - This also applies to other DDL like `ALTER TABLE` for adding/removing columns, constraints, etc.

- [ ] **T4.4: Migration CLI (`migrate latest`, `migrate down`, `migrate create`).**
- [ ] **T4.5: Migration Tracking Table.**

### Phase 5: Advanced Features & Polish

- [ ] **T5.1: Advanced Querying:** Joins, aggregations, grouping, ordering, pagination.
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

_(To be added once initial functionality is available)_

## Usage Examples

_(To be added once initial functionality is available)_

---

_This project is under active development._
