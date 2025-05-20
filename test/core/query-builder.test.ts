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
      // createdAt has a default SQL value, so it will be included in columns
      // Sorted columns: age, createdAt, name
      expect(query).toBe(
        'INSERT INTO "users" ("age", "createdAt", "name") VALUES ($1, CURRENT_TIMESTAMP, $2)'
      );
      expect(qb.getBoundParameters()).toEqual([30, "John Doe"]);
    });

    it("Spanner: should generate INSERT statement for a single row", () => {
      const query = qb
        .insert(usersTable)
        .values({ name: "Jane Doe", email: "jane@example.com" })
        .toSQL("spanner");
      // Sorted columns: createdAt, email, name
      expect(query).toBe(
        "INSERT INTO `users` (`createdAt`, `email`, `name`) VALUES (CURRENT_TIMESTAMP, @p1, @p2)"
      );
      expect(qb.getBoundParameters()).toEqual(["jane@example.com", "Jane Doe"]);
    });

    it("PostgreSQL: should generate INSERT statement for multiple rows", () => {
      const query = qb
        .insert(usersTable)
        .values([
          { name: "Alice", age: 25 }, // createdAt will use default
          { name: "Bob", age: 35 }, // createdAt will use default
        ])
        .toSQL("postgres");
      // Columns will include 'name', 'age', 'createdAt' due to default
      // The order of columns from allKeys.sort() will be "age", "createdAt", "name"
      // So the SQL will be: INSERT INTO "users" ("age", "createdAt", "name") VALUES ($1, CURRENT_TIMESTAMP, $2), ($3, CURRENT_TIMESTAMP, $4)
      // Let's check for the presence of columns and the correct number of value groups.
      // The exact order of columns in the generated SQL depends on Object.keys and allKeys.sort().
      // For this test, we'll check that the essential parts are there.
      expect(query).toContain('INSERT INTO "users"');
      expect(query).toContain('"name"');
      expect(query).toContain('"age"');
      expect(query).toContain('"createdAt"');
      expect(query).toContain("VALUES");
      expect(query).toContain("CURRENT_TIMESTAMP");
      const valueGroups = query.match(
        /\(\$[0-9]+, CURRENT_TIMESTAMP, \$[0-9]+\)|\(\$[0-9]+, \$[0-9]+, CURRENT_TIMESTAMP\)|\(CURRENT_TIMESTAMP, \$[0-9]+, \$[0-9]+\)/g
      );
      expect(valueGroups).toHaveLength(2);
      // Sorted columns: age, createdAt, name. Params: age, name for each.
      expect(qb.getBoundParameters()).toEqual([25, "Alice", 35, "Bob"]);
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

import crypto from "node:crypto"; // For randomUUID

// --- Tests for $defaultFn ---
describe("QueryBuilder with $defaultFn", () => {
  const defaultFnTable = table("default_fn_table", {
    id: integer("id").primaryKey(),
    uuid_val: text("uuid_val").default(() => crypto.randomUUID()),
    created_at_val: timestamp("created_at_val").default(() => new Date()),
    fixed_default: text("fixed_default").default("default_text"),
    sql_default_ts: timestamp("sql_default_ts").default(sql`CURRENT_TIMESTAMP`),
  });

  let qbDefault: QueryBuilder<typeof defaultFnTable>;

  beforeEach(() => {
    qbDefault = new QueryBuilder<typeof defaultFnTable>();
  });

  it("PostgreSQL: Single Insert with $defaultFn for uuid and date", () => {
    const _query = qbDefault // Marked as unused
      .insert(defaultFnTable)
      .values({ id: 1 })
      .toSQL("postgres");
    const params = qbDefault.getBoundParameters();

    // The SQL string itself is checked implicitly by checking the parameters and their order.
    const generatedSql = _query; // Use the generated SQL for checks if needed
    expect(generatedSql).toContain('INSERT INTO "default_fn_table"');
    expect(generatedSql).toContain('"id"');
    expect(generatedSql).toContain('"uuid_val"');
    expect(generatedSql).toContain('"created_at_val"');
    expect(generatedSql).toContain('"fixed_default"');
    expect(generatedSql).toContain('"sql_default_ts"');
    expect(generatedSql).toContain("CURRENT_TIMESTAMP"); // For sql_default_ts

    // Sorted columns with bound params: created_at_val, fixed_default, id, uuid_val
    expect(params.length).toBe(4);
    expect(params[0]).toBeInstanceOf(Date); // created_at_val from function
    expect(params[1]).toBe("default_text"); // fixed_default
    expect(params[2]).toBe(1); // id
    expect(typeof params[3]).toBe("string"); // uuid_val from function
    expect(params[3] as string).toHaveLength(36);
  });

  it("Spanner: Single Insert with $defaultFn for uuid and date", () => {
    const _query = qbDefault // Marked as unused
      .insert(defaultFnTable)
      .values({ id: 1 })
      .toSQL("spanner");
    const params = qbDefault.getBoundParameters();

    // The SQL string itself is checked implicitly by checking the parameters and their order.
    const generatedSpannerSql = _query;
    expect(generatedSpannerSql).toContain("INSERT INTO `default_fn_table`");
    expect(generatedSpannerSql).toContain("`id`");
    expect(generatedSpannerSql).toContain("`uuid_val`");
    expect(generatedSpannerSql).toContain("`created_at_val`");
    expect(generatedSpannerSql).toContain("`fixed_default`");
    expect(generatedSpannerSql).toContain("`sql_default_ts`");
    expect(generatedSpannerSql).toContain("CURRENT_TIMESTAMP");

    // Sorted columns with bound params: created_at_val, fixed_default, id, uuid_val
    expect(params.length).toBe(4);
    expect(params[0]).toBeInstanceOf(Date); // created_at_val from function
    expect(params[1]).toBe("default_text"); // fixed_default
    expect(params[2]).toBe(1); // id
    expect(typeof params[3]).toBe("string"); // uuid_val from function
    expect(params[3] as string).toHaveLength(36);
  });

  it("PostgreSQL: Single Insert overriding $defaultFn", () => {
    const specificUuid = crypto.randomUUID();
    const specificDate = new Date(2023, 0, 1); // Jan 1, 2023
    const _query = qbDefault // Marked as unused
      .insert(defaultFnTable)
      .values({
        id: 2,
        uuid_val: specificUuid,
        created_at_val: specificDate, // fixed_default will use its default "default_text"
      })
      .toSQL("postgres");
    const params = qbDefault.getBoundParameters();

    // Sorted columns with bound params: created_at_val, fixed_default, id, uuid_val
    // Values: specificDate, "default_text", 2, specificUuid
    expect(params).toEqual([specificDate, "default_text", 2, specificUuid]);
  });

  it("PostgreSQL: Batch Insert with $defaultFn, some overridden", () => {
    const specificUuid = crypto.randomUUID();
    const specificDate = new Date(2023, 0, 15);
    const _query = qbDefault // Marked as unused
      .insert(defaultFnTable)
      .values([
        { id: 3 }, // R1: created_at_val (fn), fixed_default ("default_text"), id (3), uuid_val (fn)
        { id: 4, uuid_val: specificUuid }, // R2: created_at_val (fn), fixed_default ("default_text"), id (4), uuid_val (specificUuid)
        { id: 5, created_at_val: specificDate }, // R3: created_at_val (specificDate), fixed_default ("default_text"), id (5), uuid_val (fn)
        { id: 6, fixed_default: "overridden_text" }, // R4: created_at_val (fn), fixed_default ("overridden_text"), id (6), uuid_val (fn)
      ])
      .toSQL("postgres");

    const params = qbDefault.getBoundParameters();
    // Each record has 4 bound parameters. Sorted: created_at_val, fixed_default, id, uuid_val
    expect(params.length).toBe(4 * 4);

    // Record 1 (id: 3)
    expect(params[0]).toBeInstanceOf(Date); // created_at_val (fn)
    expect(params[1]).toBe("default_text"); // fixed_default
    expect(params[2]).toBe(3); // id
    expect(typeof params[3]).toBe("string"); // uuid_val (fn)

    // Record 2 (id: 4) - uuid_val overridden
    expect(params[4]).toBeInstanceOf(Date); // created_at_val (fn)
    expect(params[5]).toBe("default_text"); // fixed_default
    expect(params[6]).toBe(4); // id
    expect(params[7]).toBe(specificUuid); // overridden uuid_val

    // Record 3 (id: 5) - created_at_val overridden
    expect(params[8]).toEqual(specificDate); // overridden created_at_val
    expect(params[9]).toBe("default_text"); // fixed_default
    expect(params[10]).toBe(5); // id
    expect(typeof params[11]).toBe("string"); // uuid_val (fn)

    // Record 4 (id: 6) - fixed_default overridden
    expect(params[12]).toBeInstanceOf(Date); // created_at_val (fn)
    expect(params[13]).toBe("overridden_text"); // overridden fixed_default
    expect(params[14]).toBe(6); // id
    expect(typeof params[15]).toBe("string"); // uuid_val (fn)
  });

  it("PostgreSQL: $defaultFn returning SQL object (now direct SQL default)", () => {
    const tableWithSqlDefault = table("sql_fn_table", {
      id: integer("id").primaryKey(),
      complex_default: text("complex_default").default(
        sql`LOWER('DEFAULT_VALUE')` // Direct SQL object as default
      ),
    });
    const qbSqlFn = new QueryBuilder<typeof tableWithSqlDefault>();
    const query = qbSqlFn
      .insert(tableWithSqlDefault)
      .values({ id: 1 }) // complex_default should use its SQL default
      .toSQL("postgres");
    const params = qbSqlFn.getBoundParameters();

    // Sorted columns: complex_default, id
    // SQL for complex_default is inlined, not a parameter
    expect(query).toBe(
      'INSERT INTO "sql_fn_table" ("complex_default", "id") VALUES (LOWER(\'DEFAULT_VALUE\'), $1)'
    );
    expect(params).toEqual([1]); // Only 'id' is a bound parameter.
  });
});
