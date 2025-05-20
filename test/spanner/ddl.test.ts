// test/spanner/ddl.test.ts
import { describe, it, expect } from "vitest";
import {
  table,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  sql,
  // index, // Spanner unique indexes are separate DDL, not tested here for CREATE TABLE
  // uniqueIndex,
} from "../../src/core/schema.js";
import { generateCreateTableSpanner } from "../../src/spanner/ddl.js";

describe("Spanner DDL Generator", () => {
  it("should generate a CREATE TABLE statement for a simple table (Spanner)", () => {
    const users = table("users", {
      id: varchar("id", { length: 36 }).primaryKey(), // Spanner: STRING(36)
      email: text("email").notNull().unique(), // Spanner: STRING(MAX)
      age: integer("age").default(0), // Spanner: INT64
      isAdmin: boolean("is_admin").default(false), // Spanner: BOOL
      bio: text("bio"), // Spanner: STRING(MAX)
      settings: jsonb("settings").default({ theme: "light" }), // Spanner: JSON
      lastLogin: timestamp("last_login").default(sql`CURRENT_TIMESTAMP`), // Spanner: TIMESTAMP
    });

    // Note: Spanner does not have inline UNIQUE on columns. Unique constraints are via CREATE UNIQUE INDEX.
    // The primary key implies not null for its columns in Spanner.
    // Default values are wrapped in parentheses.
    const expectedSql = `CREATE TABLE users (
  id STRING(36) NOT NULL,
  email STRING(MAX) NOT NULL,
  age INT64 DEFAULT (0),
  is_admin BOOL DEFAULT (FALSE),
  bio STRING(MAX),
  settings JSON DEFAULT (JSON '{"theme":"light"}'),
  last_login TIMESTAMP DEFAULT (CURRENT_TIMESTAMP())
) PRIMARY KEY (id);`
      .replace(/\\s+/g, " ")
      .trim();

    const actualSql = generateCreateTableSpanner(users)
      .replace(/\\s+/g, " ")
      .trim();
    expect(actualSql).toBe(expectedSql);
  });

  it("should handle tables with various constraints and default types (Spanner)", () => {
    const products = table(
      "products",
      {
        productId: integer("product_id").primaryKey(),
        productName: varchar("product_name", { length: 255 }).notNull(),
        description: text("description"), // STRING(MAX)
        price: integer("price").notNull().default(1000),
        sku: varchar("sku", { length: 50 }).notNull().unique(), // unique() will be via separate index
        isActive: boolean("is_active").default(true),
        data: jsonb("data"), // JSON
      }
      // Spanner unique indexes are separate DDL, so table-level unique constraints are not added here.
    );
    const expectedSql = `CREATE TABLE products (
  product_id INT64 NOT NULL,
  product_name STRING(255) NOT NULL,
  description STRING(MAX),
  price INT64 NOT NULL DEFAULT (1000),
  sku STRING(50) NOT NULL,
  is_active BOOL DEFAULT (TRUE),
  data JSON
) PRIMARY KEY (product_id);`
      .replace(/\\s+/g, " ")
      .trim();

    const actualSql = generateCreateTableSpanner(products)
      .replace(/\\s+/g, " ")
      .trim();
    expect(actualSql).toBe(expectedSql);
  });

  it("should handle composite primary keys (Spanner)", () => {
    const orderItems = table("order_items", {
      orderId: integer("order_id").primaryKey(), // INT64
      itemId: integer("item_id").primaryKey(), // INT64
      quantity: integer("quantity").notNull().default(1),
    });
    // In Spanner, columns part of PK are implicitly NOT NULL.
    // The DDL generator should reflect this by adding NOT NULL.
    const expectedSql = `CREATE TABLE order_items (
  order_id INT64 NOT NULL,
  item_id INT64 NOT NULL,
  quantity INT64 NOT NULL DEFAULT (1)
) PRIMARY KEY (order_id, item_id);`
      .replace(/\\s+/g, " ")
      .trim();
    const actualSql = generateCreateTableSpanner(orderItems)
      .replace(/\\s+/g, " ")
      .trim();
    expect(actualSql).toBe(expectedSql);
  });

  it("should correctly escape identifiers if needed (Spanner)", () => {
    const weirdTable = table("table with spaces", {
      // Will be \`table with spaces\`
      order: integer("order").primaryKey(), // "order" is a reserved keyword, will be \`order\`
      "col-with-hyphen": text("col-with-hyphen"), // Will be \`col-with-hyphen\`
    });
    // PK columns like 'order' should be NOT NULL.
    const expectedSql = `CREATE TABLE \`table with spaces\` (
  \`order\` INT64 NOT NULL,
  \`col-with-hyphen\` STRING(MAX)
) PRIMARY KEY (\`order\`);`
      .replace(/\\s+/g, " ")
      .trim();
    const actualSql = generateCreateTableSpanner(weirdTable)
      .replace(/\\s+/g, " ")
      .trim();
    expect(actualSql).toBe(expectedSql);
  });

  it("should handle varchar without length as STRING(MAX) for Spanner", () => {
    const logs = table("logs", {
      message: varchar("message"), // No length -> STRING(MAX)
    });
    const expectedSql = `CREATE TABLE logs (
  message STRING(MAX)
);` // No PK defined
      .replace(/\\s+/g, " ")
      .trim();
    const actualSql = generateCreateTableSpanner(logs)
      .replace(/\\s+/g, " ")
      .trim();
    expect(actualSql).toBe(expectedSql);
  });

  it("should use dialectTypes.spanner for column types", () => {
    const customTypes = table("customs", {
      id: varchar("id", { length: 36 }).primaryKey(),
      pgOnly: text("pg_specific_type"), // This would use dialectTypes.spanner from schema.ts
      spannerOnly: varchar("spanner_specific_type", { length: 100 }),
    });
    // From schema.ts:
    // text -> { postgres: "TEXT", spanner: "STRING" } -> effectively STRING(MAX) if not overridden by varchar
    // varchar -> { postgres: VARCHAR(len), spanner: STRING(len) }
    // The VarcharColumnBuilder sets spanner to STRING(MAX) if no length, or STRING(len) if length.
    // The TextColumnBuilder sets spanner to STRING (which implies STRING(MAX) in Spanner if no length is given in DDL)

    const expectedSql = `CREATE TABLE customs (
  id STRING(36) NOT NULL,
  pg_specific_type STRING(MAX),
  spanner_specific_type STRING(100)
) PRIMARY KEY (id);`
      .replace(/\\s+/g, " ")
      .trim();

    const actualSql = generateCreateTableSpanner(customTypes)
      .replace(/\\s+/g, " ")
      .trim();
    expect(actualSql).toBe(expectedSql);
  });

  it("should generate CREATE TABLE for an interleaved table with ON DELETE CASCADE (Spanner)", () => {
    // Parent table (not generated in this specific test, but defined for context)
    // const singers = table("Singers", {
    //   SingerId: integer("SingerId").primaryKey(),
    //   FirstName: varchar("FirstName", { length: 100 }),
    //   LastName: varchar("LastName", { length: 100 }).notNull(),
    // });

    // Child table, interleaved in Singers
    const albums = table(
      "Albums",
      {
        SingerId: integer("SingerId").primaryKey(), // Must match parent PK column(s)
        AlbumId: integer("AlbumId").primaryKey(), // Child's own PK column(s)
        AlbumTitle: text("AlbumTitle"),
      },
      () => ({
        // Corrected: interleave is in the function's return
        interleave: {
          parentTable: "Singers",
          onDelete: "cascade",
        },
      })
    );

    // PK columns are implicitly NOT NULL.
    const expectedSql = `CREATE TABLE Albums (
  SingerId INT64 NOT NULL,
  AlbumId INT64 NOT NULL,
  AlbumTitle STRING(MAX)
) PRIMARY KEY (SingerId, AlbumId),
  INTERLEAVE IN PARENT Singers ON DELETE CASCADE;`
      .replace(/\\s+/g, " ")
      .trim();

    const actualSql = generateCreateTableSpanner(albums)
      .replace(/\\s+/g, " ")
      .trim();
    expect(actualSql).toBe(expectedSql);
  });

  it("should generate CREATE TABLE for an interleaved table with ON DELETE NO ACTION (Spanner)", () => {
    // Parent table
    // const customers = table("Customers", {
    //   CustomerId: varchar("CustomerId", { length: 36 }).primaryKey(),
    // });

    // Child table
    const shoppingCarts = table(
      "ShoppingCarts",
      {
        CustomerId: varchar("CustomerId", { length: 36 }).primaryKey(),
        CartId: varchar("CartId", { length: 36 }).primaryKey(),
        LastUpdated: timestamp("LastUpdated"),
      },
      () => ({
        // Corrected: interleave is in the function's return
        interleave: {
          parentTable: "Customers",
          onDelete: "no action",
        },
      })
    );

    const expectedSql = `CREATE TABLE ShoppingCarts (
  CustomerId STRING(36) NOT NULL,
  CartId STRING(36) NOT NULL,
  LastUpdated TIMESTAMP
) PRIMARY KEY (CustomerId, CartId),
  INTERLEAVE IN PARENT Customers ON DELETE NO ACTION;`
      .replace(/\\s+/g, " ")
      .trim();

    const actualSql = generateCreateTableSpanner(shoppingCarts)
      .replace(/\\s+/g, " ")
      .trim();
    expect(actualSql).toBe(expectedSql);
  });
});
