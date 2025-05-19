For T5.0 (Integrate Database Adapters into Migration CLI), how should the CLI determine database connection details (e.g., connection string, project/instance/database IDs)? Please choose one of the following, or suggest an alternative:

1. Environment Variables (e.g., DB_DIALECT, DB_CONNECTION_STRING, SPANNER_PROJECT_ID)
2. A dedicated configuration file (e.g., spanner-orm.config.json)
3. Additional CLI options for each command (`migrate latest`, `migrate down`)

Environment variables are the right way - DB_DIALECT, DATABASE_URL (for postgres & pglite - pglite can use file paths here, relative or absolute - anything without "postgres://" would be pglite instead of connection to server), SPANNER needs PROJECT_ID, SPANNER_DATABASE_NAME, and SPANNER_INSTANCE_ID I think

Okay, we'll use environment variables for database connection configuration. Here's the plan:

**Environment Variables:**

- `DB_DIALECT`: `"postgres"` or `"spanner"` (this will determine which adapter to use and which set of subsequent variables to check).

- `DATABASE_URL`: For PostgreSQL and PGlite.

  - If it starts with `postgres://` or `postgresql://`, it's a PostgreSQL connection string.
  - Otherwise, it's treated as a file path for PGlite (can be relative or absolute).

- `SPANNER_PROJECT_ID`: For Spanner.

- `SPANNER_INSTANCE_ID`: For Spanner.

- `SPANNER_DATABASE_ID`: For Spanner (you mentioned `SPANNER_DATABASE_NAME`, but the Spanner adapter constructor uses `databaseId`. I'll stick to `SPANNER_DATABASE_ID` for consistency with the adapter, unless you prefer to change the adapter).

**Implementation Steps in `src/cli.ts`:**

1. **Create an Adapter Factory Function:**

   - A new function, e.g., `async function getDatabaseAdapter(): Promise<DatabaseAdapter | null>`, will be created.

   - This function will:

     - Read `process.env.DB_DIALECT`.

     - Based on the dialect:

       - If `"postgres"`:

         - Read `process.env.DATABASE_URL`.
         - If `DATABASE_URL` starts with `postgres://` or `postgresql://`, instantiate and return `ConcretePgAdapter`.
         - Else, instantiate and return `ConcretePgliteAdapter` using `DATABASE_URL` as the `dataDir`.

       - If `"spanner"`:

         - Read `process.env.SPANNER_PROJECT_ID`, `process.env.SPANNER_INSTANCE_ID`, `process.env.SPANNER_DATABASE_ID`.
         - Instantiate and return `ConcreteSpannerAdapter`.

       - If dialect is missing or unsupported, or required env vars for the dialect are missing, log an error and return `null` (or throw an error).

   - This function will also call `adapter.connect()` and return the connected adapter.

2. **Update `handleMigrateLatest` and `handleMigrateDown`:**

   - Call `getDatabaseAdapter()` at the beginning.
   - If it returns `null` (due to config errors), exit the command.
   - Replace the placeholder `executeCmdSql` with `adapter.execute.bind(adapter)`.
   - Replace the placeholder `queryRowsSql` with `adapter.query.bind(adapter)`.
   - Ensure `adapter.disconnect()` is called in a `finally` block.
   - The `--dialect` CLI option for `migrate latest` and `migrate down` will now be _validated against_ `DB_DIALECT` if both are present, or `DB_DIALECT` will be the source of truth if the CLI option is removed. For simplicity, let's make `DB_DIALECT` the primary source and remove the `--dialect` option from these two commands, as the environment should dictate the target database. The `--schema` option will still be needed.
