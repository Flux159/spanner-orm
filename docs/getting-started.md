---
id: getting-started
title: Getting Started
---

Welcome to Spanner-ORM! This guide will help you get up and running.

## Overview

`spanner-orm` is a TypeScript ORM for Google Spanner & PostgreSQL, designed for Node.js and Bun. Inspired by Drizzle ORM, `spanner-orm` aims to provide a single, elegant object model for defining your schema and querying your data across both database systems.

## Key Design Goals

`spanner-orm` is built to meet the following key requirements for modern, flexible database development:

- **Unified Schema:** Supports both PostgreSQL & Google Spanner with a single, Drizzle-inspired object model.
- **Automated Migrations:** Produces and manages migrations for both PostgreSQL & Spanner, executable via CLI or programmatically.
- **Versatile Querying:** Offers a powerful query builder with the ability to fall back to raw SQL when needed.
- **Dialect-Optimized SQL:** Generates Google SQL for Spanner and near-equivalent, standard SQL for PostgreSQL/Pglite, enabling seamless transitions between local development (Pglite), traditional deployments (PostgreSQL), and global-scale applications (Spanner).

## Why spanner-orm?

In today's diverse application landscape, developers often need to target multiple database backends. You might start with Pglite for rapid prototyping or local-first applications, move to PostgreSQL for self-hosted or managed deployments, and eventually require the massive scalability and global consistency of Google Spanner. `spanner-orm` addresses the critical challenge of managing data models and queries across these different systems without rewriting your data access layer.

Currently, the Node.js/Bun ecosystem lacks a dedicated ORM that elegantly bridges PostgreSQL and Google Spanner with a single, consistent object model and a unified migration strategy. `spanner-orm` fills this gap by:

- **Enabling a Single Codebase:** Define your schema and write your queries once. `spanner-orm` handles the dialect-specific SQL generation.
- **Streamlining Development & Deployment:** Simplify the transition between local development (Pglite/Postgres), testing, and production environments (Spanner or Postgres).
- **Reducing Complexity:** Abstract away the differences between Google SQL and PostgreSQL DDL/DML where possible, while still allowing access to dialect-specific features when needed.
- **Providing a Productive API:** Offer a familiar and productive Drizzle-inspired API that TypeScript developers will appreciate.

## Installation

1.  **Install `spanner-orm`:**

    ```bash
    # (Once published to npm)
    # npm install spanner-orm
    # bun install spanner-orm
    # yarn add spanner-orm

    # For now, clone and build locally:
    git clone https://github.com/flux159/spanner-orm.git # Updated repo
    cd spanner-orm
    bun install
    bun run build
    ```

## Defining Your Schema

Create a `schema.ts` (or similar) file. `spanner-orm` allows you to define your data model in a way that's familiar to Drizzle ORM users, emphasizing composability and type safety.

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
} from "spanner-orm"; // Adjust import path as per your project structure

// --- Define a placeholder 'users' table for demonstrating references ---
export const users = table("users", {
  id: uuid("id").primaryKey(),
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
  id: uuid("id").primaryKey(),
  ...timestamps,
};

// For resources that are owned by a user
export const ownableResource = {
  ...baseModel,
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
};

// For resources that have visibility permissions
type VisibilityStatus = "private" | "shared" | "public"; // Example type for visibility

export const permissibleResource = {
  ...ownableResource,
  visibility: varchar("visibility", { length: 10 })
    .default("private")
    .notNull()
    .$type<VisibilityStatus>(),
};

// --- Example Table: Uploads (using shared components) ---
export const uploads = table(
  "uploads",
  {
    ...permissibleResource,
    gcsObjectName: text("gcs_object_name").notNull(),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    isProcessed: boolean("is_processed").default(false),
    metadata: jsonb("metadata"),
  },
  (t) => ({
    indexes: [
      index({ columns: [t.fileType] }),
      uniqueIndex({ name: "uq_gcs_object", columns: [t.gcsObjectName] }),
    ],
  })
);
```

For more detailed information on schema definition, querying, and migrations, please refer to the specific sections in this documentation.
