// test/schema.test.ts
import { describe, it, expect } from "vitest";
import crypto from "node:crypto"; // Import crypto
import {
  table,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  sql,
  index,
  uniqueIndex,
} from "../src/core/schema.js"; // Note .js extension
import type { InferModelType } from "../src/types/common.js"; // Note .js extension, removed TableConfig

describe("Schema Builder", () => {
  it("should define a basic table with various column types", () => {
    const users = table(
      "users",
      {
        id: varchar("id", { length: 36 }).primaryKey(),
        email: text("email").notNull().unique(),
        bio: text("bio"),
        age: integer("age").default(0),
        isAdmin: boolean("is_admin").default(false),
        settings: jsonb("settings"),
        lastLogin: timestamp("last_login").default(sql`CURRENT_TIMESTAMP`),
        apiKey: varchar("api_key", { length: 64 }),
      },
      (_t) => ({
        // Prefixed t with _
        indexes: [
          index({ name: "idx_age", columns: ["age"] }),
          uniqueIndex({ name: "uq_api_key", columns: ["api_key"] }),
        ],
      })
    );

    expect(users.tableName).toBe("users");

    // Check id column
    expect(users.columns.id.name).toBe("id");
    expect(users.columns.id.type).toBe("varchar");
    expect(users.columns.id.dialectTypes.postgres).toBe("VARCHAR(36)");
    expect(users.columns.id.dialectTypes.spanner).toBe("STRING(36)");
    expect(users.columns.id.primaryKey).toBe(true);

    // Check email column
    expect(users.columns.email.name).toBe("email");
    expect(users.columns.email.type).toBe("text");
    expect(users.columns.email.dialectTypes.postgres).toBe("TEXT");
    expect(users.columns.email.dialectTypes.spanner).toBe("STRING(MAX)"); // Text maps to STRING(MAX) for Spanner
    expect(users.columns.email.notNull).toBe(true);
    expect(users.columns.email.unique).toBe(true);

    // Check age column
    expect(users.columns.age.name).toBe("age");
    expect(users.columns.age.type).toBe("integer");
    expect(users.columns.age.dialectTypes.postgres).toBe("INTEGER");
    expect(users.columns.age.dialectTypes.spanner).toBe("INT64");
    expect(users.columns.age.default).toBe(0);

    // Check isAdmin column
    expect(users.columns.isAdmin.name).toBe("is_admin");
    expect(users.columns.isAdmin.type).toBe("boolean");
    expect(users.columns.isAdmin.dialectTypes.postgres).toBe("BOOLEAN");
    expect(users.columns.isAdmin.dialectTypes.spanner).toBe("BOOL");
    expect(users.columns.isAdmin.default).toBe(false);

    // Check settings column
    expect(users.columns.settings.name).toBe("settings");
    expect(users.columns.settings.type).toBe("jsonb");
    expect(users.columns.settings.dialectTypes.postgres).toBe("JSONB");
    expect(users.columns.settings.dialectTypes.spanner).toBe("JSON");

    // Check lastLogin column
    expect(users.columns.lastLogin.name).toBe("last_login");
    expect(users.columns.lastLogin.type).toBe("timestamp");
    expect(users.columns.lastLogin.dialectTypes.postgres).toBe(
      "TIMESTAMP WITH TIME ZONE"
    );
    expect(users.columns.lastLogin.dialectTypes.spanner).toBe("TIMESTAMP");
    // Check that it's an SQL object and its SQL string is correct
    const lastLoginDefault = users.columns.lastLogin.default as any; // Cast to any to access _isSQL
    expect(lastLoginDefault).toBeDefined();
    expect(lastLoginDefault._isSQL).toBe(true);
    expect(lastLoginDefault.toSqlString("postgres")).toBe("CURRENT_TIMESTAMP");
    expect(lastLoginDefault.toSqlString("spanner")).toBe("CURRENT_TIMESTAMP");

    // Check apiKey column (varchar without explicit length for spanner should be MAX)
    const posts = table("posts", {
      content: text("content"),
      authorId: varchar("author_id").notNull(), // No length
    });
    expect(posts.columns.authorId.dialectTypes.postgres).toBe("VARCHAR");
    expect(posts.columns.authorId.dialectTypes.spanner).toBe("STRING(MAX)");

    // Check indexes
    expect(users.tableIndexes).toBeDefined();
    expect(users.tableIndexes?.length).toBe(2);
    if (users.tableIndexes) {
      expect(users.tableIndexes[0].name).toBe("idx_age");
      expect(users.tableIndexes[0].columns).toEqual(["age"]);
      expect(users.tableIndexes[0].unique).toBe(false);

      expect(users.tableIndexes[1].name).toBe("uq_api_key");
      expect(users.tableIndexes[1].columns).toEqual(["api_key"]);
      expect(users.tableIndexes[1].unique).toBe(true);
    }

    // Test type inference (compile-time check, but good to have a placeholder)
    type User = InferModelType<typeof users>;
    const userInstance: User = {
      id: "uuid-string",
      email: "test@example.com",
      bio: "A bio", // Can be null if not .notNull()
      age: 30,
      isAdmin: true,
      settings: { theme: "dark" },
      lastLogin: new Date(),
      apiKey: "secretkey",
    };
    expect(userInstance.email).toBe("test@example.com");
  });

  it("should handle table definition without extra config", () => {
    const simpleTable = table("simple", {
      name: text("name").notNull(),
    });
    expect(simpleTable.tableName).toBe("simple");
    expect(simpleTable.columns.name.notNull).toBe(true);
    expect(simpleTable.tableIndexes).toBeUndefined();
  });

  it("should correctly build a varchar without length for Spanner (STRING(MAX))", () => {
    const comments = table("comments", {
      commentText: varchar("comment_text"), // No length specified
    });
    expect(comments.columns.commentText.dialectTypes.postgres).toBe("VARCHAR"); // PG default
    expect(comments.columns.commentText.dialectTypes.spanner).toBe(
      "STRING(MAX)"
    );
  });

  it("should allow .$defaultFn for dynamic defaults", () => {
    const items = table("items", {
      id: varchar("id")
        .$defaultFn(() => crypto.randomUUID())
        .primaryKey(),
      createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    });

    const idDefault = items.columns.id.default;
    expect(typeof idDefault).toBe("function");
    if (typeof idDefault === "function") {
      // Vitest doesn't easily allow mocking crypto.randomUUID here without more setup
      // So we just check it's a function and it returns a string of typical UUID length
      const uuid = idDefault();
      expect(typeof uuid).toBe("string");
      expect(uuid.length).toBe(36); // Standard UUID length
    }

    const createdAtDefault = items.columns.createdAt.default;
    expect(typeof createdAtDefault).toBe("function");
    if (typeof createdAtDefault === "function") {
      expect(createdAtDefault()).toBeInstanceOf(Date);
    }
  });

  it("should define foreign keys with onDelete actions", () => {
    const authors = table("authors", {
      id: integer("id").primaryKey(),
      name: text("name").notNull(),
    });

    const books = table("books", {
      id: integer("id").primaryKey(),
      title: text("title").notNull(),
      authorId: integer("author_id").references(() => authors.columns.id, {
        onDelete: "cascade",
      }),
      coAuthorId: integer("co_author_id").references(() => authors.columns.id, {
        onDelete: "set null",
      }),
    });

    expect(books.columns.authorId.references).toBeDefined();
    expect(books.columns.authorId.references?.onDelete).toBe("cascade");
    // Check that the referencesFn points to the correct column config
    // This is a bit tricky to test directly without invoking it in a context where _tableName is set
    // But we can check if the function exists
    expect(typeof books.columns.authorId.references?.referencesFn).toBe(
      "function"
    );

    // To properly test referencesFn, we'd need to simulate table building or inspect DDL generation
    // For now, we assume if the function is set and onDelete is correct, it's wired up.
    // A more robust test would be in DDL generation tests.
    const referencedAuthorColumn =
      books.columns.authorId.references?.referencesFn();
    expect(referencedAuthorColumn?.name).toBe("id");
    // referencedAuthorColumn._tableName would be 'authors' after DDL processing

    expect(books.columns.coAuthorId.references).toBeDefined();
    expect(books.columns.coAuthorId.references?.onDelete).toBe("set null");
  });

  it("should define composite primary keys", () => {
    const orderItems = table(
      "order_items",
      {
        orderId: integer("order_id"),
        productId: integer("product_id"),
        quantity: integer("quantity").notNull(),
      },
      () => ({
        primaryKey: { columns: ["orderId", "productId"] },
      })
    );

    expect(orderItems.compositePrimaryKey).toBeDefined();
    expect(orderItems.compositePrimaryKey?.columns).toEqual([
      "orderId",
      "productId",
    ]);
    // Ensure individual columns are not marked as PK
    expect(orderItems.columns.orderId.primaryKey).toBeUndefined();
    expect(orderItems.columns.productId.primaryKey).toBeUndefined();
  });

  it("should throw an error if both composite and individual primary keys are defined", () => {
    expect(() =>
      table(
        "conflicting_pk",
        {
          id: integer("id").primaryKey(), // Individual PK
          keyPart: text("key_part"),
        },
        () => ({
          primaryKey: { columns: ["id", "keyPart"] }, // Composite PK
        })
      )
    ).toThrow(
      'Table "conflicting_pk" cannot have both a composite primary key and individual column primary keys (id).'
    );
  });

  it("should define Spanner INTERLEAVE IN PARENT", () => {
    const parentTable = table("parent_table", {
      parentId: integer("parent_id").primaryKey(),
    });

    const childTable = table(
      "child_table",
      {
        parentId: integer("parent_id"), // Part of child's PK, references parent
        childId: integer("child_id"),
        data: text("data"),
      },
      (_t) => ({
        primaryKey: { columns: ["parentId", "childId"] },
        interleave: {
          parentTable: parentTable.tableName, // or just "parent_table"
          onDelete: "cascade",
        },
      })
    );

    expect(childTable.interleave).toBeDefined();
    expect(childTable.interleave?.parentTable).toBe("parent_table");
    expect(childTable.interleave?.onDelete).toBe("cascade");
  });
});
