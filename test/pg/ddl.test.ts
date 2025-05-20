// test/pg/ddl.test.ts
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
  index,
  uniqueIndex,
} from "../../src/core/schema.js";
import { generateCreateTablePostgres } from "../../src/pg/ddl.js";

describe("PostgreSQL DDL Generator", () => {
  it("should generate a CREATE TABLE statement for a simple table", () => {
    const users = table("users", {
      id: varchar("id", { length: 36 }).primaryKey(),
      email: text("email").notNull().unique(),
      age: integer("age").default(0),
      isAdmin: boolean("is_admin").default(false),
      bio: text("bio"), // Nullable text
      settings: jsonb("settings").default({ theme: "light" }), // JSONB with object default
      lastLogin: timestamp("last_login").default(sql`CURRENT_TIMESTAMP`),
    });

    const expectedSql = `CREATE TABLE "users" (
  "id" VARCHAR(36) NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "age" INTEGER DEFAULT 0,
  "is_admin" BOOLEAN DEFAULT false,
  "bio" TEXT,
  "settings" JSONB DEFAULT '{"theme":"light"}',
  "last_login" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);` // Removed table-level PRIMARY KEY for single PK
      .replace(/\\s+/g, " ")
      .trim(); // Normalize whitespace for comparison

    const actualSql = generateCreateTablePostgres(users)
      .replace(/\\s+/g, " ")
      .trim();
    expect(actualSql).toBe(expectedSql);
  });

  it("should handle tables with various constraints and default types", () => {
    const products = table(
      "products",
      {
        productId: integer("product_id").primaryKey(),
        productName: varchar("product_name", { length: 255 }).notNull(),
        description: text("description"),
        price: integer("price").notNull().default(1000), // Assuming price in cents
        sku: varchar("sku", { length: 50 }).unique().notNull(),
        isActive: boolean("is_active").default(true),
        data: jsonb("data"),
      },
      (_t) => ({
        // Prefixed t with _
        indexes: [
          uniqueIndex({ name: "uq_product_sku", columns: ["sku"] }), // This will be an inline unique constraint
          index({ name: "idx_product_name", columns: ["productName"] }), // This will be ignored by current DDL gen
        ],
      })
    );
    const expectedSql = `CREATE TABLE "products" (
  "product_id" INTEGER NOT NULL PRIMARY KEY,
  "product_name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "price" INTEGER NOT NULL DEFAULT 1000,
  "sku" VARCHAR(50) NOT NULL UNIQUE,
  "is_active" BOOLEAN DEFAULT true,
  "data" JSONB,
  CONSTRAINT "uq_product_sku" UNIQUE ("sku")
);` // Removed table-level PRIMARY KEY for single PK, unique constraint from index is fine
      .replace(/\\s+/g, " ")
      .trim();

    const actualSql = generateCreateTablePostgres(products)
      .replace(/\\s+/g, " ")
      .trim();
    expect(actualSql).toBe(expectedSql);
  });

  it("should handle composite primary keys defined on columns", () => {
    const orderItems = table("order_items", {
      orderId: integer("order_id").primaryKey(),
      itemId: integer("item_id").primaryKey(),
      quantity: integer("quantity").notNull().default(1),
    });
    const expectedSql = `CREATE TABLE "order_items" (
  "order_id" INTEGER NOT NULL,
  "item_id" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("order_id", "item_id")
);`
      .replace(/\\s+/g, " ")
      .trim();
    const actualSql = generateCreateTablePostgres(orderItems)
      .replace(/\\s+/g, " ")
      .trim();
    expect(actualSql).toBe(expectedSql);
  });

  it("should handle unique constraints from table definition", () => {
    const categories = table(
      "categories",
      {
        id: integer("id").primaryKey(),
        name: varchar("name", { length: 100 }).notNull(),
      },
      (_t) => ({
        indexes: [uniqueIndex({ columns: ["name"] })], // unnamed unique index
      })
    );

    const expectedSql = `CREATE TABLE "categories" (
  "id" INTEGER NOT NULL PRIMARY KEY,
  "name" VARCHAR(100) NOT NULL,
  CONSTRAINT "uq_categories_name" UNIQUE ("name")
);` // Removed table-level PRIMARY KEY for single PK
      .replace(/\\s+/g, " ")
      .trim();
    const actualSql = generateCreateTablePostgres(categories)
      .replace(/\\s+/g, " ")
      .trim();
    expect(actualSql).toBe(expectedSql);
  });

  it("should correctly escape identifiers", () => {
    const weirdTable = table("table with spaces", {
      'column with quotes"': text('col"umn').primaryKey(),
    });
    const expectedSql = `CREATE TABLE "table with spaces" (
  "col""umn" TEXT NOT NULL PRIMARY KEY
);` // Removed table-level PRIMARY KEY for single PK
      .replace(/\\s+/g, " ")
      .trim();
    const actualSql = generateCreateTablePostgres(weirdTable)
      .replace(/\\s+/g, " ")
      .trim();
    expect(actualSql).toBe(expectedSql);
  });
});
