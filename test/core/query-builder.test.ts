import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { QueryBuilder } from "../../src/core/query-builder.js";
import { table, text, integer, timestamp } from "../../src/core/schema.js";
import { sql } from "../../src/types/common.js";
import {
  count,
  sum,
  avg,
  min,
  max,
  like,
  ilike,
  regexpContains,
  concat,
  lower,
  upper,
} from "../../src/core/functions.js";

const usersTable = table("users", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
  age: integer("age"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

const postsTable = table("posts", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  userId: integer("user_id").references(() => usersTable.columns.id),
  content: text("content"),
});

const commentsTable = table("comments", {
  id: integer("id").primaryKey(), // Simplified: removed generatedAlwaysAsIdentity()
  content: text("content").notNull(),
  userId: integer("user_id").references(() => usersTable.columns.id),
  rootId: integer("root_id").notNull(),
  entityType: text("entity_type").notNull(), // e.g., 'post', 'another_comment'
  parentId: integer("parent_id").references(() => commentsTable.columns.id), // Self-referencing for replies
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

describe("QueryBuilder SQL Generation with Aliasing", () => {
  let qb: QueryBuilder<typeof usersTable>;

  beforeEach(() => {
    qb = new QueryBuilder<typeof usersTable>();
  });

  describe("PostgreSQL Dialect", () => {
    it("should generate SELECT * with table alias", () => {
      const preparedQuery = qb.select("*").from(usersTable).prepare("postgres");
      expect(preparedQuery.sql).toBe('SELECT * FROM "users" AS "t1"');
    });

    it("should generate SELECT * when select() is called with no arguments (PostgreSQL)", () => {
      const preparedQuery = qb.select().from(usersTable).prepare("postgres");
      expect(preparedQuery.sql).toBe('SELECT * FROM "users" AS "t1"');
    });

    it("should generate SELECT with specific aliased columns", () => {
      const preparedQuery = qb
        .select({ id: usersTable.columns.id, name: usersTable.columns.name })
        .from(usersTable)
        .prepare("postgres");
      expect(preparedQuery.sql).toBe(
        'SELECT "t1"."id" AS "id", "t1"."name" AS "name" FROM "users" AS "t1"'
      );
    });

    it("should generate SELECT with specific columns and custom aliases, using table alias", () => {
      const preparedQuery = qb
        .select({
          userID: usersTable.columns.id,
          fullName: usersTable.columns.name,
        })
        .from(usersTable)
        .prepare("postgres");
      expect(preparedQuery.sql).toBe(
        'SELECT "t1"."id" AS "userID", "t1"."name" AS "fullName" FROM "users" AS "t1"'
      );
    });

    it("should generate SELECT with a WHERE clause and table alias", () => {
      const preparedQuery = qb
        .select({ id: usersTable.columns.id })
        .from(usersTable)
        .where(sql`${usersTable.columns.age} > ${30}`)
        .prepare("postgres");
      expect(preparedQuery.sql).toBe(
        'SELECT "t1"."id" AS "id" FROM "users" AS "t1" WHERE "t1"."age" > $1'
      );
    });

    it("should generate SELECT with LIMIT and table alias", () => {
      const preparedQuery = qb
        .select("*")
        .from(usersTable)
        .limit(10)
        .prepare("postgres");
      expect(preparedQuery.sql).toBe('SELECT * FROM "users" AS "t1" LIMIT 10');
    });

    it("should generate SELECT with OFFSET and table alias", () => {
      const preparedQuery = qb
        .select("*")
        .from(usersTable)
        .offset(5)
        .prepare("postgres");
      expect(preparedQuery.sql).toBe('SELECT * FROM "users" AS "t1" OFFSET 5');
    });

    it("should generate SELECT with LIMIT and OFFSET and table alias", () => {
      const preparedQuery = qb
        .select("*")
        .from(usersTable)
        .limit(10)
        .offset(5)
        .prepare("postgres");
      expect(preparedQuery.sql).toBe(
        'SELECT * FROM "users" AS "t1" LIMIT 10 OFFSET 5'
      );
    });

    it("should generate SELECT with multiple WHERE conditions (ANDed) and table alias", () => {
      const preparedQuery = qb
        .select("*")
        .from(usersTable)
        .where(sql`${usersTable.columns.name} = ${"Alice"}`)
        .where(sql`${usersTable.columns.age} < ${30}`)
        .prepare("postgres");
      expect(preparedQuery.sql).toBe(
        'SELECT * FROM "users" AS "t1" WHERE "t1"."name" = $1 AND "t1"."age" < $2'
      );
    });

    it("should generate SELECT with raw SQL in select fields and table alias", () => {
      const preparedQuery = qb
        .select({ custom: sql`COALESCE(${usersTable.columns.name}, 'N/A')` })
        .from(usersTable)
        .prepare("postgres");
      expect(preparedQuery.sql).toBe(
        'SELECT COALESCE("t1"."name", \'N/A\') AS "custom" FROM "users" AS "t1"'
      );
    });
  });

  describe("Spanner Dialect", () => {
    it("should generate SELECT * with table alias", () => {
      const preparedQuery = qb.select("*").from(usersTable).prepare("spanner");
      expect(preparedQuery.sql).toBe("SELECT * FROM `users` AS `t1`");
    });

    it("should generate SELECT * when select() is called with no arguments (Spanner)", () => {
      const preparedQuery = qb.select().from(usersTable).prepare("spanner");
      expect(preparedQuery.sql).toBe("SELECT * FROM `users` AS `t1`");
    });

    it("should generate SELECT with specific columns and custom aliases, using table alias", () => {
      const preparedQuery = qb
        .select({
          userID: usersTable.columns.id,
          fullName: usersTable.columns.name,
        })
        .from(usersTable)
        .prepare("spanner");
      expect(preparedQuery.sql).toBe(
        "SELECT `t1`.`id` AS `userID`, `t1`.`name` AS `fullName` FROM `users` AS `t1`"
      );
    });

    it("should generate SELECT with a WHERE clause and table alias", () => {
      const preparedQuery = qb
        .select({ id: usersTable.columns.id })
        .from(usersTable)
        .where(sql`${usersTable.columns.age} > ${30}`)
        .prepare("spanner");
      expect(preparedQuery.sql).toBe(
        "SELECT `t1`.`id` AS `id` FROM `users` AS `t1` WHERE `t1`.`age` > @p1"
      );
    });

    it("should generate SELECT with LIMIT and OFFSET and table alias", () => {
      const preparedQuery = qb
        .select("*")
        .from(usersTable)
        .limit(10)
        .offset(5)
        .prepare("spanner");
      expect(preparedQuery.sql).toBe(
        "SELECT * FROM `users` AS `t1` LIMIT 10 OFFSET 5"
      );
    });

    it("should generate SELECT with raw SQL in select fields for Spanner and table alias", () => {
      const preparedQuery = qb
        .select({ customName: sql`IFNULL(${usersTable.columns.name}, 'N/A')` })
        .from(usersTable)
        .prepare("spanner");
      expect(preparedQuery.sql).toBe(
        "SELECT IFNULL(`t1`.`name`, 'N/A') AS `customName` FROM `users` AS `t1`"
      );
    });
  });

  describe("Parameter Binding (should be unaffected by aliasing)", () => {
    it("should collect parameters correctly for a simple WHERE clause", () => {
      const preparedQuery = qb
        .select("*")
        .from(usersTable)
        .where(sql`${usersTable.columns.age} > ${30}`)
        .prepare("postgres");
      expect(preparedQuery.parameters).toEqual([30]);
    });

    it("should collect parameters from multiple WHERE clauses", () => {
      const preparedQuery = qb
        .select("*")
        .from(usersTable)
        .where(sql`${usersTable.columns.name} = ${"Bob"}`)
        .where(sql`${usersTable.columns.age} < ${25}`)
        .prepare("postgres");
      expect(preparedQuery.parameters).toEqual(["Bob", 25]);
    });

    it("should collect parameters from SQL in select fields", () => {
      const preparedQuery = qb
        .select({
          nameWithPrefix: sql`CONCAT(${"Mr. "}, ${usersTable.columns.name})`,
          agePlusTen: sql`${usersTable.columns.age} + ${10}`,
        })
        .from(usersTable)
        .prepare("postgres");
      expect(preparedQuery.parameters).toEqual(["Mr. ", 10]);
    });

    it("should handle nested SQL parameters correctly with aliasing", () => {
      const subQueryValue = "sub@test.com";
      const nestedSql = sql`LOWER(${subQueryValue})`;
      const preparedQuery = qb
        .select("*")
        .from(usersTable)
        .where(sql`${usersTable.columns.email} = ${nestedSql}`)
        .prepare("postgres");

      expect(preparedQuery.parameters).toEqual([subQueryValue]);
      const pgSql = preparedQuery.sql;
      expect(pgSql).toBe(
        'SELECT * FROM "users" AS "t1" WHERE "t1"."email" = LOWER($1)'
      );
    });
  });

  describe("INSERT Statements (Aliasing less relevant)", () => {
    it("PostgreSQL: should generate INSERT statement for a single row", () => {
      const preparedQuery = qb
        .insert(usersTable)
        .values({ name: "John Doe", age: 30 })
        .prepare("postgres");
      expect(preparedQuery.sql).toBe(
        'INSERT INTO "users" ("age", "created_at", "name") VALUES ($1, CURRENT_TIMESTAMP, $2)'
      );
      expect(preparedQuery.parameters).toEqual([30, "John Doe"]);
    });

    it("Spanner: should generate INSERT statement for a single row", () => {
      const preparedQuery = qb
        .insert(usersTable)
        .values({ name: "Jane Doe", email: "jane@example.com" })
        .prepare("spanner");
      expect(preparedQuery.sql).toBe(
        "INSERT INTO `users` (`created_at`, `email`, `name`) VALUES (CURRENT_TIMESTAMP, @p1, @p2)"
      );
      expect(preparedQuery.parameters).toEqual({
        p1: "jane@example.com",
        p2: "Jane Doe",
      });
    });
  });

  describe("UPDATE Statements with Aliasing", () => {
    it("PostgreSQL: should generate UPDATE statement with SET and WHERE using alias", () => {
      const preparedQuery = qb
        .update(usersTable)
        .set({ age: 31, email: "john.new@example.com" })
        .where(sql`${usersTable.columns.id} = ${1}`)
        .prepare("postgres");
      expect(preparedQuery.sql).toBe(
        'UPDATE "users" SET "age" = $1, "email" = $2 WHERE "t1"."id" = $3'
      );
      expect(preparedQuery.parameters).toEqual([31, "john.new@example.com", 1]);
    });

    it("Spanner: should generate UPDATE statement with SET and WHERE using alias", () => {
      const preparedQuery = qb
        .update(usersTable)
        .set({ name: "Updated Name" })
        .where(sql`${usersTable.columns.email} = ${"old@example.com"}`)
        .prepare("spanner");
      expect(preparedQuery.sql).toBe(
        "UPDATE `users` SET `name` = @p1 WHERE `t1`.`email` = @p2"
      );
      expect(preparedQuery.parameters).toEqual({
        p1: "Updated Name",
        p2: "old@example.com",
      });
    });

    it("PostgreSQL: should generate UPDATE statement with SQL in SET using alias", () => {
      const preparedQuery = qb
        .update(usersTable)
        .set({ age: sql`${usersTable.columns.age} + ${1}` })
        .where(sql`${usersTable.columns.id} = ${10}`)
        .prepare("postgres");
      expect(preparedQuery.sql).toBe(
        'UPDATE "users" SET "age" = "t1"."age" + $1 WHERE "t1"."id" = $2'
      );
      expect(preparedQuery.parameters).toEqual([1, 10]);
    });
  });

  describe("DELETE Statements with Aliasing", () => {
    it("PostgreSQL: should generate DELETE statement with WHERE using alias", () => {
      const preparedQuery = qb
        .deleteFrom(usersTable)
        .where(sql`${usersTable.columns.age} < ${18}`)
        .prepare("postgres");
      expect(preparedQuery.sql).toBe(
        'DELETE FROM "users" WHERE "t1"."age" < $1'
      );
      expect(preparedQuery.parameters).toEqual([18]);
    });

    it("Spanner: should generate DELETE statement with WHERE using alias", () => {
      const preparedQuery = qb
        .deleteFrom(usersTable)
        .where(sql`${usersTable.columns.email} = ${"spam@example.com"}`)
        .prepare("spanner");
      expect(preparedQuery.sql).toBe(
        "DELETE FROM `users` WHERE `t1`.`email` = @p1"
      );
      expect(preparedQuery.parameters).toEqual({ p1: "spam@example.com" });
    });

    it("PostgreSQL: should generate DELETE statement without WHERE (no alias needed for table name)", () => {
      const preparedQuery = qb.deleteFrom(usersTable).prepare("postgres");
      expect(preparedQuery.sql).toBe('DELETE FROM "users"');
      expect(preparedQuery.parameters).toEqual([]);
    });
  });
});

describe("QueryBuilder Debug Method", () => {
  let qb: QueryBuilder<typeof usersTable>;

  beforeEach(() => {
    qb = new QueryBuilder<typeof usersTable>();
    // Default spy setup moved to individual tests if needed, or keep general one if it works for others
  });

  // General spy for tests that don't need special handling
  let generalConsoleLogSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    generalConsoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => {}); // Mock implementation to suppress output during most tests
    generalConsoleLogSpy.mockClear();
  });
  afterEach(() => {
    generalConsoleLogSpy.mockRestore();
  });

  it("should log SQL and parameters when debug() is called for a SELECT query", () => {
    // Use the general spy, but clear it first for this specific test's assertions
    generalConsoleLogSpy.mockClear();
    const preparedQuery = qb
      .select({ id: usersTable.columns.id })
      .from(usersTable)
      .where(sql`${usersTable.columns.age} > ${30}`)
      .debug()
      .prepare("postgres");

    expect(generalConsoleLogSpy).toHaveBeenCalledTimes(5);
    expect(generalConsoleLogSpy).toHaveBeenCalledWith("--- SQL Query ---");
    expect(generalConsoleLogSpy).toHaveBeenCalledWith(
      'SELECT "t1"."id" AS "id" FROM "users" AS "t1" WHERE "t1"."age" > $1'
    );
    expect(generalConsoleLogSpy).toHaveBeenCalledWith("--- Parameters ---");
    expect(generalConsoleLogSpy).toHaveBeenCalledWith([30]);
    expect(generalConsoleLogSpy).toHaveBeenCalledWith("-----------------");
    expect(preparedQuery.sql).toBe(
      'SELECT "t1"."id" AS "id" FROM "users" AS "t1" WHERE "t1"."age" > $1'
    );
    expect(preparedQuery.parameters).toEqual([30]);
  });

  it("should log SQL and parameters when debug() is called for an INSERT query", () => {
    // Dedicated spy for this test
    const insertTestConsoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => {});

    const localQb = new QueryBuilder<typeof usersTable>(); // Use a local qb instance
    const preparedQuery = localQb
      .insert(usersTable)
      .values({ name: "Debug User", age: 25 })
      .debug()
      .prepare("postgres");

    expect(insertTestConsoleLogSpy).toHaveBeenCalledTimes(5);
    expect(insertTestConsoleLogSpy).toHaveBeenCalledWith("--- SQL Query ---");
    expect(insertTestConsoleLogSpy).toHaveBeenCalledWith(
      'INSERT INTO "users" ("age", "created_at", "name") VALUES ($1, CURRENT_TIMESTAMP, $2)'
    );
    expect(insertTestConsoleLogSpy).toHaveBeenCalledWith("--- Parameters ---");
    expect(insertTestConsoleLogSpy).toHaveBeenCalledWith([25, "Debug User"]);
    expect(insertTestConsoleLogSpy).toHaveBeenCalledWith("-----------------");
    expect(preparedQuery.sql).toBe(
      'INSERT INTO "users" ("age", "created_at", "name") VALUES ($1, CURRENT_TIMESTAMP, $2)'
    );
    // Note: default for createdAt is handled, so it's not in the explicit parameters list for the values() part
    // but the getBoundParameters should reflect the actual values being sent.
    // The current implementation of getBoundParameters for insert processes defaults and then extracts values.
    expect(preparedQuery.parameters).toEqual([25, "Debug User"]);

    insertTestConsoleLogSpy.mockRestore(); // Clean up dedicated spy
  });

  it("should not log if debug() is not called", () => {
    generalConsoleLogSpy.mockClear(); // Ensure clear state for this test
    qb.select({ id: usersTable.columns.id })
      .from(usersTable)
      .prepare("postgres");
    expect(generalConsoleLogSpy).not.toHaveBeenCalled();
  });
});

describe("QueryBuilder Multi-Value Insert with Optional Fields", () => {
  let qbComments: QueryBuilder<typeof commentsTable>;

  beforeEach(() => {
    qbComments = new QueryBuilder<typeof commentsTable>();
  });

  it("PostgreSQL: should correctly generate parameters for multi-value insert with missing optional fields", () => {
    const insertData = [
      {
        content: "Comment 1",
        userId: 1,
        rootId: 100,
        entityType: "post",
      }, // parentId is missing
      {
        content: "Reply to Comment 1",
        userId: 2,
        rootId: 100,
        entityType: "post",
        parentId: 1,
      },
      {
        content: "Comment 2",
        userId: 3,
        rootId: 101,
        entityType: "post",
      }, // parentId is missing
    ];

    // Directly test getBoundParameters logic
    qbComments.insert(commentsTable).values(insertData);
    const preparedPg = qbComments.prepare("postgres");
    const parameters = preparedPg.parameters as unknown[];

    // Expected order of keys after processing defaults and sorting:
    // content, createdAt, entityType, parentId, rootId, userId
    // (id is auto-generated and not part of insert values)

    // Row 1: content, createdAt (default), entityType, parentId (null), rootId, userId
    // Row 2: content, createdAt (default), entityType, parentId (1), rootId, userId
    // Row 3: content, createdAt (default), entityType, parentId (null), rootId, userId

    console.log(parameters);
    expect(parameters.length).toBe(15); // 3 rows, 5 bind parameters each (createdAt is embedded)

    // Check parameters for the first row (5 params: content, entityType, parentId, rootId, userId)
    expect(parameters[0]).toBe("Comment 1"); // content
    expect(parameters[1]).toBe("post"); // entityType
    expect(parameters[2]).toBe(null); // parentId (should be null)
    expect(parameters[3]).toBe(100); // rootId
    expect(parameters[4]).toBe(1); // userId

    // Check parameters for the second row
    expect(parameters[5]).toBe("Reply to Comment 1"); // content
    expect(parameters[6]).toBe("post"); // entityType
    expect(parameters[7]).toBe(1); // parentId
    expect(parameters[8]).toBe(100); // rootId
    expect(parameters[9]).toBe(2); // userId

    // Check parameters for the third row
    expect(parameters[10]).toBe("Comment 2"); // content
    expect(parameters[11]).toBe("post"); // entityType
    expect(parameters[12]).toBe(null); // parentId (should be null)
    expect(parameters[13]).toBe(101); // rootId
    expect(parameters[14]).toBe(3); // userId

    // Check the generated SQL
    const preparedQuery = qbComments.prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'INSERT INTO "comments" ("content", "created_at", "entity_type", "parent_id", "root_id", "user_id") VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4, $5), ($6, CURRENT_TIMESTAMP, $7, $8, $9, $10), ($11, CURRENT_TIMESTAMP, $12, $13, $14, $15)'
    );
  });

  it("Spanner: should correctly generate parameters for multi-value insert with missing optional fields", () => {
    const insertData = [
      {
        content: "Comment 1 Spanner",
        userId: 1,
        rootId: 200,
        entityType: "post",
      }, // parentId is missing
      {
        content: "Reply to Comment 1 Spanner",
        userId: 2,
        rootId: 200,
        entityType: "post",
        parentId: 10,
      },
    ];
    qbComments.insert(commentsTable).values(insertData);
    const preparedSpanner = qbComments.prepare("spanner");
    const parameters = preparedSpanner.parameters as Record<string, unknown>;
    const typeHints = preparedSpanner.spannerParamTypeHints;

    // Expected order: content, createdAt, entityType, parentId, rootId, userId
    expect(Object.keys(parameters).length).toBe(2 * 5); // 2 rows, 5 bind parameters each

    // Row 1 (5 params: content, entityType, parentId, rootId, userId)
    // Parameters are p1-p5 for row 1, p6-p10 for row 2
    expect(parameters.p1).toBe("Comment 1 Spanner"); // content
    expect(parameters.p2).toBe("post"); // entityType
    expect(parameters.p3).toBe(null); // parentId
    expect(parameters.p4).toBe(200); // rootId
    expect(parameters.p5).toBe(1); // userId

    // Row 2
    expect(parameters.p6).toBe("Reply to Comment 1 Spanner"); // content
    expect(parameters.p7).toBe("post"); // entityType
    expect(parameters.p8).toBe(10); // parentId
    expect(parameters.p9).toBe(200); // rootId
    expect(parameters.p10).toBe(2); // userId

    // Check type hints
    expect(typeHints?.p1).toBe("STRING(MAX)"); // content
    expect(typeHints?.p2).toBe("STRING(MAX)"); // entityType
    expect(typeHints?.p3).toBe("INT64"); // parentId
    expect(typeHints?.p4).toBe("INT64"); // rootId
    expect(typeHints?.p5).toBe("INT64"); // userId
    expect(typeHints?.p6).toBe("STRING(MAX)"); // content
    expect(typeHints?.p7).toBe("STRING(MAX)"); // entityType
    expect(typeHints?.p8).toBe("INT64"); // parentId
    expect(typeHints?.p9).toBe("INT64"); // rootId
    expect(typeHints?.p10).toBe("INT64"); // userId

    expect(preparedSpanner.sql).toBe(
      "INSERT INTO `comments` (`content`, `created_at`, `entity_type`, `parent_id`, `root_id`, `user_id`) VALUES (@p1, CURRENT_TIMESTAMP, @p2, @p3, @p4, @p5), (@p6, CURRENT_TIMESTAMP, @p7, @p8, @p9, @p10)"
    );
  });

  it("Spanner: should generate correct type hints for INSERT with null values", () => {
    const qb = new QueryBuilder<typeof commentsTable>();
    const insertData = {
      content: "Test comment with nulls",
      userId: 123, // Assuming userId is INT64 in Spanner based on integer()
      rootId: 456, // Assuming rootId is INT64
      entityType: "post", // STRING(MAX)
      parentId: null, // INT64 (nullable)
      // createdAt is default
    };
    qb.insert(commentsTable).values(insertData);
    const preparedQuery = qb.prepare("spanner");

    // Order of keys in 'comments' schema for params: content, entityType, parentId, rootId, userId
    // (createdAt is default, id is PK)
    // params: "Test comment with nulls", "post", null, 456, 123
    expect(preparedQuery.parameters).toEqual({
      p1: "Test comment with nulls", // content
      p2: "post", // entityType
      p3: null, // parentId
      p4: 456, // rootId
      p5: 123, // userId
    });

    expect(preparedQuery.spannerParamTypeHints).toEqual({
      p1: "STRING(MAX)", // content
      p2: "STRING(MAX)", // entityType
      p3: "INT64", // parentId (even if null, type is known)
      p4: "INT64", // rootId
      p5: "INT64", // userId
    });
  });
});

describe("QueryBuilder RETURNING clause", () => {
  let qbReturning: QueryBuilder<typeof usersTable>;

  beforeEach(() => {
    qbReturning = new QueryBuilder<typeof usersTable>();
  });

  // --- PostgreSQL RETURNING ---
  describe("PostgreSQL RETURNING", () => {
    it("should generate INSERT ... RETURNING *", () => {
      const prepared = qbReturning
        .insert(usersTable)
        .values({ name: "Test User", age: 25 })
        .returning("*") // or .returning() or .returning(true)
        .prepare("postgres");
      expect(prepared.sql).toBe(
        'INSERT INTO "users" ("age", "created_at", "name") VALUES ($1, CURRENT_TIMESTAMP, $2) RETURNING *'
      );
      expect(prepared.parameters).toEqual([25, "Test User"]);
      expect(prepared.returning).toBe(true);
    });

    it("should generate INSERT ... RETURNING specific columns", () => {
      const prepared = qbReturning
        .insert(usersTable)
        .values({ name: "Test User", email: "test@example.com" })
        .returning({
          id: usersTable.columns.id,
          userEmail: usersTable.columns.email,
        })
        .prepare("postgres");
      expect(prepared.sql).toBe(
        'INSERT INTO "users" ("created_at", "email", "name") VALUES (CURRENT_TIMESTAMP, $1, $2) RETURNING "id" AS "id", "email" AS "userEmail"'
      );
      expect(prepared.parameters).toEqual(["test@example.com", "Test User"]);
      expect(prepared.returning).toEqual({
        id: usersTable.columns.id,
        userEmail: usersTable.columns.email,
      });
    });

    it("should generate UPDATE ... RETURNING *", () => {
      const prepared = qbReturning
        .update(usersTable)
        .set({ age: 30 })
        .where(sql`${usersTable.columns.id} = ${1}`)
        .returning()
        .prepare("postgres");
      expect(prepared.sql).toBe(
        'UPDATE "users" SET "age" = $1 WHERE "t1"."id" = $2 RETURNING *'
      );
      expect(prepared.parameters).toEqual([30, 1]);
      expect(prepared.returning).toBe(true);
    });

    it("should generate UPDATE ... RETURNING specific columns", () => {
      const prepared = qbReturning
        .update(usersTable)
        .set({ name: "New Name" })
        .where(sql`${usersTable.columns.id} = ${2}`)
        .returning({ name: usersTable.columns.name })
        .prepare("postgres");
      expect(prepared.sql).toBe(
        'UPDATE "users" SET "name" = $1 WHERE "t1"."id" = $2 RETURNING "name" AS "name"'
      );
      expect(prepared.parameters).toEqual(["New Name", 2]);
    });

    it("should generate DELETE ... RETURNING *", () => {
      const prepared = qbReturning
        .deleteFrom(usersTable)
        .where(sql`${usersTable.columns.id} = ${3}`)
        .returning(true)
        .prepare("postgres");
      expect(prepared.sql).toBe(
        'DELETE FROM "users" WHERE "t1"."id" = $1 RETURNING *'
      );
      expect(prepared.parameters).toEqual([3]);
    });

    it("should generate DELETE ... RETURNING specific columns", () => {
      const prepared = qbReturning
        .deleteFrom(usersTable)
        .where(sql`${usersTable.columns.email} = ${"del@example.com"}`)
        .returning({
          deletedId: usersTable.columns.id,
          oldEmail: usersTable.columns.email,
        })
        .prepare("postgres");
      expect(prepared.sql).toBe(
        'DELETE FROM "users" WHERE "t1"."email" = $1 RETURNING "id" AS "deletedId", "email" AS "oldEmail"'
      );
    });
  });

  // --- Spanner THEN RETURN ---
  describe("Spanner THEN RETURN", () => {
    it("should generate INSERT ... THEN RETURN *", () => {
      const prepared = qbReturning
        .insert(usersTable)
        .values({ name: "Spanner User", age: 40 })
        .returning("*")
        .prepare("spanner");
      expect(prepared.sql).toBe(
        "INSERT INTO `users` (`age`, `created_at`, `name`) VALUES (@p1, CURRENT_TIMESTAMP, @p2) THEN RETURN *"
      );
      expect(prepared.parameters).toEqual({ p1: 40, p2: "Spanner User" });
    });

    it("should generate INSERT ... THEN RETURN specific columns", () => {
      const prepared = qbReturning
        .insert(usersTable)
        .values({ name: "Spanner User 2", email: "spanner@example.com" })
        .returning({
          id: usersTable.columns.id,
          userEmail: usersTable.columns.email,
        })
        .prepare("spanner");
      expect(prepared.sql).toBe(
        "INSERT INTO `users` (`created_at`, `email`, `name`) VALUES (CURRENT_TIMESTAMP, @p1, @p2) THEN RETURN `id` AS `id`, `email` AS `userEmail`"
      );
    });

    it("should generate UPDATE ... THEN RETURN *", () => {
      const prepared = qbReturning
        .update(usersTable)
        .set({ age: 45 })
        .where(sql`${usersTable.columns.id} = ${10}`)
        .returning()
        .prepare("spanner");
      expect(prepared.sql).toBe(
        "UPDATE `users` SET `age` = @p1 WHERE `t1`.`id` = @p2 THEN RETURN *"
      );
    });

    it("should generate UPDATE ... THEN RETURN specific columns", () => {
      const prepared = qbReturning
        .update(usersTable)
        .set({ name: "Updated Spanner Name" })
        .where(sql`${usersTable.columns.id} = ${11}`)
        .returning({
          name: usersTable.columns.name,
          age: usersTable.columns.age,
        })
        .prepare("spanner");
      expect(prepared.sql).toBe(
        "UPDATE `users` SET `name` = @p1 WHERE `t1`.`id` = @p2 THEN RETURN `name` AS `name`, `age` AS `age`"
      );
    });

    it("should generate DELETE ... THEN RETURN *", () => {
      const prepared = qbReturning
        .deleteFrom(usersTable)
        .where(sql`${usersTable.columns.id} = ${12}`)
        .returning(true)
        .prepare("spanner");
      expect(prepared.sql).toBe(
        "DELETE FROM `users` WHERE `t1`.`id` = @p1 THEN RETURN *"
      );
    });

    it("should generate DELETE ... THEN RETURN specific columns", () => {
      const prepared = qbReturning
        .deleteFrom(usersTable)
        .where(sql`${usersTable.columns.email} = ${"del_spanner@example.com"}`)
        .returning({ id: usersTable.columns.id })
        .prepare("spanner");
      expect(prepared.sql).toBe(
        "DELETE FROM `users` WHERE `t1`.`email` = @p1 THEN RETURN `id` AS `id`"
      );
    });
  });
});

describe("QueryBuilder JOIN Operations with Aliasing", () => {
  let qbJoin: QueryBuilder<typeof usersTable>;

  beforeEach(() => {
    qbJoin = new QueryBuilder<typeof usersTable>();
  });

  it("PostgreSQL: should generate INNER JOIN with table aliases", () => {
    const preparedQuery = qbJoin
      .select({
        userName: usersTable.columns.name,
        postTitle: postsTable.columns.title,
      })
      .from(usersTable)
      .innerJoin(
        postsTable,
        sql`${usersTable.columns.id} = ${postsTable.columns.userId}`
      )
      .where(sql`${usersTable.columns.age} > ${30}`)
      .prepare("postgres");

    expect(preparedQuery.sql).toBe(
      'SELECT "t1"."name" AS "userName", "t2"."title" AS "postTitle" FROM "users" AS "t1" INNER JOIN "posts" AS "t2" ON "t1"."id" = "t2"."user_id" WHERE "t1"."age" > $1'
    );
    expect(preparedQuery.parameters).toEqual([30]);
  });

  it("Spanner: should generate INNER JOIN with table aliases", () => {
    const preparedQuery = qbJoin
      .select({
        userName: usersTable.columns.name,
        postTitle: postsTable.columns.title,
      })
      .from(usersTable)
      .innerJoin(
        postsTable,
        sql`${usersTable.columns.id} = ${postsTable.columns.userId}`
      )
      .where(sql`${usersTable.columns.age} > ${30}`)
      .prepare("spanner");

    expect(preparedQuery.sql).toBe(
      "SELECT `t1`.`name` AS `userName`, `t2`.`title` AS `postTitle` FROM `users` AS `t1` INNER JOIN `posts` AS `t2` ON `t1`.`id` = `t2`.`user_id` WHERE `t1`.`age` > @p1"
    );
    expect(preparedQuery.parameters).toEqual({ p1: 30 });
  });

  it("PostgreSQL: should generate LEFT JOIN with table aliases", () => {
    const preparedQuery = qbJoin
      .select({
        userName: usersTable.columns.name,
        postTitle: postsTable.columns.title,
      })
      .from(usersTable)
      .leftJoin(
        postsTable,
        sql`${usersTable.columns.id} = ${postsTable.columns.userId}`
      )
      .prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'SELECT "t1"."name" AS "userName", "t2"."title" AS "postTitle" FROM "users" AS "t1" LEFT JOIN "posts" AS "t2" ON "t1"."id" = "t2"."user_id"'
    );
  });

  it("Spanner: should generate LEFT JOIN with table aliases", () => {
    const preparedQuery = qbJoin
      .select({
        userName: usersTable.columns.name,
        postTitle: postsTable.columns.title,
      })
      .from(usersTable)
      .leftJoin(
        postsTable,
        sql`${usersTable.columns.id} = ${postsTable.columns.userId}`
      )
      .prepare("spanner");
    expect(preparedQuery.sql).toBe(
      "SELECT `t1`.`name` AS `userName`, `t2`.`title` AS `postTitle` FROM `users` AS `t1` LEFT JOIN `posts` AS `t2` ON `t1`.`id` = `t2`.`user_id`"
    );
  });

  it("PostgreSQL: should collect parameters from JOIN ON condition with aliases", () => {
    const preparedQuery = qbJoin
      .select({ userName: usersTable.columns.name })
      .from(usersTable)
      .innerJoin(
        postsTable,
        sql`${usersTable.columns.id} = ${postsTable.columns.userId} AND ${
          postsTable.columns.title
        } = ${"My Post"}`
      )
      .prepare("postgres");
    const params = preparedQuery.parameters;
    expect(params).toEqual(["My Post"]);
  });
});

describe("QueryBuilder Aggregate and String Functions with Aliasing", () => {
  let qb: QueryBuilder<typeof usersTable>;
  beforeEach(() => {
    qb = new QueryBuilder<typeof usersTable>();
  });

  it("PostgreSQL: CONCAT with aliased columns", () => {
    const preparedQuery = qb
      .select({
        greeting: concat(
          "Name: ",
          usersTable.columns.name,
          ", Age: ",
          usersTable.columns.age
        ),
      })
      .from(usersTable)
      .prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'SELECT CONCAT($1, "t1"."name", $2, "t1"."age") AS "greeting" FROM "users" AS "t1"'
    );
  });
  it("Spanner: CONCAT with aliased columns", () => {
    const preparedQuery = qb
      .select({
        greeting: concat(
          "User: ",
          usersTable.columns.name,
          " (",
          usersTable.columns.email,
          ")"
        ),
      })
      .from(usersTable)
      .prepare("spanner");
    expect(preparedQuery.sql).toBe(
      "SELECT CONCAT(@p1, `t1`.`name`, @p2, `t1`.`email`, @p3) AS `greeting` FROM `users` AS `t1`"
    );
  });
  it("PostgreSQL: LOWER with aliased column", () => {
    const preparedQuery = qb
      .select({ lowerName: lower(usersTable.columns.name) })
      .from(usersTable)
      .prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'SELECT LOWER("t1"."name") AS "lowerName" FROM "users" AS "t1"'
    );
  });
  it("PostgreSQL: ORDER BY with aliased column", () => {
    const preparedQuery = qb
      .select({ name: usersTable.columns.name })
      .from(usersTable)
      .orderBy(usersTable.columns.age, "DESC")
      .prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'SELECT "t1"."name" AS "name" FROM "users" AS "t1" ORDER BY "t1"."age" DESC'
    );
  });
  it("PostgreSQL: GROUP BY with aliased column", () => {
    const preparedQuery = qb
      .select({ age: usersTable.columns.age })
      .from(usersTable)
      .groupBy(usersTable.columns.age)
      .prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'SELECT "t1"."age" AS "age" FROM "users" AS "t1" GROUP BY "t1"."age"'
    );
  });
  it("PostgreSQL: COUNT with aliased column", () => {
    const preparedQuery = qb
      .select({ countOfEmails: count(usersTable.columns.email) })
      .from(usersTable)
      .prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'SELECT COUNT("t1"."email") AS "countOfEmails" FROM "users" AS "t1"'
    );
  });

  it("PostgreSQL: UPPER with aliased column", () => {
    const preparedQuery = qb
      .select({ upperName: upper(usersTable.columns.name) })
      .from(usersTable)
      .prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'SELECT UPPER("t1"."name") AS "upperName" FROM "users" AS "t1"'
    );
  });
  it("Spanner: UPPER with aliased column", () => {
    const preparedQuery = qb
      .select({ upperName: upper(usersTable.columns.name) })
      .from(usersTable)
      .prepare("spanner");
    expect(preparedQuery.sql).toBe(
      "SELECT UPPER(`t1`.`name`) AS `upperName` FROM `users` AS `t1`"
    );
  });

  it("PostgreSQL: SUM with aliased column", () => {
    const preparedQuery = qb
      .select({ totalAge: sum(usersTable.columns.age) })
      .from(usersTable)
      .prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'SELECT SUM("t1"."age") AS "totalAge" FROM "users" AS "t1"'
    );
  });
  it("Spanner: SUM with aliased column", () => {
    const preparedQuery = qb
      .select({ totalAge: sum(usersTable.columns.age) })
      .from(usersTable)
      .prepare("spanner");
    expect(preparedQuery.sql).toBe(
      "SELECT SUM(`t1`.`age`) AS `totalAge` FROM `users` AS `t1`"
    );
  });

  it("PostgreSQL: AVG with aliased column", () => {
    const preparedQuery = qb
      .select({ averageAge: avg(usersTable.columns.age) })
      .from(usersTable)
      .prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'SELECT AVG("t1"."age") AS "averageAge" FROM "users" AS "t1"'
    );
  });
  it("Spanner: AVG with aliased column", () => {
    const preparedQuery = qb
      .select({ averageAge: avg(usersTable.columns.age) })
      .from(usersTable)
      .prepare("spanner");
    expect(preparedQuery.sql).toBe(
      "SELECT AVG(`t1`.`age`) AS `averageAge` FROM `users` AS `t1`"
    );
  });

  it("PostgreSQL: MIN with aliased column", () => {
    const preparedQuery = qb
      .select({ minAge: min(usersTable.columns.age) })
      .from(usersTable)
      .prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'SELECT MIN("t1"."age") AS "minAge" FROM "users" AS "t1"'
    );
  });
  it("Spanner: MIN with aliased column", () => {
    const preparedQuery = qb
      .select({ minAge: min(usersTable.columns.age) })
      .from(usersTable)
      .prepare("spanner");
    expect(preparedQuery.sql).toBe(
      "SELECT MIN(`t1`.`age`) AS `minAge` FROM `users` AS `t1`"
    );
  });

  it("PostgreSQL: MAX with aliased column", () => {
    const preparedQuery = qb
      .select({ maxAge: max(usersTable.columns.age) })
      .from(usersTable)
      .prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'SELECT MAX("t1"."age") AS "maxAge" FROM "users" AS "t1"'
    );
  });
  it("Spanner: MAX with aliased column", () => {
    const preparedQuery = qb
      .select({ maxAge: max(usersTable.columns.age) })
      .from(usersTable)
      .prepare("spanner");
    expect(preparedQuery.sql).toBe(
      "SELECT MAX(`t1`.`age`) AS `maxAge` FROM `users` AS `t1`"
    );
  });
});

describe("QueryBuilder with $defaultFn (Aliasing context)", () => {
  const defaultFnTable = table("default_fn_table", {
    id: integer("id").primaryKey(),
    uuid_val: text("uuid_val").default(() => crypto.randomUUID()),
    created_at_val: timestamp("created_at_val").default(() => new Date()),
  });
  let qbDefault: QueryBuilder<typeof defaultFnTable>;
  beforeEach(() => {
    qbDefault = new QueryBuilder<typeof defaultFnTable>();
  });

  it("PostgreSQL: Insert with $defaultFn should still work", () => {
    const preparedQuery = qbDefault
      .insert(defaultFnTable)
      .values({ id: 1 })
      .prepare("postgres");
    expect(preparedQuery.sql).toContain('INSERT INTO "default_fn_table"');
    const params = preparedQuery.parameters;
    expect(params.length).toBe(3);
    expect(params[0]).toBeInstanceOf(Date);
    expect(params[1]).toBe(1);
    expect(typeof params[2]).toBe("string");
  });
});

describe("QueryBuilder String Matching Functions with Aliasing", () => {
  let qb: QueryBuilder<typeof usersTable>;
  beforeEach(() => {
    qb = new QueryBuilder<typeof usersTable>();
  });

  it("PostgreSQL: LIKE with aliased column", () => {
    const preparedQuery = qb
      .select({ name: usersTable.columns.name })
      .from(usersTable)
      .where(like(usersTable.columns.name, "A%"))
      .prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'SELECT "t1"."name" AS "name" FROM "users" AS "t1" WHERE "t1"."name" LIKE $1'
    );
  });
  it("Spanner: LIKE to REGEXP_CONTAINS with aliased column", () => {
    const preparedQuery = qb
      .select({ name: usersTable.columns.name })
      .from(usersTable)
      .where(like(usersTable.columns.name, "Test%"))
      .prepare("spanner");
    expect(preparedQuery.sql).toBe(
      "SELECT `t1`.`name` AS `name` FROM `users` AS `t1` WHERE REGEXP_CONTAINS(`t1`.`name`, @p1)"
    );
  });
  it("PostgreSQL: ILIKE with aliased column", () => {
    const preparedQuery = qb
      .select({ name: usersTable.columns.name })
      .from(usersTable)
      .where(ilike(usersTable.columns.name, "a%"))
      .prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'SELECT "t1"."name" AS "name" FROM "users" AS "t1" WHERE "t1"."name" ILIKE $1'
    );
  });
  it("Spanner: ILIKE to REGEXP_CONTAINS with (?i) and aliased column", () => {
    const preparedQuery = qb
      .select({ name: usersTable.columns.name })
      .from(usersTable)
      .where(ilike(usersTable.columns.name, "Test%"))
      .prepare("spanner");
    expect(preparedQuery.sql).toBe(
      "SELECT `t1`.`name` AS `name` FROM `users` AS `t1` WHERE REGEXP_CONTAINS(`t1`.`name`, @p1)"
    );
    expect(preparedQuery.parameters).toEqual({ p1: "(?i)^Test.*" });
  });
  it("PostgreSQL: regexpContains with aliased column", () => {
    const preparedQuery = qb
      .select({ name: usersTable.columns.name })
      .from(usersTable)
      .where(regexpContains(usersTable.columns.name, "^A.*"))
      .prepare("postgres");
    expect(preparedQuery.sql).toBe(
      'SELECT "t1"."name" AS "name" FROM "users" AS "t1" WHERE "t1"."name" ~ $1'
    );
  });
  it("Spanner: regexpContains with aliased column", () => {
    const preparedQuery = qb
      .select({ name: usersTable.columns.name })
      .from(usersTable)
      .where(regexpContains(usersTable.columns.name, "^A.*"))
      .prepare("spanner");
    expect(preparedQuery.sql).toBe(
      "SELECT `t1`.`name` AS `name` FROM `users` AS `t1` WHERE REGEXP_CONTAINS(`t1`.`name`, @p1)"
    );
  });
});

describe("QueryBuilder Eager Loading (Include) with Aliasing", () => {
  let qbInclude: QueryBuilder<typeof usersTable>;

  beforeEach(() => {
    qbInclude = new QueryBuilder<typeof usersTable>();
  });

  it("PostgreSQL: should fetch users and include all columns from their posts", () => {
    const preparedQuery = qbInclude
      .select({ id: usersTable.columns.id, name: usersTable.columns.name })
      .from(usersTable)
      .include({ posts: true })
      .prepare("postgres");

    expect(preparedQuery.sql).toContain('SELECT "t1"."id" AS "id"');
    expect(preparedQuery.sql).toContain('"t1"."name" AS "name"');
    expect(preparedQuery.sql).toContain(
      '"t2"."id" AS "posts__id", "t2"."title" AS "posts__title", "t2"."user_id" AS "posts__user_id", "t2"."content" AS "posts__content"'
    );
    expect(preparedQuery.sql).toContain(
      'FROM "users" AS "t1" LEFT JOIN "posts" AS "t2" ON "t2"."user_id" = "t1"."id"'
    );
  });

  it("Spanner: should fetch users and include all columns from their posts", () => {
    const preparedQuery = qbInclude
      .select({ id: usersTable.columns.id, email: usersTable.columns.email })
      .from(usersTable)
      .include({ posts: true })
      .prepare("spanner");

    expect(preparedQuery.sql).toContain("SELECT `t1`.`id` AS `id`");
    expect(preparedQuery.sql).toContain("`t1`.`email` AS `email`");
    expect(preparedQuery.sql).toContain(
      "`t2`.`id` AS `posts__id`, `t2`.`title` AS `posts__title`, `t2`.`user_id` AS `posts__user_id`, `t2`.`content` AS `posts__content`"
    );
    expect(preparedQuery.sql).toContain(
      "FROM `users` AS `t1` LEFT JOIN `posts` AS `t2` ON `t2`.`user_id` = `t1`.`id`"
    );
  });

  it("PostgreSQL: should fetch users and include specific columns from posts", () => {
    const preparedQuery = qbInclude
      .select({ userName: usersTable.columns.name })
      .from(usersTable)
      .include({ posts: { select: { title: true, content: true } } })
      .prepare("postgres");

    expect(preparedQuery.sql).toContain('"t1"."name" AS "userName"');
    expect(preparedQuery.sql).toContain(
      '"t2"."title" AS "posts__title", "t2"."content" AS "posts__content"'
    );
    expect(preparedQuery.sql).not.toContain('"posts__id"');
    expect(preparedQuery.sql).not.toContain('"posts__user_id"');
    expect(preparedQuery.sql).toContain(
      'FROM "users" AS "t1" LEFT JOIN "posts" AS "t2" ON "t2"."user_id" = "t1"."id"'
    );
  });

  it("Spanner: should fetch users and include specific columns from posts", () => {
    const preparedQuery = qbInclude
      .select({ userName: usersTable.columns.name })
      .from(usersTable)
      .include({ posts: { select: { id: true } } })
      .prepare("spanner");

    expect(preparedQuery.sql).toContain("`t1`.`name` AS `userName`");
    expect(preparedQuery.sql).toContain("`t2`.`id` AS `posts__id`");
    expect(preparedQuery.sql).not.toContain("`posts__title`");
    expect(preparedQuery.sql).not.toContain("`posts__content`");
    expect(preparedQuery.sql).toContain(
      "FROM `users` AS `t1` LEFT JOIN `posts` AS `t2` ON `t2`.`user_id` = `t1`.`id`"
    );
  });

  it("PostgreSQL: should handle SELECT * from primary table when including relations", () => {
    const preparedQuery = qbInclude
      .select("*")
      .from(usersTable)
      .include({ posts: { select: { title: true } } })
      .prepare("postgres");

    expect(preparedQuery.sql).toContain('"t1".*');
    expect(preparedQuery.sql).toContain('"t2"."title" AS "posts__title"');
    expect(preparedQuery.sql).toContain(
      'FROM "users" AS "t1" LEFT JOIN "posts" AS "t2" ON "t2"."user_id" = "t1"."id"'
    );
  });

  it("PostgreSQL: should correctly alias columns when multiple relations are included (conceptual)", () => {
    table("profiles", {
      id: integer("id").primaryKey(),
      bio: text("bio"),
      userId: integer("user_id")
        .references(() => usersTable.columns.id)
        .unique(),
    });

    const preparedQuery = qbInclude
      .select({ userName: usersTable.columns.name })
      .from(usersTable)
      .include({
        posts: { select: { title: true } },
        profiles: { select: { bio: true } },
      })
      .prepare("postgres");

    expect(preparedQuery.sql).toContain('"t1"."name" AS "userName"');
    expect(preparedQuery.sql).toContain('"t2"."title" AS "posts__title"');
    expect(preparedQuery.sql).toContain('"t3"."bio" AS "profiles__bio"');
    expect(preparedQuery.sql).toContain(
      'LEFT JOIN "posts" AS "t2" ON "t2"."user_id" = "t1"."id"'
    );
    expect(preparedQuery.sql).toContain(
      'LEFT JOIN "profiles" AS "t3" ON "t3"."user_id" = "t1"."id"'
    );
  });
});

describe("QueryBuilder Fluent Join (joinRelation) Operations", () => {
  let qbFluent: QueryBuilder<typeof usersTable>;

  beforeEach(() => {
    qbFluent = new QueryBuilder<typeof usersTable>();
  });

  // usersTable (parent) to postsTable (child)
  it("PostgreSQL: should generate LEFT JOIN for one-to-many (users to posts)", () => {
    const preparedQuery = qbFluent
      .select({
        userName: usersTable.columns.name,
        postTitle: postsTable.columns.title,
      })
      .from(usersTable)
      .leftJoinRelation("posts") // posts is the name of the related table
      .prepare("postgres");

    expect(preparedQuery.sql).toBe(
      'SELECT "t1"."name" AS "userName", "t2"."title" AS "postTitle" FROM "users" AS "t1" LEFT JOIN "posts" AS "t2" ON "t2"."user_id" = "t1"."id"'
    );
  });

  it("Spanner: should generate INNER JOIN for one-to-many (users to posts)", () => {
    const preparedQuery = qbFluent
      .select({
        userName: usersTable.columns.name,
        postTitle: postsTable.columns.title,
      })
      .from(usersTable)
      .innerJoinRelation("posts")
      .prepare("spanner");
    expect(preparedQuery.sql).toBe(
      "SELECT `t1`.`name` AS `userName`, `t2`.`title` AS `postTitle` FROM `users` AS `t1` INNER JOIN `posts` AS `t2` ON `t2`.`user_id` = `t1`.`id`"
    );
  });

  // postsTable (child) to usersTable (parent)
  it("PostgreSQL: should generate LEFT JOIN for many-to-one (posts to users)", () => {
    const qbPosts = new QueryBuilder<typeof postsTable>();
    const preparedQuery = qbPosts
      .select({
        postTitle: postsTable.columns.title,
        userName: usersTable.columns.name,
      })
      .from(postsTable)
      .leftJoinRelation("users") // users is the name of the related table
      .prepare("postgres");

    expect(preparedQuery.sql).toBe(
      'SELECT "t1"."title" AS "postTitle", "t2"."name" AS "userName" FROM "posts" AS "t1" LEFT JOIN "users" AS "t2" ON "t1"."user_id" = "t2"."id"'
    );
  });

  it("Spanner: should generate INNER JOIN for many-to-one (posts to users)", () => {
    const qbPosts = new QueryBuilder<typeof postsTable>();
    const preparedQuery = qbPosts
      .select({
        postTitle: postsTable.columns.title,
        userName: usersTable.columns.name,
      })
      .from(postsTable)
      .innerJoinRelation("users")
      .prepare("spanner");
    expect(preparedQuery.sql).toBe(
      "SELECT `t1`.`title` AS `postTitle`, `t2`.`name` AS `userName` FROM `posts` AS `t1` INNER JOIN `users` AS `t2` ON `t1`.`user_id` = `t2`.`id`"
    );
  });
});
