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
  tableName: "users", // Changed from name to tableName
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
  tableName: "posts", // Changed from name to tableName
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
  returning: vi.fn().mockReturnThis(), // Added returning mock
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

  describe("ExecutableQuery (INSERT with RETURNING)", () => {
    it("should execute INSERT with RETURNING * and use adapter.query", async () => {
      const mockInsertReturningStarPreparedQuery: PreparedQuery<any, any> = {
        sql: "INSERT INTO users (name) VALUES ($1) RETURNING *",
        parameters: ["Returning User"],
        dialect: "postgres",
        action: "insert",
        primaryTable: usersTable,
      };
      (mockQueryBuilderInstance.prepare as vi.Mock).mockReturnValue(
        mockInsertReturningStarPreparedQuery
      );
      const mockReturnedData = [
        { id: 1, name: "Returning User", email: "ret@ex.com" },
      ];
      (mockAdapter.query as vi.Mock).mockResolvedValue(mockReturnedData);

      const result = await db
        .insert(usersTable)
        .values({ name: "Returning User" })
        .returning(); // Implicit RETURNING *

      expect(mockQueryBuilderInstance.returning).toHaveBeenCalledWith(
        undefined
      ); // or true, depending on QueryBuilder impl.
      expect(mockAdapter.query).toHaveBeenCalledWith(
        mockInsertReturningStarPreparedQuery.sql,
        mockInsertReturningStarPreparedQuery.parameters
      );
      expect(mockAdapter.execute).not.toHaveBeenCalled();
      expect(result).toEqual(mockReturnedData);
    });

    it("should execute INSERT with RETURNING specific columns", async () => {
      const mockInsertReturningColsPreparedQuery: PreparedQuery<any, any> = {
        sql: "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, email",
        parameters: ["Specific Col User", "specific@example.com"],
        dialect: "postgres",
        action: "insert",
        primaryTable: usersTable,
      };
      (mockQueryBuilderInstance.prepare as vi.Mock).mockReturnValue(
        mockInsertReturningColsPreparedQuery
      );
      const mockReturnedData = [{ id: 2, email: "specific@example.com" }];
      (mockAdapter.query as vi.Mock).mockResolvedValue(mockReturnedData);

      const result = await db
        .insert(usersTable)
        .values({ name: "Specific Col User", email: "specific@example.com" })
        .returning({
          id: usersTable.columns.id,
          email: usersTable.columns.email,
        });

      expect(mockQueryBuilderInstance.returning).toHaveBeenCalledWith({
        id: usersTable.columns.id,
        email: usersTable.columns.email,
      });
      expect(mockAdapter.query).toHaveBeenCalledWith(
        mockInsertReturningColsPreparedQuery.sql,
        mockInsertReturningColsPreparedQuery.parameters
      );
      expect(result).toEqual(mockReturnedData);
    });

    it("should emulate INSERT with RETURNING for Spanner", async () => {
      db = new OrmClient(mockAdapter, "spanner");
      const insertData = {
        id: "new-uuid",
        name: "Spanner User",
        email: "spanner@user.com",
      };

      // Mock for the initial INSERT DML
      const mockInsertDmlPrepared: PreparedQuery<any, any> = {
        sql: "INSERT INTO users (id, name, email) VALUES (@p1, @p2, @p3)",
        parameters: [insertData.id, insertData.name, insertData.email],
        dialect: "spanner",
        action: "insert",
        primaryTable: usersTable,
      };

      // Mock for the subsequent SELECT to fetch the "returned" data
      const mockSelectAfterInsertPrepared: PreparedQuery<any, any> = {
        sql: "SELECT id, name, email FROM users WHERE id = @p1", // Simplified for test
        parameters: [insertData.id],
        dialect: "spanner",
        action: "select",
        primaryTable: usersTable,
        fields: { id: true, name: true, email: true } as any,
      };
      const expectedReturnedData = [insertData];

      (mockQueryBuilderInstance.prepare as vi.Mock)
        .mockReturnValueOnce(mockInsertDmlPrepared) // For the .insert().values() part
        .mockReturnValueOnce(mockSelectAfterInsertPrepared); // For the internal SELECT

      (mockAdapter.execute as vi.Mock).mockResolvedValueOnce({ count: 1 });
      (mockAdapter.query as vi.Mock).mockResolvedValueOnce(
        expectedReturnedData
      );

      const result = await db.insert(usersTable).values(insertData).returning();

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        mockInsertDmlPrepared.sql,
        mockInsertDmlPrepared.parameters
      );
      expect(mockAdapter.query).toHaveBeenCalledWith(
        mockSelectAfterInsertPrepared.sql,
        mockSelectAfterInsertPrepared.parameters
      );
      expect(result).toEqual(expectedReturnedData);
      // Ensure QueryBuilder.returning was called
      expect(mockQueryBuilderInstance.returning).toHaveBeenCalled();
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

  describe("ExecutableQuery (UPDATE with RETURNING)", () => {
    it("should execute UPDATE with RETURNING *", async () => {
      const mockUpdateReturningStar: PreparedQuery<any, any> = {
        sql: "UPDATE users SET name = $1 WHERE id = $2 RETURNING *",
        parameters: ["Updated Name", 1],
        dialect: "postgres",
        action: "update",
        primaryTable: usersTable,
      };
      (mockQueryBuilderInstance.prepare as vi.Mock).mockReturnValue(
        mockUpdateReturningStar
      );
      const mockReturnedData = [
        { id: 1, name: "Updated Name", email: "user@example.com" },
      ];
      (mockAdapter.query as vi.Mock).mockResolvedValue(mockReturnedData);

      const result = await db
        .update(usersTable)
        .set({ name: "Updated Name" })
        .where(mockSql) // mockSql is just a placeholder for where condition
        .returning();

      expect(mockAdapter.query).toHaveBeenCalledWith(
        mockUpdateReturningStar.sql,
        mockUpdateReturningStar.parameters
      );
      expect(result).toEqual(mockReturnedData);
    });

    it("should emulate UPDATE with RETURNING for Spanner", async () => {
      db = new OrmClient(mockAdapter, "spanner");
      const updateData = { name: "Spanner Update" };
      const whereConditionSql = mockSql; // Using the existing mockSql for the WHERE

      const mockUpdateDmlPrepared: PreparedQuery<any, any> = {
        sql: "UPDATE users SET name = @p1 WHERE SELECT mock",
        parameters: [updateData.name],
        dialect: "spanner",
        action: "update",
        primaryTable: usersTable,
      };

      // Mock for the SELECT that fetches based on the original WHERE
      const mockSelectAfterUpdatePrepared: PreparedQuery<any, any> = {
        sql: "SELECT id, name, email FROM users WHERE SELECT mock", // WHERE clause should match update
        parameters: whereConditionSql.getValues("spanner"),
        dialect: "spanner",
        action: "select",
        primaryTable: usersTable,
        fields: { id: true, name: true, email: true } as any,
      };
      const expectedReturnedData = [
        { id: 1, name: "Spanner Update", email: "original@spanner.com" },
      ];

      (mockQueryBuilderInstance.prepare as vi.Mock)
        .mockReturnValueOnce(mockUpdateDmlPrepared)
        .mockReturnValueOnce(mockSelectAfterUpdatePrepared);

      (mockAdapter.execute as vi.Mock).mockResolvedValueOnce({ count: 1 });
      (mockAdapter.query as vi.Mock).mockResolvedValueOnce(
        expectedReturnedData
      );

      const result = await db
        .update(usersTable)
        .set(updateData)
        .where(whereConditionSql)
        .returning();

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        mockUpdateDmlPrepared.sql,
        mockUpdateDmlPrepared.parameters
      );
      expect(mockAdapter.query).toHaveBeenCalledWith(
        mockSelectAfterUpdatePrepared.sql,
        mockSelectAfterUpdatePrepared.parameters
      );
      expect(result).toEqual(expectedReturnedData);
      expect(mockQueryBuilderInstance.returning).toHaveBeenCalled();
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

  describe("ExecutableQuery (DELETE with RETURNING)", () => {
    it("should execute DELETE with RETURNING *", async () => {
      const mockDeleteReturningStar: PreparedQuery<any, any> = {
        sql: "DELETE FROM users WHERE id = $1 RETURNING *",
        parameters: [1],
        dialect: "postgres",
        action: "delete",
        primaryTable: usersTable,
      };
      (mockQueryBuilderInstance.prepare as vi.Mock).mockReturnValue(
        mockDeleteReturningStar
      );
      const mockReturnedData = [
        { id: 1, name: "Deleted User", email: "deleted@example.com" },
      ];
      (mockAdapter.query as vi.Mock).mockResolvedValue(mockReturnedData);

      const result = await db
        .deleteFrom(usersTable)
        .where(mockSql) // mockSql for where condition
        .returning();

      expect(mockAdapter.query).toHaveBeenCalledWith(
        mockDeleteReturningStar.sql,
        mockDeleteReturningStar.parameters
      );
      expect(result).toEqual(mockReturnedData);
    });

    it("should emulate DELETE with RETURNING for Spanner", async () => {
      db = new OrmClient(mockAdapter, "spanner");
      const whereConditionSql = mockSql;

      // Mock for the SELECT that happens BEFORE the delete
      const mockSelectBeforeDeletePrepared: PreparedQuery<any, any> = {
        sql: "SELECT id, name, email FROM users WHERE SELECT mock",
        parameters: whereConditionSql.getValues("spanner"),
        dialect: "spanner",
        action: "select",
        primaryTable: usersTable,
        fields: { id: true, name: true, email: true } as any,
      };
      const dataToBeDeleted = [
        { id: 1, name: "About To Be Deleted", email: "delete@spanner.com" },
      ];

      // Mock for the DELETE DML
      const mockDeleteDmlPrepared: PreparedQuery<any, any> = {
        sql: "DELETE FROM users WHERE SELECT mock",
        parameters: whereConditionSql.getValues("spanner"),
        dialect: "spanner",
        action: "delete",
        primaryTable: usersTable,
      };

      (mockQueryBuilderInstance.prepare as vi.Mock)
        .mockReturnValueOnce(mockSelectBeforeDeletePrepared) // For the internal SELECT
        .mockReturnValueOnce(mockDeleteDmlPrepared); // For the DELETE DML

      (mockAdapter.query as vi.Mock).mockResolvedValueOnce(dataToBeDeleted);
      (mockAdapter.execute as vi.Mock).mockResolvedValueOnce({ count: 1 });

      const result = await db
        .deleteFrom(usersTable)
        .where(whereConditionSql)
        .returning();

      expect(mockAdapter.query).toHaveBeenCalledWith(
        mockSelectBeforeDeletePrepared.sql,
        mockSelectBeforeDeletePrepared.parameters
      );
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        mockDeleteDmlPrepared.sql,
        mockDeleteDmlPrepared.parameters
      );
      expect(result).toEqual(dataToBeDeleted);
      expect(mockQueryBuilderInstance.returning).toHaveBeenCalled();
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
