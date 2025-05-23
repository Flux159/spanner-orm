---
title: "Schema Definition"
weight: 20 # Order within the "Docs" section
---

# Schema Definition in spanner-orm

`spanner-orm` allows you to define your database schema using a TypeScript-based, Drizzle-inspired syntax. This approach emphasizes composability, type safety, and a single source of truth for your data models across both PostgreSQL and Google Spanner.

## Core Concepts

- **Tables**: Defined using the `table` function.
- **Columns**: Defined using specific type functions (e.g., `text`, `varchar`, `integer`, `timestamp`, `boolean`, `jsonb`, `uuid`).
- **Modifiers**: Chainable methods to specify constraints like `.primaryKey()`, `.notNull()`, `.unique()`, `.default()`, `.$defaultFn()`.
- **SQL Helper**: The `sql` template literal tag for embedding raw SQL, often used for default values like "sql\`CURRENT_TIMESTAMP\`".
- **Composability**: Reusable schema components can be created and spread into table definitions.

## Defining Tables and Columns

Here's a basic example of defining a table:

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

// --- Define a placeholder 'users' table for demonstrating references ---
export const users = table("users", {
  id: uuid("id").primaryKey(), // Uses $defaultFn(() => crypto.randomUUID()) internally
  email: text("email").notNull().unique(),
  name: text("name"),
  isActive: boolean("is_active").default(true),
  profile: jsonb("profile"), // For storing JSON data
  age: integer("age"),
  apiKey: varchar("api_key", { length: 64 }).unique(),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});
```

### Column Types

`spanner-orm` provides various column type functions:

- `text(name: string)`: For text of arbitrary length.
- `varchar(name: string, config: { length: number })`: For variable-length strings with a maximum length.
- `integer(name: string)`: For integer numbers.
- `boolean(name: string)`: For true/false values.
- `timestamp(name: string, config?: { withTimezone?: boolean })`: For timestamps.
  - `withTimezone: true` typically maps to `TIMESTAMPTZ` in PostgreSQL.
- `jsonb(name: string)`: For JSON binary data (primarily for PostgreSQL). Spanner uses `JSON` type, and the ORM handles the distinction.
- `uuid(name: string)`: A helper for UUIDs, often configured with a default random UUID generation.
  - Internally, this might use `varchar(36)` or a native `UUID` type depending on the dialect and ORM implementation. It typically sets up `$defaultFn(() => crypto.randomUUID())`.

### Column Modifiers

- `.primaryKey()`: Marks the column as a primary key.
- `.notNull()`: Adds a `NOT NULL` constraint.
- `.unique()`: Adds a `UNIQUE` constraint.
- `.default(value: any)`: Specifies a default value. Use `sql\`...\``for SQL expressions (e.g.,`sql\`CURRENT_TIMESTAMP\``).
- `.$defaultFn(() => value: any)`: Specifies a function to generate a default value at the application level during insert operations (e.g., `.$defaultFn(() => crypto.randomUUID())`). The `uuid()` helper often uses this internally.
- `.$type<TypeName>()`: For TypeScript type assertion at the application level, useful for custom string-based enums or specific data structures within `jsonb` fields.
  ```typescript
  type UserRole = "admin" | "editor" | "viewer";
  // ...
  role: varchar("role", { length: 10 })
    .default("viewer")
    .notNull()
    .$type<UserRole>();
  ```
- `.references(() => otherTable.column, options?: { onDelete?: string, onUpdate?: string })`: Defines a foreign key relationship.
  ```typescript
  // In a 'posts' table definition
  // Assuming 'users' table is defined with an 'id' column
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });
  ```

## Composable Schemas (DRY Principle)

A powerful feature is the ability to define reusable schema components. This is great for common fields like IDs, timestamps, or ownership tracking.

```typescript
// src/lib/sharedSchemas.ts (or similar)
import { timestamp, uuid, varchar, sql } from "spanner-orm";
// Assuming 'users' table is defined elsewhere and imported if needed for references
// import { users } from '../schema'; // Example import

// Common timestamp fields
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
};

// Base model with ID (using uuid helper) and timestamps
export const baseModel = {
  id: uuid("id").primaryKey(),
  ...timestamps,
};

// For resources that are owned by a user
// Make sure 'users' table is defined and its 'id' column is compatible (e.g., uuid)
export const ownableResource = (usersTable: any) => ({
  // Pass users table for reference
  ...baseModel,
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
});

// For resources that have visibility permissions
type VisibilityStatus = "private" | "shared" | "public";

export const permissibleResource = (usersTable: any) => ({
  // Pass users table
  ...ownableResource(usersTable), // Spread and call ownableResource
  visibility: varchar("visibility", { length: 10 })
    .default("private")
    .notNull()
    .$type<VisibilityStatus>(),
});
```

**Using Composable Schemas:**

```typescript
// src/schema.ts
import { table, text, integer, boolean, jsonb } from "spanner-orm"; // Added missing imports
import {
  permissibleResource,
  baseModel,
  timestamps,
} from "./lib/sharedSchemas"; // Adjust path

// First, define the users table as it's referenced
export const users = table("users", {
  ...baseModel, // id, createdAt, updatedAt
  email: text("email").notNull().unique(),
  name: text("name"),
  // ... other user fields
});

// Example from README: Uploads table
export const uploads = table(
  "uploads",
  {
    ...permissibleResource(users), // Includes id, createdAt, updatedAt, userId (uploader), visibility
    gcsObjectName: text("gcs_object_name").notNull(), // Full path in GCS, e.g., uploads/userid/uuid-filename.jpg
    fileName: text("file_name").notNull(), // Original file name
    fileType: text("file_type").notNull(), // General type: 'image', 'audio', 'video', 'document', etc.
    mimeType: text("mime_type").notNull(), // Specific MIME type, e.g., 'image/jpeg', 'application/pdf'
    size: integer("size").notNull(), // File size in bytes
    isProcessed: boolean("is_processed").default(false), // from README
    metadata: jsonb("metadata"), // from README
  },
  (t) => ({
    // Example indexes from README (adjust column access as needed, e.g. t.fileType.name or t.fileType)
    fileTypeIndex: index({ columns: [t.fileType] }),
    gcsObjectNameUniqueIndex: uniqueIndex({
      name: "uq_gcs_object",
      columns: [t.gcsObjectName],
    }),
  })
);
```

_Note: When using composable schemas with references, ensure the referenced table (like `users`) is defined or imported in a way that the reference function (`() => users.id`) can resolve correctly._

## Defining Indexes

You can define indexes within the third argument of the `table` function (a callback that receives the table's columns, often named `t`).

```typescript
// Continuing src/schema.ts example
export const articles = table(
  "articles",
  {
    ...permissibleResource(users), // Assuming 'users' is defined
    title: text("title").notNull(),
    content: text("content"),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
  },
  (t) => ({
    // 't' represents the columns of the 'articles' table
    titleIndex: index({ columns: [t.title] }), // Index on the title column
    slugAndUserIndex: uniqueIndex({
      // A unique composite index
      name: "uq_slug_user", // Optional custom name for the index
      columns: [t.slug, t.userId], // Index on slug and userId
    }),
  })
);
```

- `index({ columns: ColumnDefinition[] })`: Creates a non-unique index.
- `uniqueIndex({ name?: string, columns: ColumnDefinition[] })`: Creates a unique index. The `name` is optional.

`columns` should be an array of column definitions from the current table (e.g., `t.columnName`). The exact way to reference the column within the index definition (e.g., `t.columnName` vs `t.columnName.name`) depends on the ORM's API for column objects passed to this callback. The examples in the README used `t.columnName.name`.

This schema definition system provides a robust and type-safe way to model your data for both PostgreSQL and Spanner, forming the foundation for migrations and queries.
