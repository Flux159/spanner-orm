import { describe, it, expect, beforeEach } from "vitest";
import { QueryBuilder } from "../../src/core/query-builder.js";
import { table, text, integer, timestamp } from "../../src/core/schema.js";
import { sql } from "../../src/types/common.js";
// import type { TableConfig } from "../../src/types/common.js"; // Unused import

// Define a sample table for testing
const usersTable = table("users", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
  age: integer("age"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// const postsTable = table("posts", { // Unused variable
//   id: integer("id").primaryKey(),
//   title: text("title").notNull(),
//   userId: integer("user_id"),
//   content: text("content"),
// });

describe("QueryBuilder SQL Generation", () => {
  let qb: QueryBuilder<typeof usersTable>;

  beforeEach(() => {
    // Create a new QueryBuilder instance for usersTable before each test
    qb = new QueryBuilder<typeof usersTable>();
  });

  describe("PostgreSQL Dialect", () => {
    it("should generate SELECT *", () => {
      const query = qb.select("*").from(usersTable).toSQL("pg");
      expect(query).toBe('SELECT * FROM "users"');
    });

    it("should generate SELECT with specific columns", () => {
      const query = qb
        .select({ id: usersTable.columns.id, name: usersTable.columns.name })
        .from(usersTable)
        .toSQL("pg");
      expect(query).toBe('SELECT "id" AS "id", "name" AS "name" FROM "users"');
    });

    it("should generate SELECT with specific columns and aliases", () => {
      const query = qb
        .select({
          userID: usersTable.columns.id,
          fullName: usersTable.columns.name,
        })
        .from(usersTable)
        .toSQL("pg");
      expect(query).toBe(
        'SELECT "id" AS "userID", "name" AS "fullName" FROM "users"'
      );
    });

    it("should generate SELECT with a WHERE clause", () => {
      const query = qb
        .select({ id: usersTable.columns.id })
        .from(usersTable)
        .where(sql`${usersTable.columns.age} > ${30}`)
        .toSQL("pg");
      expect(query).toBe('SELECT "id" AS "id" FROM "users" WHERE "age" > $1');
    });

    it("should generate SELECT with LIMIT", () => {
      const query = qb.select("*").from(usersTable).limit(10).toSQL("pg");
      expect(query).toBe('SELECT * FROM "users" LIMIT 10');
    });

    it("should generate SELECT with OFFSET", () => {
      const query = qb.select("*").from(usersTable).offset(5).toSQL("pg");
      expect(query).toBe('SELECT * FROM "users" OFFSET 5');
    });

    it("should generate SELECT with LIMIT and OFFSET", () => {
      const query = qb
        .select("*")
        .from(usersTable)
        .limit(10)
        .offset(5)
        .toSQL("pg");
      expect(query).toBe('SELECT * FROM "users" LIMIT 10 OFFSET 5');
    });

    it("should generate SELECT with multiple WHERE conditions (ANDed)", () => {
      const query = qb
        .select("*")
        .from(usersTable)
        .where(sql`${usersTable.columns.name} = ${"Alice"}`)
        .where(sql`${usersTable.columns.age} < ${30}`)
        .toSQL("pg");
      expect(query).toBe(
        'SELECT * FROM "users" WHERE "name" = $1 AND "age" < $2'
      );
    });

    it("should generate SELECT with raw SQL in select fields", () => {
      const query = qb
        .select({ custom: sql`COALESCE(${usersTable.columns.name}, 'N/A')` })
        .from(usersTable)
        .toSQL("pg");
      expect(query).toBe(
        'SELECT COALESCE("name", \'N/A\') AS "custom" FROM "users"'
      );
    });
  });

  describe("Spanner Dialect", () => {
    it("should generate SELECT *", () => {
      const query = qb.select("*").from(usersTable).toSQL("spanner");
      expect(query).toBe("SELECT * FROM `users`");
    });

    it("should generate SELECT with specific columns and aliases", () => {
      const query = qb
        .select({
          userID: usersTable.columns.id,
          fullName: usersTable.columns.name,
        })
        .from(usersTable)
        .toSQL("spanner");
      expect(query).toBe(
        "SELECT `id` AS `userID`, `name` AS `fullName` FROM `users`"
      );
    });

    it("should generate SELECT with a WHERE clause", () => {
      const query = qb
        .select({ id: usersTable.columns.id })
        .from(usersTable)
        .where(sql`${usersTable.columns.age} > ${30}`)
        .toSQL("spanner");
      expect(query).toBe("SELECT `id` AS `id` FROM `users` WHERE `age` > @p1");
    });

    it("should generate SELECT with LIMIT and OFFSET", () => {
      const query = qb
        .select("*")
        .from(usersTable)
        .limit(10)
        .offset(5)
        .toSQL("spanner");
      expect(query).toBe("SELECT * FROM `users` LIMIT 10 OFFSET 5");
    });

    it("should generate SELECT with raw SQL in select fields for Spanner", () => {
      const query = qb
        .select({ customName: sql`IFNULL(${usersTable.columns.name}, 'N/A')` })
        .from(usersTable)
        .toSQL("spanner");
      // Note: Spanner uses IFNULL, not COALESCE typically.
      // The sql tag function should ideally handle this, or user provides correct SQL.
      // For this test, we assume the user provides Spanner-compatible SQL in the sql tag.
      expect(query).toBe(
        "SELECT IFNULL(`name`, 'N/A') AS `customName` FROM `users`"
      );
    });
  });

  describe("Parameter Binding", () => {
    it("should collect parameters correctly for a simple WHERE clause", () => {
      qb.select("*")
        .from(usersTable)
        .where(sql`${usersTable.columns.age} > ${30}`);
      const params = qb.getBoundParameters();
      expect(params).toEqual([30]);
    });

    it("should collect parameters from multiple WHERE clauses", () => {
      qb.select("*")
        .from(usersTable)
        .where(sql`${usersTable.columns.name} = ${"Bob"}`)
        .where(sql`${usersTable.columns.age} < ${25}`);
      const params = qb.getBoundParameters();
      expect(params).toEqual(["Bob", 25]);
    });

    it("should collect parameters from SQL in select fields", () => {
      qb.select({
        nameWithPrefix: sql`CONCAT(${"Mr. "}, ${usersTable.columns.name})`,
        agePlusTen: sql`${usersTable.columns.age} + ${10}`,
      }).from(usersTable);
      const params = qb.getBoundParameters();
      // Expecting "Mr. " and 10 as parameters. usersTable.columns.name and .age are interpolated as identifiers.
      expect(params).toEqual(["Mr. ", 10]);
    });

    it("should collect parameters from mixed sources (select and where)", () => {
      qb.select({ processedName: sql`LOWER(${usersTable.columns.name})` }) // No param here
        .from(usersTable)
        .where(sql`${usersTable.columns.email} = ${"test@example.com"}`)
        .where(
          sql`(${usersTable.columns.age} BETWEEN ${20} AND ${30}) OR ${
            usersTable.columns.name
          } = ${"Admin"}`
        );

      const params = qb.getBoundParameters();
      // Params: "test@example.com", 20, 30, "Admin"
      expect(params).toEqual(["test@example.com", 20, 30, "Admin"]);
    });

    it("should handle nested SQL parameters correctly", () => {
      const subQueryValue = "sub@test.com";
      const nestedSql = sql`LOWER(${subQueryValue})`;
      qb.select("*")
        .from(usersTable)
        .where(sql`${usersTable.columns.email} = ${nestedSql}`);

      const params = qb.getBoundParameters();
      expect(params).toEqual([subQueryValue]);
      // Test generated SQL to ensure placeholder is correct for nested SQL
      const pgSql = qb.toSQL("pg");
      expect(pgSql).toBe('SELECT * FROM "users" WHERE "email" = LOWER($1)');
    });
  });
});
