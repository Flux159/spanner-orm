import { describe, it, expect } from "vitest";
import {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  not,
} from "../../src/core/functions.js";
// import { sql } from "../../src/types/common.js"; // Removed unused import
import type {
  SQL,
  // Dialect, // Removed unused type import
  ColumnConfig,
  FunctionArg,
} from "../../src/types/common.js";

// Mock ColumnConfig for testing
const createMockColumn = (
  name: string,
  tableName: string = "users"
): ColumnConfig<any, string> => ({
  name,
  type: "text", // Generic type
  dialectTypes: { postgres: "TEXT", spanner: "STRING" },
  _tableName: tableName,
});

const usersIdCol = createMockColumn("id");
const usersNameCol = createMockColumn("name");
const postsCountCol = createMockColumn("post_count", "posts");

describe("Condition Functions", () => {
  describe("Binary Operators (eq, ne, gt, gte, lt, lte)", () => {
    const testCases: {
      opName: string;
      opFn: (left: FunctionArg, right: FunctionArg) => SQL;
      pgSymbol: string;
      spannerSymbol: string;
    }[] = [
      { opName: "eq", opFn: eq, pgSymbol: "=", spannerSymbol: "=" },
      { opName: "ne", opFn: ne, pgSymbol: "<>", spannerSymbol: "<>" },
      { opName: "gt", opFn: gt, pgSymbol: ">", spannerSymbol: ">" },
      { opName: "gte", opFn: gte, pgSymbol: ">=", spannerSymbol: ">=" },
      { opName: "lt", opFn: lt, pgSymbol: "<", spannerSymbol: "<" },
      { opName: "lte", opFn: lte, pgSymbol: "<=", spannerSymbol: "<=" },
    ];

    for (const { opName, opFn, pgSymbol, spannerSymbol } of testCases) {
      describe(opName, () => {
        it(
          "should generate correct SQL for " +
            opName +
            " with column and literal (Postgres)",
          () => {
            const condition = opFn(usersNameCol, "Alice");
            const paramIndex = { value: 1 };
            const expectedSql = '"users"."name" ' + pgSymbol + " $1";
            expect(condition.toSqlString("postgres", paramIndex)).toBe(
              expectedSql
            );
            expect(paramIndex.value).toBe(2);
            expect(condition.getValues("postgres")).toEqual(["Alice"]);
          }
        );

        it(
          "should generate correct SQL for " +
            opName +
            " with column and literal (Spanner)",
          () => {
            const condition = opFn(usersNameCol, "Alice");
            const paramIndex = { value: 1 };
            const expectedSql = "`users`.`name` " + spannerSymbol + " @p1";
            expect(condition.toSqlString("spanner", paramIndex)).toBe(
              expectedSql
            );
            expect(paramIndex.value).toBe(2);
            expect(condition.getValues("spanner")).toEqual(["Alice"]);
          }
        );

        it(
          "should generate correct SQL for " +
            opName +
            " with two columns (Postgres)",
          () => {
            const condition = opFn(usersNameCol, usersIdCol);
            const paramIndex = { value: 1 };
            const expectedSql = '"users"."name" ' + pgSymbol + ' "users"."id"';
            expect(condition.toSqlString("postgres", paramIndex)).toBe(
              expectedSql
            );
            expect(paramIndex.value).toBe(1); // No parameters
            expect(condition.getValues("postgres")).toEqual([]);
          }
        );

        it(
          "should generate correct SQL for " +
            opName +
            " with two columns (Spanner)",
          () => {
            const condition = opFn(usersNameCol, usersIdCol);
            const paramIndex = { value: 1 };
            const expectedSql =
              "`users`.`name` " + spannerSymbol + " `users`.`id`";
            expect(condition.toSqlString("spanner", paramIndex)).toBe(
              expectedSql
            );
            expect(paramIndex.value).toBe(1); // No parameters
            expect(condition.getValues("spanner")).toEqual([]);
          }
        );

        it(
          "should generate correct SQL for " +
            opName +
            " with literal and column (Postgres)",
          () => {
            const condition = opFn(10, postsCountCol);
            const paramIndex = { value: 1 };
            const expectedSql = "$1 " + pgSymbol + ' "posts"."post_count"';
            expect(condition.toSqlString("postgres", paramIndex)).toBe(
              expectedSql
            );
            expect(paramIndex.value).toBe(2);
            expect(condition.getValues("postgres")).toEqual([10]);
          }
        );
      });
    }
  });

  describe("Logical Operators (and, or, not)", () => {
    describe("and", () => {
      it("should combine multiple conditions with AND (Postgres)", () => {
        const cond1 = eq(usersNameCol, "Alice");
        const cond2 = gt(postsCountCol, 5);
        const combined = and(cond1, cond2);
        const paramIndex = { value: 1 };
        const expectedSql =
          '("users"."name" = $1) AND ("posts"."post_count" > $2)';
        expect(combined?.toSqlString("postgres", paramIndex)).toBe(expectedSql);
        expect(paramIndex.value).toBe(3);
        expect(combined?.getValues("postgres")).toEqual(["Alice", 5]);
      });

      it("should combine multiple conditions with AND (Spanner)", () => {
        const cond1 = eq(usersNameCol, "Alice");
        const cond2 = gt(postsCountCol, 5);
        const combined = and(cond1, cond2);
        const paramIndex = { value: 1 };
        const expectedSql =
          "(`users`.`name` = @p1) AND (`posts`.`post_count` > @p2)";
        expect(combined?.toSqlString("spanner", paramIndex)).toBe(expectedSql);
        expect(paramIndex.value).toBe(3);
        expect(combined?.getValues("spanner")).toEqual(["Alice", 5]);
      });

      it("should return undefined for no conditions", () => {
        expect(and()).toBeUndefined();
      });

      it("should return the single condition if only one is provided", () => {
        const cond1 = eq(usersNameCol, "Alice");
        expect(and(cond1)).toBe(cond1);
      });

      it("should filter out undefined conditions", () => {
        const cond1 = eq(usersNameCol, "Alice");
        const combined = and(undefined, cond1, undefined);
        expect(combined).toBe(cond1);
      });

      it("should return undefined if all conditions are undefined", () => {
        expect(and(undefined, undefined)).toBeUndefined();
      });
    });

    describe("or", () => {
      it("should combine multiple conditions with OR (Postgres)", () => {
        const cond1 = eq(usersNameCol, "Alice");
        const cond2 = gt(postsCountCol, 5);
        const combined = or(cond1, cond2);
        const paramIndex = { value: 1 };
        const expectedSql =
          '("users"."name" = $1) OR ("posts"."post_count" > $2)';
        expect(combined?.toSqlString("postgres", paramIndex)).toBe(expectedSql);
        expect(paramIndex.value).toBe(3);
        expect(combined?.getValues("postgres")).toEqual(["Alice", 5]);
      });

      it("should combine multiple conditions with OR (Spanner)", () => {
        const cond1 = eq(usersNameCol, "Alice");
        const cond2 = gt(postsCountCol, 5);
        const combined = or(cond1, cond2);
        const paramIndex = { value: 1 };
        const expectedSql =
          "(`users`.`name` = @p1) OR (`posts`.`post_count` > @p2)";
        expect(combined?.toSqlString("spanner", paramIndex)).toBe(expectedSql);
        expect(paramIndex.value).toBe(3);
        expect(combined?.getValues("spanner")).toEqual(["Alice", 5]);
      });

      it("should return undefined for no conditions", () => {
        expect(or()).toBeUndefined();
      });

      it("should return the single condition if only one is provided", () => {
        const cond1 = eq(usersNameCol, "Alice");
        expect(or(cond1)).toBe(cond1);
      });
    });

    describe("not", () => {
      it("should negate a condition (Postgres)", () => {
        const cond1 = eq(usersNameCol, "Alice");
        const negated = not(cond1);
        const paramIndex = { value: 1 };
        const expectedSql = 'NOT ("users"."name" = $1)';
        expect(negated.toSqlString("postgres", paramIndex)).toBe(expectedSql);
        expect(paramIndex.value).toBe(2);
        expect(negated.getValues("postgres")).toEqual(["Alice"]);
      });

      it("should negate a condition (Spanner)", () => {
        const cond1 = eq(usersNameCol, "Alice");
        const negated = not(cond1);
        const paramIndex = { value: 1 };
        const expectedSql = "NOT (`users`.`name` = @p1)";
        expect(negated.toSqlString("spanner", paramIndex)).toBe(expectedSql);
        expect(paramIndex.value).toBe(2);
        expect(negated.getValues("spanner")).toEqual(["Alice"]);
      });

      it("should correctly negate a complex 'and' condition", () => {
        const condA = eq(usersIdCol, 1);
        const condB = gt(postsCountCol, 0);
        const complexAnd = and(condA, condB);
        if (!complexAnd) throw new Error("complexAnd should be defined");
        const negated = not(complexAnd);
        const paramIndex = { value: 1 };

        const expectedPgSql =
          'NOT (("users"."id" = $1) AND ("posts"."post_count" > $2))';
        expect(negated.toSqlString("postgres", paramIndex)).toBe(expectedPgSql);
        expect(paramIndex.value).toBe(3);
        expect(negated.getValues("postgres")).toEqual([1, 0]);

        paramIndex.value = 1; // Reset for Spanner
        const expectedSpannerSqlComplex =
          "NOT ((`users`.`id` = @p1) AND (`posts`.`post_count` > @p2))";
        expect(negated.toSqlString("spanner", paramIndex)).toBe(
          expectedSpannerSqlComplex
        );
        expect(paramIndex.value).toBe(3);
        expect(negated.getValues("spanner")).toEqual([1, 0]);
      });
    });
  });

  describe("Nested logical operators", () => {
    it("should handle nested AND and OR conditions (Postgres)", () => {
      const cond1 = eq(usersNameCol, "Alice");
      const cond2 = gt(postsCountCol, 5);
      const cond3 = lt(usersIdCol, 100);
      const complex = and(cond1, or(cond2, cond3));

      const paramIndex = { value: 1 };
      const sqlString = complex?.toSqlString("postgres", paramIndex);
      const values = complex?.getValues("postgres");
      const expectedPostgresSql =
        '("users"."name" = $1) AND (("posts"."post_count" > $2) OR ("users"."id" < $3))';

      expect(sqlString).toBe(expectedPostgresSql);
      expect(paramIndex.value).toBe(4);
      expect(values).toEqual(["Alice", 5, 100]);
    });

    it("should handle nested AND and OR conditions (Spanner)", () => {
      const cond1 = eq(usersNameCol, "Alice");
      const cond2 = gt(postsCountCol, 5);
      const cond3 = lt(usersIdCol, 100);
      const complex = and(cond1, or(cond2, cond3));

      const paramIndex = { value: 1 };
      const sqlString = complex?.toSqlString("spanner", paramIndex);
      const values = complex?.getValues("spanner");
      const expectedSpannerSql =
        "(`users`.`name` = @p1) AND ((`posts`.`post_count` > @p2) OR (`users`.`id` < @p3))";

      expect(sqlString).toBe(expectedSpannerSql);
      expect(paramIndex.value).toBe(4);
      expect(values).toEqual(["Alice", 5, 100]);
    });
  });
});
