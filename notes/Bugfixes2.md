After trying to generate migration files with this schema:

```javascript
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
} from "spanner-orm";

export const users = table("users", {
  id: uuid("id").primaryKey(), // Using the new uuid helper
  email: text("email").notNull().unique(),
  name: text("name"),
  // ... other user fields
});

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
    .references(() => users.columns.id, { onDelete: "cascade" }),
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
      index({ columns: [t.fileType.name] }), // Example non-unique index
      uniqueIndex({ name: "uq_gcs_object", columns: [t.gcsObjectName.name] }), // Example unique index
    ],
  })
);

```

We got back migrations & they looked like this for postgres:

```javascript
// Migration file for postgres
// Generated at 2025-05-22T03:36:14.352Z

import type { MigrationExecutor, Dialect } from "spanner-orm"; // Adjust path as needed

export const up: MigrationExecutor = async (executeSql, currentDialect) => {
  if (currentDialect === "postgres") {
    await executeSql(`CREATE TABLE "uploads" (
  "id" UUID NOT NULL PRIMARY KEY,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "user_id" UUID NOT NULL,
  "visibility" VARCHAR(10) NOT NULL DEFAULT 'private',
  "gcs_object_name" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_type" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "is_processed" BOOLEAN DEFAULT false,
  "metadata" JSONB,
  CONSTRAINT "uq_gcs_object" UNIQUE ("gcs_object_name")
);`);
    await executeSql(
      `ALTER TABLE "uploads" ADD CONSTRAINT "fk_uploads_userId_users" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE;`
    );
    await executeSql(
      `CREATE INDEX "idx_uploads_file_type" ON "uploads" ("file_type");`
    );
    await executeSql(`CREATE TABLE "users" (
  "id" UUID NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT
);`);
    console.log("Applying UP migration for postgres...");
  }
};

export const down: MigrationExecutor = async (executeSql, currentDialect) => {
  if (currentDialect === "postgres") {
    await executeSql(`DROP TABLE "uploads";`);
    await executeSql(`DROP TABLE "users";`);
    console.log("Applying DOWN migration for postgres...");
  }
};
```

And this for spanner:

```javascript
// Migration file for spanner
// Generated at 2025-05-22T03:36:14.353Z

import type { MigrationExecutor, Dialect } from "spanner-orm"; // Adjust path as needed

export const up: MigrationExecutor = async (executeSql, currentDialect) => {
  if (currentDialect === "spanner") {
    // --- Batch 1 ---
    await executeSql(`CREATE TABLE uploads (
  id STRING(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
  updated_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
  user_id STRING(36) NOT NULL,
  visibility STRING(10) NOT NULL DEFAULT ('private'),
  gcs_object_name STRING(MAX) NOT NULL,
  file_name STRING(MAX) NOT NULL,
  file_type STRING(MAX) NOT NULL,
  mime_type STRING(MAX) NOT NULL,
  size INT64 NOT NULL,
  is_processed BOOL DEFAULT (FALSE),
  metadata JSON
) PRIMARY KEY (id)`);
    // --- Batch 2 ---
    await executeSql(
      `CREATE INDEX idx_uploads_file_type ON uploads (file_type)`
    );
    await executeSql(
      `CREATE UNIQUE INDEX uq_gcs_object ON uploads (gcs_object_name)`
    );
    await executeSql(
      `ALTER TABLE uploads ADD CONSTRAINT FK_uploads_userId_users FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE`
    );
    // --- Batch 3 ---
    await executeSql(`CREATE TABLE users (
  id STRING(36) NOT NULL,
  email STRING(MAX) NOT NULL,
  name STRING(MAX)
) PRIMARY KEY (id)`);
    // --- Batch 4 ---
    await executeSql(`CREATE UNIQUE INDEX uq_users_email ON users (email)`);
    console.log("Applying UP migration for spanner...");
  }
};

export const down: MigrationExecutor = async (executeSql, currentDialect) => {
  if (currentDialect === "spanner") {
    await executeSql(`DROP TABLE uploads`);
    await executeSql(`DROP TABLE users`);
    console.log("Applying DOWN migration for spanner...");
  }
};
```

I ran into this error however:

bunx spanner-orm-cli migrate create add-posts-table --schema ./src/schema.ts  
(node:28279) ExperimentalWarning: Type Stripping is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
No previous schema snapshot found. Assuming this is the first migration.
Created postgres migration file: spanner-orm-migrations/20250522033614-add-posts-table.pg.ts
Created spanner migration file: spanner-orm-migrations/20250522033614-add-posts-table.spanner.ts
Successfully saved current schema snapshot to spanner-orm-migrations/latest.snapshot.json
suyogsonwalkar@Suyogs-MacBook-Pro:~/Projects/sptest$ ls spanner-orm-migrations
20250522033614-add-posts-table.pg.ts
20250522033614-add-posts-table.spanner.ts
latest.snapshot.json
suyogsonwalkar@Suyogs-MacBook-Pro:~/Projects/sptest$ DB_DIALECT=postgres DATABASE_URL=./spannerorgpglite.db npx spanner-orm-cli migrate latest --schema ./src/schema.ts
Connecting to postgres...
PGlite adapter initialized and ready.
Successfully connected to postgres.
Starting 'migrate latest' for dialect: postgres using schema: ./src/schema.ts
Ensuring migration tracking table '\_spanner_orm_migrations_log' exists...
Migration tracking table check complete.
Applied migrations: None
Found 1 pending migrations: [ '20250522033614-add-posts-table.pg.ts' ]
Applying migration: 20250522033614-add-posts-table.pg.ts...
Error executing command with Pglite adapter: error: relation "users" does not exist
at ye.Ve (file:///Users/suyogsonwalkar/Projects/sptest/node_modules/@electric-sql/pglite/dist/chunk-7PRRATDV.js:1:17602)
at ye.nt (file:///Users/suyogsonwalkar/Projects/sptest/node_modules/@electric-sql/pglite/dist/chunk-7PRRATDV.js:1:14988)
at ye.parse (file:///Users/suyogsonwalkar/Projects/sptest/node_modules/@electric-sql/pglite/dist/chunk-7PRRATDV.js:1:13740)
at Ae.execProtocol (file:///Users/suyogsonwalkar/Projects/sptest/node_modules/@electric-sql/pglite/dist/index.js:16:71096)
at async Ae.l (file:///Users/suyogsonwalkar/Projects/sptest/node_modules/@electric-sql/pglite/dist/chunk-TGYMLQND.js:8:1911)
at async file:///Users/suyogsonwalkar/Projects/sptest/node_modules/@electric-sql/pglite/dist/chunk-TGYMLQND.js:8:2539 {
length: 103,
severity: 'ERROR',
code: '42P01',
detail: undefined,
hint: undefined,
position: undefined,
internalPosition: undefined,
internalQuery: undefined,
where: undefined,
schema: undefined,
table: undefined,
column: undefined,
dataType: undefined,
constraint: undefined,
file: 'namespace.c',
line: '639',
routine: 'RangeVarGetRelidExtended'
}
Failed to apply migration 20250522033614-add-posts-table.pg.ts: error: relation "users" does not exist
at ye.Ve (file:///Users/suyogsonwalkar/Projects/sptest/node_modules/@electric-sql/pglite/dist/chunk-7PRRATDV.js:1:17602)
at ye.nt (file:///Users/suyogsonwalkar/Projects/sptest/node_modules/@electric-sql/pglite/dist/chunk-7PRRATDV.js:1:14988)
at ye.parse (file:///Users/suyogsonwalkar/Projects/sptest/node_modules/@electric-sql/pglite/dist/chunk-7PRRATDV.js:1:13740)
at Ae.execProtocol (file:///Users/suyogsonwalkar/Projects/sptest/node_modules/@electric-sql/pglite/dist/index.js:16:71096)
at async Ae.l (file:///Users/suyogsonwalkar/Projects/sptest/node_modules/@electric-sql/pglite/dist/chunk-TGYMLQND.js:8:1911)
at async file:///Users/suyogsonwalkar/Projects/sptest/node_modules/@electric-sql/pglite/dist/chunk-TGYMLQND.js:8:2539 {
length: 103,
severity: 'ERROR',
code: '42P01',
detail: undefined,
hint: undefined,
position: undefined,
internalPosition: undefined,
internalQuery: undefined,
where: undefined,
schema: undefined,
table: undefined,
column: undefined,
dataType: undefined,
constraint: undefined,
file: 'namespace.c',
line: '639',
routine: 'RangeVarGetRelidExtended'
}
Migration process halted due to error.
npm notice
npm notice New major version of npm available! 10.9.2 -> 11.4.1
npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.4.1
npm notice To update run: npm install -g npm@11.4.1
npm notice

---

As you can see, the order of creation operations is incorrect - we try to add the foreign key before the other table is created. We need to order our migrations correctly - for both spanner & postgres.
