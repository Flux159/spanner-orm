I'm writing an orm layer for postgres and spanner since that doesn't exist for node.js / bun. Specifically I have a couple of requirements (you should also update the readme with the requirements to market it correctly):

- Supports both postgres & google spanner with a single object model
- Produces migrations for both postgres & spanner that can be run via a migrate command or via cli
- Can build queries with query builder or fallback to SQL
- Supports Google SQL as the dialect for Spanner while using almost equivalent SQL for Postgres / Pglite. Allowing users to use postgres for non-spanner deployments, pglite for local dev builds or applications where the user will run the app locally, and spanner for global scale web apps.

The object model should look like drizzle where we can compose objects in SQL

import {
pgTable,
text,
timestamp,
varchar,
boolean,
uniqueIndex,
integer,
primaryKey,
jsonb, // Added for JSONB type
index, // Added for non-unique indexes
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm"; // For sql.raw and default values
import crypto from "crypto"; // For crypto.randomUUID()

import {
baseModel,
permissibleResource,
timestamps,
ownableResource,
// @ts-ignore
} from "./sharedSchemas";

// --- Existing Tables (with potential modifications) ---

// Uploads table - uses permissibleResource as uploads are owned by users
// @ts-ignore
export const uploads = pgTable("uploads", {
...permissibleResource, // Includes id, createdAt, updatedAt, userId (uploader), visibility
gcsObjectName: text("gcs_object_name").notNull(), // Full path in GCS, e.g., uploads/userid/uuid-filename.jpg
fileName: text("file_name").notNull(), // Original file name
fileType: text("file_type").notNull(), // General type: 'image', 'audio', 'video', 'document', etc.
mimeType: text("mime_type").notNull(), // Specific MIME type, e.g., 'image/jpeg', 'application/pdf'
size: integer("size").notNull(), // File size in bytes
});

And use shared properties

import { sql } from "drizzle-orm";
import { timestamp, varchar } from "drizzle-orm/pg-core"; // Removed pgEnum

// @ts-ignore
import { users } from "./schema"; // Assuming your users table is exported from schema.ts
// @ts-ignore
import type { VisibilityStatus } from "../../helpers/shared/constants"; // Import the type for $type assertion

// Common timestamp fields
export const timestamps = {
createdAt: timestamp("created_at", { withTimezone: true })
.default(sql`CURRENT_TIMESTAMP`)
.notNull(),
updatedAt: timestamp("updated_at", { withTimezone: true })
.default(sql`CURRENT_TIMESTAMP`)
.notNull(),
// .$onUpdate(() => new Date()) // Drizzle ORM way to auto-update timestamp if supported by your adapter/driver
};

// Base model with ID and timestamps
export const baseModel = {
// id: uuid("id").defaultRandom().primaryKey(),
id: varchar("id", { length: 36 })
.$defaultFn(() => crypto.randomUUID())
.primaryKey(), // Using varchar for UUID
...timestamps,
};

// For resources that are owned by a user
export const ownableResource: any = {
...baseModel,
userId: varchar("user_id")
.notNull()
// @ts-ignore
.references(() => users.id, { onDelete: "cascade" }), // Assuming users.id is uuid
};

// For resources that have visibility permissions
export const permissibleResource: any = {
...ownableResource,
visibility: varchar("visibility", { length: 10 }) // e.g., 'private', 'shared', 'public'
.default("private")
.notNull()
.$type<VisibilityStatus>(), // Enforce type at application level
};

The SQL generated will need to support both postgres & Spanner (Spanner's dialect is distinctly different for the DDL & Data manipulation sql so it will use the objects and then generate sql). We have a strategy in our README to approach this project.

We have a strategy in our README to approach this project.

CHANGE FROM HERE DEPENDING ON NEXT TASK IN CLINE:

We are finishing up Phase 5. We also have a file in notes/GoogleSQLSpanner.md that you should read. You are continuing work from another AI agent, here is what they said to continue with:
