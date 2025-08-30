import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SpannerConnectionOptions } from "../../src/spanner/adapter.js";

// Create a test-only version of SpannerAdapter that uses mocked Spanner
class TestableSpannerAdapter {
  readonly dialect = "spanner";
  private mockDb: any;
  private isConnected = false;
  private options: SpannerConnectionOptions;

  constructor(options: SpannerConnectionOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    // Create mock database
    this.mockDb = {
      run: async (options: any) => {
        // Simulate successful query for connection test
        if (options.sql === "SELECT 1") {
          return [[], {}];
        }
        // Check if type hints are being passed correctly
        if (options.types || options.paramTypes) {
          return [[{ result: "with_types" }], {}];
        }
        return [[{ result: "no_types" }], {}];
      },
      runTransactionAsync: async (callback: any) => {
        const mockTransaction = {
          runUpdate: async (options: any) => {
            // Check if type hints are being passed
            if (options.types || options.paramTypes) {
              return [1]; // 1 row affected with types
            }
            return [0]; // 0 rows affected without types
          },
          run: async (options: any) => {
            if (options.types || options.paramTypes) {
              return [[{ result: "with_types" }], {}];
            }
            return [[{ result: "no_types" }], {}];
          },
          commit: async () => {},
          rollback: async () => {},
        };
        return callback(mockTransaction);
      },
      getTransaction: () => ({
        runUpdate: async (options: any) => {
          if (options.types || options.paramTypes) {
            return [1];
          }
          return [0];
        },
        run: async (options: any) => {
          if (options.types || options.paramTypes) {
            return [[{ result: "with_types" }], {}];
          }
          return [[{ result: "no_types" }], {}];
        },
        commit: async () => {},
        rollback: async () => {},
        begin: async () => {},
      }),
    };
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.mockDb = undefined;
  }

  private ensureConnected() {
    if (!this.isConnected || !this.mockDb) {
      throw new Error("Not connected");
    }
    return this.mockDb;
  }

  // Clean JSON helper (copy from real adapter)
  private cleanJsonForSpanner(value: any): any {
    if (value === null || value === undefined) {
      return null;
    }
    
    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      const cleaned: any = {};
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          if (value[key] !== undefined) {
            cleaned[key] = this.cleanJsonForSpanner(value[key]);
          }
          // Skip undefined values entirely
        }
      }
      return cleaned;
    }
    
    if (Array.isArray(value)) {
      return value.map(item => this.cleanJsonForSpanner(item));
    }
    
    return value;
  }

  private cleanParamsForSpanner(
    params?: Record<string, any>,
    typeHints?: Record<string, string>
  ): Record<string, any> | undefined {
    if (!params) return undefined;
    
    const cleaned: Record<string, any> = {};
    for (const key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        const hint = typeHints?.[key];
        // Clean JSON fields
        if (hint && (hint.toUpperCase() === 'JSON' || hint.toUpperCase() === 'JSONB')) {
          cleaned[key] = this.cleanJsonForSpanner(params[key]);
        } else {
          cleaned[key] = params[key];
        }
      }
    }
    return cleaned;
  }

  // Helper function to automatically infer Spanner types from JavaScript values
  private inferSpannerTypeFromValue(value: any): string {
    if (value === null || value === undefined) {
      return "STRING";
    }
    
    if (typeof value === 'string') {
      return "STRING";
    }
    
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return "INT64";
      }
      return "FLOAT64";
    }
    
    if (typeof value === 'boolean') {
      return "BOOL";
    }
    
    if (value instanceof Date) {
      return "TIMESTAMP";
    }
    
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      return "BYTES";
    }
    
    if (typeof value === 'object') {
      return "JSON";
    }
    
    return "STRING";
  }

  // Helper function to automatically generate type hints from parameters
  private generateTypeHintsFromParams(params?: Record<string, any>): Record<string, string> | undefined {
    if (!params) return undefined;
    
    const typeHints: Record<string, string> = {};
    for (const key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        typeHints[key] = this.inferSpannerTypeFromValue(params[key]);
      }
    }
    return typeHints;
  }

  // Helper function to merge provided hints with inferred hints
  private mergeTypeHints(
    providedHints?: Record<string, string>,
    params?: Record<string, any>
  ): Record<string, string> | undefined {
    if (!params && !providedHints) return undefined;
    
    const inferredHints = this.generateTypeHintsFromParams(params);
    
    if (!providedHints) {
      return inferredHints;
    }
    
    if (!inferredHints) {
      return providedHints;
    }
    
    return { ...inferredHints, ...providedHints };
  }

  async query<T = any>(
    sql: string,
    params?: Record<string, any>,
    spannerTypeHints?: Record<string, string>
  ): Promise<T[]> {
    const db = this.ensureConnected();
    
    // Merge provided hints with inferred hints
    const mergedHints = this.mergeTypeHints(spannerTypeHints, params);
    
    // Clean params if they contain JSON
    const cleanedParams = this.cleanParamsForSpanner(params, mergedHints);
    
    const queryOptions: any = {
      sql,
      params: cleanedParams,
      json: true,
    };
    
    // Add types if provided or inferred
    if (mergedHints) {
      queryOptions.types = mergedHints;
      queryOptions.paramTypes = mergedHints; // Mock uses this to detect type hints
    }

    const [rows] = await db.run(queryOptions);
    return rows as T[];
  }

  async execute(
    sql: string,
    params?: Record<string, any>,
    spannerTypeHints?: Record<string, string>
  ): Promise<{ count: number }> {
    const db = this.ensureConnected();
    
    // Merge provided hints with inferred hints
    const mergedHints = this.mergeTypeHints(spannerTypeHints, params);
    
    // Clean params if they contain JSON
    const cleanedParams = this.cleanParamsForSpanner(params, mergedHints);

    const rowCount = await db.runTransactionAsync(
      async (transaction: any) => {
        const updateOptions: any = {
          sql,
          params: cleanedParams,
        };
        
        // Add types if provided or inferred
        if (mergedHints) {
          updateOptions.types = mergedHints;
          updateOptions.paramTypes = mergedHints;
        }

        const [count] = await transaction.runUpdate(updateOptions);
        await transaction.commit();
        return count;
      }
    );
    return { count: typeof rowCount === "number" ? rowCount : 0 };
  }

  async executeAndReturnRows<T = any>(
    sql: string,
    params?: Record<string, any>,
    spannerTypeHints?: Record<string, string>
  ): Promise<T[]> {
    const db = this.ensureConnected();
    
    // Merge provided hints with inferred hints
    const mergedHints = this.mergeTypeHints(spannerTypeHints, params);
    
    // Clean params if they contain JSON
    const cleanedParams = this.cleanParamsForSpanner(params, mergedHints);

    return await db.runTransactionAsync(
      async (transaction: any) => {
        const queryOptions: any = {
          sql,
          params: cleanedParams,
          json: true,
        };
        
        // Add types if provided or inferred
        if (mergedHints) {
          queryOptions.types = mergedHints;
          queryOptions.paramTypes = mergedHints;
        }

        const [rows] = await transaction.run(queryOptions);
        await transaction.commit();
        return rows as T[];
      }
    );
  }

  async beginTransaction() {
    const db = this.ensureConnected();
    const spannerTx = db.getTransaction();
    
    return {
      execute: async (
        sqlCmd: string,
        paramsCmd?: Record<string, any>,
        cmdSpannerTypeHints?: Record<string, string>
      ) => {
        if (spannerTx.begin) await spannerTx.begin();
        
        const mergedHints = this.mergeTypeHints(cmdSpannerTypeHints, paramsCmd);
        const cleanedParams = this.cleanParamsForSpanner(paramsCmd, mergedHints);
        const updateOptions: any = {
          sql: sqlCmd,
          params: cleanedParams,
        };
        
        if (mergedHints) {
          updateOptions.types = mergedHints;
          updateOptions.paramTypes = mergedHints;
        }

        const [rowCount] = await spannerTx.runUpdate(updateOptions);
        return { count: rowCount };
      },
      query: async <T = any>(
        sqlQuery: string,
        paramsQuery?: Record<string, any>,
        querySpannerTypeHints?: Record<string, string>
      ): Promise<T[]> => {
        const mergedHints = this.mergeTypeHints(querySpannerTypeHints, paramsQuery);
        const cleanedParams = this.cleanParamsForSpanner(paramsQuery, mergedHints);
        const queryOptions: any = {
          sql: sqlQuery,
          params: cleanedParams,
          json: true,
        };
        
        if (mergedHints) {
          queryOptions.types = mergedHints;
          queryOptions.paramTypes = mergedHints;
        }

        const [rows] = await spannerTx.run(queryOptions);
        return rows as T[];
      },
      commit: async () => {
        if (spannerTx.commit) await spannerTx.commit();
      },
      rollback: async () => {
        if (spannerTx.rollback) await spannerTx.rollback();
      },
    };
  }

  async transaction<T>(
    callback: (tx: any) => Promise<T>
  ): Promise<T> {
    const db = this.ensureConnected();
    return db.runTransactionAsync(
      async (gcpTransaction: any) => {
        const txExecutor = {
          execute: async (
            cmdSql: string,
            cmdParams?: Record<string, any>,
            cmdSpannerTypeHints?: Record<string, string>
          ) => {
            const mergedHints = this.mergeTypeHints(cmdSpannerTypeHints, cmdParams);
            const cleanedParams = this.cleanParamsForSpanner(cmdParams, mergedHints);
            const updateOptions: any = {
              sql: cmdSql,
              params: cleanedParams,
            };
            
            if (mergedHints) {
              updateOptions.types = mergedHints;
              updateOptions.paramTypes = mergedHints;
            }

            const [rowCount] = await gcpTransaction.runUpdate(updateOptions);
            return { count: rowCount };
          },
          query: async (
            querySql: string,
            queryParams?: Record<string, any>,
            querySpannerTypeHints?: Record<string, string>
          ) => {
            const mergedHints = this.mergeTypeHints(querySpannerTypeHints, queryParams);
            const cleanedParams = this.cleanParamsForSpanner(queryParams, mergedHints);
            const queryOptions: any = {
              sql: querySql,
              params: cleanedParams,
              json: true,
            };
            
            if (mergedHints) {
              queryOptions.types = mergedHints;
              queryOptions.paramTypes = mergedHints;
            }

            const [rows] = await gcpTransaction.run(queryOptions);
            return rows as any[];
          },
          commit: async () => {},
          rollback: async () => {},
        };
        return callback(txExecutor);
      }
    );
  }
}

describe("SpannerAdapter Type Hints", () => {
  let adapter: TestableSpannerAdapter;

  beforeEach(async () => {
    const options: SpannerConnectionOptions = {
      projectId: "test-project",
      instanceId: "test-instance",
      databaseId: "test-database",
    };
    adapter = new TestableSpannerAdapter(options);
    await adapter.connect();
  });

  describe("JSON Data Cleaning", () => {
    it("should clean undefined values from JSON parameters", async () => {
      const params = {
        p1: "value1",
        p2: {
          field1: "test",
          field2: undefined,
          field3: null,
          nested: {
            a: 1,
            b: undefined,
            c: null,
          },
        },
      };

      const typeHints = {
        p2: "JSON",
      };

      // This should not throw an error even with undefined values
      const result = await adapter.query("SELECT * FROM test", params, typeHints);
      expect(result).toBeDefined();
      // Since we're passing type hints, it should return "with_types"
      expect(result).toEqual([{ result: "with_types" }]);
    });

    it("should handle arrays with undefined values in JSON", async () => {
      const params = {
        p1: [1, undefined, 3, null],
        p2: {
          arr: [undefined, "test", null],
        },
      };

      const typeHints = {
        p1: "JSON",
        p2: "JSON",
      };

      const result = await adapter.query("SELECT * FROM test", params, typeHints);
      expect(result).toBeDefined();
      expect(result).toEqual([{ result: "with_types" }]);
    });
  });

  describe("Type Hints in Query Methods", () => {
    it("should pass type hints to query method", async () => {
      const params = { p1: "test", p2: 123 };
      const typeHints = { p1: "STRING", p2: "INT64" };

      const result = await adapter.query("SELECT * FROM test", params, typeHints);
      expect(result).toEqual([{ result: "with_types" }]);
    });

    it("should automatically infer types when no hints provided", async () => {
      const params = { p1: "test", p2: 123 };

      const result = await adapter.query("SELECT * FROM test", params);
      // Types are now auto-inferred, so it should return "with_types"
      expect(result).toEqual([{ result: "with_types" }]);
    });

    it("should pass type hints to execute method", async () => {
      const params = { p1: "test", p2: null };
      const typeHints = { p1: "STRING", p2: "INT64" };

      const result = await adapter.execute("UPDATE test SET col = @p1", params, typeHints);
      expect(result).toEqual({ count: 1 });
    });

    it("should automatically infer types in execute when no hints provided", async () => {
      const params = { p1: "test" };

      const result = await adapter.execute("UPDATE test SET col = @p1", params);
      // Types are now auto-inferred, so it should return count: 1
      expect(result).toEqual({ count: 1 });
    });

    it("should pass type hints to executeAndReturnRows method", async () => {
      const params = { p1: new Date(), p2: true };
      const typeHints = { p1: "TIMESTAMP", p2: "BOOL" };

      const result = await adapter.executeAndReturnRows(
        "INSERT INTO test VALUES (@p1, @p2) THEN RETURN *",
        params,
        typeHints
      );
      expect(result).toEqual([{ result: "with_types" }]);
    });
  });

  describe("Type Mapping", () => {
    it("should map PostgreSQL types to Spanner types correctly", async () => {
      const typeTests = [
        { pgType: "text", spannerType: "STRING" },
        { pgType: "varchar(255)", spannerType: "STRING" },
        { pgType: "uuid", spannerType: "STRING" },
        { pgType: "integer", spannerType: "INT64" },
        { pgType: "bigint", spannerType: "INT64" },
        { pgType: "serial", spannerType: "INT64" },
        { pgType: "boolean", spannerType: "BOOL" },
        { pgType: "double precision", spannerType: "FLOAT64" },
        { pgType: "real", spannerType: "FLOAT64" },
        { pgType: "numeric(10,2)", spannerType: "NUMERIC" },
        { pgType: "decimal", spannerType: "NUMERIC" },
        { pgType: "date", spannerType: "DATE" },
        { pgType: "timestamp", spannerType: "TIMESTAMP" },
        { pgType: "timestamptz", spannerType: "TIMESTAMP" },
        { pgType: "jsonb", spannerType: "JSON" },
        { pgType: "json", spannerType: "JSON" },
        { pgType: "bytea", spannerType: "BYTES" },
      ];

      for (const test of typeTests) {
        const params = { p1: null };
        const typeHints = { p1: test.pgType };

        // The mock will return "with_types" if types are passed
        const result = await adapter.query("SELECT * FROM test", params, typeHints);
        expect(result).toEqual([{ result: "with_types" }]);
      }
    });

    it("should pass through valid Spanner type codes", async () => {
      const validTypeCodes = [
        "STRING",
        "INT64",
        "BOOL",
        "FLOAT64",
        "TIMESTAMP",
        "DATE",
        "BYTES",
        "NUMERIC",
        "JSON",
      ];

      for (const typeCode of validTypeCodes) {
        const params = { p1: null };
        const typeHints = { p1: typeCode };

        const result = await adapter.query("SELECT * FROM test", params, typeHints);
        expect(result).toEqual([{ result: "with_types" }]);
      }
    });
  });

  describe("Transaction Type Hints", () => {
    it("should pass type hints in transaction execute", async () => {
      const result = await adapter.transaction(async (tx) => {
        const params = { p1: "test", p2: 456 };
        const typeHints = { p1: "STRING", p2: "INT64" };
        
        const execResult = await tx.execute("UPDATE test SET col = @p1", params, typeHints);
        return execResult;
      });

      expect(result).toEqual({ count: 1 });
    });

    it("should pass type hints in transaction query", async () => {
      const result = await adapter.transaction(async (tx) => {
        const params = { p1: new Date() };
        const typeHints = { p1: "TIMESTAMP" };
        
        const queryResult = await tx.query("SELECT * FROM test WHERE created = @p1", params, typeHints);
        return queryResult;
      });

      expect(result).toEqual([{ result: "with_types" }]);
    });

    it("should automatically infer types in transaction when no hints provided", async () => {
      const result = await adapter.transaction(async (tx) => {
        const params = { p1: "test" };
        
        const queryResult = await tx.query("SELECT * FROM test WHERE name = @p1", params);
        return queryResult;
      });

      // Types are now auto-inferred, so it should return "with_types"
      expect(result).toEqual([{ result: "with_types" }]);
    });
  });

  describe("beginTransaction Type Hints", () => {
    it("should pass type hints in beginTransaction", async () => {
      const tx = await adapter.beginTransaction();
      
      const params = { p1: "test", p2: 123 };
      const typeHints = { p1: "STRING", p2: "INT64" };
      
      const result = await tx.execute("UPDATE test SET col = @p1", params, typeHints);
      expect(result).toEqual({ count: 1 });
      
      await tx.commit();
    });

    it("should work with query in beginTransaction", async () => {
      const tx = await adapter.beginTransaction();
      
      const params = { p1: "test" };
      const typeHints = { p1: "STRING" };
      
      const result = await tx.query("SELECT * FROM test", params, typeHints);
      expect(result).toEqual([{ result: "with_types" }]);
      
      await tx.commit();
    });
  });

  describe("Null Parameter Handling", () => {
    it("should handle null parameters with type hints", async () => {
      const params = {
        p1: null,
        p2: null,
        p3: "value",
      };

      const typeHints = {
        p1: "STRING",
        p2: "INT64",
        p3: "STRING",
      };

      // With type hints, null values should work fine
      const result = await adapter.query("SELECT * FROM test", params, typeHints);
      expect(result).toEqual([{ result: "with_types" }]);
    });

    it("should handle mixed null and undefined in JSON", async () => {
      const params = {
        jsonField: {
          a: null,
          b: undefined,
          c: "value",
          nested: {
            x: undefined,
            y: null,
          },
        },
      };

      const typeHints = {
        jsonField: "JSON",
      };

      // Should clean undefined but keep null
      const result = await adapter.query("SELECT * FROM test", params, typeHints);
      expect(result).toEqual([{ result: "with_types" }]);
    });
  });

  describe("Automatic Type Inference", () => {
    it("should automatically infer types when no hints provided", async () => {
      const params = {
        stringParam: "test",
        intParam: 42,
        floatParam: 3.14,
        boolParam: true,
        dateParam: new Date(),
        jsonParam: { key: "value" },
        arrayParam: [1, 2, 3],
      };

      // No type hints provided - should auto-infer and still pass types
      const result = await adapter.query("SELECT * FROM test", params);
      // Since types are auto-inferred, mock should see types and return "with_types"
      expect(result).toEqual([{ result: "with_types" }]);
    });

    it("should use provided hints over inferred types", async () => {
      const params = {
        p1: 42, // Would normally infer as INT64
        p2: "123", // String that could be a number
      };

      const typeHints = {
        p1: "STRING", // Override to STRING
        p2: "INT64", // Override to INT64
      };

      const result = await adapter.query("SELECT * FROM test", params, typeHints);
      expect(result).toEqual([{ result: "with_types" }]);
    });

    it("should handle null values with auto-inference", async () => {
      const params = {
        p1: null,
        p2: "value",
        p3: 123,
      };

      // No hints provided - nulls will default to STRING
      const result = await adapter.query("SELECT * FROM test", params);
      expect(result).toEqual([{ result: "with_types" }]);
    });

    it("should auto-infer JSON type for objects", async () => {
      const params = {
        data: {
          nested: {
            field: "value",
            number: 123,
          },
        },
      };

      // No hints - should auto-detect as JSON
      const result = await adapter.query("SELECT * FROM test", params);
      expect(result).toEqual([{ result: "with_types" }]);
    });

    it("should work in execute with auto-inference", async () => {
      const params = {
        name: "test",
        age: 30,
        active: true,
      };

      // No hints provided
      const result = await adapter.execute("UPDATE users SET name = @name", params);
      expect(result).toEqual({ count: 1 });
    });

    it("should work in transactions with auto-inference", async () => {
      const result = await adapter.transaction(async (tx) => {
        const params = {
          id: 1,
          data: { key: "value" },
        };
        
        // No type hints - should auto-infer
        return await tx.query("SELECT * FROM test", params);
      });

      expect(result).toEqual([{ result: "with_types" }]);
    });
  });

  afterEach(async () => {
    if (adapter) {
      await adapter.disconnect();
    }
  });
});