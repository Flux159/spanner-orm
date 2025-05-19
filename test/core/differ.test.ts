// test/core/differ.test.ts

import { describe, it, expect } from "vitest";
import { generateSchemaDiff } from "../../src/core/differ";
import type {
  SchemaSnapshot,
  ColumnSnapshot,
  IndexSnapshot,
  CompositePrimaryKeySnapshot,
  InterleaveSnapshot,
  TableSnapshot,
} from "../../src/types/common";

const V1_SNAPSHOT_VERSION = "1.0.0";

const createBaseSnapshot = (
  tables: Record<string, TableSnapshot> = {}
): SchemaSnapshot => ({
  version: V1_SNAPSHOT_VERSION,
  dialect: "common",
  tables,
});

const sampleColumn = (
  name: string,
  type: string = "text",
  overrides: Partial<ColumnSnapshot> = {}
): ColumnSnapshot => ({
  name,
  type,
  dialectTypes: {
    postgres: type.toUpperCase(),
    spanner: type === "text" ? "STRING(MAX)" : type.toUpperCase(),
  },
  ...overrides,
});

const sampleIndex = (
  columns: string[],
  name?: string,
  unique: boolean = false
): IndexSnapshot => ({
  name,
  columns,
  unique,
});

const samplePK = (
  columns: string[],
  name?: string
): CompositePrimaryKeySnapshot => ({
  name,
  columns,
});

const sampleInterleave = (
  parentTable: string,
  onDelete: "cascade" | "no action" = "cascade"
): InterleaveSnapshot => ({
  parentTable,
  onDelete,
});

describe("generateSchemaDiff", () => {
  it("should detect no changes for identical snapshots", () => {
    const snapshot1 = createBaseSnapshot({
      users: {
        name: "users",
        columns: { id: sampleColumn("id", "varchar", { primaryKey: true }) },
      },
    });
    const diff = generateSchemaDiff(snapshot1, snapshot1);
    expect(diff.tableChanges).toEqual([]);
  });

  it("should detect added table", () => {
    const snapshot1 = createBaseSnapshot();
    const snapshot2 = createBaseSnapshot({
      users: {
        name: "users",
        columns: { id: sampleColumn("id", "varchar", { primaryKey: true }) },
      },
    });
    const diff = generateSchemaDiff(snapshot1, snapshot2);
    expect(diff.tableChanges).toEqual([
      { action: "add", table: snapshot2.tables.users },
    ]);
  });

  it("should detect removed table", () => {
    const snapshot1 = createBaseSnapshot({
      users: {
        name: "users",
        columns: { id: sampleColumn("id", "varchar", { primaryKey: true }) },
      },
    });
    const snapshot2 = createBaseSnapshot();
    const diff = generateSchemaDiff(snapshot1, snapshot2);
    expect(diff.tableChanges).toEqual([
      { action: "remove", tableName: "users" },
    ]);
  });

  describe("Table Changes", () => {
    it("should detect added column", () => {
      const snapshot1 = createBaseSnapshot({
        users: { name: "users", columns: { id: sampleColumn("id") } },
      });
      const snapshot2 = createBaseSnapshot({
        users: {
          name: "users",
          columns: {
            id: sampleColumn("id"),
            email: sampleColumn("email", "varchar"),
          },
        },
      });
      const diff = generateSchemaDiff(snapshot1, snapshot2);
      expect(diff.tableChanges.length).toBe(1);
      expect(diff.tableChanges[0].action).toBe("change");
      if (diff.tableChanges[0].action === "change") {
        expect(diff.tableChanges[0].columnChanges).toEqual([
          { action: "add", column: snapshot2.tables.users.columns.email },
        ]);
      }
    });

    it("should detect removed column", () => {
      const snapshot1 = createBaseSnapshot({
        users: {
          name: "users",
          columns: {
            id: sampleColumn("id"),
            email: sampleColumn("email", "varchar"),
          },
        },
      });
      const snapshot2 = createBaseSnapshot({
        users: { name: "users", columns: { id: sampleColumn("id") } },
      });
      const diff = generateSchemaDiff(snapshot1, snapshot2);
      expect(diff.tableChanges.length).toBe(1);
      expect(diff.tableChanges[0].action).toBe("change");
      if (diff.tableChanges[0].action === "change") {
        expect(diff.tableChanges[0].columnChanges).toEqual([
          { action: "remove", columnName: "email" },
        ]);
      }
    });

    it("should detect changed column type", () => {
      const snapshot1 = createBaseSnapshot({
        users: {
          name: "users",
          columns: { id: sampleColumn("id", "integer") },
        },
      });
      const snapshot2 = createBaseSnapshot({
        users: {
          name: "users",
          columns: { id: sampleColumn("id", "varchar") },
        },
      });
      const diff = generateSchemaDiff(snapshot1, snapshot2);
      expect(diff.tableChanges.length).toBe(1);
      if (diff.tableChanges[0].action === "change") {
        expect(diff.tableChanges[0].columnChanges).toEqual([
          {
            action: "change",
            columnName: "id",
            changes: {
              type: "varchar",
              dialectTypes: { postgres: "VARCHAR", spanner: "VARCHAR" },
            },
          },
        ]);
      }
    });

    it("should detect changed column notNull constraint", () => {
      const snapshot1 = createBaseSnapshot({
        users: {
          name: "users",
          columns: {
            email: sampleColumn("email", "varchar", { notNull: false }),
          },
        },
      });
      const snapshot2 = createBaseSnapshot({
        users: {
          name: "users",
          columns: {
            email: sampleColumn("email", "varchar", { notNull: true }),
          },
        },
      });
      const diff = generateSchemaDiff(snapshot1, snapshot2);
      expect(diff.tableChanges.length).toBe(1);
      if (diff.tableChanges[0].action === "change") {
        expect(diff.tableChanges[0].columnChanges).toEqual([
          {
            action: "change",
            columnName: "email",
            changes: { notNull: true },
          },
        ]);
      }
    });

    it("should detect added index", () => {
      const snapshot1 = createBaseSnapshot({
        users: { name: "users", columns: { email: sampleColumn("email") } },
      });
      const newIndex = sampleIndex(["email"], "users_email_idx");
      const snapshot2 = createBaseSnapshot({
        users: {
          name: "users",
          columns: { email: sampleColumn("email") },
          indexes: [newIndex],
        },
      });
      const diff = generateSchemaDiff(snapshot1, snapshot2);
      expect(diff.tableChanges.length).toBe(1);
      if (diff.tableChanges[0].action === "change") {
        expect(diff.tableChanges[0].indexChanges).toEqual([
          { action: "add", index: newIndex },
        ]);
      }
    });

    it("should detect removed index", () => {
      const oldIndex = sampleIndex(["email"], "users_email_idx");
      const snapshot1 = createBaseSnapshot({
        users: {
          name: "users",
          columns: { email: sampleColumn("email") },
          indexes: [oldIndex],
        },
      });
      const snapshot2 = createBaseSnapshot({
        users: { name: "users", columns: { email: sampleColumn("email") } },
      });
      const diff = generateSchemaDiff(snapshot1, snapshot2);
      expect(diff.tableChanges.length).toBe(1);
      if (diff.tableChanges[0].action === "change") {
        expect(diff.tableChanges[0].indexChanges).toEqual([
          { action: "remove", indexName: "users_email_idx" },
        ]);
      }
    });

    it("should detect changed index (e.g. unique status)", () => {
      const snapshot1 = createBaseSnapshot({
        users: {
          name: "users",
          columns: { email: sampleColumn("email") },
          indexes: [sampleIndex(["email"], "users_email_idx", false)],
        },
      });
      const snapshot2 = createBaseSnapshot({
        users: {
          name: "users",
          columns: { email: sampleColumn("email") },
          indexes: [sampleIndex(["email"], "users_email_idx", true)],
        },
      });
      const diff = generateSchemaDiff(snapshot1, snapshot2);
      expect(diff.tableChanges.length).toBe(1);
      if (diff.tableChanges[0].action === "change") {
        expect(diff.tableChanges[0].indexChanges).toEqual([
          {
            action: "change",
            indexName: "users_email_idx",
            changes: { unique: true },
          },
        ]);
      }
    });

    it("should detect set composite primary key", () => {
      const snapshot1 = createBaseSnapshot({
        orders: {
          name: "orders",
          columns: {
            orderId: sampleColumn("orderId"),
            itemId: sampleColumn("itemId"),
          },
        },
      });
      const newPk = samplePK(["orderId", "itemId"], "orders_pk");
      const snapshot2 = createBaseSnapshot({
        orders: {
          name: "orders",
          columns: {
            orderId: sampleColumn("orderId"),
            itemId: sampleColumn("itemId"),
          },
          compositePrimaryKey: newPk,
        },
      });
      const diff = generateSchemaDiff(snapshot1, snapshot2);
      expect(diff.tableChanges.length).toBe(1);
      if (diff.tableChanges[0].action === "change") {
        expect(diff.tableChanges[0].primaryKeyChange).toEqual({
          action: "set",
          pk: newPk,
        });
      }
    });

    it("should detect removed composite primary key", () => {
      const oldPk = samplePK(["orderId", "itemId"], "orders_pk");
      const snapshot1 = createBaseSnapshot({
        orders: {
          name: "orders",
          columns: {
            orderId: sampleColumn("orderId"),
            itemId: sampleColumn("itemId"),
          },
          compositePrimaryKey: oldPk,
        },
      });
      const snapshot2 = createBaseSnapshot({
        orders: {
          name: "orders",
          columns: {
            orderId: sampleColumn("orderId"),
            itemId: sampleColumn("itemId"),
          },
        },
      });
      const diff = generateSchemaDiff(snapshot1, snapshot2);
      expect(diff.tableChanges.length).toBe(1);
      if (diff.tableChanges[0].action === "change") {
        expect(diff.tableChanges[0].primaryKeyChange).toEqual({
          action: "remove",
          pkName: "orders_pk",
        });
      }
    });

    it("should detect set interleave", () => {
      const snapshot1 = createBaseSnapshot({
        orderDetails: {
          name: "orderDetails",
          columns: { detailId: sampleColumn("detailId") },
        },
      });
      const newInterleave = sampleInterleave("orders");
      const snapshot2 = createBaseSnapshot({
        orderDetails: {
          name: "orderDetails",
          columns: { detailId: sampleColumn("detailId") },
          interleave: newInterleave,
        },
      });
      const diff = generateSchemaDiff(snapshot1, snapshot2);
      expect(diff.tableChanges.length).toBe(1);
      if (diff.tableChanges[0].action === "change") {
        expect(diff.tableChanges[0].interleaveChange).toEqual({
          action: "set",
          interleave: newInterleave,
        });
      }
    });

    it("should detect removed interleave", () => {
      const oldInterleave = sampleInterleave("orders");
      const snapshot1 = createBaseSnapshot({
        orderDetails: {
          name: "orderDetails",
          columns: { detailId: sampleColumn("detailId") },
          interleave: oldInterleave,
        },
      });
      const snapshot2 = createBaseSnapshot({
        orderDetails: {
          name: "orderDetails",
          columns: { detailId: sampleColumn("detailId") },
        },
      });
      const diff = generateSchemaDiff(snapshot1, snapshot2);
      expect(diff.tableChanges.length).toBe(1);
      if (diff.tableChanges[0].action === "change") {
        expect(diff.tableChanges[0].interleaveChange).toEqual({
          action: "remove",
        });
      }
    });
  });
});
