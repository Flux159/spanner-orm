import { SQL, Dialect } from "../types/common.js";
import { ColumnConfig } from "../types/common.js";

/**
 * Represents the COUNT aggregate function.
 * Can be used with a column or '*' for COUNT(*).
 * @param field Optional: A column configuration or '*' to count all rows.
 *              If undefined or '*', it translates to COUNT(*).
 */
export function count(field?: ColumnConfig<any, any> | "*"): SQL {
  return {
    _isSQL: true,
    getValues: () => [],
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
 * Represents the SUM aggregate function.
 * @param field A column configuration.
 */
export function sum(field: ColumnConfig<any, any>): SQL {
  return {
    _isSQL: true,
    getValues: () => [],
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
    getValues: () => [],
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
    getValues: () => [],
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
    getValues: () => [],
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
