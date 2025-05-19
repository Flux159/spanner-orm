// import { Table } from "./schema.js"; // This was incorrect
import type { TableConfig, ColumnConfig, SQL } from "../types/common.js";
// import { sql } from "../types/common.js"; // Import for potential use in conditions

// Define a type for the selection.
// It's an object where keys are aliases and values are ColumnConfig or SQL objects.
export type SelectFields = Record<
  string,
  ColumnConfig<any, any> | SQL | string // string for '*' or direct column name
>;

// Define a type for conditions. For now, we'll assume SQL objects or raw strings.
// This will be expanded for complex conditions (eq, gt, lt, and, or, etc.)
export type WhereCondition = SQL | string;

export class QueryBuilder<TTable extends TableConfig<any, any>> {
  private _selectedFields?: SelectFields;
  private _sourceTable?: TTable;
  private _conditions: WhereCondition[] = [];
  private _limit?: number;
  private _offset?: number;
  // TODO: Add _orderBy

  constructor() {}

  select(fields: SelectFields | "*" = "*"): this {
    if (fields === "*") {
      // We'll handle actual column resolution for '*' in toSQL or a build step,
      // as it requires knowing the table columns.
      // For now, store it as a special marker or a specific structure.
      // Let's assume for now '*' means selecting all columns from the _sourceTable.
      // This will be resolved during SQL generation.
      this._selectedFields = { "*": "*" }; // Special marker for SELECT *
    } else {
      this._selectedFields = fields;
    }
    return this;
  }

  from(table: TTable): this {
    this._sourceTable = table;
    return this;
  }

  where(condition: WhereCondition): this {
    // TODO: Implement more sophisticated condition handling, e.g., and, or, operators
    // For now, conditions are expected to be SQL objects or raw strings.
    this._conditions.push(condition);
    return this;
  }

  limit(count: number): this {
    this._limit = count;
    return this;
  }

  offset(count: number): this {
    this._offset = count;
    return this;
  }

  // TODO: orderBy(field: ColumnConfig<any,any> | SQL, direction: 'ASC' | 'DESC' = 'ASC')

  toSQL(dialect: "pg" | "spanner"): string {
    if (!this._sourceTable) {
      throw new Error(
        "Source table not specified. Use .from() to set the table."
      );
    }

    if (!this._selectedFields) {
      // Default to SELECT * if .select() was not called or called with no args.
      // This requires knowing table columns. For now, let's assume this means '*'
      this._selectedFields = { "*": "*" };
    }

    if (dialect === "pg") {
      return this.toPgSQL();
    } else if (dialect === "spanner") {
      return this.toSpannerSQL();
    } else {
      throw new Error(`Unsupported dialect: ${dialect}`); // Should not happen with TS
    }
  }

  private toPgSQL(): string {
    if (!this._sourceTable) throw new Error("FROM clause is missing."); // Should be caught by toSQL

    let selectClause = "";
    const paramIndexState = { value: 1 }; // Initialize parameter index counter

    if (this._selectedFields && this._selectedFields["*"] === "*") {
      // Handle SELECT *
      selectClause = `SELECT *`;
    } else if (this._selectedFields) {
      const selectedParts = Object.entries(this._selectedFields).map(
        ([alias, field]) => {
          let fieldName: string;
          if (typeof field === "string") {
            fieldName = field;
          } else if ("_isSQL" in field) {
            fieldName = (field as SQL).toSqlString("postgres", paramIndexState);
          } else if ("name" in field) {
            fieldName = `"${(field as ColumnConfig<any, any>).name}"`;
          } else {
            throw new Error(`Invalid field type in select: ${alias}`);
          }
          // Use alias if it's different from the derived field name, or if it's a complex expression
          // For simple column selections, alias might be the same as column name.
          // Drizzle often uses the key as the alias if it's a computed field.
          if (alias !== fieldName && !fieldName.includes(" AS ")) {
            // Basic check to avoid double aliasing
            // Check if fieldName is already an alias from SQL object
            const sqlObject = field as SQL;
            if (
              sqlObject &&
              sqlObject._isSQL &&
              sqlObject.toSqlString("postgres").toLowerCase().includes(" as ")
            ) {
              return fieldName; // SQL object already handles its aliasing
            }
            return `${fieldName} AS "${alias}"`;
          }
          return fieldName;
        }
      );
      selectClause = `SELECT ${selectedParts.join(", ")}`;
    } else {
      // This case should ideally be handled by defaulting _selectedFields to '*'
      throw new Error("SELECT clause is missing or invalid.");
    }

    const fromClause = `FROM "${this._sourceTable.name}"`;

    let whereClause = "";
    if (this._conditions.length > 0) {
      const conditionsStr = this._conditions
        .map((cond) => {
          if (typeof cond === "string") {
            return cond;
          } else if ("_isSQL" in cond) {
            return (cond as SQL).toSqlString("postgres", paramIndexState);
          }
          throw new Error("Invalid condition type.");
        })
        .join(" AND ");
      whereClause = `WHERE ${conditionsStr}`;
    }

    let limitClause = "";
    if (this._limit !== undefined) {
      limitClause = `LIMIT ${this._limit}`;
    }

    let offsetClause = "";
    if (this._offset !== undefined) {
      offsetClause = `OFFSET ${this._offset}`;
    }

    return [selectClause, fromClause, whereClause, limitClause, offsetClause]
      .filter(Boolean)
      .join(" ");
  }

  private toSpannerSQL(): string {
    if (!this._sourceTable) throw new Error("FROM clause is missing.");

    let selectClause = "";
    const paramIndexState = { value: 1 }; // Initialize parameter index counter

    if (this._selectedFields && this._selectedFields["*"] === "*") {
      selectClause = `SELECT *`;
    } else if (this._selectedFields) {
      const selectedParts = Object.entries(this._selectedFields).map(
        ([alias, field]) => {
          let fieldName: string;
          if (typeof field === "string") {
            fieldName = field;
          } else if ("_isSQL" in field) {
            fieldName = (field as SQL).toSqlString("spanner", paramIndexState);
          } else if ("name" in field) {
            fieldName = `\`${(field as ColumnConfig<any, any>).name}\``;
          } else {
            throw new Error(`Invalid field type in select: ${alias}`);
          }

          const sqlObject = field as SQL;
          if (
            alias !== fieldName &&
            !(
              sqlObject &&
              sqlObject._isSQL &&
              sqlObject.toSqlString("spanner").toLowerCase().includes(" as ")
            ) &&
            !fieldName.includes(" AS ") // Basic check
          ) {
            return `${fieldName} AS \`${alias}\``;
          }
          return fieldName;
        }
      );
      selectClause = `SELECT ${selectedParts.join(", ")}`;
    } else {
      throw new Error("SELECT clause is missing or invalid.");
    }

    const fromClause = `FROM \`${this._sourceTable.name}\``;

    let whereClause = "";
    if (this._conditions.length > 0) {
      const conditionsStr = this._conditions
        .map((cond) => {
          if (typeof cond === "string") {
            return cond;
          } else if ("_isSQL" in cond) {
            return (cond as SQL).toSqlString("spanner", paramIndexState);
          }
          throw new Error("Invalid condition type.");
        })
        .join(" AND ");
      whereClause = `WHERE ${conditionsStr}`;
    }

    let limitClause = "";
    if (this._limit !== undefined) {
      limitClause = `LIMIT ${this._limit}`;
    }

    let offsetClause = "";
    if (this._offset !== undefined) {
      // Spanner's OFFSET requires LIMIT.
      // "OFFSET requires a LIMIT clause on Spanner" - this is a common Spanner constraint.
      // However, some contexts might allow OFFSET without LIMIT (e.g. within subqueries or specific APIs)
      // For direct SQL, it's safer to assume LIMIT is needed if OFFSET is present.
      // For now, we'll generate it, but this might need adjustment based on how it's used.
      // Drizzle's Spanner dialect also generates OFFSET if specified.
      offsetClause = `OFFSET ${this._offset}`;
    }

    return [selectClause, fromClause, whereClause, limitClause, offsetClause]
      .filter(Boolean)
      .join(" ");
  }

  getBoundParameters(): unknown[] {
    const allParams: unknown[] = [];

    // Collect params from selected fields
    if (this._selectedFields) {
      for (const field of Object.values(this._selectedFields)) {
        if (typeof field === "object" && field !== null && "_isSQL" in field) {
          allParams.push(...(field as SQL).getValues());
        }
      }
    }

    // Collect params from conditions
    if (this._conditions) {
      for (const condition of this._conditions) {
        if (
          typeof condition === "object" &&
          condition !== null &&
          "_isSQL" in condition
        ) {
          allParams.push(...(condition as SQL).getValues());
        }
        // Raw string conditions don't have bound parameters here
      }
    }
    return allParams;
  }

  // Placeholder for executing the query - will be dialect-specific
  // This might eventually be moved to adapter-specific classes or a core execution handler.
  // For now, it's a conceptual placeholder.
  // async execute(adapter: PgAdapter | SpannerAdapter | SQLiteAdapter): Promise<any[]> {
  //   // Determine dialect from adapter
  //   const dialect = adapter.dialect; // Assuming adapter has a dialect property
  //   const sqlString = this.toSQL(dialect as "pg" | "spanner"); // Cast needed if dialect is wider union
  //   const params = this.getBoundParameters();

  //   // Spanner expects params as Record<string, any> if using named params like @p1
  //   // Our current SQL generator uses @p1, @p2, etc. which some drivers might map from an array.
  //   // If the Spanner driver strictly needs Record<string, any> for @p1, @p2,
  //   // we'd need to transform `params` array into { p1: value1, p2: value2, ... }
  //   // For now, assuming the adapter's execute method can handle array params if placeholders are positional.
  //   if (dialect === 'spanner') {
  //      const spannerParams: Record<string, any> = {};
  //      params.forEach((p, i) => spannerParams[`p${i + 1}`] = p);
  //      return adapter.execute(sqlString, spannerParams);
  //   }
  //   return adapter.execute(sqlString, params);
  // }
}

// Example usage (conceptual, won't run without table definitions and adapters)
// import { table, text, integer } from './schema.js'; // Note .js extension
// const usersTable = table('users', {
//   id: integer('id').primaryKey(),
//   name: text('name').notNull(),
//   email: text('email'),
//   age: integer('age'),
// });

// const qb = new QueryBuilder<typeof usersTable>();

// Example 1: Select specific fields
// const query1 = qb
//   .select({ userId: usersTable.columns.id, userName: usersTable.columns.name })
//   .from(usersTable)
//   .where(sql`${usersTable.columns.age} > 30`) // Assuming sql tag and column access
//   .limit(10)
//   .offset(5)
//   .toSQL('pg');
// console.log("Query 1:", query1);
// Expected: SELECT "id" AS "userId", "name" AS "userName" FROM "users" WHERE age > 30 LIMIT 10 OFFSET 5 (actual field names depend on ColumnConfig)

// Example 2: Select all
// const qb2 = new QueryBuilder<typeof usersTable>();
// const query2 = qb2.select("*").from(usersTable).toSQL('pg');
// console.log("Query 2:", query2);
// Expected: SELECT * FROM "users"

// Example 3: Select with raw SQL
// const qb3 = new QueryBuilder<typeof usersTable>();
// const query3 = qb3
//   .select({ complexField: sql`CONCAT(${usersTable.columns.name}, ' (', ${usersTable.columns.age}, ')')` })
//   .from(usersTable)
//   .toSQL('pg');
// console.log("Query 3:", query3);
// Expected: SELECT CONCAT(users.name, ' (', users.age, ')') AS "complexField" FROM "users" (actual field names depend on ColumnConfig and sql tag output)

// To make it more Drizzle-like, a central `db` object could provide the entry point:
// export function createDB() { // Or however you initialize your main DB interface
//   return {
//     select: <TFields extends SelectFields>(fields: TFields) => {
//       const qb = new QueryBuilder<any>(); // `any` here is problematic, needs proper table type inference
//       return qb.select(fields);
//     },
//     // from: ... not directly chainable this way, select usually returns a builder that needs a .from()
//   };
// }
// const db = createDB();
// const queryX = db
//   .select({ id: usersTable.columns.id })
//   // .from(usersTable) // .from would be called on the QueryBuilder instance returned by select
//   // .where(...)
//   // .toSQL('pg');

// A more common Drizzle pattern:
// const dbInstance = new DrizzleLikeDB(); // where DrizzleLikeDB has a .select() method
// dbInstance.select().from(users).where(...);
// or
// dbInstance.select({field: users.id}).from(users).where(...);
// This implies QueryBuilder might be instantiated by a top-level db object.
