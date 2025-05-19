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
      const query = qb.select("*").from(usersTable).toSQL("postgres");
      expect(query).toBe('SELECT * FROM "users"');
    });

    it("should generate SELECT with specific columns", () => {
      const query = qb
        .select({ id: usersTable.columns.id, name: usersTable.columns.name })
        .from(usersTable)
        .toSQL("postgres");
      expect(query).toBe('SELECT "id" AS "id", "name" AS "name" FROM "users"');
    });

    it("should generate SELECT with specific columns and aliases", () => {
      const query = qb
        .select({
          userID: usersTable.columns.id,
          fullName: usersTable.columns.name,
        })
        .from(usersTable)
        .toSQL("postgres");
      expect(query).toBe(
        'SELECT "id" AS "userID", "name" AS "fullName" FROM "users"'
      );
    });

    it("should generate SELECT with a WHERE clause", () => {
      const query = qb
        .select({ id: usersTable.columns.id })
        .from(usersTable)
        .where(sql`${usersTable.columns.age} > ${30}`)
        .toSQL("postgres");
      expect(query).toBe('SELECT "id" AS "id" FROM "users" WHERE "age" > $1');
    });

    it("should generate SELECT with LIMIT", () => {
      const query = qb.select("*").from(usersTable).limit(10).toSQL("postgres");
      expect(query).toBe('SELECT * FROM "users" LIMIT 10');
    });

    it("should generate SELECT with OFFSET", () => {
      const query = qb.select("*").from(usersTable).offset(5).toSQL("postgres");
      expect(query).toBe('SELECT * FROM "users" OFFSET 5');
    });

    it("should generate SELECT with LIMIT and OFFSET", () => {
      const query = qb
        .select("*")
        .from(usersTable)
        .limit(10)
        .offset(5)
        .toSQL("postgres");
      expect(query).toBe('SELECT * FROM "users" LIMIT 10 OFFSET 5');
    });

    it("should generate SELECT with multiple WHERE conditions (ANDed)", () => {
      const query = qb
        .select("*")
        .from(usersTable)
        .where(sql`${usersTable.columns.name} = ${"Alice"}`)
        .where(sql`${usersTable.columns.age} < ${30}`)
        .toSQL("postgres");
      expect(query).toBe(
        'SELECT * FROM "users" WHERE "name" = $1 AND "age" < $2'
      );
    });

    it("should generate SELECT with raw SQL in select fields", () => {
      const query = qb
        .select({ custom: sql`COALESCE(${usersTable.columns.name}, 'N/A')` })
        .from(usersTable)
        .toSQL("postgres");
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
      const pgSql = qb.toSQL("postgres");
      expect(pgSql).toBe('SELECT * FROM "users" WHERE "email" = LOWER($1)');
    });
  });

  // --- INSERT Statements ---
  describe("INSERT Statements", () => {
    it("PostgreSQL: should generate INSERT statement for a single row", () => {
      const query = qb
        .insert(usersTable)
        .values({ name: "John Doe", age: 30 })
        .toSQL("postgres");
      expect(query).toBe('INSERT INTO "users" ("name", "age") VALUES ($1, $2)');
      expect(qb.getBoundParameters()).toEqual(["John Doe", 30]);
    });

    it("Spanner: should generate INSERT statement for a single row", () => {
      const query = qb
        .insert(usersTable)
        .values({ name: "Jane Doe", email: "jane@example.com" })
        .toSQL("spanner");
      expect(query).toBe(
        "INSERT INTO `users` (`name`, `email`) VALUES (@p1, @p2)"
      );
      expect(qb.getBoundParameters()).toEqual(["Jane Doe", "jane@example.com"]);
    });

    it("PostgreSQL: should generate INSERT statement for multiple rows", () => {
      const query = qb
        .insert(usersTable)
        .values([
          { name: "Alice", age: 25 },
          { name: "Bob", age: 35 },
        ])
        .toSQL("postgres");
      expect(query).toBe(
        'INSERT INTO "users" ("name", "age") VALUES ($1, $2), ($3, $4)'
      );
      expect(qb.getBoundParameters()).toEqual(["Alice", 25, "Bob", 35]);
    });
  });

  // --- UPDATE Statements ---
  describe("UPDATE Statements", () => {
    it("PostgreSQL: should generate UPDATE statement with SET and WHERE", () => {
      const query = qb
        .update(usersTable)
        .set({ age: 31, email: "john.new@example.com" })
        .where(sql`${usersTable.columns.id} = ${1}`)
        .toSQL("postgres");
      expect(query).toBe(
        'UPDATE "users" SET "age" = $1, "email" = $2 WHERE "id" = $3'
      );
      expect(qb.getBoundParameters()).toEqual([31, "john.new@example.com", 1]);
    });

    it("Spanner: should generate UPDATE statement with SET and WHERE", () => {
      const query = qb
        .update(usersTable)
        .set({ name: "Updated Name" })
        .where(sql`${usersTable.columns.email} = ${"old@example.com"}`)
        .toSQL("spanner");
      expect(query).toBe("UPDATE `users` SET `name` = @p1 WHERE `email` = @p2");
      expect(qb.getBoundParameters()).toEqual([
        "Updated Name",
        "old@example.com",
      ]);
    });

    it("PostgreSQL: should generate UPDATE statement with SQL in SET", () => {
      const query = qb
        .update(usersTable)
        .set({ age: sql`${usersTable.columns.age} + ${1}` })
        .where(sql`${usersTable.columns.id} = ${10}`)
        .toSQL("postgres");
      expect(query).toBe(
        'UPDATE "users" SET "age" = "age" + $1 WHERE "id" = $2'
      );
      expect(qb.getBoundParameters()).toEqual([1, 10]);
    });
  });

  // --- DELETE Statements ---
  describe("DELETE Statements", () => {
    it("PostgreSQL: should generate DELETE statement with WHERE", () => {
      const query = qb
        .deleteFrom(usersTable)
        .where(sql`${usersTable.columns.age} < ${18}`)
        .toSQL("postgres");
      expect(query).toBe('DELETE FROM "users" WHERE "age" < $1');
      expect(qb.getBoundParameters()).toEqual([18]);
    });

    it("Spanner: should generate DELETE statement with WHERE", () => {
      const query = qb
        .deleteFrom(usersTable)
        .where(sql`${usersTable.columns.email} = ${"spam@example.com"}`)
        .toSQL("spanner");
      expect(query).toBe("DELETE FROM `users` WHERE `email` = @p1");
      expect(qb.getBoundParameters()).toEqual(["spam@example.com"]);
    });

    it("PostgreSQL: should generate DELETE statement without WHERE (deletes all rows)", () => {
      const query = qb.deleteFrom(usersTable).toSQL("postgres");
      expect(query).toBe('DELETE FROM "users"');
      expect(qb.getBoundParameters()).toEqual([]);
    });
  });
  // Note: Tests for transaction execution would typically involve mocking the adapter
  // and are beyond the scope of QueryBuilder unit tests for SQL generation.
  // Transaction logic is tested at the adapter level.
});
