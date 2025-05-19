// test/core/migration-generator.test.ts

import { describe, it, expect } from "vitest";
import { generateMigrationDDL } from "../../src/core/migration-generator";
import type {
  SchemaDiff,
  TableSnapshot,
  ColumnSnapshot,
  IndexSnapshot,
  CompositePrimaryKeySnapshot,
  InterleaveSnapshot,
} from "../../src/types/common";

const V1_SNAPSHOT_VERSION = "1.0.0";

const createSampleColumn = (
  name: string,
  type: string,
  dialectTypes: { pg: string; spanner: string },
  overrides: Partial<ColumnSnapshot> = {}
): ColumnSnapshot => ({
  name,
  type,
  dialectTypes: { postgres: dialectTypes.pg, spanner: dialectTypes.spanner },
  ...overrides,
});

const createSampleTable = (
  name: string,
  columns: Record<string, ColumnSnapshot>,
  indexes?: IndexSnapshot[],
  pk?: CompositePrimaryKeySnapshot,
  interleave?: InterleaveSnapshot
): TableSnapshot => ({
  name,
  columns,
  indexes,
  compositePrimaryKey: pk,
  interleave,
});

describe("generateMigrationDDL", () => {
  describe("PostgreSQL DDL Generation", () => {
    it("should generate CREATE TABLE DDL for an added table", () => {
      const usersTable = createSampleTable("users", {
        id: createSampleColumn(
          "id",
          "integer",
          { pg: "INTEGER", spanner: "INT64" },
          { primaryKey: true, notNull: true }
        ),
        email: createSampleColumn(
          "email",
          "varchar",
          { pg: "VARCHAR(255)", spanner: "STRING(255)" },
          { notNull: true, unique: true }
        ),
        bio: createSampleColumn("bio", "text", {
          pg: "TEXT",
          spanner: "STRING(MAX)",
        }),
      });
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [{ action: "add", table: usersTable }],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres");
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe(
        'CREATE TABLE "users" (\n' +
          '  "id" INTEGER NOT NULL PRIMARY KEY,\n' +
          '  "email" VARCHAR(255) NOT NULL UNIQUE,\n' +
          '  "bio" TEXT\n' +
          ");"
      );
    });

    it("should generate CREATE TABLE DDL with composite PK and unique constraint", () => {
      const orderItemsTable = createSampleTable(
        "order_items",
        {
          order_id: createSampleColumn(
            "order_id",
            "integer",
            { pg: "INTEGER", spanner: "INT64" },
            { notNull: true }
          ),
          item_id: createSampleColumn(
            "item_id",
            "integer",
            { pg: "INTEGER", spanner: "INT64" },
            { notNull: true }
          ),
          quantity: createSampleColumn(
            "quantity",
            "integer",
            { pg: "INTEGER", spanner: "INT64" },
            { default: 1 }
          ),
        },
        [
          {
            name: "uq_order_item",
            columns: ["order_id", "item_id"],
            unique: true,
          },
        ], // Unique constraint
        { columns: ["order_id", "item_id"] } // Composite PK
      );
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [{ action: "add", table: orderItemsTable }],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres");
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe(
        'CREATE TABLE "order_items" (\n' +
          '  "order_id" INTEGER NOT NULL,\n' +
          '  "item_id" INTEGER NOT NULL,\n' +
          '  "quantity" INTEGER DEFAULT 1,\n' +
          '  PRIMARY KEY ("order_id", "item_id"),\n' +
          '  CONSTRAINT "uq_order_item" UNIQUE ("order_id", "item_id")\n' +
          ");"
      );
    });

    it("should generate CREATE TABLE and CREATE INDEX for non-unique index", () => {
      const productsTable = createSampleTable(
        "products",
        {
          product_id: createSampleColumn(
            "product_id",
            "integer",
            { pg: "INTEGER", spanner: "INT64" },
            { primaryKey: true }
          ),
          category: createSampleColumn("category", "varchar", {
            pg: "VARCHAR(100)",
            spanner: "STRING(100)",
          }),
        },
        [{ name: "idx_product_category", columns: ["category"], unique: false }]
      );
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [{ action: "add", table: productsTable }],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres");
      expect(ddl.length).toBe(2);
      expect(ddl[0]).toContain('CREATE TABLE "products"');
      expect(ddl[1]).toBe(
        'CREATE INDEX "idx_product_category" ON "products" ("category");'
      );
    });

    it("should generate DROP TABLE DDL for a removed table", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [{ action: "remove", tableName: "old_users" }],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres");
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe('DROP TABLE "old_users";');
    });
  });

  describe("Spanner DDL Generation", () => {
    it("should generate CREATE TABLE DDL for an added table", () => {
      const usersTable = createSampleTable("Users", {
        // Spanner is case-sensitive for identifiers
        UserId: createSampleColumn(
          "UserId",
          "integer",
          { pg: "INTEGER", spanner: "INT64" },
          { primaryKey: true, notNull: true }
        ),
        Email: createSampleColumn(
          "Email",
          "varchar",
          { pg: "VARCHAR(255)", spanner: "STRING(255)" },
          { notNull: true }
        ),
        Bio: createSampleColumn("Bio", "text", {
          pg: "TEXT",
          spanner: "STRING(MAX)",
        }),
      });
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [{ action: "add", table: usersTable }],
      };
      const ddl = generateMigrationDDL(schemaDiff, "spanner");
      expect(ddl.length).toBe(1); // CREATE TABLE only, unique indexes are separate
      expect(ddl[0]).toBe(
        "CREATE TABLE Users (\n" +
          "  UserId INT64 NOT NULL,\n" +
          "  Email STRING(255) NOT NULL,\n" +
          "  Bio STRING(MAX)\n" +
          ") PRIMARY KEY (UserId);"
      );
    });

    it("should generate CREATE TABLE and CREATE UNIQUE INDEX DDL", () => {
      const productsTable = createSampleTable(
        "Products",
        {
          ProductId: createSampleColumn(
            "ProductId",
            "integer",
            { pg: "INTEGER", spanner: "INT64" },
            { primaryKey: true }
          ),
          ProductCode: createSampleColumn(
            "ProductCode",
            "varchar",
            { pg: "VARCHAR(50)", spanner: "STRING(50)" },
            { notNull: true }
          ),
        },
        [{ name: "UQ_ProductCode", columns: ["ProductCode"], unique: true }]
      );
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [{ action: "add", table: productsTable }],
      };
      const ddl = generateMigrationDDL(schemaDiff, "spanner");
      expect(ddl.length).toBe(2);
      expect(ddl[0]).toContain("CREATE TABLE Products");
      expect(ddl[1]).toBe(
        "CREATE UNIQUE INDEX UQ_ProductCode ON Products (ProductCode);"
      );
    });

    it("should generate CREATE TABLE with INTERLEAVE and non-unique index", () => {
      const orderDetailsTable = createSampleTable(
        "OrderDetails",
        {
          OrderId: createSampleColumn(
            "OrderId",
            "integer",
            { pg: "INTEGER", spanner: "INT64" },
            { notNull: true }
          ),
          DetailId: createSampleColumn(
            "DetailId",
            "integer",
            { pg: "INTEGER", spanner: "INT64" },
            { notNull: true }
          ),
          Notes: createSampleColumn("Notes", "text", {
            pg: "TEXT",
            spanner: "STRING(MAX)",
          }),
        },
        [{ name: "IDX_OrderDetails_Notes", columns: ["Notes"], unique: false }],
        { columns: ["OrderId", "DetailId"] }, // Composite PK
        { parentTable: "Orders", onDelete: "cascade" } // Interleave
      );
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [{ action: "add", table: orderDetailsTable }],
      };
      const ddl = generateMigrationDDL(schemaDiff, "spanner");
      expect(ddl.length).toBe(2); // CREATE TABLE, CREATE INDEX
      expect(ddl[0]).toBe(
        "CREATE TABLE OrderDetails (\n" +
          "  OrderId INT64 NOT NULL,\n" +
          "  DetailId INT64 NOT NULL,\n" +
          "  Notes STRING(MAX)\n" +
          ") PRIMARY KEY (OrderId, DetailId),\n" +
          "  INTERLEAVE IN PARENT Orders ON DELETE CASCADE;"
      );
      expect(ddl[1]).toBe(
        "CREATE INDEX IDX_OrderDetails_Notes ON OrderDetails (Notes);"
      );
    });

    it("should generate DROP TABLE DDL for a removed table", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [{ action: "remove", tableName: "OldProducts" }],
      };
      const ddl = generateMigrationDDL(schemaDiff, "spanner");
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe("DROP TABLE OldProducts;");
    });
  });
});
