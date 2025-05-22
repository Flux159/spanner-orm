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
  SchemaSnapshot, // Added for new argument
} from "../../src/types/common";

const V1_SNAPSHOT_VERSION = "1.0.0";

const createMockNewSchemaSnapshot = (
  tables: Record<string, TableSnapshot>,
  dialect: "postgres" | "spanner"
): SchemaSnapshot => ({
  version: V1_SNAPSHOT_VERSION,
  dialect,
  tables,
});

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
          { notNull: true, unique: true } // This unique will be a separate statement
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
      const newSnapshot = createMockNewSchemaSnapshot(
        { users: usersTable },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
      // Expect CREATE TABLE + ALTER TABLE for unique constraint
      expect(ddl.length).toBe(2);
      expect(ddl[0]).toBe(
        'CREATE TABLE "users" (\n' +
          '  "id" INTEGER NOT NULL PRIMARY KEY,\n' +
          // Unique is no longer inline in the base CREATE TABLE for this helper's output
          '  "email" VARCHAR(255) NOT NULL,\n' +
          '  "bio" TEXT\n' +
          ");"
      );
      // The unique constraint on 'email' is now generated as a separate ALTER TABLE statement
      expect(ddl[1]).toBe(
        'ALTER TABLE "users" ADD CONSTRAINT "uq_users_email" UNIQUE ("email");'
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
      const newSnapshot = createMockNewSchemaSnapshot(
        { order_items: orderItemsTable },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
      // Expect CREATE TABLE + CREATE UNIQUE INDEX for the table-level unique constraint
      expect(ddl.length).toBe(2);
      expect(ddl[0]).toBe(
        'CREATE TABLE "order_items" (\n' +
          '  "order_id" INTEGER NOT NULL,\n' +
          '  "item_id" INTEGER NOT NULL,\n' +
          '  "quantity" INTEGER DEFAULT 1,\n' +
          // PK is inline
          '  PRIMARY KEY ("order_id", "item_id")\n' +
          ");"
      );
      // The unique constraint uq_order_item is now a separate CREATE UNIQUE INDEX
      expect(ddl[1]).toBe(
        'CREATE UNIQUE INDEX "uq_order_item" ON "order_items" ("order_id", "item_id");'
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
      const newSnapshot = createMockNewSchemaSnapshot(
        { products: productsTable },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const newSnapshot = createMockNewSchemaSnapshot({}, "postgres"); // No tables after removal
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const usersTableAfterAdd = createSampleTable("users", {
        new_col: createSampleColumn(
          "new_col",
          "boolean",
          { pg: "BOOLEAN", spanner: "BOOL" },
          { notNull: true, default: false }
        ),
        // Assuming other columns might exist, but new_col is key for the snapshot
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { users: usersTableAfterAdd },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      // Snapshot after 'old_col' is removed from 'users' table
      const usersTableAfterDrop = createSampleTable("users", {
        // No 'old_col' here
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { users: usersTableAfterDrop },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
                columnName: "age", // JS key
                changes: {
                  type: "bigint",
                  dialectTypes: { postgres: "BIGINT", spanner: "INT64" },
                },
              },
            ],
          },
        ],
      };
      const usersTableAfterTypeChange = createSampleTable("users", {
        age: createSampleColumn(
          // JS key
          "age", // DB name
          "bigint",
          { pg: "BIGINT", spanner: "INT64" } // New type
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { users: usersTableAfterTypeChange },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const usersTableAfterSetNotNull = createSampleTable("users", {
        email: createSampleColumn(
          "email",
          "varchar",
          { pg: "VARCHAR(255)", spanner: "STRING(255)" },
          { notNull: true } // Changed property
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { users: usersTableAfterSetNotNull },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const usersTableAfterDropNotNull = createSampleTable("users", {
        email: createSampleColumn(
          "email",
          "varchar",
          { pg: "VARCHAR(255)", spanner: "STRING(255)" },
          { notNull: false } // Changed property
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { users: usersTableAfterDropNotNull },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const usersTableAfterSetDefault = createSampleTable("users", {
        score: createSampleColumn(
          "score",
          "integer",
          { pg: "INTEGER", spanner: "INT64" },
          { default: 0 } // Changed property
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { users: usersTableAfterSetDefault },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const usersTableAfterDropDefault = createSampleTable("users", {
        score: createSampleColumn(
          "score",
          "integer",
          { pg: "INTEGER", spanner: "INT64" },
          { default: undefined } // Changed property
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { users: usersTableAfterDropDefault },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const productsTableAfterAddUnique = createSampleTable("products", {
        product_code: createSampleColumn(
          "product_code",
          "varchar",
          { pg: "VARCHAR(50)", spanner: "STRING(50)" },
          { unique: true }
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { products: productsTableAfterAddUnique },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const productsTableAfterDropUnique = createSampleTable("products", {
        product_code: createSampleColumn(
          "product_code",
          "varchar",
          { pg: "VARCHAR(50)", spanner: "STRING(50)" },
          { unique: false }
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { products: productsTableAfterDropUnique },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const usersTableAfterAddIndex = createSampleTable(
        "users",
        {
          bio: createSampleColumn("bio", "text", {
            pg: "TEXT",
            spanner: "STRING(MAX)",
          }),
        },
        [{ name: "idx_users_bio", columns: ["bio"], unique: false }]
      );
      const newSnapshot = createMockNewSchemaSnapshot(
        { users: usersTableAfterAddIndex },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const usersTableAfterAddUniqueIndex = createSampleTable(
        "users",
        {
          username: createSampleColumn("username", "varchar", {
            pg: "VARCHAR(50)",
            spanner: "STRING(50)",
          }),
        },
        [{ name: "uq_users_username", columns: ["username"], unique: true }]
      );
      const newSnapshot = createMockNewSchemaSnapshot(
        { users: usersTableAfterAddUniqueIndex },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const usersTableAfterDropIndex = createSampleTable("users", {
        // Assuming columns still exist, just index is gone
        email: createSampleColumn("email", "varchar", {
          pg: "VARCHAR(255)",
          spanner: "STRING(255)",
        }),
      }); // No index 'idx_users_email_old'
      const newSnapshot = createMockNewSchemaSnapshot(
        { users: usersTableAfterDropIndex },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const usersTableAfterChangeIndex = createSampleTable(
        "users",
        {
          status: createSampleColumn("status", "varchar", {
            pg: "VARCHAR(20)",
            spanner: "STRING(20)",
          }),
          type: createSampleColumn("type", "varchar", {
            pg: "VARCHAR(20)",
            spanner: "STRING(20)",
          }),
        },
        [
          {
            name: "idx_users_status",
            columns: ["status", "type"],
            unique: false,
          },
        ]
      );
      const newSnapshot = createMockNewSchemaSnapshot(
        { users: usersTableAfterChangeIndex },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const ordersTableAfterSetPk = createSampleTable(
        "orders",
        {
          order_id: createSampleColumn("order_id", "integer", {
            pg: "INTEGER",
            spanner: "INT64",
          }),
          customer_id: createSampleColumn("customer_id", "integer", {
            pg: "INTEGER",
            spanner: "INT64",
          }),
        },
        undefined,
        { name: "pk_orders", columns: ["order_id", "customer_id"] }
      );
      const newSnapshot = createMockNewSchemaSnapshot(
        { orders: ordersTableAfterSetPk },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const itemsTableAfterSetPkDefaultName = createSampleTable(
        "items",
        {
          item_uuid: createSampleColumn("item_uuid", "uuid", {
            pg: "UUID",
            spanner: "STRING(36)",
          }),
        },
        undefined,
        { columns: ["item_uuid"] }
      ); // Name will be defaulted
      const newSnapshot = createMockNewSchemaSnapshot(
        { items: itemsTableAfterSetPkDefaultName },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const ordersTableAfterDropPk = createSampleTable("orders", {
        order_id: createSampleColumn("order_id", "integer", {
          pg: "INTEGER",
          spanner: "INT64",
        }),
        customer_id: createSampleColumn("customer_id", "integer", {
          pg: "INTEGER",
          spanner: "INT64",
        }),
      }); // No PK
      const newSnapshot = createMockNewSchemaSnapshot(
        { orders: ordersTableAfterDropPk },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const itemsTableAfterDropPkDefaultName = createSampleTable("items", {
        item_uuid: createSampleColumn("item_uuid", "uuid", {
          pg: "UUID",
          spanner: "STRING(36)",
        }),
      }); // No PK
      const newSnapshot = createMockNewSchemaSnapshot(
        { items: itemsTableAfterDropPkDefaultName },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe('ALTER TABLE "items" DROP CONSTRAINT "pk_items";');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Primary key name for DROP PK on "items" not provided. Assuming default ""pk_items"".' // Updated warning
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
                columnName: "user_id", // JS Key
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
      const postsTableAfterAddFk = createSampleTable("posts", {
        user_id: createSampleColumn(
          // JS Key
          "user_id", // DB Name
          "integer",
          { pg: "INTEGER", spanner: "INT64" }, // Assuming type
          {
            // from changes
            references: {
              name: "fk_posts_user_id",
              referencedTable: "users",
              referencedColumn: "id",
              onDelete: "cascade",
            },
          }
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { posts: postsTableAfterAddFk },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
                columnName: "post_id", // JS Key
                changes: {
                  references: null, // Signal to remove the FK
                },
              },
            ],
          },
        ],
      };
      const commentsTableAfterDropFk = createSampleTable("comments", {
        post_id: createSampleColumn(
          // JS Key
          "post_id", // DB Name
          "integer",
          { pg: "INTEGER", spanner: "INT64" }, // Assuming type
          { references: undefined } // FK removed
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { comments: commentsTableAfterDropFk },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
      expect(ddl.length).toBe(1);
      // This will use the placeholder name due to current limitations
      expect(ddl[0]).toBe(
        'ALTER TABLE "comments" DROP CONSTRAINT "fk_comments_post_id_TO_BE_DROPPED";'
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Attempting to DROP foreign key for comments.post_id. The specific constraint name is required. Using placeholder: "fk_comments_post_id_TO_BE_DROPPED". This will likely FAIL.' // Updated warning
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
                  "user_account_id", // DB Name
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
      const profilesTableAfterAddColFk = createSampleTable("profiles", {
        user_account_id: createSampleColumn(
          // JS Key (same as DB name here)
          "user_account_id", // DB Name
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
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { profiles: profilesTableAfterAddColFk },
        "postgres"
      );
      const ddl = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "postgres"
      ) as string[];
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
      const newSnapshot = createMockNewSchemaSnapshot(
        { Users: usersTable },
        "spanner"
      );
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
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
          ") PRIMARY KEY (UserId)"
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
      const newSnapshot = createMockNewSchemaSnapshot(
        { Products: productsTable },
        "spanner"
      );
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];
      // With selective batching, CREATE TABLE (non-validating) and CREATE UNIQUE INDEX (validating)
      // will be in separate batches.
      expect(ddlBatches.length).toBe(2);
      expect(ddlBatches[0].length).toBe(1);
      expect(ddlBatches[0][0]).toContain("CREATE TABLE Products");
      expect(ddlBatches[1].length).toBe(1);
      expect(ddlBatches[1][0]).toBe(
        "CREATE UNIQUE INDEX UQ_ProductCode ON Products (ProductCode)"
      );
      const ddl = ddlBatches.flat(); // Keep this for checking total statements if needed, though covered by batch checks.
      expect(ddl.length).toBe(2); // CREATE TABLE, CREATE UNIQUE INDEX
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
      const newSnapshot = createMockNewSchemaSnapshot(
        { OrderDetails: orderDetailsTable },
        "spanner"
      );
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
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
          "  INTERLEAVE IN PARENT Orders ON DELETE CASCADE"
      );
      expect(ddl[1]).toBe(
        "CREATE INDEX IDX_OrderDetails_Notes ON OrderDetails (Notes)"
      );
    });

    it("should generate DROP TABLE DDL for a removed table", () => {
      const schemaDiff: SchemaDiff = {
        fromVersion: V1_SNAPSHOT_VERSION,
        toVersion: V1_SNAPSHOT_VERSION,
        tableChanges: [{ action: "remove", tableName: "OldProducts" }],
      };
      const newSnapshot = createMockNewSchemaSnapshot({}, "spanner");
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];
      expect(ddlBatches.length).toBe(1);
      expect(ddlBatches[0].length).toBe(1);
      expect(ddlBatches[0][0]).toBe("DROP TABLE OldProducts");
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
                  "PhoneNumber", // DB Name
                  "varchar",
                  { pg: "VARCHAR(20)", spanner: "STRING(20)" },
                  { default: "N/A" }
                ),
              },
            ],
          },
        ],
      };
      const usersTableAfterAddCol = createSampleTable("Users", {
        PhoneNumber: createSampleColumn(
          "PhoneNumber",
          "varchar",
          { pg: "VARCHAR(20)", spanner: "STRING(20)" },
          { default: "N/A" }
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { Users: usersTableAfterAddCol },
        "spanner"
      );
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl[0]).toBe(
        "ALTER TABLE Users ADD COLUMN PhoneNumber STRING(20) DEFAULT ('N/A')"
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
      const usersTableAfterDropCol = createSampleTable("Users", {
        /* No Bio column */
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { Users: usersTableAfterDropCol },
        "spanner"
      );
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl[0]).toBe("ALTER TABLE Users DROP COLUMN Bio");
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
                columnName: "UserId", // JS Key
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
      const usersTableAfterTypeChangeSpanner = createSampleTable("Users", {
        UserId: createSampleColumn(
          // JS Key
          "UserId", // DB Name
          "string",
          { pg: "VARCHAR(36)", spanner: "STRING(36)" } // New type
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { Users: usersTableAfterTypeChangeSpanner },
        "spanner"
      );
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl[0]).toBe("ALTER TABLE Users ALTER COLUMN UserId STRING(36)");
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
      const usersTableAfterSetNotNullSpanner = createSampleTable("Users", {
        Email: createSampleColumn(
          "Email",
          "varchar",
          { pg: "VARCHAR(255)", spanner: "STRING(255)" },
          { notNull: true }
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { Users: usersTableAfterSetNotNullSpanner },
        "spanner"
      );
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl[0]).toBe("ALTER TABLE Users ALTER COLUMN Email NOT NULL");
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
      const usersTableAfterDropNotNullSpanner = createSampleTable("Users", {
        Email: createSampleColumn(
          "Email",
          "varchar",
          { pg: "VARCHAR(255)", spanner: "STRING(255)" },
          { notNull: false }
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { Users: usersTableAfterDropNotNullSpanner },
        "spanner"
      );
      generateMigrationDDL(schemaDiff, newSnapshot, "spanner");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Spanner DDL for making Users.Email nullable may require re-specifying type and 'DROP NOT NULL' is not standard; typically, you just omit NOT NULL.` // Updated
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
      const usersTableAfterSetDefaultSpanner = createSampleTable("Users", {
        Bio: createSampleColumn(
          "Bio",
          "text",
          { pg: "TEXT", spanner: "STRING(MAX)" },
          { default: "New default" }
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { Users: usersTableAfterSetDefaultSpanner },
        "spanner"
      );
      generateMigrationDDL(schemaDiff, newSnapshot, "spanner");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Spanner does not support ALTER COLUMN SET DEFAULT for Users.Bio. Default changes require table recreation or other strategies.` // Updated
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
      const usersTableAfterSetUniqueSpanner = createSampleTable("Users", {
        Email: createSampleColumn(
          "Email",
          "varchar",
          { pg: "VARCHAR(255)", spanner: "STRING(255)" },
          { unique: true }
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { Users: usersTableAfterSetUniqueSpanner },
        "spanner"
      );
      generateMigrationDDL(schemaDiff, newSnapshot, "spanner");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Spanner 'unique' constraint changes for Users.Email are typically handled via separate CREATE/DROP UNIQUE INDEX operations. Ensure index diffs cover this.` // Updated
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
      const usersTableAfterSetPkSpanner = createSampleTable(
        "Users",
        {
          NewPkCol: createSampleColumn("NewPkCol", "string", {
            pg: "TEXT",
            spanner: "STRING(MAX)",
          }),
        },
        undefined,
        { columns: ["NewPkCol"] }
      );
      const newSnapshot = createMockNewSchemaSnapshot(
        { Users: usersTableAfterSetPkSpanner },
        "spanner"
      );
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl.length).toBe(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Spanner does not support altering Primary Keys on existing table "Users". This requires table recreation.` // Updated
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
      const productsTableAfterDropPkSpanner = createSampleTable("Products", {
        // columns...
      }); // No PK
      const newSnapshot = createMockNewSchemaSnapshot(
        { Products: productsTableAfterDropPkSpanner },
        "spanner"
      );
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl.length).toBe(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Spanner does not support altering Primary Keys on existing table "Products". This requires table recreation.` // Updated
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
      const orderItemsTableAfterInterleaveChange = createSampleTable(
        "OrderItems",
        {
          // columns...
        },
        undefined,
        undefined,
        { parentTable: "NewParent", onDelete: "no action" }
      );
      const newSnapshot = createMockNewSchemaSnapshot(
        { OrderItems: orderItemsTableAfterInterleaveChange },
        "spanner"
      );
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl.length).toBe(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Spanner does not support altering interleave for table "OrderItems". This requires table recreation.` // Updated
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
                columnName: "ArtistId", // JS Key
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
      const albumsTableAfterFkChange = createSampleTable("Albums", {
        ArtistId: createSampleColumn(
          // JS Key
          "ArtistId", // DB Name
          "integer",
          { pg: "INTEGER", spanner: "INT64" }, // Assuming type
          {
            references: {
              name: "FK_Albums_ArtistId",
              referencedTable: "Artists",
              referencedColumn: "ArtistId",
              onDelete: "no action",
            },
          }
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { Albums: albumsTableAfterFkChange },
        "spanner"
      );
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe(
        "ALTER TABLE Albums ADD CONSTRAINT FK_Albums_ArtistId FOREIGN KEY (ArtistId) REFERENCES Artists (ArtistId) ON DELETE NO ACTION"
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
                columnName: "AlbumId", // JS Key
                changes: {
                  references: null,
                },
              },
            ],
          },
        ],
      };
      const tracksTableAfterDropFk = createSampleTable("Tracks", {
        AlbumId: createSampleColumn(
          // JS Key
          "AlbumId", // DB Name
          "integer",
          { pg: "INTEGER", spanner: "INT64" }, // Assuming type
          { references: undefined } // FK removed
        ),
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { Tracks: tracksTableAfterDropFk },
        "spanner"
      );
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl.length).toBe(1);
      expect(ddl[0]).toBe(
        "ALTER TABLE Tracks DROP CONSTRAINT FK_Tracks_AlbumId_TO_BE_DROPPED"
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Attempting to DROP foreign key for Tracks.AlbumId. The specific constraint name is required. Using placeholder: FK_Tracks_AlbumId_TO_BE_DROPPED. This will likely FAIL.` // Updated
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
                  "UserId", // DB Name
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
      const playlistsTableAfterAddColFk = createSampleTable("Playlists", {
        UserId: createSampleColumn(
          // JS Key (same as DB name)
          "UserId", // DB Name
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
      });
      const newSnapshot = createMockNewSchemaSnapshot(
        { Playlists: playlistsTableAfterAddColFk },
        "spanner"
      );
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];
      const ddl = ddlBatches.flat();
      expect(ddl.length).toBe(2);
      expect(ddl[0]).toBe("ALTER TABLE Playlists ADD COLUMN UserId STRING(36)");
      expect(ddl[1]).toBe(
        "ALTER TABLE Playlists ADD CONSTRAINT FK_Playlists_UserId FOREIGN KEY (UserId) REFERENCES Users (UserId)"
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
      const table1Snapshot =
        schemaDiff.tableChanges[0].action === "add"
          ? schemaDiff.tableChanges[0].table
          : undefined;
      const table2Snapshot =
        schemaDiff.tableChanges[2].action === "add"
          ? schemaDiff.tableChanges[2].table
          : undefined;

      // Construct newSchemaSnapshot based on the final state of tables after all changes in schemaDiff
      // This is a simplified representation; a real scenario might need more complex logic
      // to build the 'after' state if changes were more intricate (e.g., column modifications within TestTable1).
      const finalTables: Record<string, TableSnapshot> = {};
      if (table1Snapshot) {
        // Simulate adding columns from columnChanges to table1Snapshot
        const finalTable1Cols = { ...table1Snapshot.columns };
        const colChanges =
          schemaDiff.tableChanges[1].action === "change"
            ? schemaDiff.tableChanges[1].columnChanges
            : [];
        if (colChanges) {
          for (const colChange of colChanges) {
            if (colChange.action === "add") {
              finalTable1Cols[colChange.column.name] = colChange.column; // Assuming key is same as name for simplicity here
            }
          }
        }
        finalTables[table1Snapshot.name] = {
          ...table1Snapshot,
          columns: finalTable1Cols,
        };
      }
      if (table2Snapshot) {
        finalTables[table2Snapshot.name] = table2Snapshot;
      }

      const newSnapshot = createMockNewSchemaSnapshot(finalTables, "spanner");
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];

      // Updated expectations based on global sort by DDL type:
      // DDL order after global sort by type:
      // 1. CREATE TABLE TestTable1 (NV)
      // 2. CREATE TABLE TestTable2 (NV)
      // 3. ALTER TABLE TestTable1 ADD COLUMN field2 (V)
      // 4. ALTER TABLE TestTable1 ADD COLUMN field3 (V)
      // 5. ALTER TABLE TestTable1 ADD COLUMN field4 (V)
      // 6. ALTER TABLE TestTable1 ADD COLUMN field5 (V)
      // 7. ALTER TABLE TestTable1 ADD COLUMN field6 (V)
      // 8. CREATE INDEX idx_field1 ON TestTable1 (field1) (V)
      // 9. CREATE UNIQUE INDEX idx_data ON TestTable2 (data) (V)

      // Expected Batching:
      // Batch 1 (NV): [CREATE TABLE TestTable1, CREATE TABLE TestTable2] (length 2)
      // Batch 2 (V): [ALTER...field2, ALTER...field3, ALTER...field4, ALTER...field5, ALTER...field6] (length 5)
      // Batch 3 (V): [CREATE INDEX idx_field1, CREATE UNIQUE INDEX idx_data] (length 2)
      expect(ddlBatches.length).toBe(3);

      // Batch 1: Create Tables (Non-validating)
      expect(ddlBatches[0].length).toBe(2);
      expect(ddlBatches[0][0]).toContain("CREATE TABLE TestTable1");
      expect(ddlBatches[0][1]).toContain("CREATE TABLE TestTable2");

      // Batch 2: Add Columns (Validating)
      expect(ddlBatches[1].length).toBe(5);
      expect(ddlBatches[1][0]).toContain(
        "ALTER TABLE TestTable1 ADD COLUMN field2"
      );
      expect(ddlBatches[1][1]).toContain(
        "ALTER TABLE TestTable1 ADD COLUMN field3"
      );
      expect(ddlBatches[1][2]).toContain(
        "ALTER TABLE TestTable1 ADD COLUMN field4"
      );
      expect(ddlBatches[1][3]).toContain(
        "ALTER TABLE TestTable1 ADD COLUMN field5"
      );
      expect(ddlBatches[1][4]).toContain(
        "ALTER TABLE TestTable1 ADD COLUMN field6"
      );

      // Batch 3: Create Indexes (Validating)
      expect(ddlBatches[2].length).toBe(2);
      expect(ddlBatches[2][0]).toContain(
        "CREATE INDEX idx_field1 ON TestTable1 (field1)"
      );
      expect(ddlBatches[2][1]).toContain(
        "CREATE UNIQUE INDEX idx_data ON TestTable2 (data)"
      );
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
      const newSnapshot = createMockNewSchemaSnapshot({}, "spanner"); // Empty tables after removals
      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];
      // All are non-validating, so they should be batched by SPANNER_DDL_BATCH_SIZE
      expect(ddlBatches.length).toBe(2);
      expect(ddlBatches[0].length).toBe(5);
      expect(ddlBatches[1].length).toBe(1);
      expect(ddlBatches[0][0]).toBe("DROP TABLE OldTable1");
      expect(ddlBatches[1][0]).toBe("DROP TABLE OldTable6");
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

      // Construct the newSchemaSnapshot: T1 with c1-c5, OldTableDrop is removed.
      const t1Cols: Record<string, ColumnSnapshot> = {};
      const colChangesToAdd =
        schemaDiff.tableChanges[0].action === "change"
          ? schemaDiff.tableChanges[0].columnChanges
          : [];
      if (colChangesToAdd) {
        for (const colChange of colChangesToAdd) {
          if (colChange.action === "add") {
            t1Cols[colChange.column.name] = colChange.column; // Assuming key is same as name
          }
        }
      }
      const t1TableSnapshot = createSampleTable("T1", t1Cols);
      const newSnapshot = createMockNewSchemaSnapshot(
        { T1: t1TableSnapshot },
        "spanner"
      );

      const ddlBatches = generateMigrationDDL(
        schemaDiff,
        newSnapshot,
        "spanner"
      ) as string[][];

      // Updated expectations based on global sort by DDL type:
      // DDL order: DROP TABLE OldTableDrop (NV), then 5x ALTER TABLE T1 ADD COLUMN (V)
      // Batch 1 (NV): [DROP TABLE OldTableDrop] (length 1)
      // Batch 2 (V): [ALTER T1 ADD c1, ..., ALTER T1 ADD c5] (length 5)
      expect(ddlBatches.length).toBe(2);

      expect(ddlBatches[0].length).toBe(1);
      expect(ddlBatches[0][0]).toBe("DROP TABLE OldTableDrop");

      expect(ddlBatches[1].length).toBe(5);
      expect(ddlBatches[1][0]).toContain("ALTER TABLE T1 ADD COLUMN c1 BOOL");
    });
  });
});
