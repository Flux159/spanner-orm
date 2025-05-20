// test/core/migration-generator.test.ts

import { describe, it, expect, vi } from "vitest"; // Added vi
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
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
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
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
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
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
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
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe('DROP TABLE "old_users";');
    });

    it("should generate ADD COLUMN DDL", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "users",
            columnChanges: [
              {
                action: "add",
                column: createSampleColumn(
                  "new_col",
                  "boolean",
                  { pg: "BOOLEAN", spanner: "BOOL" },
                  { notNull: true, default: false }
                ),
              },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl[0]).toBe(
        'ALTER TABLE "users" ADD COLUMN "new_col" BOOLEAN NOT NULL DEFAULT false;'
      );
    });

    it("should generate DROP COLUMN DDL", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "users",
            columnChanges: [{ action: "remove", columnName: "old_col" }],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl[0]).toBe('ALTER TABLE "users" DROP COLUMN "old_col";');
    });

    it("should generate ALTER COLUMN TYPE DDL", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "users",
            columnChanges: [
              {
                action: "change",
                columnName: "age",
                changes: {
                  type: "bigint",
                  dialectTypes: { postgres: "BIGINT", spanner: "INT64" },
                },
              },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl[0]).toBe(
        'ALTER TABLE "users" ALTER COLUMN "age" SET DATA TYPE BIGINT;'
      );
    });

    it("should generate ALTER COLUMN SET NOT NULL DDL", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "users",
            columnChanges: [
              {
                action: "change",
                columnName: "email",
                changes: { notNull: true },
              },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl[0]).toBe(
        'ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;'
      );
    });

    it("should generate ALTER COLUMN DROP NOT NULL DDL", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "users",
            columnChanges: [
              {
                action: "change",
                columnName: "email",
                changes: { notNull: false },
              },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl[0]).toBe(
        'ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;'
      );
    });

    it("should generate ALTER COLUMN SET DEFAULT DDL", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "users",
            columnChanges: [
              {
                action: "change",
                columnName: "score",
                changes: { default: 0 },
              },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl[0]).toBe(
        'ALTER TABLE "users" ALTER COLUMN "score" DEFAULT 0;'
      );
    });

    it("should generate ALTER COLUMN DROP DEFAULT DDL", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "users",
            columnChanges: [
              {
                action: "change",
                columnName: "score",
                changes: { default: undefined },
              },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl[0]).toBe(
        'ALTER TABLE "users" ALTER COLUMN "score" DROP DEFAULT;'
      );
    });

    it("should generate ADD UNIQUE constraint DDL for column change", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "products",
            columnChanges: [
              {
                action: "change",
                columnName: "product_code",
                changes: { unique: true },
              },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl[0]).toBe(
        'ALTER TABLE "products" ADD CONSTRAINT "uq_products_product_code" UNIQUE ("product_code");'
      );
    });

    it("should generate DROP UNIQUE constraint DDL for column change", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "products",
            columnChanges: [
              {
                action: "change",
                columnName: "product_code",
                changes: { unique: false },
              },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl[0]).toBe(
        'ALTER TABLE "products" DROP CONSTRAINT "uq_products_product_code";'
      );
    });

    it("should generate CREATE INDEX DDL for an added index", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "users",
            indexChanges: [
              {
                action: "add",
                index: {
                  name: "idx_users_bio",
                  columns: ["bio"],
                  unique: false,
                },
              },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl[0]).toBe('CREATE INDEX "idx_users_bio" ON "users" ("bio");');
    });

    it("should generate CREATE UNIQUE INDEX DDL for an added unique index", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "users",
            indexChanges: [
              {
                action: "add",
                index: {
                  name: "uq_users_username",
                  columns: ["username"],
                  unique: true,
                },
              },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl[0]).toBe(
        'CREATE UNIQUE INDEX "uq_users_username" ON "users" ("username");'
      );
    });

    it("should generate DROP INDEX DDL for a removed index", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "users",
            indexChanges: [
              { action: "remove", indexName: "idx_users_email_old" },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl[0]).toBe('DROP INDEX "idx_users_email_old";');
    });

    it("should generate DROP and CREATE INDEX DDL for a changed index", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn");
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "users",
            indexChanges: [
              {
                action: "change",
                indexName: "idx_users_status",
                changes: { columns: ["status", "type"], unique: false },
              },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Index change for "idx_users_status" on table "users" will be handled as DROP and ADD for PG.'
      );
      expect(ddl.length).toBe(2);
      expect(ddl[0]).toBe('DROP INDEX "idx_users_status";');
      expect(ddl[1]).toBe(
        'CREATE INDEX "idx_users_status" ON "users" ("status", "type");'
      );
      consoleWarnSpy.mockRestore();
    });

    it("should generate ADD PRIMARY KEY DDL for PostgreSQL", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "orders",
            primaryKeyChange: {
              action: "set",
              pk: { name: "pk_orders", columns: ["order_id", "customer_id"] },
            },
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe(
        'ALTER TABLE "orders" ADD CONSTRAINT "pk_orders" PRIMARY KEY ("order_id", "customer_id");'
      );
    });

    it("should generate ADD PRIMARY KEY DDL with default name for PostgreSQL", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "items",
            primaryKeyChange: {
              action: "set",
              pk: { columns: ["item_uuid"] }, // No name provided
            },
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe(
        'ALTER TABLE "items" ADD CONSTRAINT "pk_items" PRIMARY KEY ("item_uuid");'
      );
    });

    it("should generate DROP PRIMARY KEY DDL for PostgreSQL with explicit name", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "orders",
            primaryKeyChange: {
              action: "remove",
              pkName: "pk_orders_old",
            },
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe(
        'ALTER TABLE "orders" DROP CONSTRAINT "pk_orders_old";'
      );
    });

    it("should generate DROP PRIMARY KEY DDL for PostgreSQL with warning if name is not provided", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "items",
            primaryKeyChange: {
              action: "remove", // No pkName provided
            },
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe('ALTER TABLE "items" DROP CONSTRAINT "pk_items";');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Primary key name for DROP operation on table "items" for PostgreSQL was not provided. Assuming default name ""pk_items"". This might fail.'
      );
      consoleWarnSpy.mockRestore();
    });

    it("should generate ADD FOREIGN KEY constraint DDL for PostgreSQL", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "posts",
            columnChanges: [
              {
                action: "change", // Assuming FK is added to an existing column or column is changed to have an FK
                columnName: "user_id",
                changes: {
                  references: {
                    name: "fk_posts_user_id",
                    referencedTable: "users",
                    referencedColumn: "id",
                    onDelete: "cascade",
                  },
                },
              },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe(
        'ALTER TABLE "posts" ADD CONSTRAINT "fk_posts_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;'
      );
    });

    it("should generate DROP FOREIGN KEY constraint DDL for PostgreSQL", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "comments",
            columnChanges: [
              {
                action: "change",
                columnName: "post_id",
                changes: {
                  references: null, // Signal to remove the FK
                },
              },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl.length).toBe(1);
      // This will use the placeholder name due to current limitations
      expect(ddl[0]).toBe(
        'ALTER TABLE "comments" DROP CONSTRAINT "fk_comments_post_id_TO_BE_DROPPED";'
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Attempting to DROP foreign key for comments.post_id because its \'references\' property was set to null. The specific constraint name is required for PostgreSQL. Using placeholder name ""fk_comments_post_id_TO_BE_DROPPED"". This DDL will likely FAIL. The schema diff process should provide the exact name of the FK constraint to drop.'
      );
      consoleWarnSpy.mockRestore();
    });

    it("should generate ADD COLUMN with FOREIGN KEY for PostgreSQL", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "profiles",
            columnChanges: [
              {
                action: "add",
                column: createSampleColumn(
                  "user_account_id",
                  "integer",
                  { pg: "INTEGER", spanner: "INT64" },
                  {
                    references: {
                      name: "fk_profiles_user_account",
                      referencedTable: "user_accounts",
                      referencedColumn: "account_id",
                      onDelete: "set null",
                    },
                  }
                ),
              },
            ],
          },
        ],
      };
      const ddl = generateMigrationDDL(schemaDiff, "postgres") as string[];
      expect(ddl.length).toBe(2);
      expect(ddl[0]).toBe(
        'ALTER TABLE "profiles" ADD COLUMN "user_account_id" INTEGER;'
      );
      expect(ddl[1]).toBe(
        'ALTER TABLE "profiles" ADD CONSTRAINT "fk_profiles_user_account" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts" ("account_id") ON DELETE SET NULL;'
      );
    });
  });

  describe("Spanner DDL Generation", () => {
    it("should generate CREATE TABLE DDL for an added table", () => {
      const usersTable = createSampleTable("Users", {
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
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      // Expecting CREATE TABLE and potentially CREATE UNIQUE INDEX for Email if `unique:true` was set
      // For this specific test, Email does not have unique:true, so only CREATE TABLE.
      expect(ddlBatches.length).toBe(1); // One batch
      expect(ddlBatches[0].length).toBe(1); // One statement in the batch
      expect(ddlBatches[0][0]).toBe(
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
            { notNull: true } // Removed unique: true from column, will use table index
          ),
        },
        [{ name: "UQ_ProductCode", columns: ["ProductCode"], unique: true }]
      );
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [{ action: "add", table: productsTable }],
      };
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      // With selective batching, CREATE TABLE (non-validating) and CREATE UNIQUE INDEX (validating)
      // will be in separate batches.
      expect(ddlBatches.length).toBe(2);
      expect(ddlBatches[0].length).toBe(1);
      expect(ddlBatches[0][0]).toContain("CREATE TABLE Products");
      expect(ddlBatches[1].length).toBe(1);
      expect(ddlBatches[1][0]).toBe(
        "CREATE UNIQUE INDEX UQ_ProductCode ON Products (ProductCode);"
      );
      const ddl = ddlBatches.flat(); // Keep this for checking total statements if needed, though covered by batch checks.
      expect(ddl.length).toBe(2); // CREATE TABLE, CREATE UNIQUE INDEX
      // Original check for ddl[1] is now ddlBatches[1][0]
      // This specific check is now part of the batch check above.
      // expect(ddl[1]).toBe(
      //   "CREATE UNIQUE INDEX UQ_ProductCode ON Products (ProductCode);"
      // );
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
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
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
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      expect(ddlBatches.length).toBe(1);
      expect(ddlBatches[0].length).toBe(1);
      expect(ddlBatches[0][0]).toBe("DROP TABLE OldProducts;");
    });

    it("should generate ADD COLUMN DDL for Spanner", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "Users",
            columnChanges: [
              {
                action: "add",
                column: createSampleColumn(
                  "PhoneNumber",
                  "varchar",
                  { pg: "VARCHAR(20)", spanner: "STRING(20)" },
                  { default: "N/A" }
                ),
              },
            ],
          },
        ],
      };
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl[0]).toBe(
        "ALTER TABLE Users ADD COLUMN PhoneNumber STRING(20) DEFAULT ('N/A');"
      );
    });

    it("should generate DROP COLUMN DDL for Spanner", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "Users",
            columnChanges: [{ action: "remove", columnName: "Bio" }],
          },
        ],
      };
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl[0]).toBe("ALTER TABLE Users DROP COLUMN Bio;");
    });

    it("should generate ALTER COLUMN TYPE DDL for Spanner", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn");
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "Users",
            columnChanges: [
              {
                action: "change",
                columnName: "UserId",
                changes: {
                  type: "string",
                  dialectTypes: {
                    postgres: "VARCHAR(36)",
                    spanner: "STRING(36)",
                  },
                },
              },
            ],
          },
        ],
      };
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl[0]).toBe("ALTER TABLE Users ALTER COLUMN UserId STRING(36);");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Spanner DDL for changing column type for Users.UserId to STRING(36) generated. Review for compatibility.`
      );
      consoleWarnSpy.mockRestore();
    });

    it("should generate ALTER COLUMN SET NOT NULL DDL for Spanner", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "Users",
            columnChanges: [
              {
                action: "change",
                columnName: "Email",
                changes: { notNull: true },
              },
            ],
          },
        ],
      };
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl[0]).toBe("ALTER TABLE Users ALTER COLUMN Email NOT NULL;");
    });

    it("should issue a warning when trying to make a Spanner column nullable (as it requires type re-specification)", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn");
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "Users",
            columnChanges: [
              {
                action: "change",
                columnName: "Email",
                changes: { notNull: false },
              },
            ],
          },
        ],
      };
      generateMigrationDDL(schemaDiff, "spanner");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Spanner DDL for making Users.Email nullable may require re-specifying type.`
      );
      consoleWarnSpy.mockRestore();
    });

    it("should issue a warning for default value changes on existing Spanner columns", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn");
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "Users",
            columnChanges: [
              {
                action: "change",
                columnName: "Bio",
                changes: { default: "New default" },
              },
            ],
          },
        ],
      };
      generateMigrationDDL(schemaDiff, "spanner");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Spanner does not support ALTER COLUMN SET DEFAULT for Users.Bio.`
      );
      consoleWarnSpy.mockRestore();
    });
    it("should issue a warning for unique constraint changes on existing Spanner columns (handled by index changes)", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn");
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "Users",
            columnChanges: [
              {
                action: "change",
                columnName: "Email",
                changes: { unique: true },
              },
            ],
          },
        ],
      };
      generateMigrationDDL(schemaDiff, "spanner");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Spanner 'unique' constraint changes for Users.Email handled via index diffs.`
      );
      consoleWarnSpy.mockRestore();
    });

    it("should issue a warning when attempting to add a PK to an existing Spanner table", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "Users",
            primaryKeyChange: {
              action: "set",
              pk: { columns: ["NewPkCol"] },
            },
          },
        ],
      };
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl.length).toBe(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Spanner does not support altering PKs on existing table "Users".`
      );
      consoleWarnSpy.mockRestore();
    });

    it("should issue a warning when attempting to remove a PK from an existing Spanner table", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "Products",
            primaryKeyChange: {
              action: "remove",
              pkName: "PK_Products_Old",
            },
          },
        ],
      };
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl.length).toBe(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Spanner does not support altering PKs on existing table "Products".`
      );
      consoleWarnSpy.mockRestore();
    });

    it("should issue a warning when attempting to change interleave configuration on an existing Spanner table", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "OrderItems",
            interleaveChange: {
              action: "set",
              interleave: { parentTable: "NewParent", onDelete: "no action" },
            },
          },
        ],
      };
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl.length).toBe(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Spanner does not support altering interleave for table "OrderItems".`
      );
      consoleWarnSpy.mockRestore();
    });

    it("should generate ADD FOREIGN KEY constraint DDL for Spanner", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "Albums",
            columnChanges: [
              {
                action: "change",
                columnName: "ArtistId",
                changes: {
                  references: {
                    name: "FK_Albums_ArtistId",
                    referencedTable: "Artists",
                    referencedColumn: "ArtistId",
                    onDelete: "no action",
                  },
                },
              },
            ],
          },
        ],
      };
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe(
        "ALTER TABLE Albums ADD CONSTRAINT FK_Albums_ArtistId FOREIGN KEY (ArtistId) REFERENCES Artists (ArtistId) ON DELETE NO ACTION;"
      );
    });

    it("should generate DROP FOREIGN KEY constraint DDL for Spanner", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "Tracks",
            columnChanges: [
              {
                action: "change",
                columnName: "AlbumId",
                changes: {
                  references: null,
                },
              },
            ],
          },
        ],
      };
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe(
        "ALTER TABLE Tracks DROP CONSTRAINT FK_Tracks_AlbumId_TO_BE_DROPPED;"
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Dropping FK for Tracks.AlbumId. Constraint name needed.`
      );
      consoleWarnSpy.mockRestore();
    });

    it("should generate ADD COLUMN with FOREIGN KEY for Spanner", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "Playlists",
            columnChanges: [
              {
                action: "add",
                column: createSampleColumn(
                  "UserId",
                  "STRING(36)",
                  { pg: "VARCHAR(36)", spanner: "STRING(36)" },
                  {
                    references: {
                      name: "FK_Playlists_UserId",
                      referencedTable: "Users",
                      referencedColumn: "UserId",
                    },
                  }
                ),
              },
            ],
          },
        ],
      };
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl.length).toBe(2);
      expect(ddl[0]).toBe(
        "ALTER TABLE Playlists ADD COLUMN UserId STRING(36);"
      );
      expect(ddl[1]).toBe(
        "ALTER TABLE Playlists ADD CONSTRAINT FK_Playlists_UserId FOREIGN KEY (UserId) REFERENCES Users (UserId);"
      );
    });
  });

  describe("Spanner DDL Batching Logic", () => {
    it("should batch multiple validating DDL statements correctly", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "add", // Results in CREATE TABLE (non-validating by current helper) + CREATE INDEX (validating)
            table: createSampleTable(
              "TestTable1",
              {
                id: createSampleColumn(
                  "id",
                  "INT64",
                  { pg: "INT", spanner: "INT64" },
                  { primaryKey: true }
                ),
                field1: createSampleColumn("field1", "STRING(100)", {
                  pg: "VARCHAR(100)",
                  spanner: "STRING(100)",
                }),
              },
              [{ name: "idx_field1", columns: ["field1"], unique: false }] // CREATE INDEX - validating
            ),
          },
          {
            action: "change", // Results in ALTER TABLE ADD COLUMN (validating)
            tableName: "TestTable1",
            columnChanges: [
              {
                action: "add",
                column: createSampleColumn("field2", "BOOL", {
                  pg: "BOOL",
                  spanner: "BOOL",
                }),
              }, // validating
              {
                action: "add",
                column: createSampleColumn("field3", "DATE", {
                  pg: "DATE",
                  spanner: "DATE",
                }),
              }, // validating
              {
                action: "add",
                column: createSampleColumn("field4", "FLOAT64", {
                  pg: "FLOAT8",
                  spanner: "FLOAT64",
                }),
              }, // validating
              {
                action: "add",
                column: createSampleColumn("field5", "TIMESTAMP", {
                  pg: "TIMESTAMP",
                  spanner: "TIMESTAMP",
                }),
              }, // validating
              {
                action: "add",
                column: createSampleColumn("field6", "BYTES(10)", {
                  pg: "BYTEA",
                  spanner: "BYTES(10)",
                }),
              }, // validating - 6th validating
            ],
          },
          {
            action: "add", // Another CREATE TABLE + CREATE INDEX
            table: createSampleTable(
              "TestTable2",
              {
                id2: createSampleColumn(
                  "id2",
                  "INT64",
                  { pg: "INT", spanner: "INT64" },
                  { primaryKey: true }
                ),
                data: createSampleColumn("data", "STRING(MAX)", {
                  pg: "TEXT",
                  spanner: "STRING(MAX)",
                }),
              },
              [{ name: "idx_data", columns: ["data"], unique: true }] // CREATE UNIQUE INDEX - validating
            ),
          },
        ],
      };

      // Expected DDLs (order might vary slightly based on generation logic, but types are important):
      // 1. CREATE TABLE TestTable1 ...; (non-validating)
      // 2. CREATE INDEX idx_field1 ON TestTable1 (field1); (validating)
      // 3. ALTER TABLE TestTable1 ADD COLUMN field2 BOOL; (validating)
      // 4. ALTER TABLE TestTable1 ADD COLUMN field3 DATE; (validating)
      // 5. ALTER TABLE TestTable1 ADD COLUMN field4 FLOAT64; (validating)
      // 6. ALTER TABLE TestTable1 ADD COLUMN field5 TIMESTAMP; (validating)
      // 7. ALTER TABLE TestTable1 ADD COLUMN field6 BYTES(10); (validating)
      // 8. CREATE TABLE TestTable2 ...; (non-validating)
      // 9. CREATE UNIQUE INDEX idx_data ON TestTable2 (data); (validating)
      // Total: 2 non-validating, 7 validating. SPANNER_DDL_BATCH_SIZE = 5.

      // Expected batching:
      // Batch 1: [CREATE TABLE TestTable1] (non-validating batch ends because next is validating)
      // Batch 2: [CREATE INDEX idx_field1, ALTER...field2, ALTER...field3, ALTER...field4, ALTER...field5] (validating, size 5)
      // Batch 3: [ALTER...field6] (validating, size 1, new batch because previous validating batch was full)
      // Batch 4: [CREATE TABLE TestTable2] (non-validating batch ends because next is validating)
      // Batch 5: [CREATE UNIQUE INDEX idx_data] (validating, size 1)

      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];

      expect(ddlBatches.length).toBe(5);
      // Batch 1 (Non-validating)
      expect(ddlBatches[0].length).toBe(1);
      expect(ddlBatches[0][0]).toContain("CREATE TABLE TestTable1");

      // Batch 2 (Validating)
      expect(ddlBatches[1].length).toBe(5);
      expect(ddlBatches[1][0]).toContain("CREATE INDEX idx_field1");
      expect(ddlBatches[1][1]).toContain(
        "ALTER TABLE TestTable1 ADD COLUMN field2"
      );
      expect(ddlBatches[1][2]).toContain(
        "ALTER TABLE TestTable1 ADD COLUMN field3"
      );
      expect(ddlBatches[1][3]).toContain(
        "ALTER TABLE TestTable1 ADD COLUMN field4"
      );
      expect(ddlBatches[1][4]).toContain(
        "ALTER TABLE TestTable1 ADD COLUMN field5"
      );

      // Batch 3 (Validating)
      expect(ddlBatches[2].length).toBe(1);
      expect(ddlBatches[2][0]).toContain(
        "ALTER TABLE TestTable1 ADD COLUMN field6"
      );

      // Batch 4 (Non-validating)
      expect(ddlBatches[3].length).toBe(1);
      expect(ddlBatches[3][0]).toContain("CREATE TABLE TestTable2");

      // Batch 5 (Validating)
      expect(ddlBatches[4].length).toBe(1);
      expect(ddlBatches[4][0]).toContain("CREATE UNIQUE INDEX idx_data");
    });

    it("should handle a sequence of non-validating DDLs correctly", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          { action: "remove", tableName: "OldTable1" },
          { action: "remove", tableName: "OldTable2" },
          { action: "remove", tableName: "OldTable3" },
          { action: "remove", tableName: "OldTable4" },
          { action: "remove", tableName: "OldTable5" },
          { action: "remove", tableName: "OldTable6" }, // 6th non-validating
        ],
      };
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      // All are non-validating, so they should be batched by SPANNER_DDL_BATCH_SIZE
      expect(ddlBatches.length).toBe(2);
      expect(ddlBatches[0].length).toBe(5);
      expect(ddlBatches[1].length).toBe(1);
      expect(ddlBatches[0][0]).toBe("DROP TABLE OldTable1;");
      expect(ddlBatches[1][0]).toBe("DROP TABLE OldTable6;");
    });

    it("should correctly batch when a non-validating DDL follows a full validating batch", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [
          {
            action: "change",
            tableName: "T1",
            columnChanges: [
              {
                action: "add",
                column: createSampleColumn("c1", "BOOL", {
                  pg: "BOOL",
                  spanner: "BOOL",
                }),
              }, // V1
              {
                action: "add",
                column: createSampleColumn("c2", "BOOL", {
                  pg: "BOOL",
                  spanner: "BOOL",
                }),
              }, // V2
              {
                action: "add",
                column: createSampleColumn("c3", "BOOL", {
                  pg: "BOOL",
                  spanner: "BOOL",
                }),
              }, // V3
              {
                action: "add",
                column: createSampleColumn("c4", "BOOL", {
                  pg: "BOOL",
                  spanner: "BOOL",
                }),
              }, // V4
              {
                action: "add",
                column: createSampleColumn("c5", "BOOL", {
                  pg: "BOOL",
                  spanner: "BOOL",
                }),
              }, // V5 - batch full
            ],
          },
          { action: "remove", tableName: "OldTableDrop" }, // Non-validating
        ],
      };
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        "spanner"
      ) as string[][];
      expect(ddlBatches.length).toBe(2);
      expect(ddlBatches[0].length).toBe(5); // Validating batch
      expect(ddlBatches[0][0]).toContain("ALTER TABLE T1 ADD COLUMN c1 BOOL;");
      expect(ddlBatches[1].length).toBe(1); // Non-validating batch
      expect(ddlBatches[1][0]).toBe("DROP TABLE OldTableDrop;");
    });
  });
});
