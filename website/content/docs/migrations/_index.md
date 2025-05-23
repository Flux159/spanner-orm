---
title: "Migrations"
weight: 30 # Order within the "Docs" section
---

# Database Migrations with spanner-orm

`spanner-orm` provides a command-line interface (CLI) to help you manage your database schema evolution across both PostgreSQL and Google Spanner. This includes generating Data Definition Language (DDL) and managing migration files.

## Generating DDL (for inspection or manual use)

If you want to see the DDL that `spanner-orm` would generate for your schema without creating a migration file, you can use the `ddl` command.

```bash
# Ensure your project is built (e.g., bun run build) so the CLI can access your compiled schema.
# The CLI is typically available via a 'bin' script in package.json (e.g., spanner-orm-cli).

# Generate PostgreSQL DDL
npx spanner-orm-cli ddl --schema ./dist/schema.js --dialect postgres

# Generate Spanner DDL
npx spanner-orm-cli ddl --schema ./dist/schema.js --dialect spanner
```

- `--schema`: Path to your compiled schema file (e.g., `schema.js` if you wrote it in TypeScript as `schema.ts`).
- `--dialect`: Specify `postgres` or `spanner`.

This command prints the generated `CREATE TABLE` statements (and other DDL) to standard output. You can redirect this to a file if needed.

**Note for Bun users:** If you're using `bunx`, you might be able to point directly to your TypeScript schema file (`.ts`) without pre-compiling it to JavaScript, if `bunx` handles the on-the-fly TypeScript execution for the CLI.

## Managing Migrations with `spanner-orm-cli migrate`

For a more robust workflow, `spanner-orm` uses a migration system. Migration files are stored in the `./spanner-orm-migrations` directory by default. A `latest.snapshot.json` file in this directory tracks the current state of your schema to help generate subsequent migrations.

### 1. Creating a New Migration File

When you make changes to your `schema.ts` file, you create a new migration to capture these changes.

```bash
# Example: Create a migration file for adding a 'posts' table
# This requires your schema file (e.g., dist/schema.js) to be built and specified.
npx spanner-orm-cli migrate create add-posts-table --schema ./dist/schema.js
```

- `add-posts-table`: A descriptive name for your migration. This will be part of the generated filename.
- `--schema`: Path to your compiled schema file.

This command:

1.  Compares your current schema (from `--schema`) against the last known state (`latest.snapshot.json`).
2.  Generates a new timestamped migration file (e.g., `YYYYMMDDHHMMSS-add-posts-table.ts`) in `./spanner-orm-migrations/`.
3.  This single `.ts` file contains dialect-specific `up` and `down` functions:
    - `migratePostgresUp(db)` and `migratePostgresDown(db)` for PostgreSQL.
    - `migrateSpannerUp(db)` and `migrateSpannerDown(db)` for Spanner.
      These functions will contain the necessary DDL statements.
4.  Updates `latest.snapshot.json` to reflect the new schema state.

You should review the generated migration file to ensure it accurately reflects your intended changes.

### 2. Applying Pending Migrations (`migrate latest`)

To apply all pending migrations to your database:

```bash
# Apply latest migrations
# The command uses environment variables for database connection.
npx spanner-orm-cli migrate latest --schema ./dist/schema.js
```

- `--schema`: Path to your compiled schema file (used to ensure consistency, though the migrations themselves contain the SQL).

**Database Connection via Environment Variables:**

The `migrate latest` (and `migrate down`) command relies on environment variables to connect to your database:

- **`DB_DIALECT`**: Must be set to either `postgres` or `spanner`.
- **For PostgreSQL / PGLite:**
  - `DATABASE_URL`: Your PostgreSQL connection string.
    - Example for PostgreSQL: `postgresql://user:pass@host:port/db`
    - Example for PGLite (file-based): `file:./mydata.db` or just `./mydata.db` (ensure PgliteAdapter handles this)
- **For Google Spanner:**
  - `SPANNER_PROJECT_ID`: Your Google Cloud Project ID.
  - `SPANNER_INSTANCE_ID`: Your Spanner Instance ID.
  - `SPANNER_DATABASE_ID`: Your Spanner Database ID.

**Example Usage:**

```bash
# Example for PostgreSQL:
export DB_DIALECT=postgres
export DATABASE_URL="postgresql://myuser:mypass@localhost:5432/mydb"
npx spanner-orm-cli migrate latest --schema ./dist/schema.js

# Example for PGLite:
export DB_DIALECT=postgres # PGLite uses the postgres dialect
export DATABASE_URL="./spannerormtest.db"
npx spanner-orm-cli migrate latest --schema ./dist/schema.js

# Example for Spanner:
export DB_DIALECT=spanner
export SPANNER_PROJECT_ID=my-gcp-project
export SPANNER_INSTANCE_ID=my-spanner-instance
export SPANNER_DATABASE_ID=my-spanner-database
npx spanner-orm-cli migrate latest --schema ./dist/schema.js
```

The CLI will connect to the specified database and apply any migration files from `./spanner-orm-migrations/` that haven't been applied yet, in chronological order.

### 3. Reverting the Last Applied Migration (`migrate down`)

To revert the most recently applied migration:

```bash
# Revert the last migration (uses the same environment variables for DB connection)
npx spanner-orm-cli migrate down --schema ./dist/schema.js
```

This command will execute the `down` function(s) from the last applied migration file for the specified `DB_DIALECT`.

## Migration Files Content

A generated migration file (`.ts`) will look something like this:

```typescript
// ./spanner-orm-migrations/YYYYMMDDHHMMSS-add-posts-table.ts
import type { MigrationContext } from "spanner-orm"; // Or relevant type import

export async function migratePostgresUp({
  db,
}: MigrationContext): Promise<void> {
  await db.raw(`CREATE TABLE "posts" (...)`);
  // ... other PostgreSQL DDL
}

export async function migratePostgresDown({
  db,
}: MigrationContext): Promise<void> {
  await db.raw(`DROP TABLE "posts"`);
  // ... other PostgreSQL DDL
}

export async function migrateSpannerUp({
  db,
}: MigrationContext): Promise<void> {
  await db.raw(`CREATE TABLE posts (...) PRIMARY KEY (id)`);
  // ... other Spanner DDL
}

export async function migrateSpannerDown({
  db,
}: MigrationContext): Promise<void> {
  await db.raw(`DROP TABLE posts`);
  // ... other Spanner DDL
}
```

The `MigrationContext` typically provides a `db` instance (or similar query executor) that is already configured for the correct dialect and transaction (if applicable).

This system ensures that your schema changes are version-controlled, repeatable, and can be applied consistently across different environments and database dialects.
