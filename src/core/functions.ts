import { SQL, Dialect, sql, FunctionArg } from "../types/common.js";
import { ColumnConfig } from "../types/common.js";

// Helper to escape RE2 special characters
function escapeRe2(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

// Helper to convert SQL LIKE pattern to RE2 regex
function sqlLikePatternToRe2(likePattern: string): string {
  let re = "";
  for (let i = 0; i < likePattern.length; i++) {
    const char = likePattern[i];
    if (char === "%") {
      re += ".*";
    } else if (char === "_") {
      re += ".";
    } else {
      re += escapeRe2(char); // Escape other characters
    }
  }

  // Add anchors based on original pattern
  if (!likePattern.startsWith("%")) {
    re = "^" + re;
  }
  if (!likePattern.endsWith("%")) {
    re = re + "$";
  }

  // Simplification for patterns that become "match anything"
  if (re === "^.*$" && likePattern === "%") return ".*"; // Handles single '%'
  // Handles "%%", "%%%", etc. which become "^.*...*$"
  if (
    re.startsWith("^") &&
    re.endsWith("$") &&
    re
      .substring(1, re.length - 1)
      .split("")
      .every((c) => c === "." || c === "*")
  ) {
    if (likePattern.split("").every((c) => c === "%" || c === "_")) return ".*";
  }
  // Handles cases like "%...%" which become ".*...*"
  if (
    !re.startsWith("^") &&
    !re.endsWith("$") &&
    re.split("").every((c) => c === "." || c === "*")
  ) {
    if (likePattern.split("").every((c) => c === "%" || c === "_")) return ".*";
  }

  // Correct common over-generations like "^.*.*$" to "^.*$"
  re = re.replace(/\.\*\.\*/g, ".*"); // Replace consecutive ".*" with a single one.

  // If the original pattern was of the form %text% (and not just % or %%),
  // REGEXP_CONTAINS just needs 'text'.
  if (
    likePattern.startsWith("%") &&
    likePattern.endsWith("%") &&
    likePattern.length > 2 && // e.g. not "%%"
    re.startsWith(".*") &&
    re.endsWith(".*")
  ) {
    // Strip leading .* and trailing .*
    let core = re.substring(2); // remove leading .*
    if (core.endsWith(".*")) {
      // check again in case of ".*" in middle
      core = core.substring(0, core.length - 2);
    }
    // Only return the core if it's not empty, otherwise it might be from "%%" -> ".*"
    if (core !== "") return core;
    else if (likePattern === "%%") return ".*"; // Ensure "%%" still becomes ".*"
  }

  return re;
}

/**
 * Represents the LOWER SQL function.
 * @param value A column configuration, literal string, or SQL object to convert to lowercase.
 */
export function lower(value: ColumnConfig<any, any> | string | SQL): SQL {
  return {
    _isSQL: true,
    getValues: (dialect: Dialect): unknown[] => {
      if (typeof value === "object" && value !== null && "_isSQL" in value) {
        return (value as SQL).getValues(dialect);
      } else if (typeof value === "string") {
        return [value];
      }
      return []; // ColumnConfig doesn't have a direct value here
    },
    toSqlString: (
      dialect: Dialect,
      currentParamIndex?: { value: number },
      aliasMap?: Map<string, string> // Added aliasMap
    ): string => {
      const paramIdxState = currentParamIndex || { value: 1 };
      let internalValueStr: string;
      if (typeof value === "object" && value !== null) {
        if ("_isSQL" in value) {
          // Pass aliasMap to nested SQL objects
          internalValueStr = (value as SQL).toSqlString(
            dialect,
            paramIdxState,
            aliasMap
          );
        } else if (
          "name" in value &&
          "type" in value &&
          "dialectTypes" in value
        ) {
          // More robust ColumnConfig check
          // ColumnConfig
          const colConfig = value as ColumnConfig<any, any>;
          const colName = colConfig.name;
          let tableNameToUse = colConfig._tableName;
          if (
            aliasMap &&
            colConfig._tableName &&
            aliasMap.has(colConfig._tableName)
          ) {
            tableNameToUse = aliasMap.get(colConfig._tableName);
          }

          if (tableNameToUse) {
            internalValueStr =
              dialect === "postgres"
                ? `"${tableNameToUse}"."${colName}"`
                : `\`${tableNameToUse}\`.\`${colName}\``;
          } else {
            internalValueStr =
              dialect === "postgres" ? `"${colName}"` : `\`${colName}\``;
          }
        } else {
          // If it's an object but not SQL or ColumnConfig, it might be an error or an unsupported type
          // For now, let's assume it should have been a parameter if it's not a known structural type.
          // This path might need more robust handling depending on allowed FunctionArg types.
          throw new Error(
            `Invalid object type for 'value' in lower(): ${JSON.stringify(
              value
            )}`
          );
        }
      } else if (typeof value === "string") {
        // Literal string argument, treat as parameter
        internalValueStr =
          dialect === "postgres"
            ? `$${paramIdxState.value++}`
            : `@p${paramIdxState.value++}`;
      } else {
        throw new Error(`Invalid argument type for lower(): ${typeof value}`);
      }
      return `LOWER(${internalValueStr})`;
    },
  };
}

// --- Condition Functions ---

/**
 * Represents an equality comparison (lhs = rhs).
 * @param left The left-hand side of the comparison (column, value, or SQL).
 * @param right The right-hand side of the comparison (column, value, or SQL).
 */
export function eq(left: FunctionArg, right: FunctionArg): SQL {
  return sql`${left} = ${right}`;
}

/**
 * Represents a non-equality comparison (lhs <> rhs).
 * @param left The left-hand side of the comparison (column, value, or SQL).
 * @param right The right-hand side of the comparison (column, value, or SQL).
 */
export function ne(left: FunctionArg, right: FunctionArg): SQL {
  return sql`${left} <> ${right}`;
}

/**
 * Represents a "greater than" comparison (lhs > rhs).
 * @param left The left-hand side of the comparison (column, value, or SQL).
 * @param right The right-hand side of the comparison (column, value, or SQL).
 */
export function gt(left: FunctionArg, right: FunctionArg): SQL {
  return sql`${left} > ${right}`;
}

/**
 * Represents a "greater than or equal to" comparison (lhs >= rhs).
 * @param left The left-hand side of the comparison (column, value, or SQL).
 * @param right The right-hand side of the comparison (column, value, or SQL).
 */
export function gte(left: FunctionArg, right: FunctionArg): SQL {
  return sql`${left} >= ${right}`;
}

/**
 * Represents a "less than" comparison (lhs < rhs).
 * @param left The left-hand side of the comparison (column, value, or SQL).
 * @param right The right-hand side of the comparison (column, value, or SQL).
 */
export function lt(left: FunctionArg, right: FunctionArg): SQL {
  return sql`${left} < ${right}`;
}

/**
 * Represents a "less than or equal to" comparison (lhs <= rhs).
 * @param left The left-hand side of the comparison (column, value, or SQL).
 * @param right The right-hand side of the comparison (column, value, or SQL).
 */
export function lte(left: FunctionArg, right: FunctionArg): SQL {
  return sql`${left} <= ${right}`;
}

/**
 * Combines multiple SQL conditions with an AND operator.
 * Undefined conditions are filtered out.
 * @param conditions An array of SQL conditions.
 */
export function and(...conditions: (SQL | undefined)[]): SQL | undefined {
  const filteredConditions = conditions.filter(
    (c): c is SQL => c !== undefined
  );
  if (filteredConditions.length === 0) {
    return undefined;
  }
  if (filteredConditions.length === 1) {
    return filteredConditions[0];
  }

  // To ensure correct precedence, wrap each condition in parentheses if it's complex,
  // but the `sql` template literal should handle parameters correctly.
  // For joining, we construct the string manually to intersperse 'AND'.
  // The `sql` tag will then process the whole thing.
  // Example: sql`(${cond1}) AND (${cond2}) AND (${cond3})`
  // We need to build the template strings array and values array for the sql tag.

  const queryParts: string[] = ["("];
  const values: unknown[] = [];

  filteredConditions.forEach((condition, index) => {
    queryParts.push(""); // Placeholder for the condition
    values.push(condition);
    if (index < filteredConditions.length - 1) {
      queryParts.push(") AND (");
    } else {
      queryParts.push(")");
    }
  });

  // The TemplateStringsArray needs one more element than the values array.
  // If queryParts is ["(", "", ") AND (", "", ")"], strings should be ["(", ") AND (", ")"]
  // This manual construction is a bit tricky. Let's simplify.
  // Drizzle's approach is `sql.join(conditions, sql` and `)` - we can emulate this.

  if (filteredConditions.length === 0) return undefined;
  if (filteredConditions.length === 1) return filteredConditions[0];

  // Create a new SQL object that joins the conditions
  return {
    _isSQL: true,
    getValues: (dialect: Dialect): unknown[] => {
      const allValues: unknown[] = [];
      filteredConditions.forEach((cond) => {
        allValues.push(...cond.getValues(dialect));
      });
      return allValues;
    },
    toSqlString: (
      dialect: Dialect,
      currentParamIndex?: { value: number },
      aliasMap?: Map<string, string>
    ): string => {
      return filteredConditions
        .map(
          (cond) =>
            `(${cond.toSqlString(dialect, currentParamIndex, aliasMap)})`
        )
        .join(" AND ");
    },
  };
}

/**
 * Combines multiple SQL conditions with an OR operator.
 * Undefined conditions are filtered out.
 * @param conditions An array of SQL conditions.
 */
export function or(...conditions: (SQL | undefined)[]): SQL | undefined {
  const filteredConditions = conditions.filter(
    (c): c is SQL => c !== undefined
  );
  if (filteredConditions.length === 0) {
    return undefined;
  }
  if (filteredConditions.length === 1) {
    return filteredConditions[0];
  }

  return {
    _isSQL: true,
    getValues: (dialect: Dialect): unknown[] => {
      const allValues: unknown[] = [];
      filteredConditions.forEach((cond) => {
        allValues.push(...cond.getValues(dialect));
      });
      return allValues;
    },
    toSqlString: (
      dialect: Dialect,
      currentParamIndex?: { value: number },
      aliasMap?: Map<string, string>
    ): string => {
      return filteredConditions
        .map(
          (cond) =>
            `(${cond.toSqlString(dialect, currentParamIndex, aliasMap)})`
        )
        .join(" OR ");
    },
  };
}

/**
 * Negates an SQL condition using NOT.
 * @param condition The SQL condition to negate.
 */
export function not(condition: SQL): SQL {
  // Drizzle's `not` returns `sql`NOT (${condition})`
  // We need to ensure the `sql` tag handles the `condition` object correctly.
  return {
    _isSQL: true,
    getValues: (dialect: Dialect): unknown[] => {
      return condition.getValues(dialect);
    },
    toSqlString: (
      dialect: Dialect,
      currentParamIndex?: { value: number },
      aliasMap?: Map<string, string>
    ): string => {
      return `NOT (${condition.toSqlString(
        dialect,
        currentParamIndex,
        aliasMap
      )})`;
    },
  };
}

/**
 * Represents the UPPER SQL function.
 * @param value A column configuration, literal string, or SQL object to convert to uppercase.
 */
export function upper(value: ColumnConfig<any, any> | string | SQL): SQL {
  return {
    _isSQL: true,
    getValues: (dialect: Dialect): unknown[] => {
      if (typeof value === "object" && value !== null && "_isSQL" in value) {
        return (value as SQL).getValues(dialect);
      } else if (typeof value === "string") {
        return [value];
      }
      return [];
    },
    toSqlString: (
      dialect: Dialect,
      currentParamIndex?: { value: number },
      aliasMap?: Map<string, string> // Added aliasMap
    ): string => {
      const paramIdxState = currentParamIndex || { value: 1 };
      let internalValueStr: string;
      if (typeof value === "object" && value !== null) {
        if ("_isSQL" in value) {
          // Pass aliasMap to nested SQL objects
          internalValueStr = (value as SQL).toSqlString(
            dialect,
            paramIdxState,
            aliasMap
          );
        } else if (
          "name" in value &&
          "type" in value &&
          "dialectTypes" in value
        ) {
          // More robust ColumnConfig check
          // ColumnConfig
          const colConfig = value as ColumnConfig<any, any>;
          const colName = colConfig.name;
          let tableNameToUse = colConfig._tableName;
          if (
            aliasMap &&
            colConfig._tableName &&
            aliasMap.has(colConfig._tableName)
          ) {
            tableNameToUse = aliasMap.get(colConfig._tableName);
          }

          if (tableNameToUse) {
            internalValueStr =
              dialect === "postgres"
                ? `"${tableNameToUse}"."${colName}"`
                : `\`${tableNameToUse}\`.\`${colName}\``;
          } else {
            internalValueStr =
              dialect === "postgres" ? `"${colName}"` : `\`${colName}\``;
          }
        } else {
          throw new Error(
            `Invalid object type for 'value' in upper(): ${JSON.stringify(
              value
            )}`
          );
        }
      } else if (typeof value === "string") {
        // Literal string argument, treat as parameter
        internalValueStr =
          dialect === "postgres"
            ? `$${paramIdxState.value++}`
            : `@p${paramIdxState.value++}`;
      } else {
        throw new Error(`Invalid argument type for upper(): ${typeof value}`);
      }
      return `UPPER(${internalValueStr})`;
    },
  };
}

/**
 * Represents the CONCAT SQL function.
 * @param args A list of column configurations, literal strings, or SQL objects to concatenate.
 */
export function concat(
  ...args: (ColumnConfig<any, any> | string | SQL)[]
): SQL {
  if (args.length === 0) {
    // Return an SQL object representing an empty string or handle as an error
    return sql`''`; // Or throw new Error("CONCAT requires at least one argument.");
  }

  return {
    _isSQL: true,
    getValues: (dialect: Dialect): unknown[] => {
      const values: unknown[] = [];
      for (const arg of args) {
        if (typeof arg === "object" && arg !== null && "_isSQL" in arg) {
          values.push(...(arg as SQL).getValues(dialect));
        } else if (typeof arg === "string") {
          values.push(arg);
        }
        // ColumnConfig objects don't contribute to values here, they are part of the SQL string structure
      }
      return values;
    },
    toSqlString: (
      dialect: Dialect,
      currentParamIndex?: { value: number },
      aliasMap?: Map<string, string> // Added aliasMap
    ): string => {
      const paramIdxState = currentParamIndex || { value: 1 };
      const stringArgs = args.map((arg) => {
        if (typeof arg === "object" && arg !== null) {
          if ("_isSQL" in arg) {
            // Pass aliasMap to nested SQL objects
            return (arg as SQL).toSqlString(dialect, paramIdxState, aliasMap);
          } else if ("name" in arg && "type" in arg && "dialectTypes" in arg) {
            // More robust ColumnConfig check
            // ColumnConfig
            const colConfig = arg as ColumnConfig<any, any>;
            const colName = colConfig.name;
            let tableNameToUse = colConfig._tableName;
            if (
              aliasMap &&
              colConfig._tableName &&
              aliasMap.has(colConfig._tableName)
            ) {
              tableNameToUse = aliasMap.get(colConfig._tableName);
            }
            let identifier = "";
            if (tableNameToUse) {
              identifier =
                dialect === "postgres"
                  ? `"${tableNameToUse}"."${colName}"`
                  : `\`${tableNameToUse}\`.\`${colName}\``;
            } else {
              identifier =
                dialect === "postgres" ? `"${colName}"` : `\`${colName}\``;
            }
            return identifier;
          } else {
            throw new Error(
              `Invalid object type for argument in concat(): ${JSON.stringify(
                arg
              )}`
            );
          }
        } else if (typeof arg === "string") {
          // Literal string argument, treat as parameter
          return dialect === "postgres"
            ? `$${paramIdxState.value++}`
            : `@p${paramIdxState.value++}`;
        } else {
          throw new Error(`Invalid argument type for concat(): ${typeof arg}`);
        }
      });
      return `CONCAT(${stringArgs.join(", ")})`;
    },
  };
}

/**
 * Represents the COUNT aggregate function.
 * Can be used with a column or '*' for COUNT(*).
 * @param field Optional: A column configuration or '*' to count all rows.
 *              If undefined or '*', it translates to COUNT(*).
 */
export function count(field?: ColumnConfig<any, any> | "*"): SQL {
  return {
    _isSQL: true,
    getValues: (_dialect: Dialect) => [],
    toSqlString: (
      dialect: Dialect,
      _currentParamIndex?: { value: number }, // Not used for COUNT(col) string part but good for consistency
      aliasMap?: Map<string, string> // Added aliasMap
    ): string => {
      if (!field || field === "*") {
        return "COUNT(*)";
      }
      const colConfig = field as ColumnConfig<any, any>;
      const colName = colConfig.name;
      let tableNameToUse = colConfig._tableName;
      if (
        aliasMap &&
        colConfig._tableName &&
        aliasMap.has(colConfig._tableName)
      ) {
        tableNameToUse = aliasMap.get(colConfig._tableName);
      }
      let identifier = "";
      if (tableNameToUse) {
        identifier =
          dialect === "postgres"
            ? `"${tableNameToUse}"."${colName}"`
            : `\`${tableNameToUse}\`.\`${colName}\``;
      } else {
        identifier = dialect === "postgres" ? `"${colName}"` : `\`${colName}\``;
      }
      return `COUNT(${identifier})`;
    },
  };
}

/**
 * Represents the LIKE operator.
 * For PostgreSQL, uses `LIKE`.
 * For Spanner, translates to `REGEXP_CONTAINS` using a converted pattern.
 * @param column The column to compare.
 * @param pattern The SQL LIKE pattern string.
 * @param escapeChar Optional escape character (PostgreSQL only).
 */
export function like(
  column: ColumnConfig<any, any>,
  pattern: string,
  escapeChar?: string // escapeChar is PG only
): SQL {
  return {
    _isSQL: true,
    getValues: (dialect: Dialect): unknown[] => {
      if (dialect === "spanner") {
        return [sqlLikePatternToRe2(pattern)];
      }
      // PostgreSQL
      return escapeChar ? [pattern, escapeChar] : [pattern];
    },
    toSqlString: (
      dialect: Dialect,
      currentParamIndex?: { value: number },
      aliasMap?: Map<string, string> // Added aliasMap
    ): string => {
      const paramIdxState = currentParamIndex || { value: 1 };

      const colConfig = column as ColumnConfig<any, any>; // Treat column as ColumnConfig
      const colName = colConfig.name;
      let tableNameToUse = colConfig._tableName;
      if (
        aliasMap &&
        colConfig._tableName &&
        aliasMap.has(colConfig._tableName)
      ) {
        tableNameToUse = aliasMap.get(colConfig._tableName);
      }

      const tblNamePart = tableNameToUse
        ? dialect === "postgres"
          ? `"${tableNameToUse}".`
          : `\`${tableNameToUse}\`.`
        : "";
      const colNamePart =
        dialect === "postgres" ? `"${colName}"` : `\`${colName}\``;
      const fullColIdentifier = `${tblNamePart}${colNamePart}`;

      if (dialect === "spanner") {
        const paramPlaceholder = `@p${paramIdxState.value++}`;
        // For Spanner, like() translates to REGEXP_CONTAINS, so the column part is an identifier
        return `REGEXP_CONTAINS(${fullColIdentifier}, ${paramPlaceholder})`;
      }
      // PostgreSQL
      let sqlStr = `${fullColIdentifier} LIKE $${paramIdxState.value++}`;
      if (escapeChar) {
        sqlStr += ` ESCAPE $${paramIdxState.value++}`;
      }
      return sqlStr;
    },
  };
}

/**
 * Represents the ILIKE operator (case-insensitive LIKE).
 * For PostgreSQL, uses `ILIKE`.
 * For Spanner, translates to `REGEXP_CONTAINS` with `(?i)` flag and a converted pattern.
 * @param column The column to compare.
 * @param pattern The SQL LIKE pattern string.
 * @param escapeChar Optional escape character (PostgreSQL only).
 */
export function ilike(
  column: ColumnConfig<any, any>,
  pattern: string,
  escapeChar?: string // escapeChar is PG only
): SQL {
  return {
    _isSQL: true,
    getValues: (dialect: Dialect): unknown[] => {
      if (dialect === "spanner") {
        return [`(?i)${sqlLikePatternToRe2(pattern)}`];
      }
      // PostgreSQL
      return escapeChar ? [pattern, escapeChar] : [pattern];
    },
    toSqlString: (
      dialect: Dialect,
      currentParamIndex?: { value: number },
      aliasMap?: Map<string, string> // Added aliasMap
    ): string => {
      const paramIdxState = currentParamIndex || { value: 1 };

      const colConfig = column as ColumnConfig<any, any>; // Treat column as ColumnConfig
      const colName = colConfig.name;
      let tableNameToUse = colConfig._tableName;
      if (
        aliasMap &&
        colConfig._tableName &&
        aliasMap.has(colConfig._tableName)
      ) {
        tableNameToUse = aliasMap.get(colConfig._tableName);
      }

      const tblNamePart = tableNameToUse
        ? dialect === "postgres"
          ? `"${tableNameToUse}".`
          : `\`${tableNameToUse}\`.`
        : "";
      const colNamePart =
        dialect === "postgres" ? `"${colName}"` : `\`${colName}\``;
      const fullColIdentifier = `${tblNamePart}${colNamePart}`;

      if (dialect === "spanner") {
        const paramPlaceholder = `@p${paramIdxState.value++}`;
        // For Spanner, ilike() translates to REGEXP_CONTAINS, so the column part is an identifier
        return `REGEXP_CONTAINS(${fullColIdentifier}, ${paramPlaceholder})`;
      }
      // PostgreSQL
      let sqlStr = `${fullColIdentifier} ILIKE $${paramIdxState.value++}`;
      if (escapeChar) {
        sqlStr += ` ESCAPE $${paramIdxState.value++}`;
      }
      return sqlStr;
    },
  };
}

/**
 * Represents a regular expression match.
 * For Spanner, uses `REGEXP_CONTAINS(column, pattern)`.
 * For PostgreSQL, uses `column ~ pattern` (case-sensitive POSIX regex).
 * @param column The column to compare.
 * @param regexpPattern The regular expression pattern string.
 *                      For Spanner, this should be an RE2 compatible pattern.
 *                      For PostgreSQL, this should be a POSIX ERE pattern.
 */
export function regexpContains(
  column: ColumnConfig<any, any>,
  regexpPattern: string
): SQL {
  return {
    _isSQL: true,
    getValues: (_dialect: Dialect) => [regexpPattern], // dialect not used but required by interface
    toSqlString: (
      dialect: Dialect,
      currentParamIndex?: { value: number },
      aliasMap?: Map<string, string> // Added aliasMap
    ): string => {
      // Pass aliasMap to the toSqlString call of the SQL object returned by the sql tag
      if (dialect === "spanner") {
        return sql`REGEXP_CONTAINS(${column}, ${regexpPattern})`.toSqlString(
          dialect,
          currentParamIndex,
          aliasMap // Pass aliasMap
        );
      } else {
        // postgres
        return sql`${column} ~ ${regexpPattern}`.toSqlString(
          dialect,
          currentParamIndex,
          aliasMap // Pass aliasMap
        );
      }
    },
  };
}

/**
 * Represents the SUM aggregate function.
 * @param field A column configuration.
 */
export function sum(field: ColumnConfig<any, any>): SQL {
  return {
    _isSQL: true,
    getValues: (_dialect: Dialect) => [],
    toSqlString: (
      dialect: Dialect,
      _currentParamIndex?: { value: number },
      aliasMap?: Map<string, string> // Added aliasMap
    ): string => {
      const colConfig = field as ColumnConfig<any, any>;
      const colName = colConfig.name;
      let tableNameToUse = colConfig._tableName;
      if (
        aliasMap &&
        colConfig._tableName &&
        aliasMap.has(colConfig._tableName)
      ) {
        tableNameToUse = aliasMap.get(colConfig._tableName);
      }
      let identifier = "";
      if (tableNameToUse) {
        identifier =
          dialect === "postgres"
            ? `"${tableNameToUse}"."${colName}"`
            : `\`${tableNameToUse}\`.\`${colName}\``;
      } else {
        identifier = dialect === "postgres" ? `"${colName}"` : `\`${colName}\``;
      }
      return `SUM(${identifier})`; // Fixed typo: was MIN
    },
  };
}

/**
 * Represents the AVG aggregate function.
 * @param field A column configuration.
 */
export function avg(field: ColumnConfig<any, any>): SQL {
  return {
    _isSQL: true,
    getValues: (_dialect: Dialect) => [],
    toSqlString: (
      dialect: Dialect,
      _currentParamIndex?: { value: number },
      aliasMap?: Map<string, string> // Added aliasMap
    ): string => {
      const colConfig = field as ColumnConfig<any, any>;
      const colName = colConfig.name;
      let tableNameToUse = colConfig._tableName;
      if (
        aliasMap &&
        colConfig._tableName &&
        aliasMap.has(colConfig._tableName)
      ) {
        tableNameToUse = aliasMap.get(colConfig._tableName);
      }
      let identifier = "";
      if (tableNameToUse) {
        identifier =
          dialect === "postgres"
            ? `"${tableNameToUse}"."${colName}"`
            : `\`${tableNameToUse}\`.\`${colName}\``;
      } else {
        identifier = dialect === "postgres" ? `"${colName}"` : `\`${colName}\``;
      }
      return `AVG(${identifier})`;
    },
  };
}

/**
 * Represents the MIN aggregate function.
 * @param field A column configuration.
 */
export function min(field: ColumnConfig<any, any>): SQL {
  return {
    _isSQL: true,
    getValues: (_dialect: Dialect) => [],
    toSqlString: (
      dialect: Dialect,
      _currentParamIndex?: { value: number },
      aliasMap?: Map<string, string> // Added aliasMap
    ): string => {
      const colConfig = field as ColumnConfig<any, any>;
      const colName = colConfig.name;
      let tableNameToUse = colConfig._tableName;
      if (
        aliasMap &&
        colConfig._tableName &&
        aliasMap.has(colConfig._tableName)
      ) {
        tableNameToUse = aliasMap.get(colConfig._tableName);
      }
      let identifier = "";
      if (tableNameToUse) {
        identifier =
          dialect === "postgres"
            ? `"${tableNameToUse}"."${colName}"`
            : `\`${tableNameToUse}\`.\`${colName}\``;
      } else {
        identifier = dialect === "postgres" ? `"${colName}"` : `\`${colName}\``;
      }
      return `MIN(${identifier})`;
    },
  };
}

/**
 * Represents the MAX aggregate function.
 * @param field A column configuration.
 */
export function max(field: ColumnConfig<any, any>): SQL {
  return {
    _isSQL: true,
    getValues: (_dialect: Dialect) => [],
    toSqlString: (
      dialect: Dialect,
      _currentParamIndex?: { value: number }, // paramIndexState not used by MAX for string part
      aliasMap?: Map<string, string> // Ensured aliasMap is parameter
    ): string => {
      const colConfig = field as ColumnConfig<any, any>;
      const colName = colConfig.name;
      let tableNameToUse = colConfig._tableName;
      if (
        aliasMap &&
        colConfig._tableName &&
        aliasMap.has(colConfig._tableName)
      ) {
        tableNameToUse = aliasMap.get(colConfig._tableName);
      }
      let identifier = "";
      if (tableNameToUse) {
        identifier =
          dialect === "postgres"
            ? `"${tableNameToUse}"."${colName}"`
            : `\`${tableNameToUse}\`.\`${colName}\``;
      } else {
        identifier = dialect === "postgres" ? `"${colName}"` : `\`${colName}\``;
      }
      return `MAX(${identifier})`;
    },
  };
}
