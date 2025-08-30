// src/spanner/adapter.ts

// Import types directly
import type {
  Database as SpannerDatabase,
  Transaction as SpannerNativeTransaction,
  Instance as SpannerInstance,
  // DatabaseAdminClient will be obtained via this.spannerClient.getDatabaseAdminClient()
  // google.longrunning.IOperation type will be inferred
} from "@google-cloud/spanner";

// Type for the Spanner class constructor
type SpannerClientClassType = typeof import("@google-cloud/spanner").Spanner;
// Type for Spanner instance
type SpannerClientInstanceType = import("@google-cloud/spanner").Spanner;
// google.spanner.v1.IType and google.spanner.v1.TypeCode are globally available
// for type checking from @google-cloud/spanner's .d.ts files.

// Local interface to represent the structure of google.spanner.v1.IType
// This helps with type checking without needing a direct runtime import of 'google'.
interface SpannerParamType {
  code: string | number; // Corresponds to google.spanner.v1.TypeCode
  arrayElementType?: SpannerParamType | null; // Corresponds to google.spanner.v1.IType
  structType?: {
    fields: Array<{
      name?: string | null;
      type?: SpannerParamType | null; // Corresponds to google.spanner.v1.IType
    }>;
  } | null; // Corresponds to google.spanner.v1.IStructType
}

import type {
  DatabaseAdapter,
  QueryResultRow as AdapterQueryResultRow,
  ConnectionOptions,
  Transaction as OrmTransaction, // Renaming to avoid conflict with Spanner's Transaction
  AffectedRows,
} from "../types/adapter.js";
import type { PreparedQuery, TableConfig } from "../types/common.js"; // Corrected path
import { shapeResults } from "../core/result-shaper.js"; // Corrected path
import { types } from "util";

// Helper function to map DDL type strings to Spanner TypeCodes
function mapDdlTypeToSpannerCode(ddlType: string): string {
  const upperType = ddlType.toUpperCase();
  if (
    upperType.startsWith("STRING") ||
    upperType === "TEXT" ||
    upperType === "UUID" ||
    upperType.startsWith("VARCHAR")
  ) {
    return "STRING";
  }
  if (
    upperType.startsWith("INT") ||
    upperType === "BIGINT" ||
    upperType === "INTEGER" ||
    upperType === "SERIAL" ||
    upperType === "BIGSERIAL" ||
    upperType === "SMALLINT" ||
    upperType === "INT64"
  ) {
    return "INT64";
  }
  if (upperType === "BOOLEAN" || upperType === "BOOL") {
    return "BOOL";
  }
  if (
    upperType.startsWith("FLOAT") ||
    upperType === "DOUBLE" ||
    upperType === "REAL" ||
    upperType === "DOUBLE PRECISION" ||
    upperType === "FLOAT64"
  ) {
    return "FLOAT64";
  }
  if (upperType.startsWith("NUMERIC") || upperType.startsWith("DECIMAL")) {
    return "NUMERIC";
  }
  if (upperType === "DATE") {
    return "DATE";
  }
  if (upperType.startsWith("TIMESTAMP")) {
    // Covers TIMESTAMP and TIMESTAMPTZ
    return "TIMESTAMP";
  }
  if (upperType.startsWith("JSON")) {
    // Covers JSON and JSONB
    return "JSON";
  }
  if (upperType === "BYTES" || upperType === "BYTEA") {
    return "BYTES";
  }
  // If the type is already a valid Spanner TypeCode, pass it through.
  // This handles cases where the hint might already be in the correct format.
  const validSpannerTypeCodes = [
    "STRING",
    "INT64",
    "BOOL",
    "FLOAT64",
    "TIMESTAMP",
    "DATE",
    "BYTES",
    "ARRAY",
    "STRUCT",
    "NUMERIC",
    "JSON",
  ];
  if (validSpannerTypeCodes.includes(upperType)) {
    return upperType;
  }

  console.warn(
    `Unknown DDL type for Spanner mapping: ${ddlType}. Defaulting to STRING.`
  );
  return "STRING";
}

// Helper function to map type string to Spanner TypeCode enum number
function getSpannerTypeCodeEnum(typeString: string): number {
  const typeCodeMap: Record<string, number> = {
    'BOOL': 1,
    'INT64': 2,
    'FLOAT64': 3,
    'TIMESTAMP': 4,
    'DATE': 5,
    'STRING': 6,
    'BYTES': 7,
    'ARRAY': 8,
    'STRUCT': 9,
    'NUMERIC': 10,
    'JSON': 11,
    'PROTO': 13,
    'ENUM': 14,
    'FLOAT32': 15,
    'INTERVAL': 16,
    'UUID': 17,
  };
  return typeCodeMap[typeString] || 6; // Default to STRING (6) if unknown
}

// Helper function to transform DDL hints to Spanner paramTypes object
function transformDdlHintsToParamTypes(
  ddlHints?: Record<string, string>
): Record<string, SpannerParamType> | undefined {
  if (!ddlHints) {
    return undefined;
  }
  const paramTypes: Record<string, SpannerParamType> = {};
  for (const key in ddlHints) {
    if (Object.prototype.hasOwnProperty.call(ddlHints, key)) {
      const typeCodeString = mapDdlTypeToSpannerCode(ddlHints[key]);
      // Construct an object conforming to our local SpannerParamType interface,
      // which is structurally compatible with google.spanner.v1.IType.
      paramTypes[key] = {
        code: getSpannerTypeCodeEnum(typeCodeString), // Use numeric TypeCode enum value
        arrayElementType: null, // Assuming scalar types for now
        structType: null, // Assuming scalar types for now
      };
    }
  }
  return paramTypes;
}

function transformDdlHintsToTypes(
  ddlHints?: Record<string, string>
): Record<string, string> | undefined {
  if (!ddlHints) {
    return undefined;
  }
  const types: Record<string, string> = {};
  for (const key in ddlHints) {
    if (Object.prototype.hasOwnProperty.call(ddlHints, key)) {
      const typeCodeString = mapDdlTypeToSpannerCode(ddlHints[key]);
      // Construct an object conforming to our local SpannerParamType interface,
      // which is structurally compatible with google.spanner.v1.IType.
      types[key] = typeCodeString; // mapDdlTypeToSpannerCode returns a string like "STRING"
    }
  }
  return types;
}

// Helper function to clean JSON data before sending to Spanner
function cleanJsonForSpanner(value: any): any {
  if (value === null || value === undefined) {
    return null;
  }
  
  if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    const cleaned: any = {};
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        if (value[key] !== undefined) {
          cleaned[key] = cleanJsonForSpanner(value[key]);
        }
        // Skip undefined values entirely
      }
    }
    return cleaned;
  }
  
  if (Array.isArray(value)) {
    return value.map(item => cleanJsonForSpanner(item));
  }
  
  return value;
}

// Helper to clean params that might contain JSON
function cleanParamsForSpanner(
  params?: Record<string, any>,
  typeHints?: Record<string, string>
): Record<string, any> | undefined {
  if (!params) return undefined;
  
  const cleaned: Record<string, any> = {};
  let hasKeys = false;
  
  for (const key in params) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      const hint = typeHints?.[key];
      // Clean JSON fields
      if (hint && mapDdlTypeToSpannerCode(hint) === 'JSON') {
        cleaned[key] = cleanJsonForSpanner(params[key]);
      } else {
        cleaned[key] = params[key];
      }
      hasKeys = true;
    }
  }
  
  // Return undefined if params is empty to avoid sending empty object to Spanner
  return hasKeys ? cleaned : undefined;
}

// Helper function to automatically infer Spanner types from JavaScript values
function inferSpannerTypeFromValue(value: any): string {
  if (value === null || value === undefined) {
    // For null/undefined, we can't infer type, default to STRING
    return "STRING";
  }
  
  if (typeof value === 'string') {
    return "STRING";
  }
  
  if (typeof value === 'number') {
    // Check if it's an integer or float
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
    // For objects and arrays, use JSON type
    return "JSON";
  }
  
  // Default fallback
  return "STRING";
}

// Helper function to automatically generate type hints from parameters
function generateTypeHintsFromParams(params?: Record<string, any>): Record<string, string> | undefined {
  if (!params) return undefined;
  
  const typeHints: Record<string, string> = {};
  let hasKeys = false;
  for (const key in params) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      typeHints[key] = inferSpannerTypeFromValue(params[key]);
      hasKeys = true;
    }
  }
  // Return undefined if params is empty to avoid sending empty types object to Spanner
  return hasKeys ? typeHints : undefined;
}

// Helper function to merge provided hints with inferred hints
function mergeTypeHints(
  providedHints?: Record<string, string>,
  params?: Record<string, any>
): Record<string, string> | undefined {
  if (!params && !providedHints) return undefined;
  
  // Generate automatic hints from params
  const inferredHints = generateTypeHintsFromParams(params);
  
  if (!providedHints) {
    return inferredHints;
  }
  
  if (!inferredHints) {
    return providedHints;
  }
  
  // Merge, with provided hints taking precedence
  return { ...inferredHints, ...providedHints };
}

// Helper function to provide better error messages
function enhanceSpannerError(error: any, params?: Record<string, any>): Error {
  const errorMessage = error.message || '';
  
  if (errorMessage.includes('The code field is required for types')) {
    // Check for undefined values in params
    const hasUndefinedInJson = checkForUndefinedInJsonParams(params);
    if (hasUndefinedInJson) {
      return new Error(
        'Spanner Error: JSON columns cannot contain undefined values. ' +
        'Found undefined in JSON parameters. Please use null instead of undefined. ' +
        `Original error: ${errorMessage}`
      );
    }
    
    // Check for null values without types
    const nullParams = findNullParams(params);
    if (nullParams.length > 0) {
      return new Error(
        'Spanner Error: Null values may require type information. ' +
        `Parameters with null values: ${nullParams.join(', ')}. ` +
        `Consider providing type hints for these parameters. ` +
        `Original error: ${errorMessage}`
      );
    }
  }
  
  return error;
}

function checkForUndefinedInJsonParams(params?: Record<string, any>): boolean {
  if (!params) return false;
  
  for (const value of Object.values(params)) {
    if (hasUndefinedValue(value)) {
      return true;
    }
  }
  return false;
}

function hasUndefinedValue(value: any): boolean {
  if (value === undefined) return true;
  
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    if (Array.isArray(value)) {
      return value.some(item => hasUndefinedValue(item));
    } else {
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          if (hasUndefinedValue(value[key])) {
            return true;
          }
        }
      }
    }
  }
  
  return false;
}

function findNullParams(params?: Record<string, any>): string[] {
  if (!params) return [];
  
  const nullParams: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null) {
      nullParams.push(key);
    }
  }
  return nullParams;
}

export interface SpannerConnectionOptions extends ConnectionOptions {
  projectId: string;
  instanceId: string;
  databaseId: string;
  // Add other Spanner specific options if needed, e.g., credentials
}

// SpannerTransactionAdapter is effectively replaced by the global OrmTransaction interface

export class SpannerAdapter implements DatabaseAdapter {
  readonly dialect = "spanner";
  private spannerClient?: SpannerClientInstanceType;
  private instance?: SpannerInstance;
  private db?: SpannerDatabase;
  // private adminClient?: DatabaseAdminClient; // Removed, will be obtained on demand
  private dbPath?: string; // Kept
  private options: SpannerConnectionOptions;
  private isConnected: boolean = false;
  private ready: Promise<void>;
  private SpannerClientClass?: SpannerClientClassType;

  constructor(options: SpannerConnectionOptions) {
    if (!options.projectId || !options.instanceId || !options.databaseId) {
      throw new Error(
        "projectId, instanceId, and databaseId are required for Spanner adapter."
      );
    }
    this.options = options;
    this.ready = this.initializeSpannerClient();
  }

  private async initializeSpannerClient(): Promise<void> {
    if (!this.SpannerClientClass) {
      const spannerModule = await import("@google-cloud/spanner");
      this.SpannerClientClass = spannerModule.Spanner;
    }
  }

  async connect(): Promise<void> {
    await this.ready; // Ensure Spanner class is loaded
    if (this.isConnected) {
      console.log("Spanner adapter already connected.");
      return;
    }
    if (!this.SpannerClientClass) {
      // Should not happen if await this.ready worked
      throw new Error("Spanner client class not loaded.");
    }
    try {
      this.spannerClient = new this.SpannerClientClass({
        projectId: this.options.projectId,
        // Consider adding credentials if they are part of options
      });
      this.instance = this.spannerClient.instance(this.options.instanceId);
      this.db = this.instance.database(this.options.databaseId);

      // Construct the fully qualified database path
      this.dbPath = `projects/${this.options.projectId}/instances/${this.options.instanceId}/databases/${this.options.databaseId}`;

      // adminClient is no longer initialized here

      // Perform a simple query to verify connection and authentication
      await this.db.run("SELECT 1");
      this.isConnected = true;
      console.log("Spanner adapter connected successfully.");
    } catch (error) {
      console.error("Error connecting Spanner adapter:", error);
      this.spannerClient = undefined;
      this.instance = undefined;
      this.db = undefined;
      // this.adminClient = undefined; // Removed
      this.dbPath = undefined;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    // No need to await this.ready for disconnect, if spannerClient exists, try to close it.
    if (!this.isConnected || !this.spannerClient) {
      console.log("Spanner adapter already disconnected or not connected.");
      return;
    }
    try {
      // Close the main client
      if (this.spannerClient) {
        await this.spannerClient.close();
      }
      // adminClient is no longer a class member to close here
      this.isConnected = false;
      this.spannerClient = undefined;
      this.instance = undefined;
      this.db = undefined;
      // this.adminClient = undefined; // Removed
      this.dbPath = undefined;
      console.log("Spanner adapter disconnected.");
    } catch (error) {
      console.error("Error disconnecting Spanner adapter:", error);
      throw error;
    }
  }

  private ensureConnected(): SpannerDatabase {
    // this.ready should have been awaited by the calling public method or connect()
    if (!this.isConnected || !this.db) {
      throw new Error(
        "Spanner adapter is not connected. Call connect() first."
      );
    }
    return this.db;
  }

  async execute(
    sql: string,
    params?: Record<string, any>,
    types?: Record<string, string>,
    paramTypes?: Record<string, any>,
    _spannerTypeHints?: Record<string, string>
  ): Promise<number | AffectedRows> {
    const db = this.ensureConnected(); // Relies on connect() having awaited this.ready
    try {
      // Merge provided hints with inferred hints
      const mergedHints = mergeTypeHints(spannerTypeHints, params);
      
      // Clean params if they contain JSON
      const cleanedParams = cleanParamsForSpanner(params, mergedHints);
      const paramTypes = transformDdlHintsToParamTypes(mergedHints) as any;
      const types = transformDdlHintsToTypes(mergedHints);

      // Spanner's runUpdate returns an array where the first element is the affected row count.
      // The result of runTransactionAsync is the result of its callback.
      const rowCount = await db.runTransactionAsync(
        async (transaction: SpannerNativeTransaction) => {
          try {
            const updateOptions: any = {
              sql,
              params,
              types,
              paramTypes,
            });
            await transaction.commit();
            return count;
          } catch (err) {
            console.error("Error during transaction:", err);
            await transaction.rollback();
            throw enhanceSpannerError(err, params);
          }
        }
      );
      return { count: typeof rowCount === "number" ? rowCount : 0 };
    } catch (error) {
      console.error("Error executing command with Spanner adapter:", error);
      throw enhanceSpannerError(error, params);
    }
  }

  async executeDDL(
    sql: string,
    // params are ignored for Spanner DDL but kept for interface compatibility
    _params?: unknown[]
  ): Promise<number | AffectedRows> {
    this.ensureConnected(); // Ensures spannerClient and db are available

    if (!this.spannerClient) {
      // Should be caught by ensureConnected if db is not set, but good to be explicit
      throw new Error(
        "Spanner client is not initialized. Call connect() first."
      );
    }
    if (!this.dbPath) {
      throw new Error(
        "Spanner database path is not set. Call connect() first."
      );
    }

    const adminClient = this.spannerClient.getDatabaseAdminClient();

    // Remove trailing semicolon if present, as Spanner DDL API doesn't like it.
    let ddlSql = sql.trim();
    if (ddlSql.endsWith(";")) {
      ddlSql = ddlSql.slice(0, -1);
    }

    console.log(`Executing DDL for Spanner: ${ddlSql.substring(0, 200)}...`); // Log snippet

    try {
      const [operation] = await adminClient.updateDatabaseDdl({
        // Using the on-demand adminClient
        database: this.dbPath, // Using the fully qualified dbPath
        statements: [ddlSql], // Spanner API expects an array of statements
      });

      console.log(
        `DDL operation "${operation.name}" started. Waiting for completion...`
      );

      // Wait for the operation to complete.
      // The promise() method on the operation polls until it's done.
      // The result of promise() is an array, typically [response, metadata, finalOperation]
      // For updateDatabaseDdl, the response is often empty upon success.
      await operation.promise();

      console.log(`DDL operation "${operation.name}" completed successfully.`);
      return { count: 0 }; // DDLs don't have 'affected rows' like DML
    } catch (error) {
      console.error("Error executing DDL with Spanner adapter:", error);
      throw error;
    }
  }

  async query<TResult extends AdapterQueryResultRow = AdapterQueryResultRow>(
    sql: string,
    params?: Record<string, any>,
    types?: Record<string, string>,
    paramTypes?: Record<string, any>,
    _spannerTypeHints?: Record<string, string>
  ): Promise<TResult[]> {
    const db = this.ensureConnected(); // Relies on connect() having awaited this.ready
    try {
      // Merge provided hints with inferred hints
      const mergedHints = mergeTypeHints(spannerTypeHints, params);
      
      // Clean params if they contain JSON
      const cleanedParams = cleanParamsForSpanner(params, mergedHints);
      const paramTypes = transformDdlHintsToParamTypes(mergedHints) as any;
      const types = transformDdlHintsToTypes(mergedHints);

      const queryOptions: any = {
        sql,
        json: true,
        types,
        paramTypes,
      });
      return rows as TResult[];
    } catch (error) {
      console.error("Error executing query with Spanner adapter:", error);
      throw enhanceSpannerError(error, params);
    }
  }

  async queryPrepared<TTable extends TableConfig<any, any>>(
    preparedQuery: PreparedQuery<TTable>
  ): Promise<any[]> {
    // ensureConnected will be called by this.query
    try {
      let spannerParams: Record<string, any> | undefined;

      if (preparedQuery.parameters) {
        if (Array.isArray(preparedQuery.parameters)) {
          // If it's an array (e.g., from raw SQL or a misconfigured call), convert it
          spannerParams = {};
          preparedQuery.parameters.forEach((val, i) => {
            spannerParams![`p${i + 1}`] = val;
          });
        } else {
          // If it's already an object (Record<string, unknown>), use it directly
          // Cast to Record<string, any> as Spanner client expects `any` for values
          spannerParams = preparedQuery.parameters as Record<string, any>;
        }
      }

      const rawResults = await this.query<AdapterQueryResultRow>(
        preparedQuery.sql,
        spannerParams,
        preparedQuery.spannerParamTypeHints
      );

      if (preparedQuery.includeClause && preparedQuery.primaryTable) {
        return shapeResults(
          rawResults,
          preparedQuery.primaryTable,
          preparedQuery.includeClause
        );
      }
      return rawResults;
    } catch (error) {
      console.error(
        "Error executing prepared query with Spanner adapter:",
        error
      );
      throw error;
    }
  }

  async executeAndReturnRows<
    TResult extends AdapterQueryResultRow = AdapterQueryResultRow
  >(
    sql: string,
    params?: Record<string, any>, // Spanner expects Record<string, any>
    types?: Record<string, string>,
    paramTypes?: Record<string, any>
  ): Promise<TResult[]> {
    const db = this.ensureConnected();
    try {
      // Merge provided hints with inferred hints
      const mergedHints = mergeTypeHints(spannerTypeHints, params);
      
      // Clean params if they contain JSON
      const cleanedParams = cleanParamsForSpanner(params, mergedHints);
      const paramTypes = transformDdlHintsToParamTypes(mergedHints) as any;
      const types = transformDdlHintsToTypes(mergedHints);

      // Use runTransactionAsync to ensure a read-write transaction
      return await db.runTransactionAsync(
        async (transaction: SpannerNativeTransaction) => {
          try {
            const queryOptions: any = {
              sql,
              json: true,
              types,
              paramTypes,
            });
            await transaction.commit();
            return rows as TResult[];
          } catch (err) {
            console.error("Error during transaction:", err);
            await transaction.rollback();
            throw enhanceSpannerError(err, params);
          }
        }
      );
    } catch (error) {
      console.error(
        "Error executing DML and returning rows with Spanner adapter:",
        error
      );
      throw enhanceSpannerError(error, params);
    }
  }

  async beginTransaction(): Promise<OrmTransaction> {
    const db = this.ensureConnected(); // Relies on connect() having awaited this.ready
    // Spanner's transactions are typically managed via runTransactionAsync.
    // To return a Transaction object, we'd need to get a transaction object
    // from Spanner and wrap its methods. This is complex because Spanner
    // encourages the callback pattern for retries and context management.

    // For now, this will be a simplified version that might not support
    // all OrmTransaction capabilities perfectly or might rely on a single-use transaction.
    // The main `transaction` method below is preferred for Spanner.

    // This is a placeholder. A true Spanner transaction object for manual control
    // would require more careful handling of the Spanner Transaction object lifecycle.
    // The `runTransactionAsync` pattern is generally safer.
    const spannerTx = db.getTransaction(); // This gets a Transaction object but doesn't start it in the traditional sense.
    // It's more of a context for a single transaction attempt.

    return {
      execute: async (
        sqlCmd: string,
        paramsCmd?: Record<string, any>,
        typesCmd?: Record<string, string>,
        paramTypesCmd?: Record<string, any>
        // _cmdSpannerTypeHints?: Record<string, string>
      ): Promise<number | AffectedRows> => {
        // Note: Spanner transactions are usually committed as a whole.
        // Running individual DMLs and then a separate commit is not the typical pattern.
        // This is a simplified adaptation.
        // Spanner's client library Transaction object does not have a public `begin()` method.
        // Operations are typically run within the `runTransactionAsync` callback.
        // This manual begin/commit/rollback on a getTransaction() object is not standard.
        // We'll make these throw or return a conceptual failure.
        const txObject = spannerTx as any; // Cast to any to access internal-like methods if they existed
        if (typeof txObject.begin === "function") await txObject.begin();
        else
          console.warn(
            "Spanner: conceptual begin() called on transaction object"
          );

        // TODO: Update this to use type hints
        const [rowCountFromRunUpdate] = await txObject.runUpdate({
          sql: sqlCmd,
          params: paramsCmd,
          types: typesCmd,
          paramTypes: paramTypesCmd,
        });
        return { count: rowCountFromRunUpdate };
      },
      query: async <
        TQuery extends AdapterQueryResultRow = AdapterQueryResultRow
      >(
        sqlQuery: string,
        paramsQuery?: Record<string, any>,
        querySpannerTypeHints?: Record<string, string>
      ): Promise<TQuery[]> => {
        const txObjectQuery = spannerTx as any;
        try {
          // Merge provided hints with inferred hints
          const mergedHints = mergeTypeHints(querySpannerTypeHints, paramsQuery);
          
          // Clean params if they contain JSON
          const cleanedParams = cleanParamsForSpanner(paramsQuery, mergedHints);
          const paramTypes = transformDdlHintsToParamTypes(mergedHints) as any;
          const types = transformDdlHintsToTypes(mergedHints);

          const queryOptions: any = {
            sql: sqlQuery,
            json: true,
          };
          
          // Only add params if they exist
          if (cleanedParams !== undefined) {
            queryOptions.params = cleanedParams;
          }
          
          // Add types if provided
          if (types) {
            queryOptions.types = types;
          }
          if (paramTypes) {
            queryOptions.paramTypes = paramTypes;
          }

          const [rows] = await txObjectQuery.run(queryOptions);
          return rows as TQuery[];
        } catch (err) {
          throw enhanceSpannerError(err, paramsQuery);
        }
      },
      commit: async (): Promise<void> => {
        const txObjectCommit = spannerTx as any;
        if (typeof txObjectCommit.commit === "function")
          await txObjectCommit.commit();
        else
          console.warn(
            "Spanner: conceptual commit() called on transaction object"
          );
      },
      rollback: async (): Promise<void> => {
        const txObjectRollback = spannerTx as any;
        if (typeof txObjectRollback.rollback === "function")
          await txObjectRollback.rollback();
        else
          console.warn(
            "Spanner: conceptual rollback() called on transaction object"
          );
      },
    };
  }

  async transaction<T>(
    callback: (txAdapter: OrmTransaction) => Promise<T>
  ): Promise<T> {
    const db = this.ensureConnected(); // Relies on connect() having awaited this.ready
    // Use Spanner's recommended runTransactionAsync pattern
    return db.runTransactionAsync(
      async (gcpTransaction: SpannerNativeTransaction) => {
        const txExecutor: OrmTransaction = {
          execute: async (
            cmdSql,
            cmdParams,
            cmdTypes,
            cmdParamTypes
            // _cmdSpannerTypeHints?: Record<string, string>
          ) => {
            // const paramTypes = transformDdlHintsToParamTypes(
            //   cmdSpannerTypeHints
            // ) as any;
            // const types = transformDdlHintsToTypes(cmdSpannerTypeHints);
            // console.log("Before running gcp transaction runUpdate...");
            // console.log(cmdSql);
            // console.log(cmdParams);
            // console.log(types);
            // console.log(paramTypes);

            const [rowCount] = await gcpTransaction.runUpdate({
              sql: cmdSql,
              params: cmdParams,
              types: cmdTypes,
              paramTypes: cmdParamTypes,
              // types,
              // paramTypes,
            });

            // const [rowCount] = await gcpTransaction.runUpdate({
            //   sql: cmdSql,
            //   params: cmdParams as Record<string, any> | undefined,
            //   paramTypes: transformDdlHintsToParamTypes(
            //     cmdSpannerTypeHints
            //   ) as any,
            // });
            return { count: rowCount };
          },
          query: async (
            querySql,
            queryParams,
            queryTypes,
            queryParamTypes
            // _querySpannerTypeHints?: Record<string, string>
          ) => {
            // const paramTypes = transformDdlHintsToParamTypes(
            //   querySpannerTypeHints
            // ) as any;
            // const types = transformDdlHintsToTypes(querySpannerTypeHints);
            // console.log("Before running gcp query transaction runUpdate...");
            // console.log(querySql);
            // console.log(queryParams);
            // console.log(types);
            // console.log(paramTypes);

            const [rows] = await gcpTransaction.run({
              sql: querySql,
              params: queryParams,
              json: true,
              types: queryTypes,
              paramTypes: queryParamTypes,
            });

            // const [rows] = await gcpTransaction.run({
            //   sql: querySql,
            //   params: queryParams as Record<string, any> | undefined,
            //   json: true,
            //   paramTypes: transformDdlHintsToParamTypes(
            //     querySpannerTypeHints
            //   ) as any,
            // });
            return rows as any[];
          },
          commit: async () => {
            // Commit is handled by runTransactionAsync itself. This is a no-op.
            return Promise.resolve();
          },
          rollback: async () => {
            // Rollback is handled by runTransactionAsync if the callback throws. This is a no-op.
            return Promise.resolve();
          },
        };
        return callback(txExecutor);
      }
    );
  }
}
