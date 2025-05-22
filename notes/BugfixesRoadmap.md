## Bug fixes in initial releases

- v0.0.1 - FIXED [x] type files .d.ts were not built with package. Updated tsconfig.json to fix & republished v0.0.2.
- v0.0.2 - Generated DDL for postgres & spanner has some bugs, for the schema directly in the README.md, it does this:

This is the schema for reference:

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
      uniqueIndex({
        name: "uq_gcs_object",
        columns: [t.gcsObjectName.name],
      }), // Example unique index
    ],
  })
);
```

This is what is generated for postgres using this command `> bunx spanner-orm-cli ddl --schema ./src/schema ts --dialect postgres`:

```sql

Function default for column "id" cannot be directly represented in DDL. Use sql`...` or a literal value.
Function default for column "user_id" cannot be directly represented in DDL. Use sql`...` or a literal value.
Function default for column "id" cannot be directly represented in DDL. Use sql`...` or a literal value.
CREATE TABLE "uploads" (
  "id" UUID NOT NULL PRIMARY KEY,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT '{"_isSQL":true}',
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT '{"_isSQL":true}',
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
);

ALTER TABLE "uploads" ADD CONSTRAINT "fk_uploads_userId_users" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "idx_uploads_file_type" ON "uploads" ("file_type");

CREATE TABLE "users" (
  "id" UUID NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT
);

```

Then for spanner using this command `> bunx spanner-orm-cli ddl --schema ./src/schema.ts --dialect spanner` it generates this:

```sql

Function default for Spanner column "id" cannot be directly represented in DDL.
Function default for Spanner column "user_id" cannot be directly represented in DDL.
Function default for Spanner column "id" cannot be directly represented in DDL.
CREATE TABLE uploads (
  id STRING(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT (JSON '{"_isSQL":true}'),
  updated_at TIMESTAMP NOT NULL DEFAULT (JSON '{"_isSQL":true}'),
  user_id STRING(36) NOT NULL,
  visibility STRING(10) NOT NULL DEFAULT ('private'),
  gcs_object_name STRING(MAX) NOT NULL,
  file_name STRING(MAX) NOT NULL,
  file_type STRING(MAX) NOT NULL,
  mime_type STRING(MAX) NOT NULL,
  size INT64 NOT NULL,
  is_processed BOOL DEFAULT (FALSE),
  metadata JSON
) PRIMARY KEY (id);

CREATE INDEX idx_uploads_file_type ON uploads (file_type);,CREATE UNIQUE INDEX uq_gcs_object ON uploads (gcs_object_name);,ALTER TABLE uploads ADD CONSTRAINT FK_uploads_userId_users FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE;

CREATE TABLE users (
  id STRING(36) NOT NULL,
  email STRING(MAX) NOT NULL,
  name STRING(MAX)
) PRIMARY KEY (id);

CREATE UNIQUE INDEX uq_users_email ON users (email);
```

The issues are:

- [ ] First the warnings around function defaults for id & user_id should not be there. They should be fixed so that you can define those columns as ddl.
- [ ] Both the ddl generations have this `DEFAULT '{"_isSQL":true}'` for the timestamps - that should be default now() or some other function available in postgres / spanner.
- [ ] In the spanner DDL generated, the create index, create unique index, etc. are not on different lines. They should be.
