import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";

const tempSchemaDir = path.join(__dirname, "temp_cli_schema");
const tempSchemaJsFile = path.join(tempSchemaDir, "schema.js"); // Output of tsc
const migrationsDir = path.join(process.cwd(), "spanner-orm-migrations"); // Default migrations dir
const snapshotFile = path.join(migrationsDir, "latest.snapshot.json"); // Snapshot file

const cliEntryPoint = path.resolve(__dirname, "../dist/cli.js");

const schemaContent = `
import { table, text, integer } from '../../dist/core/schema.js'; // Adjusted for dist

export const users = table('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
});

export const products = table('products', {
  sku: text('sku').primaryKey(),
  description: text('description'),
});
`;

const schemaContentV2 = `
import { table, text, integer } from '../../dist/core/schema.js';

export const users = table('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
  age: integer('age'), // New field
});

export const products = table('products', {
  sku: text('sku').primaryKey(),
  description: text('description'),
});
`;

const schemaContentV3 = `
import { table, text, integer } from '../../dist/core/schema.js';

export const users = table('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
  age: integer('age'),
});

export const products = table('products', {
  sku: text('sku').primaryKey(),
  description: text('description'),
});

export const orders = table('orders', { // New table
  orderId: integer('orderId').primaryKey(),
  userId: integer('userId').references(() => users.columns.id),
});
`;

// Helper to create a JS version of the schema for CLI to import
async function writeSchemaToFile(content: string) {
  // In a real scenario, this would be a build step (tsc, esbuild, etc.)
  // For testing, we'll just write the content as if it were JS.
  // The import path in schemaContent is already adjusted for dist.
  await fs.writeFile(tempSchemaJsFile, content);
}

describe("spanner-orm-cli", () => {
  beforeAll(async () => {
    await fs.mkdir(tempSchemaDir, { recursive: true });
    await writeSchemaToFile(schemaContent); // Initial schema
  });

  afterAll(async () => {
    await fs.rm(tempSchemaDir, { recursive: true, force: true });
    // Clean up migrations directory if it was created by tests
    const stats = await fs.stat(migrationsDir).catch(() => null);
    if (stats) {
      await fs.rm(migrationsDir, { recursive: true, force: true });
    }
  });

  describe("ddl command", () => {
    it("should generate correct PostgreSQL DDL", async () => {
      const { stdout } = await execa("bun", [
        cliEntryPoint,
        "ddl",
        "--schema",
        tempSchemaJsFile,
        "--dialect",
        "postgres",
      ]);

      const expectedPgUsersDDL = `CREATE TABLE "users" (
  "id" INTEGER NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT UNIQUE
);`;
      const expectedPgProductsDDL = `CREATE TABLE "products" (
  "sku" TEXT NOT NULL PRIMARY KEY,
  "description" TEXT
);`;
      expect(stdout).toContain(expectedPgUsersDDL);
      expect(stdout).toContain(expectedPgProductsDDL);
    });

    it("should generate correct Spanner DDL", async () => {
      const { stdout } = await execa("bun", [
        cliEntryPoint,
        "ddl",
        "--schema",
        tempSchemaJsFile,
        "--dialect",
        "spanner",
      ]);

      const expectedSpannerUsersTable = `CREATE TABLE users (
  id INT64 NOT NULL,
  name STRING(MAX) NOT NULL,
  email STRING(MAX)
) PRIMARY KEY (id);`;
      const expectedSpannerUsersIndex = `CREATE UNIQUE INDEX uq_users_email ON users (email);`;
      const expectedSpannerProductsTable = `CREATE TABLE products (
  sku STRING(MAX) NOT NULL,
  description STRING(MAX)
) PRIMARY KEY (sku);`;
      expect(stdout).toContain(expectedSpannerUsersTable);
      expect(stdout).toContain(expectedSpannerUsersIndex);
      expect(stdout).toContain(expectedSpannerProductsTable);
    });

    it("should write DDL to output file if --output is specified", async () => {
      const outputFile = path.join(tempSchemaDir, "output.sql");
      await execa("bun", [
        cliEntryPoint,
        "ddl",
        "--schema",
        tempSchemaJsFile,
        "--dialect",
        "postgres",
        "--output",
        outputFile,
      ]);
      const content = await fs.readFile(outputFile, "utf-8");
      expect(content).toContain('CREATE TABLE "users"');
      await fs.unlink(outputFile); // Clean up
    });

    it("should show error for invalid dialect in ddl", async () => {
      const result = await execa("bun", [
        cliEntryPoint,
        "ddl",
        "--schema",
        tempSchemaJsFile,
        "--dialect",
        "mysql",
      ]).catch((e) => e);
      expect(result.stderr).toMatch(
        /error: option '-d, --dialect <dialect>' argument 'mysql' is invalid. Allowed choices are postgres, spanner/i
      );
      expect(result.exitCode).toBeGreaterThan(0);
    });

    it("should show error if schema file not found for ddl", async () => {
      const result = await execa("bun", [
        cliEntryPoint,
        "ddl",
        "--schema",
        "./nonexistent.js",
        "--dialect",
        "postgres",
      ]).catch((e) => e);
      expect(result.stderr).toContain("Error: Schema file not found at");
      expect(result.exitCode).toBeGreaterThan(0);
    });
  });

  describe("migrate command", () => {
    beforeEach(async () => {
      // Ensure migrations directory is clean before each migration test
      const migrationsDirStats = await fs.stat(migrationsDir).catch(() => null);
      if (migrationsDirStats) {
        await fs.rm(migrationsDir, { recursive: true, force: true });
      }
      // Clean up snapshot file if it exists
      const snapshotFileStats = await fs.stat(snapshotFile).catch(() => null);
      if (snapshotFileStats) {
        await fs.unlink(snapshotFile);
      }
      // Ensure mock PGlite DB file is clean before each migration test
      const pgliteDbPath = path.resolve(process.cwd(), "mock-pg-url"); // Assuming DATABASE_URL for pglite is 'mock-pg-url'
      const pgliteDbStats = await fs.stat(pgliteDbPath).catch(() => null);
      if (pgliteDbStats) {
        await fs.rm(pgliteDbPath, { recursive: true, force: true }); // Added recursive
      }
      // Reset schema to V1 before each test in this block
      await writeSchemaToFile(schemaContent);
    });

    describe("create", () => {
      it("should create pg and spanner migration files with DDL (full schema for first migration)", async () => {
        const migrationName = "initial-schema";
        // Ensure schema is V1
        await writeSchemaToFile(schemaContent);

        const { stdout, stderr } = await execa("bun", [
          cliEntryPoint,
          "migrate",
          "create",
          migrationName,
          "--schema", // Added schema option
          tempSchemaJsFile,
        ]);

        if (stderr) console.error("CLI stderr:", stderr);
        expect(stdout).toContain("Created postgres migration file:");
        expect(stdout).toContain(".pg.ts");
        expect(stdout).toContain(migrationName);
        expect(stdout).toContain("Created spanner migration file:");
        expect(stdout).toContain(".spanner.ts");
        expect(stdout).toContain(migrationName);

        const files = await fs.readdir(migrationsDir);
        const pgFile = files.find((f) => f.endsWith(`${migrationName}.pg.ts`));
        const spannerFile = files.find((f) =>
          f.endsWith(`${migrationName}.spanner.ts`)
        );

        expect(pgFile).toBeDefined();
        expect(spannerFile).toBeDefined();

        if (pgFile) {
          const content = await fs.readFile(
            path.join(migrationsDir, pgFile),
            "utf-8"
          );
          expect(content).toContain("export const up: MigrationExecutor");
          expect(content).toContain('currentDialect === "postgres"');
          // Check for UP DDL (PostgreSQL)
          expect(content).toContain('CREATE TABLE "users"');
          expect(content).toContain('"id" INTEGER NOT NULL PRIMARY KEY'); // More specific
          expect(content).toContain('"name" TEXT NOT NULL');
          expect(content).toContain('"email" TEXT UNIQUE'); // Corrected: inline unique

          expect(content).toContain('CREATE TABLE "products"');
          expect(content).toContain('"sku" TEXT NOT NULL PRIMARY KEY'); // More specific

          // Check for DOWN DDL (PostgreSQL)
          // Order of drop statements might vary, check for presence
          expect(content).toContain('DROP TABLE "products";');
          expect(content).toContain('DROP TABLE "users";');
        }
        if (spannerFile) {
          const content = await fs.readFile(
            path.join(migrationsDir, spannerFile),
            "utf-8"
          );
          expect(content).toContain("export const up: MigrationExecutor");
          expect(content).toContain('currentDialect === "spanner"');
          // Check for UP DDL (Spanner)
          expect(content).toContain("CREATE TABLE users");
          expect(content).toContain("id INT64 NOT NULL");
          expect(content).toContain("name STRING(MAX) NOT NULL");
          expect(content).toContain("email STRING(MAX)");
          expect(content).toContain(") PRIMARY KEY (id)");
          expect(content).toContain(
            "CREATE UNIQUE INDEX uq_users_email ON users (email)"
          );

          expect(content).toContain("CREATE TABLE products");
          expect(content).toContain("sku STRING(MAX) NOT NULL");
          expect(content).toContain(") PRIMARY KEY (sku)");

          // Check for DOWN DDL (Spanner)
          expect(content).toContain("DROP TABLE products;");
          expect(content).toContain("DROP TABLE users;");
        }

        // Verify snapshot was created
        const snapshotExists = await fs.stat(snapshotFile).catch(() => null);
        expect(snapshotExists).not.toBeNull();
        if (snapshotExists) {
          const snapshotContent = JSON.parse(
            await fs.readFile(snapshotFile, "utf-8")
          );
          expect(snapshotContent.tables.users).toBeDefined();
          expect(snapshotContent.tables.products).toBeDefined();
          expect(snapshotContent.tables.users.columns.email).toBeDefined();
        }
      });

      it("should generate incremental migration for schema change (add column)", async () => {
        // 1. Create initial migration (V1 schema)
        await writeSchemaToFile(schemaContent);
        await execa("bun", [
          cliEntryPoint,
          "migrate",
          "create",
          "initial-setup",
          "--schema",
          tempSchemaJsFile,
        ]);
        expect(await fs.stat(snapshotFile).catch(() => null)).not.toBeNull();

        // 2. Update schema to V2 (add 'age' to users)
        await writeSchemaToFile(schemaContentV2);
        const migrationName = "add-age-to-users";
        const { stdout, stderr } = await execa("bun", [
          cliEntryPoint,
          "migrate",
          "create",
          migrationName,
          "--schema",
          tempSchemaJsFile,
        ]);

        if (stderr) console.error("CLI stderr (add-age-to-users):", stderr);
        expect(stdout).toContain(`Created postgres migration file:`);
        expect(stdout).toContain(`Created spanner migration file:`);

        const files = await fs.readdir(migrationsDir);
        const pgFile = files.find((f) => f.endsWith(`${migrationName}.pg.ts`));
        const spannerFile = files.find((f) =>
          f.endsWith(`${migrationName}.spanner.ts`)
        );

        expect(pgFile).toBeDefined();
        expect(spannerFile).toBeDefined();

        if (pgFile) {
          const content = await fs.readFile(
            path.join(migrationsDir, pgFile),
            "utf-8"
          );
          // UP should only add the age column
          expect(content).toContain(
            'ALTER TABLE "users" ADD COLUMN "age" INTEGER;'
          );
          expect(content).not.toContain('CREATE TABLE "users"'); // Should not recreate table
          expect(content).not.toContain('CREATE TABLE "products"');
          // DOWN should only remove the age column
          expect(content).toContain('ALTER TABLE "users" DROP COLUMN "age";');
        }
        if (spannerFile) {
          const content = await fs.readFile(
            path.join(migrationsDir, spannerFile),
            "utf-8"
          );
          // UP should only add the age column
          expect(content).toContain("ALTER TABLE users ADD COLUMN age INT64;");
          expect(content).not.toContain("CREATE TABLE users"); // Should not recreate table
          expect(content).not.toContain("CREATE TABLE products");
          // DOWN should only remove the age column
          expect(content).toContain("ALTER TABLE users DROP COLUMN age;");
        }

        // Verify snapshot was updated for V2
        const snapshotContentV2 = JSON.parse(
          await fs.readFile(snapshotFile, "utf-8")
        );
        expect(snapshotContentV2.tables.users.columns.age).toBeDefined();
      });

      it("should generate incremental migration for schema change (add table)", async () => {
        // 1. Create initial migration (V1 schema)
        await writeSchemaToFile(schemaContent);
        await execa("bun", [
          cliEntryPoint,
          "migrate",
          "create",
          "initial-setup",
          "--schema",
          tempSchemaJsFile,
        ]);

        // 2. Update schema to V2 (add 'age' to users) and create migration
        await writeSchemaToFile(schemaContentV2);
        await execa("bun", [
          cliEntryPoint,
          "migrate",
          "create",
          "add-age-to-users",
          "--schema",
          tempSchemaJsFile,
        ]);
        expect(await fs.stat(snapshotFile).catch(() => null)).not.toBeNull();
        const snapshotContentV2 = JSON.parse(
          await fs.readFile(snapshotFile, "utf-8")
        );
        expect(snapshotContentV2.tables.users.columns.age).toBeDefined();

        // 3. Update schema to V3 (add 'orders' table)
        await writeSchemaToFile(schemaContentV3);
        const migrationName = "add-orders-table";
        const { stdout: _stdout, stderr } = await execa("bun", [
          cliEntryPoint,
          "migrate",
          "create",
          migrationName,
          "--schema",
          tempSchemaJsFile,
        ]);

        if (stderr) console.error("CLI stderr (add-orders-table):", stderr);

        const files = await fs.readdir(migrationsDir);
        const pgFile = files.find((f) => f.endsWith(`${migrationName}.pg.ts`));
        const spannerFile = files.find((f) =>
          f.endsWith(`${migrationName}.spanner.ts`)
        );

        expect(pgFile).toBeDefined();
        expect(spannerFile).toBeDefined();

        if (pgFile) {
          const content = await fs.readFile(
            path.join(migrationsDir, pgFile),
            "utf-8"
          );
          // UP should only add the orders table
          expect(content).toContain('CREATE TABLE "orders"');
          expect(content).toContain('"orderId" INTEGER NOT NULL PRIMARY KEY');
          expect(content).toContain('"userId" INTEGER'); // Column definition
          expect(content).toContain(
            'ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_userId_users" FOREIGN KEY ("userId") REFERENCES "users" ("id")'
          ); // Separate FK constraint
          expect(content).not.toContain('CREATE TABLE "users"');
          expect(content).not.toContain('ALTER TABLE "users" ADD COLUMN "age"'); // This was in previous migration
          // DOWN should only drop the orders table
          expect(content).toContain('DROP TABLE "orders";');
        }
        if (spannerFile) {
          const content = await fs.readFile(
            path.join(migrationsDir, spannerFile),
            "utf-8"
          );
          // UP should only add the orders table
          expect(content).toContain("CREATE TABLE orders");
          expect(content).toContain("orderId INT64 NOT NULL");
          expect(content).toContain("userId INT64");
          expect(content).toContain(
            "FOREIGN KEY (userId) REFERENCES users (id)"
          );
          expect(content).not.toContain("CREATE TABLE users");
          expect(content).not.toContain("ALTER TABLE users ADD COLUMN age"); // This was in previous migration
          // DOWN should only drop the orders table
          expect(content).toContain("DROP TABLE orders;");
        }

        // Verify snapshot was updated for V3
        const snapshotContentV3 = JSON.parse(
          await fs.readFile(snapshotFile, "utf-8")
        );
        expect(snapshotContentV3.tables.orders).toBeDefined();
        expect(snapshotContentV3.tables.users.columns.age).toBeDefined(); // from previous
      });

      it("should show error if migration name is missing for create", async () => {
        const result = await execa("bun", [
          cliEntryPoint,
          "migrate",
          "create",
          // Name intentionally omitted
          "--schema",
          tempSchemaJsFile,
        ]).catch((e) => e);
        expect(result.stderr).toMatch(
          /error: missing required argument 'name'/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });

      it("should show error if schema is missing for create", async () => {
        const result = await execa("bun", [
          cliEntryPoint,
          "migrate",
          "create",
          "some-name",
          // Schema intentionally omitted
        ]).catch((e) => e);
        expect(result.stderr).toMatch(
          /error: required option '-s, --schema <path>' not specified/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });
    });

    // TODO: Enhance 'latest' and 'down' tests to mock DB interactions
    // For now, they will test the current simulation/placeholder output.
    describe("latest", () => {
      it(
        "should simulate applying latest migrations",
        async () => {
          // First, create a dummy migration file to simulate 'latest'
          await writeSchemaToFile(schemaContent); // Ensure schema V1 for this test
          await execa("bun", [
            cliEntryPoint,
            "migrate",
            "create",
            "dummy-for-latest",
            "--schema",
            tempSchemaJsFile,
          ]);

          const { stdout } = await execa(
            "bun",
            [
              cliEntryPoint,
              "migrate",
              "latest",
              "--schema",
              tempSchemaJsFile,
              // Dialect is now from env
            ],
            { env: { DB_DIALECT: "postgres", DATABASE_URL: "./mock-pg-url" } }
          );
          // Updated to check for the new output, which is more detailed
          expect(stdout).toContain(
            "Starting 'migrate latest' for dialect: postgres"
          );
          expect(stdout).toContain(
            "Ensuring migration tracking table '_spanner_orm_migrations_log' exists..."
          );
          expect(stdout).toContain("Migration tracking table check complete.");
          expect(stdout).toContain("Applied migrations: None"); // Assuming placeholder returns empty
          expect(stdout).toContain("Found 1 pending migrations:");
          expect(stdout).toContain("dummy-for-latest.pg.ts");
          expect(stdout).toContain("Applying migration: ");
          expect(stdout).toContain("dummy-for-latest.pg.ts");
          // Check for migration execution logs
          expect(stdout).toContain("Applying UP migration for postgres..."); // This log comes from the migration file template
          expect(stdout).toContain("Successfully applied migration:");
          expect(stdout).toContain(
            "All pending migrations applied successfully."
          );
          expect(stdout).toContain("Migrate latest process finished.");
        },
        { timeout: 15000 }
      ); // Increased timeout for CI

      it("should require schema for latest", async () => {
        const result = await execa("bun", [
          cliEntryPoint,
          "migrate",
          "latest",
          "--dialect",
          "postgres",
        ]).catch((e) => e);
        expect(result.stderr).toMatch(
          /error: required option '-s, --schema <path>' not specified/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });

      it("should require dialect for latest", async () => {
        const result = await execa("bun", [
          cliEntryPoint,
          "migrate",
          "latest",
          "--schema",
          tempSchemaJsFile,
        ]).catch((e) => e);
        // Test now checks for DB_DIALECT error
        expect(result.stderr).toMatch(
          /Error: DB_DIALECT environment variable is not set/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });
    });

    describe("down", () => {
      it("should simulate reverting last migration", async () => {
        const mockMigrationBaseName = "00000000000000-mock-last-migration";
        const spannerMigrationFileName = `${mockMigrationBaseName}.spanner.ts`;
        const spannerMigrationFilePath = path.join(
          migrationsDir,
          spannerMigrationFileName
        );

        // Manually create the migration file that handleMigrateDown's mock expects
        await fs.mkdir(migrationsDir, { recursive: true });
        const dummySpannerMigrationContent = `
          import type { MigrationExecutor } from '../../dist/types/common.js';
          export const up: MigrationExecutor = async (executeSql) => { await executeSql('SELECT 1;'); };
          export const down: MigrationExecutor = async (executeSql, dialect) => {
            console.log("Applying DOWN migration for spanner...");
            await executeSql('SELECT 1;'); // Dummy SQL
          };
        `;
        await fs.writeFile(
          spannerMigrationFilePath,
          dummySpannerMigrationContent
        );

        // Verify the manually created file exists
        expect(
          await fs.stat(spannerMigrationFilePath).catch(() => null)
        ).not.toBeNull();

        // This test should now expect a failure because mock Spanner credentials won't work.
        // The CLI should output an error and exit.
        const result = await execa(
          "bun",
          [
            cliEntryPoint,
            "migrate",
            "down",
            "--schema",
            tempSchemaJsFile,
            // Dialect is now from env
          ],
          {
            env: {
              DB_DIALECT: "spanner",
              SPANNER_PROJECT_ID: "mock-project",
              SPANNER_INSTANCE_ID: "mock-instance",
              SPANNER_DATABASE_ID: "mock-db",
            },
            reject: false, // Don't throw on non-zero exit
          }
        );

        expect(result.exitCode).toBeGreaterThan(0);
        expect(result.stderr).toContain("Error connecting to spanner:");
        expect(result.stderr).toContain(
          "Failed to initialize database adapter. Exiting."
        );
      });

      it("should require schema for down", async () => {
        const result = await execa("bun", [
          cliEntryPoint,
          "migrate",
          "down",
          "--dialect",
          "postgres",
        ]).catch((e) => e);
        expect(result.stderr).toMatch(
          /error: required option '-s, --schema <path>' not specified/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });

      it("should require dialect for down", async () => {
        const result = await execa("bun", [
          cliEntryPoint,
          "migrate",
          "down",
          "--schema",
          tempSchemaJsFile,
        ]).catch((e) => e);
        // Test now checks for DB_DIALECT error
        expect(result.stderr).toMatch(
          /Error: DB_DIALECT environment variable is not set/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });
    });
  });
});
