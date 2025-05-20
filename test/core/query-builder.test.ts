import { describe, it, expect, beforeEach } from "vitest";
import { QueryBuilder } from "../../src/core/query-builder.js";
import { table, text, integer, timestamp } from "../../src/core/schema.js";
import { sql } from "../../src/types/common.js";
import {
  count,
  // sum, // Not used
  // avg, // Not used
  // min, // Not used
  // max, // Not used
  like,
  ilike,
  regexpContains,
  concat,
  lower,
  // upper, // Not used
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

describe("QueryBuilder SQL Generation with Aliasing", () => {
  let qb: QueryBuilder<typeof usersTable>;

  beforeEach(() => {
    qb = new QueryBuilder<typeof usersTable>();
  });

  describe("PostgreSQL Dialect", () => {
    it("should generate SELECT * with table alias", () => {
      const query = qb.select("*").from(usersTable).toSQL("postgres");
      expect(query).toBe('SELECT * FROM "users" AS "t1"');
    });

    it("should generate SELECT with specific aliased columns", () => {
      const query = qb
        .select({ id: usersTable.columns.id, name: usersTable.columns.name })
        .from(usersTable)
        .toSQL("postgres");
      expect(query).toBe(
        'SELECT "t1"."id" AS "id", "t1"."name" AS "name" FROM "users" AS "t1"'
      );
    });

    it("should generate SELECT with specific columns and custom aliases, using table alias", () => {
      const query = qb
        .select({
          userID: usersTable.columns.id,
          fullName: usersTable.columns.name,
        })
        .from(usersTable)
        .toSQL("postgres");
      expect(query).toBe(
        'SELECT "t1"."id" AS "userID", "t1"."name" AS "fullName" FROM "users" AS "t1"'
      );
    });

    it("should generate SELECT with a WHERE clause and table alias", () => {
      const query = qb
        .select({ id: usersTable.columns.id })
        .from(usersTable)
        .where(sql`${usersTable.columns.age} > ${30}`)
        .toSQL("postgres");
      expect(query).toBe(
        'SELECT "t1"."id" AS "id" FROM "users" AS "t1" WHERE "t1"."age" > $1'
      );
    });

    it("should generate SELECT with LIMIT and table alias", () => {
      const query = qb.select("*").from(usersTable).limit(10).toSQL("postgres");
      expect(query).toBe('SELECT * FROM "users" AS "t1" LIMIT 10');
    });

    it("should generate SELECT with OFFSET and table alias", () => {
      const query = qb.select("*").from(usersTable).offset(5).toSQL("postgres");
      expect(query).toBe('SELECT * FROM "users" AS "t1" OFFSET 5');
    });

    it("should generate SELECT with LIMIT and OFFSET and table alias", () => {
      const query = qb
        .select("*")
        .from(usersTable)
        .limit(10)
        .offset(5)
        .toSQL("postgres");
      expect(query).toBe('SELECT * FROM "users" AS "t1" LIMIT 10 OFFSET 5');
    });

    it("should generate SELECT with multiple WHERE conditions (ANDed) and table alias", () => {
      const query = qb
        .select("*")
        .from(usersTable)
        .where(sql`${usersTable.columns.name} = ${"Alice"}`)
        .where(sql`${usersTable.columns.age} < ${30}`)
        .toSQL("postgres");
      expect(query).toBe(
        'SELECT * FROM "users" AS "t1" WHERE "t1"."name" = $1 AND "t1"."age" < $2'
      );
    });

    it("should generate SELECT with raw SQL in select fields and table alias", () => {
      const query = qb
        .select({ custom: sql`COALESCE(${usersTable.columns.name}, 'N/A')` })
        .from(usersTable)
        .toSQL("postgres");
      expect(query).toBe(
        'SELECT COALESCE("t1"."name", \'N/A\') AS "custom" FROM "users" AS "t1"'
      );
    });
  });

  describe("Spanner Dialect", () => {
    it("should generate SELECT * with table alias", () => {
      const query = qb.select("*").from(usersTable).toSQL("spanner");
      expect(query).toBe("SELECT * FROM `users` AS `t1`");
    });

    it("should generate SELECT with specific columns and custom aliases, using table alias", () => {
      const query = qb
        .select({
          userID: usersTable.columns.id,
          fullName: usersTable.columns.name,
        })
        .from(usersTable)
        .toSQL("spanner");
      expect(query).toBe(
        "SELECT `t1`.`id` AS `userID`, `t1`.`name` AS `fullName` FROM `users` AS `t1`"
      );
    });

    it("should generate SELECT with a WHERE clause and table alias", () => {
      const query = qb
        .select({ id: usersTable.columns.id })
        .from(usersTable)
        .where(sql`${usersTable.columns.age} > ${30}`)
        .toSQL("spanner");
      expect(query).toBe(
        "SELECT `t1`.`id` AS `id` FROM `users` AS `t1` WHERE `t1`.`age` > @p1"
      );
    });

    it("should generate SELECT with LIMIT and OFFSET and table alias", () => {
      const query = qb
        .select("*")
        .from(usersTable)
        .limit(10)
        .offset(5)
        .toSQL("spanner");
      expect(query).toBe("SELECT * FROM `users` AS `t1` LIMIT 10 OFFSET 5");
    });

    it("should generate SELECT with raw SQL in select fields for Spanner and table alias", () => {
      const query = qb
        .select({ customName: sql`IFNULL(${usersTable.columns.name}, 'N/A')` })
        .from(usersTable)
        .toSQL("spanner");
      expect(query).toBe(
        "SELECT IFNULL(`t1`.`name`, 'N/A') AS `customName` FROM `users` AS `t1`"
      );
    });
  });

  describe("Parameter Binding (should be unaffected by aliasing)", () => {
    it("should collect parameters correctly for a simple WHERE clause", () => {
      qb.select("*")
        .from(usersTable)
        .where(sql`${usersTable.columns.age} > ${30}`);
      const params = qb.getBoundParameters("postgres");
      expect(params).toEqual([30]);
    });

    it("should collect parameters from multiple WHERE clauses", () => {
      qb.select("*")
        .from(usersTable)
        .where(sql`${usersTable.columns.name} = ${"Bob"}`)
        .where(sql`${usersTable.columns.age} < ${25}`);
      const params = qb.getBoundParameters("postgres");
      expect(params).toEqual(["Bob", 25]);
    });

    it("should collect parameters from SQL in select fields", () => {
      qb.select({
        nameWithPrefix: sql`CONCAT(${"Mr. "}, ${usersTable.columns.name})`,
        agePlusTen: sql`${usersTable.columns.age} + ${10}`,
      }).from(usersTable);
      const params = qb.getBoundParameters("postgres");
      expect(params).toEqual(["Mr. ", 10]);
    });

    it("should handle nested SQL parameters correctly with aliasing", () => {
      const subQueryValue = "sub@test.com";
      const nestedSql = sql`LOWER(${subQueryValue})`;
      qb.select("*")
        .from(usersTable)
        .where(sql`${usersTable.columns.email} = ${nestedSql}`);

      const params = qb.getBoundParameters("postgres");
      expect(params).toEqual([subQueryValue]);
      const pgSql = qb.toSQL("postgres");
      expect(pgSql).toBe(
        'SELECT * FROM "users" AS "t1" WHERE "t1"."email" = LOWER($1)'
      );
    });
  });

  describe("INSERT Statements (Aliasing less relevant)", () => {
    it("PostgreSQL: should generate INSERT statement for a single row", () => {
      const query = qb
        .insert(usersTable)
        .values({ name: "John Doe", age: 30 })
        .toSQL("postgres");
      expect(query).toBe(
        'INSERT INTO "users" ("age", "createdAt", "name") VALUES ($1, CURRENT_TIMESTAMP, $2)'
      );
      expect(qb.getBoundParameters("postgres")).toEqual([30, "John Doe"]);
    });

    it("Spanner: should generate INSERT statement for a single row", () => {
      const query = qb
        .insert(usersTable)
        .values({ name: "Jane Doe", email: "jane@example.com" })
        .toSQL("spanner");
      expect(query).toBe(
        "INSERT INTO `users` (`createdAt`, `email`, `name`) VALUES (CURRENT_TIMESTAMP, @p1, @p2)"
      );
      expect(qb.getBoundParameters("spanner")).toEqual([
        "jane@example.com",
        "Jane Doe",
      ]);
    });
  });

  describe("UPDATE Statements with Aliasing", () => {
    it("PostgreSQL: should generate UPDATE statement with SET and WHERE using alias", () => {
      const query = qb
        .update(usersTable)
        .set({ age: 31, email: "john.new@example.com" })
        .where(sql`${usersTable.columns.id} = ${1}`)
        .toSQL("postgres");
      expect(query).toBe(
        'UPDATE "users" SET "age" = $1, "email" = $2 WHERE "t1"."id" = $3'
      );
      expect(qb.getBoundParameters("postgres")).toEqual([
        31,
        "john.new@example.com",
        1,
      ]);
    });

    it("Spanner: should generate UPDATE statement with SET and WHERE using alias", () => {
      const query = qb
        .update(usersTable)
        .set({ name: "Updated Name" })
        .where(sql`${usersTable.columns.email} = ${"old@example.com"}`)
        .toSQL("spanner");
      expect(query).toBe(
        "UPDATE `users` SET `name` = @p1 WHERE `t1`.`email` = @p2"
      );
      expect(qb.getBoundParameters("spanner")).toEqual([
        "Updated Name",
        "old@example.com",
      ]);
    });

    it("PostgreSQL: should generate UPDATE statement with SQL in SET using alias", () => {
      const query = qb
        .update(usersTable)
        .set({ age: sql`${usersTable.columns.age} + ${1}` })
        .where(sql`${usersTable.columns.id} = ${10}`)
        .toSQL("postgres");
      expect(query).toBe(
        'UPDATE "users" SET "age" = "t1"."age" + $1 WHERE "t1"."id" = $2'
      );
      expect(qb.getBoundParameters("postgres")).toEqual([1, 10]);
    });
  });

  describe("DELETE Statements with Aliasing", () => {
    it("PostgreSQL: should generate DELETE statement with WHERE using alias", () => {
      const query = qb
        .deleteFrom(usersTable)
        .where(sql`${usersTable.columns.age} < ${18}`)
        .toSQL("postgres");
      expect(query).toBe('DELETE FROM "users" WHERE "t1"."age" < $1');
      expect(qb.getBoundParameters("postgres")).toEqual([18]);
    });

    it("Spanner: should generate DELETE statement with WHERE using alias", () => {
      const query = qb
        .deleteFrom(usersTable)
        .where(sql`${usersTable.columns.email} = ${"spam@example.com"}`)
        .toSQL("spanner");
      expect(query).toBe("DELETE FROM `users` WHERE `t1`.`email` = @p1");
      expect(qb.getBoundParameters("spanner")).toEqual(["spam@example.com"]);
    });

    it("PostgreSQL: should generate DELETE statement without WHERE (no alias needed for table name)", () => {
      const query = qb.deleteFrom(usersTable).toSQL("postgres");
      expect(query).toBe('DELETE FROM "users"');
      expect(qb.getBoundParameters("postgres")).toEqual([]);
    });
  });
});

describe("QueryBuilder JOIN Operations with Aliasing", () => {
  let qbJoin: QueryBuilder<typeof usersTable>; // Use a specific QB for join tests to reset aliases

  beforeEach(() => {
    qbJoin = new QueryBuilder<typeof usersTable>();
  });

  it("PostgreSQL: should generate INNER JOIN with table aliases", () => {
    const query = qbJoin
      .select({
        userName: usersTable.columns.name, // Will be t1.name
        postTitle: postsTable.columns.title, // Will be t2.title
      })
      .from(usersTable) // usersTable becomes t1
      .innerJoin(
        postsTable, // postsTable becomes t2
        sql`${usersTable.columns.id} = ${postsTable.columns.userId}` // t1.id = t2.userId
      )
      .where(sql`${usersTable.columns.age} > ${30}`) // t1.age > $1
      .toSQL("postgres");

    expect(query).toBe(
      'SELECT "t1"."name" AS "userName", "t2"."title" AS "postTitle" FROM "users" AS "t1" INNER JOIN "posts" AS "t2" ON "t1"."id" = "t2"."user_id" WHERE "t1"."age" > $1'
    );
    expect(qbJoin.getBoundParameters("postgres")).toEqual([30]);
  });

  it("Spanner: should generate INNER JOIN with table aliases", () => {
    const query = qbJoin
      .select({
        userName: usersTable.columns.name,
        postTitle: postsTable.columns.title,
      })
      .from(usersTable) // t1
      .innerJoin(
        postsTable, // t2
        sql`${usersTable.columns.id} = ${postsTable.columns.userId}` // t1.id = t2.userId
      )
      .where(sql`${usersTable.columns.age} > ${30}`) // t1.age
      .toSQL("spanner");

    expect(query).toBe(
      "SELECT `t1`.`name` AS `userName`, `t2`.`title` AS `postTitle` FROM `users` AS `t1` INNER JOIN `posts` AS `t2` ON `t1`.`id` = `t2`.`user_id` WHERE `t1`.`age` > @p1"
    );
    expect(qbJoin.getBoundParameters("spanner")).toEqual([30]);
  });

  it("PostgreSQL: should generate LEFT JOIN with table aliases", () => {
    const query = qbJoin
      .select({
        userName: usersTable.columns.name,
        postTitle: postsTable.columns.title,
      })
      .from(usersTable) // t1
      .leftJoin(
        postsTable, // t2
        sql`${usersTable.columns.id} = ${postsTable.columns.userId}` // t1.id = t2.userId
      )
      .toSQL("postgres");
    expect(query).toBe(
      'SELECT "t1"."name" AS "userName", "t2"."title" AS "postTitle" FROM "users" AS "t1" LEFT JOIN "posts" AS "t2" ON "t1"."id" = "t2"."user_id"'
    );
  });

  it("Spanner: should generate LEFT JOIN with table aliases", () => {
    const query = qbJoin
      .select({
        userName: usersTable.columns.name,
        postTitle: postsTable.columns.title,
      })
      .from(usersTable) // t1
      .leftJoin(
        postsTable, // t2
        sql`${usersTable.columns.id} = ${postsTable.columns.userId}` // t1.id = t2.userId
      )
      .toSQL("spanner");
    expect(query).toBe(
      "SELECT `t1`.`name` AS `userName`, `t2`.`title` AS `postTitle` FROM `users` AS `t1` LEFT JOIN `posts` AS `t2` ON `t1`.`id` = `t2`.`user_id`"
    );
  });

  it("PostgreSQL: should collect parameters from JOIN ON condition with aliases", () => {
    qbJoin
      .select({ userName: usersTable.columns.name })
      .from(usersTable) //t1
      .innerJoin(
        postsTable, //t2
        sql`${usersTable.columns.id} = ${postsTable.columns.userId} AND ${
          postsTable.columns.title
        } = ${"My Post"}`
      );
    const params = qbJoin.getBoundParameters("postgres");
    expect(params).toEqual(["My Post"]);
  });
});

describe("QueryBuilder Aggregate and String Functions with Aliasing", () => {
  let qb: QueryBuilder<typeof usersTable>;
  beforeEach(() => {
    qb = new QueryBuilder<typeof usersTable>();
  });

  it("PostgreSQL: CONCAT with aliased columns", () => {
    const query = qb
      .select({
        greeting: concat(
          "Name: ",
          usersTable.columns.name,
          ", Age: ",
          usersTable.columns.age
        ),
      })
      .from(usersTable)
      .toSQL("postgres");
    expect(query).toBe(
      'SELECT CONCAT($1, "t1"."name", $2, "t1"."age") AS "greeting" FROM "users" AS "t1"'
    );
  });
  it("Spanner: CONCAT with aliased columns", () => {
    const query = qb
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
      .toSQL("spanner");
    expect(query).toBe(
      "SELECT CONCAT(@p1, `t1`.`name`, @p2, `t1`.`email`, @p3) AS `greeting` FROM `users` AS `t1`"
    );
  });
  it("PostgreSQL: LOWER with aliased column", () => {
    const query = qb
      .select({ lowerName: lower(usersTable.columns.name) })
      .from(usersTable)
      .toSQL("postgres");
    expect(query).toBe(
      'SELECT LOWER("t1"."name") AS "lowerName" FROM "users" AS "t1"'
    );
  });
  it("PostgreSQL: ORDER BY with aliased column", () => {
    const query = qb
      .select({ name: usersTable.columns.name })
      .from(usersTable)
      .orderBy(usersTable.columns.age, "DESC")
      .toSQL("postgres");
    expect(query).toBe(
      'SELECT "t1"."name" AS "name" FROM "users" AS "t1" ORDER BY "t1"."age" DESC'
    );
  });
  it("PostgreSQL: GROUP BY with aliased column", () => {
    const query = qb
      .select({ age: usersTable.columns.age })
      .from(usersTable)
      .groupBy(usersTable.columns.age)
      .toSQL("postgres");
    expect(query).toBe(
      'SELECT "t1"."age" AS "age" FROM "users" AS "t1" GROUP BY "t1"."age"'
    );
  });
  it("PostgreSQL: COUNT with aliased column", () => {
    const query = qb
      .select({ countOfEmails: count(usersTable.columns.email) })
      .from(usersTable)
      .toSQL("postgres");
    expect(query).toBe(
      'SELECT COUNT("t1"."email") AS "countOfEmails" FROM "users" AS "t1"'
    );
  });
});

// DefaultFn tests should largely be unaffected by aliasing in their core logic,
// as aliasing primarily impacts SELECT, WHERE, JOIN, ORDER, GROUP parts.
// The $defaultFn values are resolved before SQL string generation for values.
// SQL defaults like CURRENT_TIMESTAMP are also unaffected.
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
    const query = qbDefault
      .insert(defaultFnTable)
      .values({ id: 1 })
      .toSQL("postgres");
    // The INSERT statement itself doesn't use aliases like t1.
    expect(query).toContain('INSERT INTO "default_fn_table"');
    // Check that default fn values are processed for parameters
    const params = qbDefault.getBoundParameters("postgres");
    // Sorted columns: created_at_val, id, uuid_val
    expect(params.length).toBe(3);
    expect(params[0]).toBeInstanceOf(Date); // created_at_val
    expect(params[1]).toBe(1); // id
    expect(typeof params[2]).toBe("string"); // uuid_val
  });
});

describe("QueryBuilder String Matching Functions with Aliasing", () => {
  let qb: QueryBuilder<typeof usersTable>;
  beforeEach(() => {
    qb = new QueryBuilder<typeof usersTable>();
  });

  it("PostgreSQL: LIKE with aliased column", () => {
    const query = qb
      .select({ name: usersTable.columns.name })
      .from(usersTable)
      .where(like(usersTable.columns.name, "A%"))
      .toSQL("postgres");
    expect(query).toBe(
      'SELECT "t1"."name" AS "name" FROM "users" AS "t1" WHERE "t1"."name" LIKE $1'
    );
  });
  it("Spanner: LIKE to REGEXP_CONTAINS with aliased column", () => {
    const query = qb
      .select({ name: usersTable.columns.name })
      .from(usersTable)
      .where(like(usersTable.columns.name, "Test%"))
      .toSQL("spanner");
    expect(query).toBe(
      "SELECT `t1`.`name` AS `name` FROM `users` AS `t1` WHERE REGEXP_CONTAINS(`t1`.`name`, @p1)"
    );
  });
  it("PostgreSQL: ILIKE with aliased column", () => {
    const query = qb
      .select({ name: usersTable.columns.name })
      .from(usersTable)
      .where(ilike(usersTable.columns.name, "a%"))
      .toSQL("postgres");
    expect(query).toBe(
      'SELECT "t1"."name" AS "name" FROM "users" AS "t1" WHERE "t1"."name" ILIKE $1'
    );
  });
  it("Spanner: ILIKE to REGEXP_CONTAINS with (?i) and aliased column", () => {
    const query = qb
      .select({ name: usersTable.columns.name })
      .from(usersTable)
      .where(ilike(usersTable.columns.name, "Test%"))
      .toSQL("spanner");
    expect(query).toBe(
      "SELECT `t1`.`name` AS `name` FROM `users` AS `t1` WHERE REGEXP_CONTAINS(`t1`.`name`, @p1)"
    );
    expect(qb.getBoundParameters("spanner")).toEqual(["(?i)^Test.*"]);
  });
  it("PostgreSQL: regexpContains with aliased column", () => {
    const query = qb
      .select({ name: usersTable.columns.name })
      .from(usersTable)
      .where(regexpContains(usersTable.columns.name, "^A.*"))
      .toSQL("postgres");
    expect(query).toBe(
      'SELECT "t1"."name" AS "name" FROM "users" AS "t1" WHERE "t1"."name" ~ $1'
    );
  });
  it("Spanner: regexpContains with aliased column", () => {
    const query = qb
      .select({ name: usersTable.columns.name })
      .from(usersTable)
      .where(regexpContains(usersTable.columns.name, "^A.*"))
      .toSQL("spanner");
    expect(query).toBe(
      "SELECT `t1`.`name` AS `name` FROM `users` AS `t1` WHERE REGEXP_CONTAINS(`t1`.`name`, @p1)"
    );
  });
});
