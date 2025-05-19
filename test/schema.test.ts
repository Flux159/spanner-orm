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

    expect(users.name).toBe("users");

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
    expect(users.columns.lastLogin.default).toEqual({
      sql: "CURRENT_TIMESTAMP",
    });

    // Check apiKey column (varchar without explicit length for spanner should be MAX)
    const posts = table("posts", {
      content: text("content"),
      authorId: varchar("author_id").notNull(), // No length
    });
    expect(posts.columns.authorId.dialectTypes.postgres).toBe("VARCHAR");
    expect(posts.columns.authorId.dialectTypes.spanner).toBe("STRING(MAX)");

    // Check indexes
    expect(users.indexes).toBeDefined();
    expect(users.indexes?.length).toBe(2);
    if (users.indexes) {
      expect(users.indexes[0].name).toBe("idx_age");
      expect(users.indexes[0].columns).toEqual(["age"]);
      expect(users.indexes[0].unique).toBe(false);

      expect(users.indexes[1].name).toBe("uq_api_key");
      expect(users.indexes[1].columns).toEqual(["api_key"]);
      expect(users.indexes[1].unique).toBe(true);
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
    expect(simpleTable.name).toBe("simple");
    expect(simpleTable.columns.name.notNull).toBe(true);
    expect(simpleTable.indexes).toBeUndefined();
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
});
