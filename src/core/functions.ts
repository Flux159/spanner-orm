import { SQL, Dialect, sql } from "../types/common.js";
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
      currentParamIndex?: { value: number }
    ): string => {
      const paramIdxState = currentParamIndex || { value: 1 };
      let internalValueStr: string;
      if (typeof value === "object" && value !== null) {
        if ("_isSQL" in value) {
          internalValueStr = (value as SQL).toSqlString(dialect, paramIdxState);
        } else if ("name" in value) {
          // ColumnConfig
          const colConfig = value as ColumnConfig<any, any>;
          const colName = colConfig.name;
          if (colConfig._tableName) {
            internalValueStr =
              dialect === "postgres"
                ? `"${colConfig._tableName}"."${colName}"`
                : `\`${colConfig._tableName}\`.\`${colName}\``;
          } else {
            internalValueStr =
              dialect === "postgres" ? `"${colName}"` : `\`${colName}\``;
          }
        } else {
          throw new Error("Invalid argument type for lower()");
        }
      } else {
        // Literal string argument
        internalValueStr =
          dialect === "postgres"
            ? `$${paramIdxState.value++}`
            : `@p${paramIdxState.value++}`;
      }
      return `LOWER(${internalValueStr})`;
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
      currentParamIndex?: { value: number }
    ): string => {
      const paramIdxState = currentParamIndex || { value: 1 };
      let internalValueStr: string;
      if (typeof value === "object" && value !== null) {
        if ("_isSQL" in value) {
          internalValueStr = (value as SQL).toSqlString(dialect, paramIdxState);
        } else if ("name" in value) {
          // ColumnConfig
          const colConfig = value as ColumnConfig<any, any>;
          const colName = colConfig.name;
          if (colConfig._tableName) {
            internalValueStr =
              dialect === "postgres"
                ? `"${colConfig._tableName}"."${colName}"`
                : `\`${colConfig._tableName}\`.\`${colName}\``;
          } else {
            internalValueStr =
              dialect === "postgres" ? `"${colName}"` : `\`${colName}\``;
          }
        } else {
          throw new Error("Invalid argument type for upper()");
        }
      } else {
        // Literal string argument
        internalValueStr =
          dialect === "postgres"
            ? `$${paramIdxState.value++}`
            : `@p${paramIdxState.value++}`;
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
      currentParamIndex?: { value: number }
    ): string => {
      const paramIdxState = currentParamIndex || { value: 1 };
      const stringArgs = args.map((arg) => {
        if (typeof arg === "object" && arg !== null) {
          if ("_isSQL" in arg) {
            return (arg as SQL).toSqlString(dialect, paramIdxState);
          } else if ("name" in arg) {
            // ColumnConfig
            const colConfig = arg as ColumnConfig<any, any>;
            const colName = colConfig.name;
            let identifier = "";
            if (colConfig._tableName) {
              identifier =
                dialect === "postgres"
                  ? `"${colConfig._tableName}"."${colName}"`
                  : `\`${colConfig._tableName}\`.\`${colName}\``;
            } else {
              identifier =
                dialect === "postgres" ? `"${colName}"` : `\`${colName}\``;
            }
            return identifier;
          }
        }
        // Literal string argument
        return dialect === "postgres"
          ? `$${paramIdxState.value++}`
          : `@p${paramIdxState.value++}`;
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
    getValues: (_dialect: Dialect) => [], // dialect not used but required by interface
    toSqlString: (dialect: Dialect): string => {
      if (!field || field === "*") {
        return "COUNT(*)";
      }
      const colConfig = field as ColumnConfig<any, any>;
      let identifier = "";
      if (colConfig._tableName) {
        identifier =
          dialect === "postgres"
            ? `"${colConfig._tableName}"."${colConfig.name}"`
            : `\`${colConfig._tableName}\`.\`${colConfig.name}\``;
      } else {
        identifier =
          dialect === "postgres"
            ? `"${colConfig.name}"`
            : `\`${colConfig.name}\``;
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
      currentParamIndex?: { value: number }
    ): string => {
      const paramIdxState = currentParamIndex || { value: 1 };
      const colName =
        dialect === "postgres" ? `"${column.name}"` : `\`${column.name}\``;
      const tblName = column._tableName
        ? dialect === "postgres"
          ? `"${column._tableName}".`
          : `\`${column._tableName}\`.`
        : "";

      if (dialect === "spanner") {
        const paramPlaceholder = `@p${paramIdxState.value++}`;
        return `REGEXP_CONTAINS(${tblName}${colName}, ${paramPlaceholder})`;
      }
      // PostgreSQL
      let sqlStr = `${tblName}${colName} LIKE $${paramIdxState.value++}`;
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
      currentParamIndex?: { value: number }
    ): string => {
      const paramIdxState = currentParamIndex || { value: 1 };
      const colName =
        dialect === "postgres" ? `"${column.name}"` : `\`${column.name}\``;
      const tblName = column._tableName
        ? dialect === "postgres"
          ? `"${column._tableName}".`
          : `\`${column._tableName}\`.`
        : "";

      if (dialect === "spanner") {
        const paramPlaceholder = `@p${paramIdxState.value++}`;
        return `REGEXP_CONTAINS(${tblName}${colName}, ${paramPlaceholder})`;
      }
      // PostgreSQL
      let sqlStr = `${tblName}${colName} ILIKE $${paramIdxState.value++}`;
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
      currentParamIndex?: { value: number }
    ): string => {
      // Here, we can use the sql tag because the parameter logic is simple (always one parameter)
      // and doesn't depend on the dialect for the getValues part.
      if (dialect === "spanner") {
        return sql`REGEXP_CONTAINS(${column}, ${regexpPattern})`.toSqlString(
          dialect,
          currentParamIndex
        );
      } else {
        // postgres
        return sql`${column} ~ ${regexpPattern}`.toSqlString(
          dialect,
          currentParamIndex
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
    getValues: (_dialect: Dialect) => [], // dialect not used but required by interface
    toSqlString: (dialect: Dialect): string => {
      const colConfig = field as ColumnConfig<any, any>;
      let identifier = "";
      if (colConfig._tableName) {
        identifier =
          dialect === "postgres"
            ? `"${colConfig._tableName}"."${colConfig.name}"`
            : `\`${colConfig._tableName}\`.\`${colConfig.name}\``;
      } else {
        identifier =
          dialect === "postgres"
            ? `"${colConfig.name}"`
            : `\`${colConfig.name}\``;
      }
      return `SUM(${identifier})`;
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
    getValues: (_dialect: Dialect) => [], // dialect not used but required by interface
    toSqlString: (dialect: Dialect): string => {
      const colConfig = field as ColumnConfig<any, any>;
      let identifier = "";
      if (colConfig._tableName) {
        identifier =
          dialect === "postgres"
            ? `"${colConfig._tableName}"."${colConfig.name}"`
            : `\`${colConfig._tableName}\`.\`${colConfig.name}\``;
      } else {
        identifier =
          dialect === "postgres"
            ? `"${colConfig.name}"`
            : `\`${colConfig.name}\``;
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
    getValues: (_dialect: Dialect) => [], // dialect not used but required by interface
    toSqlString: (dialect: Dialect): string => {
      const colConfig = field as ColumnConfig<any, any>;
      let identifier = "";
      if (colConfig._tableName) {
        identifier =
          dialect === "postgres"
            ? `"${colConfig._tableName}"."${colConfig.name}"`
            : `\`${colConfig._tableName}\`.\`${colConfig.name}\``;
      } else {
        identifier =
          dialect === "postgres"
            ? `"${colConfig.name}"`
            : `\`${colConfig.name}\``;
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
    getValues: (_dialect: Dialect) => [], // dialect not used but required by interface
    toSqlString: (dialect: Dialect): string => {
      const colConfig = field as ColumnConfig<any, any>;
      let identifier = "";
      if (colConfig._tableName) {
        identifier =
          dialect === "postgres"
            ? `"${colConfig._tableName}"."${colConfig.name}"`
            : `\`${colConfig._tableName}\`.\`${colConfig.name}\``;
      } else {
        identifier =
          dialect === "postgres"
            ? `"${colConfig.name}"`
            : `\`${colConfig.name}\``;
      }
      return `MAX(${identifier})`;
    },
  };
}
