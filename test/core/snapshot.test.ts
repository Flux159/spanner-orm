// test/core/snapshot.test.ts

import { describe, it, expect } from "vitest";
import {
  table,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  sql,
} from "../../src/core/schema";
import { generateSchemaSnapshot } from "../../src/core/snapshot";
import crypto from "crypto";

describe("generateSchemaSnapshot", () => {
  // Define a more comprehensive schema for testing
  const users = table("users", {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    email: varchar("email", { length: 255 }).notNull().unique(),
    name: text("name").notNull(),
    bio: text("bio"),
    isAdmin: boolean("is_admin").default(false).notNull(),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    jsonData: jsonb("json_data"),
  });

  // Re-defining posts to avoid the error of composite PK + individual PK
  // The table function in schema.ts throws an error if both are present.
  // For the test, we'll define posts with only a composite PK.
  const postsCorrected = table(
    "posts_corrected",
    {
      postId: integer("post_id"), // Not a PK here
      secondaryId: integer("secondary_id"), // Not a PK here
      authorId: varchar("author_id", { length: 36 })
        .notNull()
        .references(() => users.columns.id, { onDelete: "cascade" }),
      title: varchar("title", { length: 200 }).notNull(),
      content: text("content"),
      publishedAt: timestamp("published_at"),
      views: integer("views").default(0),
    },
    (t) => ({
      indexes: [
        index({
          name: "idx_posts_corrected_author",
          columns: [t.authorId.name],
        }),
        uniqueIndex({
          name: "uidx_posts_corrected_title",
          columns: [t.title.name],
        }),
      ],
      primaryKey: { columns: [t.postId.name, t.secondaryId.name] },
    })
  );

  const comments = table(
    "comments",
    {
      commentId: varchar("comment_id").primaryKey(),
      postId: integer("post_id").notNull(), // References posts_corrected.postId
      // For simplicity in test setup, we assume posts_corrected.columns.postId is available
      // In a real scenario, ensure the referenced table (posts_corrected) is defined before comments
      // and its columns are accessible.
      // This reference will be to a part of a composite key.
      commenterId: varchar("commenter_id", { length: 36 })
        .notNull()
        .references(() => users.columns.id),
      text: text("text_content").notNull(), // Renamed to avoid conflict with 'text' function
    },
    (_t) => ({
      // Spanner specific interleave example
      interleave: {
        parentTable: "posts_corrected", // Referencing the corrected posts table
        onDelete: "cascade",
      },
      // Add a foreign key manually for snapshot testing if not using .references() on postId
      // This is more of a conceptual note; .references() is the way to define FKs.
      // The snapshot should pick up FKs from .references()
    })
  );

  // Manually add the reference for comments.postId to postsCorrected.postId
  // This is a bit of a hack for testing because the schema definition doesn't directly support
  // referencing one column of a composite key easily with the current `references` API
  // without defining the target column as a standalone `ColumnConfig` export.
  // For snapshot testing, we can simulate this.
  // In a real schema, you'd ensure `postsCorrected.columns.postId` is the correct `ColumnConfig`.
  if (comments.columns.postId && postsCorrected.columns.postId) {
    comments.columns.postId.references = {
      referencesFn: () => postsCorrected.columns.postId, // This is the key part
      onDelete: "no action", // Example, could be cascade etc.
    };
  }

  const schemaDefinition = { users, posts_corrected: postsCorrected, comments };

  it("should generate a valid schema snapshot", () => {
    const snapshot = generateSchemaSnapshot(schemaDefinition);

    expect(snapshot.version).toBe("1.0.0");
    expect(snapshot.dialect).toBe("common");
    expect(Object.keys(snapshot.tables)).toEqual([
      "users",
      "posts_corrected",
      "comments",
    ]);

    // --- Test Users Table ---
    const usersTable = snapshot.tables.users;
    expect(usersTable.name).toBe("users");
    expect(Object.keys(usersTable.columns).length).toBe(7);

    // id column
    expect(usersTable.columns.id).toEqual({
      name: "id",
      type: "varchar",
      dialectTypes: { postgres: "VARCHAR(36)", spanner: "STRING(36)" },
      primaryKey: true,
      default: { function: "[FUNCTION_DEFAULT]" }, // crypto.randomUUID
    });
    // email column
    expect(usersTable.columns.email).toEqual({
      name: "email",
      type: "varchar",
      dialectTypes: { postgres: "VARCHAR(255)", spanner: "STRING(255)" },
      notNull: true,
      unique: true,
    });
    // isAdmin column
    expect(usersTable.columns.isAdmin).toEqual({
      // Changed is_admin to isAdmin
      name: "is_admin",
      type: "boolean",
      dialectTypes: { postgres: "BOOLEAN", spanner: "BOOL" },
      default: false,
      notNull: true,
    });
    // createdAt column
    expect(usersTable.columns.createdAt.name).toBe("created_at");
    expect(usersTable.columns.createdAt.type).toBe("timestamp");
    expect(usersTable.columns.createdAt.dialectTypes.postgres).toBe(
      "TIMESTAMP WITH TIME ZONE"
    );
    expect(usersTable.columns.createdAt.dialectTypes.spanner).toBe("TIMESTAMP");
    expect(usersTable.columns.createdAt.notNull).toBe(true);
    // Check the default value for createdAt
    const createdAtDefault = usersTable.columns.createdAt.default as any;
    expect(createdAtDefault).toBeDefined();
    expect(createdAtDefault._isSQL).toBe(true); // It should be an SQL object now
    expect(createdAtDefault.toSqlString("postgres")).toBe("CURRENT_TIMESTAMP");

    // jsonData column
    expect(usersTable.columns.jsonData).toEqual({
      // Changed json_data to jsonData
      name: "json_data",
      type: "jsonb",
      dialectTypes: { postgres: "JSONB", spanner: "JSON" },
    });

    // --- Test PostsCorrected Table ---
    const postsTable = snapshot.tables.posts_corrected;
    expect(postsTable.name).toBe("posts_corrected");
    expect(Object.keys(postsTable.columns).length).toBe(7); // postId, secondaryId, authorId, title, content, publishedAt, views

    // authorId column (FK)
    expect(postsTable.columns.authorId).toEqual({
      // No change needed here, authorId is already correct
      name: "author_id",
      type: "varchar",
      dialectTypes: { postgres: "VARCHAR(36)", spanner: "STRING(36)" },
      notNull: true,
      references: {
        referencedTable: "users",
        referencedColumn: "id",
        onDelete: "cascade",
      },
    });
    // views column
    expect(postsTable.columns.views).toEqual({
      // No change needed here, views is already correct
      name: "views",
      type: "integer",
      dialectTypes: { postgres: "INTEGER", spanner: "INT64" },
      default: 0,
    });

    // Indexes for posts_corrected
    expect(postsTable.indexes).toBeDefined();
    expect(postsTable.indexes?.length).toBe(2);
    expect(postsTable.indexes).toContainEqual({
      name: "idx_posts_corrected_author",
      columns: ["author_id"],
      unique: false,
    });
    expect(postsTable.indexes).toContainEqual({
      name: "uidx_posts_corrected_title",
      columns: ["title"],
      unique: true,
    });

    // Composite PK for posts_corrected
    expect(postsTable.compositePrimaryKey).toEqual({
      columns: ["post_id", "secondary_id"],
      name: undefined, // Default name is undefined unless specified
    });
    expect(postsTable.columns.postId.primaryKey).toBeUndefined(); // Changed post_id to postId
    expect(postsTable.columns.secondaryId.primaryKey).toBeUndefined(); // Changed secondary_id to secondaryId

    // --- Test Comments Table ---
    const commentsTable = snapshot.tables.comments;
    expect(commentsTable.name).toBe("comments");
    expect(Object.keys(commentsTable.columns).length).toBe(4); // commentId, postId, commenterId, text_content

    // commentId (PK)
    expect(commentsTable.columns.commentId).toEqual({
      // No change needed here, commentId is already correct
      name: "comment_id",
      type: "varchar",
      dialectTypes: { postgres: "VARCHAR", spanner: "STRING(MAX)" }, // Default length for varchar
      primaryKey: true,
    });

    // postId (FK to posts_corrected.postId)
    expect(commentsTable.columns.postId).toEqual({
      // No change needed here, postId is already correct
      name: "post_id",
      type: "integer",
      dialectTypes: { postgres: "INTEGER", spanner: "INT64" },
      notNull: true,
      references: {
        // This was manually added in the test setup
        referencedTable: "posts_corrected",
        referencedColumn: "post_id",
        onDelete: "no action",
      },
    });

    // commenterId (FK to users.id)
    expect(commentsTable.columns.commenterId).toEqual({
      // No change needed here, commenterId is already correct
      name: "commenter_id",
      type: "varchar",
      dialectTypes: { postgres: "VARCHAR(36)", spanner: "STRING(36)" },
      notNull: true,
      references: {
        referencedTable: "users",
        referencedColumn: "id",
        onDelete: undefined, // Default onDelete
      },
    });

    // Interleave for comments
    expect(commentsTable.interleave).toEqual({
      parentTable: "posts_corrected",
      onDelete: "cascade",
    });
  });

  it("should throw an error if referenced table in FK is not found", () => {
    const _brokenUsers = table("broken_users", {
      id: varchar("id").primaryKey(),
    });
    const brokenPosts = table("broken_posts", {
      id: integer("id").primaryKey(),
      userId: varchar("user_id").references(() => (({} as any).columns.id)), // Invalid reference
    });
    // Simulate _tableName not being set on referenced column config
    const tableWithoutTableName = table("no_table_name_ref_source", {
      id: varchar("id").primaryKey(),
    });
    const colRef = tableWithoutTableName.columns.id;
    delete colRef._tableName; // Simulate missing _tableName

    const postsWithMissingTableRef = table("posts_missing_table_ref", {
      id: integer("id").primaryKey(),
      userId: varchar("user_id").references(() => colRef),
    });

    const schemaWithInvalidFk = { broken_posts: brokenPosts }; // users table is missing
    const schemaWithMissingRefTable = {
      posts_missing_table_ref: postsWithMissingTableRef,
      no_table_name_ref_source: tableWithoutTableName,
    };

    expect(() => generateSchemaSnapshot(schemaWithInvalidFk)).toThrow(
      /Error resolving foreign key for broken_posts.user_id: Cannot read properties of undefined \(reading 'id'\)/
    );

    // Corrected expectation for the second case
    expect(() => generateSchemaSnapshot(schemaWithMissingRefTable)).toThrow(
      /Error resolving foreign key for posts_missing_table_ref.user_id: Could not determine referenced table name for column "user_id" in table "posts_missing_table_ref". Ensure _tableName is set on referenced column's config./
    );

    // Test for referenced table not found in schema
    const anotherUserTable = table("another_users", {
      id: varchar("id").primaryKey(),
    });
    // Make sure _tableName is set for the referenced column
    anotherUserTable.columns.id._tableName = "another_users";

    const postsRefMissingSchemaTable = table("posts_ref_missing_schema_table", {
      id: integer("id").primaryKey(),
      userId: varchar("user_id").references(() => anotherUserTable.columns.id),
    });
    // `anotherUserTable` is not included in the schema passed to generateSchemaSnapshot
    const schemaWithTableNotInSnapshot = {
      posts_ref_missing_schema_table: postsRefMissingSchemaTable,
    };
    expect(() => generateSchemaSnapshot(schemaWithTableNotInSnapshot)).toThrow(
      'Error resolving foreign key for posts_ref_missing_schema_table.user_id: Referenced table "another_users" for column "user_id" in table "posts_ref_missing_schema_table" not found in schema.'
    );
  });
});
