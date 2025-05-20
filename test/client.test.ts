import { vi, describe, it, expect, beforeEach } from "vitest";
import { OrmClient } from "../src/client";
import type {
  DatabaseAdapter,
  QueryResultRow,
  Transaction,
  AffectedRows,
} from "../src/types/adapter";
import type {
  SQL,
  TableConfig,
  PreparedQuery,
  Dialect,
  EnhancedIncludeClause,
  SelectFields,
} from "../src/types/common";
import { QueryBuilder } from "../src/core/query-builder";
import { shapeResults } from "../src/core/result-shaper";

vi.mock("../src/core/result-shaper");

const mockSql: SQL = {
  toSqlString: vi.fn(() => "SELECT mock"),
  getValues: vi.fn(() => []),
  _isSQL: true,
};

const usersTable: TableConfig = {
  name: "users",
  columns: {
    id: {
      name: "id",
      type: "integer",
      dialectTypes: { postgres: "INTEGER", spanner: "INT64" },
      primaryKey: true,
    },
    name: {
      name: "name",
      type: "text",
      dialectTypes: { postgres: "TEXT", spanner: "STRING(MAX)" },
    },
    email: {
      name: "email",
      type: "text",
      dialectTypes: { postgres: "TEXT", spanner: "STRING(MAX)" },
      unique: true,
    },
  },
  _isTable: true,
};

const postsTable: TableConfig = {
  name: "posts",
  columns: {
    id: {
      name: "id",
      type: "integer",
      dialectTypes: { postgres: "INTEGER", spanner: "INT64" },
      primaryKey: true,
    },
    user_id: {
      name: "user_id",
      type: "integer",
      dialectTypes: { postgres: "INTEGER", spanner: "INT64" },
      references: { referencesFn: () => usersTable.columns.id },
    },
    title: {
      name: "title",
      type: "text",
      dialectTypes: { postgres: "TEXT", spanner: "STRING(MAX)" },
    },
  },
  _isTable: true,
};

const mockQueryBuilderInstance = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  groupBy: vi.fn().mockReturnThis(),
  include: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  deleteFrom: vi.fn().mockReturnThis(),
  prepare: vi.fn(),
};

vi.mock("../src/core/query-builder", () => ({
  QueryBuilder: vi.fn(() => mockQueryBuilderInstance),
}));

describe("OrmClient & ExecutableQuery", () => {
  let mockAdapter: DatabaseAdapter;
  let db: OrmClient;

  beforeEach(() => {
    vi.clearAllMocks();
    (shapeResults as vi.Mock).mockClear();

    Object.values(mockQueryBuilderInstance).forEach((mockFn) =>
      (mockFn as vi.Mock).mockClear().mockReturnThis()
    );
    (mockQueryBuilderInstance.prepare as vi.Mock).mockClear();

    mockAdapter = {
      dialect: "postgres" as Dialect,
      connect: vi.fn(),
      disconnect: vi.fn(),
      execute: vi.fn(),
      query: vi.fn(),
      beginTransaction: vi.fn(),
    };

    (mockAdapter.connect as vi.Mock).mockResolvedValue(undefined);
    (mockAdapter.disconnect as vi.Mock).mockResolvedValue(undefined);
    (mockAdapter.execute as vi.Mock).mockResolvedValue({
      count: 1,
    } as AffectedRows);
    (mockAdapter.query as vi.Mock).mockResolvedValue([] as QueryResultRow[]);

    db = new OrmClient(mockAdapter, "postgres");
  });

  describe("OrmClient", () => {
    it("should initialize select query", () => {
      db.select({ id: true, name: true });
      expect(QueryBuilder).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilderInstance.select).toHaveBeenCalledWith({
        id: true,
        name: true,
      });
    });
    it("should initialize insert query", () => {
      db.insert(usersTable);
      expect(QueryBuilder).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilderInstance.insert).toHaveBeenCalledWith(usersTable);
    });
    it("should initialize update query", () => {
      db.update(usersTable);
      expect(QueryBuilder).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilderInstance.update).toHaveBeenCalledWith(usersTable);
    });
    it("should initialize delete query", () => {
      db.deleteFrom(usersTable);
      expect(QueryBuilder).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilderInstance.deleteFrom).toHaveBeenCalledWith(
        usersTable
      );
    });
  });

  describe("ExecutableQuery (SELECT)", () => {
    const mockSelectPreparedQuery: PreparedQuery<any, any> = {
      sql: "SELECT id, name FROM users WHERE id = $1",
      parameters: [1],
      dialect: "postgres",
      action: "select",
      primaryTable: usersTable,
      fields: { id: true, name: true } as unknown as SelectFields<
        TableConfig<any, any>
      >,
    };
    it("should build and execute a SELECT query", async () => {
      (mockQueryBuilderInstance.prepare as vi.Mock).mockReturnValue(
        mockSelectPreparedQuery
      );
      (mockAdapter.query as vi.Mock).mockResolvedValue([
        { id: 1, name: "Test User" },
      ]);
      const users = await db
        .select({ id: usersTable.columns.id, name: usersTable.columns.name })
        .from(usersTable)
        .where(mockSql)
        .limit(1);
      expect(mockAdapter.query).toHaveBeenCalledWith(
        mockSelectPreparedQuery.sql,
        mockSelectPreparedQuery.parameters
      );
      expect(users).toEqual([{ id: 1, name: "Test User" }]);
    });
    it("should call shapeResults for SELECT query with include", async () => {
      const includeClause: EnhancedIncludeClause = {
        posts: {
          relationTable: postsTable,
          options: { select: { title: true } },
        },
      };
      const mockSelectWithIncludePreparedQuery: PreparedQuery<any, any> = {
        ...mockSelectPreparedQuery,
        includeClause,
        primaryTable: usersTable,
      };
      const rawData = [{ id: 1, name: "Test User", posts__title: "Post 1" }];
      const shapedData = [
        { id: 1, name: "Test User", posts: [{ title: "Post 1" }] },
      ];
      (mockQueryBuilderInstance.prepare as vi.Mock).mockReturnValue(
        mockSelectWithIncludePreparedQuery
      );
      (mockAdapter.query as vi.Mock).mockResolvedValue(rawData);
      (shapeResults as vi.Mock).mockReturnValue(shapedData);
      const result = await db
        .select({ id: usersTable.columns.id, name: usersTable.columns.name })
        .from(usersTable)
        .include(includeClause);
      expect(shapeResults).toHaveBeenCalledWith(
        rawData,
        usersTable,
        includeClause
      );
      expect(result).toEqual(shapedData);
    });
  });

  describe("ExecutableQuery (INSERT)", () => {
    it("should build and execute an INSERT query", async () => {
      const mockInsertPreparedQuery: PreparedQuery<any, any> = {
        sql: "INSERT INTO users (email, name) VALUES ($1, $2)",
        parameters: ["new@example.com", "New User"],
        dialect: "postgres",
        action: "insert",
        primaryTable: usersTable,
      };
      (mockQueryBuilderInstance.prepare as vi.Mock).mockReturnValue(
        mockInsertPreparedQuery
      );
      (mockAdapter.execute as vi.Mock).mockResolvedValue({ count: 1 });
      const result = await db
        .insert(usersTable)
        .values({ name: "New User", email: "new@example.com" });
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        mockInsertPreparedQuery.sql,
        mockInsertPreparedQuery.parameters
      );
      expect(result).toEqual({ count: 1 });
    });
  });

  describe("ExecutableQuery (UPDATE)", () => {
    it("should build and execute an UPDATE query", async () => {
      const mockUpdatePreparedQuery: PreparedQuery<any, any> = {
        sql: "UPDATE users SET name = $1 WHERE SELECT mock",
        parameters: ["Updated User"],
        dialect: "postgres",
        action: "update",
        primaryTable: usersTable,
      };
      (mockQueryBuilderInstance.prepare as vi.Mock).mockReturnValue(
        mockUpdatePreparedQuery
      );
      (mockAdapter.execute as vi.Mock).mockResolvedValue({ count: 1 });
      const result = await db
        .update(usersTable)
        .set({ name: "Updated User" })
        .where(mockSql);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        mockUpdatePreparedQuery.sql,
        mockUpdatePreparedQuery.parameters
      );
      expect(result).toEqual({ count: 1 });
    });
  });

  describe("ExecutableQuery (DELETE)", () => {
    it("should build and execute a DELETE query", async () => {
      const mockDeletePreparedQuery: PreparedQuery<any, any> = {
        sql: "DELETE FROM users WHERE SELECT mock",
        parameters: [],
        dialect: "postgres",
        action: "delete",
        primaryTable: usersTable,
      };
      (mockQueryBuilderInstance.prepare as vi.Mock).mockReturnValue(
        mockDeletePreparedQuery
      );
      (mockAdapter.execute as vi.Mock).mockResolvedValue({ count: 1 });
      const result = await db.deleteFrom(usersTable).where(mockSql);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        mockDeletePreparedQuery.sql,
        mockDeletePreparedQuery.parameters
      );
      expect(result).toEqual({ count: 1 });
    });
  });

  describe("ExecutableRawQuery", () => {
    it("should execute a raw query", async () => {
      const rawSqlInst: SQL = {
        toSqlString: () => "SELECT * FROM test_raw",
        getValues: () => [42],
        _isSQL: true,
      };
      const mockRawData = [{ col: "value" }];
      (mockAdapter.query as vi.Mock).mockResolvedValue(mockRawData);
      const result = await db.raw(rawSqlInst);
      expect(mockAdapter.query).toHaveBeenCalledWith("SELECT * FROM test_raw", [
        42,
      ]);
      expect(result).toEqual(mockRawData);
    });
  });

  describe("OrmClient Transactions", () => {
    let mockTransaction: Transaction;

    beforeEach(() => {
      mockTransaction = {
        execute: vi.fn(),
        query: vi.fn(),
        commit: vi.fn(),
        rollback: vi.fn(),
      };

      (mockTransaction.execute as vi.Mock).mockResolvedValue({
        count: 1,
      } as AffectedRows);
      (mockTransaction.query as vi.Mock).mockResolvedValue(
        [] as QueryResultRow[]
      );
      (mockTransaction.commit as vi.Mock).mockResolvedValue(undefined);
      (mockTransaction.rollback as vi.Mock).mockResolvedValue(undefined);

      if (mockAdapter.beginTransaction) {
        (mockAdapter.beginTransaction as vi.Mock).mockResolvedValue(
          mockTransaction
        );
      }
    });

    it("should commit a successful transaction", async () => {
      if (!mockAdapter.beginTransaction) {
        throw new Error("beginTransaction is not mocked");
      }
      const mockTxInsertPreparedQuery: PreparedQuery<any, any> = {
        sql: "INSERT INTO users (name) VALUES ($1)",
        parameters: ["Tx User"],
        dialect: "postgres",
        action: "insert",
        primaryTable: usersTable,
      };
      (mockQueryBuilderInstance.prepare as vi.Mock).mockReturnValueOnce(
        mockTxInsertPreparedQuery
      );

      await db.transaction(async (txDb) => {
        await txDb.insert(usersTable).values({ name: "Tx User" });
      });
      expect(mockAdapter.beginTransaction).toHaveBeenCalledTimes(1);
      expect(mockTransaction.execute).toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalledTimes(1);
      expect(mockTransaction.rollback).not.toHaveBeenCalled();
    });

    it("should rollback a failed transaction", async () => {
      if (!mockAdapter.beginTransaction) {
        throw new Error("beginTransaction is not mocked");
      }
      const mockTxInsertPreparedQuery: PreparedQuery<any, any> = {
        sql: "INSERT INTO users (name) VALUES ($1)",
        parameters: ["Tx User Fail"],
        dialect: "postgres",
        action: "insert",
        primaryTable: usersTable,
      };
      (mockQueryBuilderInstance.prepare as vi.Mock).mockReturnValueOnce(
        mockTxInsertPreparedQuery
      );

      const error = new Error("Transaction failed");
      (mockTransaction.execute as vi.Mock).mockRejectedValueOnce(error);

      await expect(
        db.transaction(async (txDb) => {
          await txDb.insert(usersTable).values({ name: "Tx User Fail" });
        })
      ).rejects.toThrow("Transaction failed");

      expect(mockAdapter.beginTransaction).toHaveBeenCalledTimes(1);
      expect(mockTransaction.execute).toHaveBeenCalled();
      expect(mockTransaction.commit).not.toHaveBeenCalled();
      expect(mockTransaction.rollback).toHaveBeenCalledTimes(1);
    });
  });
});
