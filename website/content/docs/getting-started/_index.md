---
title: "Getting Started"
weight: 10 # Order within the "Docs" section
---

# Getting Started with spanner-orm

This guide will walk you through installing `spanner-orm` and setting up a basic project.

## Installation

You can install `spanner-orm` using your preferred package manager:

**Using NPM:**

```bash
npm install spanner-orm
```

**Or using Bun:**

```bash
bun add spanner-orm
```

### Peer Dependencies

`spanner-orm` relies on peer dependencies for the specific database clients. You'll need to install the ones corresponding to the databases you intend to use:

- For **PostgreSQL**: `pg`
- For **Google Cloud Spanner**: `@google-cloud/spanner`
- For **PGLite** (optional, for local/embedded use): `@electric-sql/pglite`

You can install them like so:

**Using NPM:**

```bash
# Install all, or pick the ones you need:
npm install pg @google-cloud/spanner @electric-sql/pglite
```

**Or using Bun:**

```bash
# Install all, or pick the ones you need:
bun add pg @google-cloud/spanner @electric-sql/pglite
```

## Your First Project: A "Hello World" Example

Let's create a simple example to define a schema, connect to a database (we'll use PGLite for simplicity here), and perform a basic operation.

### 1. Define Your Schema

Create a file named `schema.ts` (e.g., in `src/schema.ts`):

```typescript
// src/schema.ts
import { table, uuid, text, timestamp, sql } from "spanner-orm";

// Common timestamp fields
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`) // Use backticks for sql template literal
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`) // Use backticks for sql template literal
    .notNull(),
};

// Define a simple 'notes' table
export const notes = table("notes", {
  id: uuid("id").primaryKey(), // Automatically uses $defaultFn(() => crypto.randomUUID())
  content: text("content").notNull(),
  ...timestamps,
});
```

### 2. Initialize the Client and Interact with the Database

Create a file, for example `index.ts`:

```typescript
// src/index.ts
import { OrmClient, PgliteAdapter } from "spanner-orm";
import { PGlite } from "@electric-sql/pglite";
import { notes } from "./schema"; // Assuming your schema.ts is in the same directory or adjust path

async function main() {
  // Initialize PGLite (in-memory for this example)
  const pglite = new PGlite();
  const adapter = new PgliteAdapter(pglite); // Use PgliteAdapter

  // Connect the adapter (important for PgliteAdapter)
  // For PgliteAdapter, connect() also runs initial setup like 'CREATE EXTENSION IF NOT EXISTS vector'.
  await adapter.connect();

  const db = new OrmClient(adapter, "postgres"); // 'postgres' is the dialect for PGLite

  console.log("Successfully connected to PGLite!");

  // For PGLite, we might need to manually create the table if not using migrations
  // This is a simplified way for a quick start.
  // NOTE: In a typical workflow, you would generate and run migrations.
  try {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `;
    await db.raw(createTableSQL); // Use db.raw for DDL if db.rawExecute is not available
    console.log("'notes' table checked/created.");
  } catch (error) {
    console.error("Error creating table (it might already exist):", error);
  }

  // Insert a new note
  try {
    const insertResult = await db
      .insert(notes)
      .values({ content: "Hello, spanner-orm!" });
    console.log("Insert Result:", insertResult);

    // Retrieve the note
    const allNotes = await db.select().from(notes);
    console.log("All Notes:", allNotes);

    if (allNotes.length > 0) {
      console.log("First note content:", allNotes[0].content);
    }
  } catch (error) {
    console.error("Error during database operation:", error);
  } finally {
    // Close the adapter connection if necessary
    await adapter.disconnect();
  }
}

main().catch(console.error);
```

### 3. Run Your Example

- Ensure you have `bun` or `ts-node` (or similar) to execute TypeScript files.
- Make sure your `tsconfig.json` is set up appropriately (e.g., `moduleResolution: "node"` or `"bundler"`, `target: "esnext"`).

**Using Bun:**

```bash
bun run src/index.ts
```

This simple example demonstrates the basic workflow: define a schema, initialize a client with an adapter, and perform database operations.

For more complex scenarios, you'll typically use the [Migration tools](./../migrations/) to manage your schema and the [Querying Data](./../querying-data/) guide for more advanced database interactions.
