Project Roadmap that was in Readme during development.

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
  - [x] **T5.2.2: Simple Eager Loading (One Level Deep):** Implement fetching of directly related data (e.g., user's posts). Start with one-to-many. (SQL generation complete; result shaping and full type safety pending).
    - [x] The advanced TypeScript type safety for the shaped results remains a future enhancement for T5.2.2.
  - [x] **T5.2.3: Fluent Join API based on Schema Relations:** Enable joins based on pre-defined schema relations for a more ORM-like experience.
- [x] **T5.3: Performance Optimizations (e.g., batching for Spanner).**
  - [x] Implemented selective DDL batching for Spanner, grouping validating DDLs (e.g., CREATE INDEX, ALTER TABLE ADD/ALTER COLUMN, ADD FOREIGN KEY) into batches of up to 5.
- [~] **T5.4: Comprehensive Documentation & Examples.** (Ongoing - README updates are part of this, docusaurus is also part of this).
- [~] **T5.5: Robust Testing Suite (unit & integration tests).** (Ongoing - Unit tests have been added for current features features, but new features will need more unit tests).
- [~] **T5.6: Setup Docusaurus Documentation:** Implement Docusaurus for comprehensive, versioned documentation, deployable to GitHub Pages. Started, but need to add comprehensive docs.
- [x] **T5.7: Incremental Migration Generation:** Enhance `migrate create` to generate migrations based on the difference between the last applied schema state and the current schema definition, rather than always from an empty schema. This involves:
  - Storing a snapshot of the schema after each migration generation (e.g., `latest.snapshot.json`).
  - Using this snapshot as the "before" state for the next `migrate create` command.

### Beyond Phase 5: Future Considerations

- **Advanced Dialect-Specific Features:**
  - Support for Google Spanner Graph Queries.
  - Exploration of PostgreSQL extensions for feature parity (e.g., Apache AGE for graph capabilities).
- **Further Performance Enhancements.**
- **Community-Driven Features.**

### Phase 6: Support Basic GQL / Graph DDL Dialect for Interleaved tables

- [x] **T6.1 Implement Graph DDL Dialect for Interleaved Tables**
  - **Description:** GQL (Graph Query Language in Spanner) should be doable with regular SQL, we don't need a fluent API for this right now, just the ability to generate the correct migrations for interleaved tables, then run example GQL via the sql / raw template tags.

### Phase 7: Developer Experience & Fluent API (Future)

- [x] **T7.1: Implement Fluent Database Interaction API (`db` object)**
  - **Description:** Developed a high-level fluent API, exposed as an `OrmClient` (typically used as `db`), that simplifies database interactions. This API wraps the `QueryBuilder` and the `DatabaseAdapter`, allowing users to write chainable queries that are directly `await`-able (thenable) for execution against the database.
  - **Key Features:**
    - Instantiated with a configured `DatabaseAdapter` and `dialect` (e.g., `new OrmClient(adapter, 'postgres')`).
    - Supports `db.select()`, `db.insert()`, `db.update()`, `db.deleteFrom()`, and `db.raw()`.
    - Methods return a chainable and thenable `ExecutableQuery` or `ExecutableRawQuery` object.
    - Seamlessly integrates query building, SQL generation, execution, and (for SELECTs with includes) result shaping.
    - Provides strong TypeScript inference for query results.
    - Includes `db.transaction()` for managing atomic operations.
    - Ensures a consistent API experience across PostgreSQL, Pglite, and Spanner.
  - **Impact:** Greatly improves the developer experience by providing a more intuitive and common ORM interaction pattern.
