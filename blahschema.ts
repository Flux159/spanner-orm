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
} from "./dist/index.js"; // Adjust import path as per your project structure
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
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`) // Use backticks for sql template literal
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`) // Use backticks for sql template literal
    .notNull(),
};

// Base model with ID (using uuid helper) and timestamps
const baseModel = {
  id: uuid("id").primaryKey(), // Automatically uses $defaultFn(() => crypto.randomUUID())
  ...timestamps,
};

// For resources that are owned by a user
const ownableResource = {
  ...baseModel,
  userId: uuid("user_id") // Assuming user_id is also a UUID
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
};

// For resources that have visibility permissions
type VisibilityStatus = "private" | "shared" | "public"; // Example type for visibility

const permissibleResource = {
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

export const posts = table("posts", {
  ...permissibleResource, // Includes id, createdAt, updatedAt, userId, visibility
  title: text("title").notNull(),
  content: text("content").notNull(),
});
