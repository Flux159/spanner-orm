import { describe, it, expect } from "vitest";
import {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  not,
  and,
  or,
  ConditionArg,
} from "../../src/core/functions";
import { sql, SQL, Dialect, ColumnConfig } from "../../src/types/common";

// Mock ColumnConfig for testing
const mockColumn = (
  name: string,
  tableName?: string
): ColumnConfig<any, any> => ({
  name,
  type: "integer", // Example type
  dialectTypes: { postgres: "INTEGER", spanner: "INT64" },
  _tableName: tableName,
});

const usersIdColumn: ColumnConfig<any, any> = mockColumn("id", "users");
const postsUserIdColumn: ColumnConfig<any, any> = mockColumn(
  "user_id",
  "posts"
);
const postsScoreColumn: ColumnConfig<any, any> = mockColumn("score", "posts");

describe("Condition Functions", () => {
  describe("Binary Comparison Operators", () => {
    const operators: {
      [key: string]: (left: ConditionArg, right: ConditionArg) => SQL;
    } = { eq, ne, gt, gte, lt, lte };
    const sqlSymbols: { [key: string]: string } = {
      eq: "=",
      ne: "<>",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
    };

    for (const opKey in operators) {
      const operatorFn = operators[opKey];
      const symbol = sqlSymbols[opKey];

      describe(opKey, () => {
        it(
          "should generate correct SQL for postgres with column and literal for " +
            opKey,
          () => {
            const condition = operatorFn(usersIdColumn, 10);
            expect(condition.toSqlString("postgres")).toBe(
              // No outer parens for the whole expression
              '"users"."id" ' + symbol + " $1"
            );
            expect(condition.getValues("postgres")).toEqual([10]);
          }
        );

        it(
          "should generate correct SQL for spanner with column and literal for " +
            opKey,
          () => {
            const condition = operatorFn(usersIdColumn, 10);
            const expectedSql = "`users`.`id` " + symbol + " @p1"; // No outer parens
            expect(condition.toSqlString("spanner")).toBe(expectedSql);
            expect(condition.getValues("spanner")).toEqual([10]);
          }
        );

        it(
          "should generate correct SQL for postgres with two columns for " +
            opKey,
          () => {
            const condition = operatorFn(usersIdColumn, postsUserIdColumn);
            expect(condition.toSqlString("postgres")).toBe(
              // No outer parens
              '"users"."id" ' + symbol + ' "posts"."user_id"'
            );
            expect(condition.getValues("postgres")).toEqual([]);
          }
        );

        it(
          "should generate correct SQL for spanner with two columns for " +
            opKey,
          () => {
            const condition = operatorFn(usersIdColumn, postsUserIdColumn);
            const expectedSql = "`users`.`id` " + symbol + " `posts`.`user_id`"; // No outer parens
            expect(condition.toSqlString("spanner")).toBe(expectedSql);
            expect(condition.getValues("spanner")).toEqual([]);
          }
        );

        it("should handle nested SQL for postgres for " + opKey, () => {
          const nestedSql: SQL = {
            _isSQL: true,
            toSqlString: (dialect: Dialect): string => {
              if (dialect === "postgres") {
                return '(SELECT MAX(score) FROM "posts")';
              }
              return "(SELECT MAX(score) FROM `posts`)";
            },
            getValues: (_dialect: Dialect): unknown[] => [],
          };
          const condition = operatorFn(postsScoreColumn, nestedSql);
          expect(condition.toSqlString("postgres")).toBe(
            // No outer parens for the main expression
            '"posts"."score" ' + symbol + ' (SELECT MAX(score) FROM "posts")'
          );
          expect(condition.getValues("postgres")).toEqual([]);
        });

        it("should handle nested SQL for spanner for " + opKey, () => {
          const nestedSql: SQL = {
            _isSQL: true,
            toSqlString: (dialect: Dialect): string => {
              if (dialect === "postgres") {
                // This condition is technically for spanner, but mock is simple
                return '(SELECT MAX(score) FROM "posts")'; // Should be `posts` for spanner
              }
              return "(SELECT MAX(score) FROM `posts`)";
            },
            getValues: (_dialect: Dialect): unknown[] => [],
          };
          const condition = operatorFn(postsScoreColumn, nestedSql);
          const expectedSql = // No outer parens for the main expression
            "`posts`.`score` " + symbol + " (SELECT MAX(score) FROM `posts`)";
          expect(condition.toSqlString("spanner")).toBe(expectedSql);
          expect(condition.getValues("spanner")).toEqual([]);
        });
      });
    }
  });

  describe("not", () => {
    it("should generate correct SQL for postgres", () => {
      const condition = not(eq(usersIdColumn, 10));
      expect(condition.toSqlString("postgres")).toBe(
        'NOT ("users"."id" = $1)' // Corrected: NOT wraps the unparenthesized inner expression
      );
      expect(condition.getValues("postgres")).toEqual([10]);
    });

    it("should generate correct SQL for spanner", () => {
      const condition = not(eq(usersIdColumn, 10));
      const expectedSql = "NOT (`users`.`id` = @p1)"; // Corrected: NOT wraps the unparenthesized inner expression
      expect(condition.toSqlString("spanner")).toBe(expectedSql);
      expect(condition.getValues("spanner")).toEqual([10]);
    });
  });

  describe("and", () => {
    it("should return undefined if no conditions are provided", () => {
      expect(and()).toBeUndefined();
      expect(and(undefined, undefined)).toBeUndefined();
    });

    it("should return the single condition if only one is provided", () => {
      const condition1 = eq(usersIdColumn, 1);
      expect(and(condition1)).toBe(condition1);
      expect(and(undefined, condition1, undefined)).toBe(condition1);
    });

    it("should combine multiple conditions with AND for postgres", () => {
      const condition1 = eq(usersIdColumn, 1);
      const condition2 = gt(postsScoreColumn, 100);
      const combined = and(condition1, condition2);
      expect(combined?.toSqlString("postgres")).toBe(
        '(("users"."id" = $1) AND ("posts"."score" > $2))' // Corrected: Outer parens from and/or, inner from sql tag processing eq/gt
      );
      expect(combined?.getValues("postgres")).toEqual([1, 100]);
    });

    it("should combine multiple conditions with AND for spanner", () => {
      const condition1 = eq(usersIdColumn, 1);
      const condition2 = gt(postsScoreColumn, 100);
      const combined = and(condition1, condition2);
      const expectedSql = "((`users`.`id` = @p1) AND (`posts`.`score` > @p2))"; // Corrected
      expect(combined?.toSqlString("spanner")).toBe(expectedSql);
      expect(combined?.getValues("spanner")).toEqual([1, 100]);
    });

    it("should handle undefined conditions mixed with valid ones for postgres", () => {
      const condition1 = eq(usersIdColumn, 1);
      const condition2 = gt(postsScoreColumn, 100);
      const combined = and(
        undefined,
        condition1,
        undefined,
        condition2,
        undefined
      );
      expect(combined?.toSqlString("postgres")).toBe(
        '(("users"."id" = $1) AND ("posts"."score" > $2))' // Corrected
      );
      expect(combined?.getValues("postgres")).toEqual([1, 100]);
    });
  });

  describe("or", () => {
    it("should return undefined if no conditions are provided", () => {
      expect(or()).toBeUndefined();
      expect(or(undefined, undefined)).toBeUndefined();
    });

    it("should return the single condition if only one is provided", () => {
      const condition1 = eq(usersIdColumn, 1);
      expect(or(condition1)).toBe(condition1);
      expect(or(undefined, condition1, undefined)).toBe(condition1);
    });

    it("should combine multiple conditions with OR for postgres", () => {
      const condition1 = eq(usersIdColumn, 1);
      const condition2 = gt(postsScoreColumn, 100);
      const combined = or(condition1, condition2);
      expect(combined?.toSqlString("postgres")).toBe(
        '(("users"."id" = $1) OR ("posts"."score" > $2))' // Corrected
      );
      expect(combined?.getValues("postgres")).toEqual([1, 100]);
    });

    it("should combine multiple conditions with OR for spanner", () => {
      const condition1 = eq(usersIdColumn, 1);
      const condition2 = gt(postsScoreColumn, 100);
      const combined = or(condition1, condition2);
      const expectedSql = "((`users`.`id` = @p1) OR (`posts`.`score` > @p2))"; // Corrected
      expect(combined?.toSqlString("spanner")).toBe(expectedSql);
      expect(combined?.getValues("spanner")).toEqual([1, 100]);
    });

    it("should handle nested and/or conditions for postgres", () => {
      const cond1 = eq(usersIdColumn, 1);
      const cond2 = lt(postsScoreColumn, 50);
      const cond3 = ne(mockColumn("status", "orders"), "pending");

      const complexOr = or(cond1, cond2); // This will be (cond1 OR cond2)
      const finalAnd = and(complexOr, cond3); // This will be ((cond1 OR cond2) AND cond3)

      expect(finalAnd?.toSqlString("postgres")).toBe(
        '( (("users"."id" = $1) OR ("posts"."score" < $2)) AND (("orders"."status" <> $3)) )'
      );
      expect(finalAnd?.getValues("postgres")).toEqual([1, 50, "pending"]);
    });

    it("should handle nested and/or conditions for spanner", () => {
      const cond1 = eq(usersIdColumn, 1);
      const cond2 = lt(postsScoreColumn, 50);
      const cond3 = ne(mockColumn("status", "orders"), "pending");

      const complexOr = or(cond1, cond2);
      const finalAnd = and(complexOr, cond3);
      const expectedSql =
        "( ((`users`.`id` = @p1) OR (`posts`.`score` < @p2)) AND ((`orders`.`status` <> @p3)) )";
      expect(finalAnd?.toSqlString("spanner")).toBe(expectedSql);
      expect(finalAnd?.getValues("spanner")).toEqual([1, 50, "pending"]);
    });
  });
});
