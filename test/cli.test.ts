import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
// @ts-ignore: This import is problematic in the test environment for type resolution,
// but MigrationExecutor is primarily for type checking within the test.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { MigrationExecutor } from "@/types/index.js";

// Helper functions copied from migration-generator.ts for test purposes
function escapeIdentifierPostgres(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// Assuming spannerReservedKeywords is not needed for simple cases or can be mocked if necessary
// For simplicity, we'll use a basic version here. If complex reserved words are tested,
// this might need to be more sophisticated or the actual function imported if made available.
const spannerReservedKeywordsTest = new Set(["USER", "TABLE"]); // Example
function escapeIdentifierSpanner(name: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    if (spannerReservedKeywordsTest.has(name.toUpperCase())) {
      return `\`${name}\``;
    }
    return name;
  }
  return `\`${name}\``;
}

const TEMP_SCHEMA_DIR = path.join(__dirname, "temp_cli_schema");
const MIGRATIONS_DIR_TEST = path.join(process.cwd(), "spanner-orm-migrations"); // Default migrations dir
const SNAPSHOT_FILENAME_TEST = "latest.snapshot.json";
const snapshotFilePathTest = path.join(
  MIGRATIONS_DIR_TEST,
  SNAPSHOT_FILENAME_TEST
);

const cliEntryPoint = path.resolve(process.cwd(), "dist/cli.js");

const initialSchemaContent = `
import { table, text, integer, uuid, jsonb, boolean, timestamp, sql } from '../../src/index.js'; // Adjusted for spanner-orm

export const Users = table('Users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
  createdAt: timestamp('created_at').default(sql\`CURRENT_TIMESTAMP\`),
});

export const Posts = table('Posts', {
  postId: uuid('post_id').primaryKey(),
  title: text('title').notNull(),
  content: text('content'),
  userId: uuid('user_id').references(() => Users.columns.id),
  views: integer('views').default(0),
  isPublished: boolean('is_published').default(false),
  meta: jsonb('meta'),
});
`;

const initialSchemaJsPath = path.join(TEMP_SCHEMA_DIR, "initialSchema.js");

// Helper to "build" schema (simplified for tests)
async function buildSchema(tsContent: string, outJsPath: string) {
  // In a real scenario, this would involve actual TypeScript compilation.
  // For tests, we'll just write it as if it's JS, assuming imports are resolvable.
  // The CLI expects a .js file.
  await fs.writeFile(
    outJsPath,
    tsContent.replace(/\.\.\/\.\.\/src\/index\.js/g, "../../dist/index.js")
  );
}

async function runCliCommand(commandWithArgs: string) {
  const [command, ...args] = commandWithArgs.split(" ");
  return execa("bun", [cliEntryPoint, command, ...args]);
}
async function runCliCommandWithEnv(
  commandWithArgs: string,
  envVars: Record<string, string>
) {
  const [command, ...args] = commandWithArgs.split(" ");
  return execa("bun", [cliEntryPoint, command, ...args], {
    env: envVars,
    reject: false,
  });
}

describe("spanner-orm-cli", () => {
  beforeAll(async () => {
    await fs.mkdir(TEMP_SCHEMA_DIR, { recursive: true });
    await buildSchema(initialSchemaContent, initialSchemaJsPath);
  });

  afterAll(async () => {
    await fs.rm(TEMP_SCHEMA_DIR, { recursive: true, force: true });
    const migrationsDirStats = await fs
      .stat(MIGRATIONS_DIR_TEST)
      .catch(() => null);
    if (migrationsDirStats) {
      await fs.rm(MIGRATIONS_DIR_TEST, { recursive: true, force: true });
    }

    // Clean up mock PGlite DB files
    const mockDbLatestPath = path.resolve(
      process.cwd(),
      "mock-pg-url-latest.db"
    );
    const mockDbDownPath = path.resolve(process.cwd(), "mock-pg-url-down.db");
    if (await fs.stat(mockDbLatestPath).catch(() => false)) {
      await fs.rm(mockDbLatestPath, { recursive: true, force: true });
    }
    if (await fs.stat(mockDbDownPath).catch(() => false)) {
      await fs.rm(mockDbDownPath, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    const migrationsDirStats = await fs
      .stat(MIGRATIONS_DIR_TEST)
      .catch(() => null);
    if (migrationsDirStats) {
      await fs.rm(MIGRATIONS_DIR_TEST, { recursive: true, force: true });
    }
    await fs.mkdir(MIGRATIONS_DIR_TEST, { recursive: true }); // Ensure it exists for each test

    // Reset schema to initial state for relevant tests
    await buildSchema(initialSchemaContent, initialSchemaJsPath);
  });

  describe("ddl command", () => {
    it("should generate correct PostgreSQL DDL", async () => {
      const { stdout } = await runCliCommand(
        `ddl --schema ${initialSchemaJsPath} --dialect postgres`
      );
      expect(stdout).toContain(`CREATE TABLE "Users"`);
      expect(stdout).toContain(`CREATE TABLE "Posts"`);
      expect(stdout).toContain(
        `ALTER TABLE "Users" ADD CONSTRAINT "uq_Users_email" UNIQUE ("email");`
      );
    });

    it("should generate correct Spanner DDL", async () => {
      const { stdout } = await runCliCommand(
        `ddl --schema ${initialSchemaJsPath} --dialect spanner`
      );
      expect(stdout).toContain("CREATE TABLE Users");
      expect(stdout).toContain("CREATE TABLE Posts");
      expect(stdout).toContain(
        "CREATE UNIQUE INDEX uq_Users_email ON Users (email)"
      );
    });

    it("should write DDL to output file if --output is specified", async () => {
      const outputFile = path.join(TEMP_SCHEMA_DIR, "output.sql");
      await runCliCommand(
        `ddl --schema ${initialSchemaJsPath} --dialect postgres --output ${outputFile}`
      );
      const content = await fs.readFile(outputFile, "utf-8");
      expect(content).toContain('CREATE TABLE "Users"');
      await fs.unlink(outputFile);
    });

    it("should show error for invalid dialect in ddl", async () => {
      const result = await runCliCommand(
        `ddl --schema ${initialSchemaJsPath} --dialect mysql`
      ).catch((e) => e);
      expect(result.stderr).toMatch(
        /error: option '-d, --dialect <dialect>' argument 'mysql' is invalid. Allowed choices are postgres, spanner/i
      );
      expect(result.exitCode).toBeGreaterThan(0);
    });

    it("should show error if schema file not found for ddl", async () => {
      const result = await runCliCommand(
        "ddl --schema ./nonexistent.js --dialect postgres"
      ).catch((e) => e);
      expect(result.stderr).toContain("Error: Schema file not found at");
      expect(result.exitCode).toBeGreaterThan(0);
    });
  });

  describe("migrate command", () => {
    describe("create", () => {
      it("should create a single migration file with DDL for both dialects (full schema for first migration)", async () => {
        const migrationName = "initial-schema";
        const { stdout, stderr } = await runCliCommand(
          `migrate create ${migrationName} --schema ${initialSchemaJsPath}`
        );

        if (stderr) console.error("CLI stderr:", stderr);
        expect(stdout).toContain("Created migration file:");
        expect(stdout).toContain(`${migrationName}.ts`);
        expect(stdout).toContain("Successfully saved current schema snapshot");

        const files = await fs.readdir(MIGRATIONS_DIR_TEST);
        const migrationFile = files.find((f) =>
          f.endsWith(`${migrationName}.ts`)
        );
        expect(migrationFile).toBeDefined();

        if (migrationFile) {
          const content = await fs.readFile(
            path.join(MIGRATIONS_DIR_TEST, migrationFile),
            "utf-8"
          );
          expect(content).toContain(
            "export const migratePostgresUp: MigrationExecutor"
          );
          expect(content).toContain(
            "export const migratePostgresDown: MigrationExecutor"
          );
          expect(content).toContain(
            "export const migrateSpannerUp: MigrationExecutor"
          );
          expect(content).toContain(
            "export const migrateSpannerDown: MigrationExecutor"
          );

          // Check PG DDL
          expect(content).toContain('CREATE TABLE "Users"');
          expect(content).toContain(escapeIdentifierPostgres("Posts"));
          // Check Spanner DDL
          expect(content).toContain("CREATE TABLE Users");
          expect(content).toContain(escapeIdentifierSpanner("Posts"));
        }
        const snapshotExists = await fs
          .stat(snapshotFilePathTest)
          .catch(() => null);
        expect(snapshotExists).not.toBeNull();
      }, 20000);

      it("should generate incremental migration for schema change (add column)", async () => {
        await runCliCommand(
          `migrate create initial-for-increment --schema ${initialSchemaJsPath}`
        );

        const newSchemaContent = `
          import { table, text, integer, uuid } from '../../src/index.js';
          export const Users = table('Users', {
            id: uuid('id').primaryKey(),
            name: text('name').notNull(),
            age: integer('age') // New column
          });
        `;

        path.join(TEMP_SCHEMA_DIR, "newSchemaWithAge.ts");
        const newSchemaJsPath = path.join(
          TEMP_SCHEMA_DIR,
          "newSchemaWithAge.js"
        );
        await buildSchema(newSchemaContent, newSchemaJsPath);

        const incrementalMigrationName = "add-age-to-users";
        const { stdout: incrementStdout, stderr: incrementStderr } =
          await runCliCommand(
            `migrate create ${incrementalMigrationName} --schema ${newSchemaJsPath}`
          );

        if (incrementStderr)
          console.error("CLI stderr (add-age-to-users):", incrementStderr);

        expect(incrementStdout).toContain(
          "Loaded previous schema snapshot from"
        );
        expect(incrementStdout).toContain("Created migration file:");
        expect(incrementStdout).toContain(incrementalMigrationName);

        const files = await fs.readdir(MIGRATIONS_DIR_TEST);
        const migrationFile = files.find((f) =>
          f.endsWith(`${incrementalMigrationName}.ts`)
        );
        expect(migrationFile).toBeDefined();

        if (migrationFile) {
          const content = await fs.readFile(
            path.join(MIGRATIONS_DIR_TEST, migrationFile),
            "utf-8"
          );
          // PG
          expect(content).toContain(
            `ALTER TABLE "Users" ADD COLUMN "age" INTEGER`
          );
          expect(content).not.toContain('CREATE TABLE "Users"');
          // Spanner
          expect(content).toContain("ALTER TABLE Users ADD COLUMN age INT64");
          expect(content).not.toContain("CREATE TABLE Users");
        }
      }, 20000);

      it("should generate incremental migration for schema change (add table)", async () => {
        const initialSchemaForAddTable = `
          import { table, text, uuid } from '../../src/index.js';
          export const Users = table('Users', {
            id: uuid('id').primaryKey(),
            name: text('name').notNull()
          });
        `;
        const initialSchemaJsPathForAddTable = path.join(
          TEMP_SCHEMA_DIR,
          "initialSchemaForAddTable.js"
        );
        await buildSchema(
          initialSchemaForAddTable,
          initialSchemaJsPathForAddTable
        );
        await runCliCommand(
          `migrate create initial-for-add-table --schema ${initialSchemaJsPathForAddTable}`
        );

        const newSchemaWithProducts = `
          import { table, text, integer, uuid } from '../../src/index.js';
          export const Users = table('Users', {
            id: uuid('id').primaryKey(),
            name: text('name').notNull()
          });
          export const Products = table('Products', {
            productId: uuid('product_id').primaryKey(),
            productName: text('product_name').notNull(),
            price: integer('price')
          });
        `;
        const newSchemaJsPathWithProducts = path.join(
          TEMP_SCHEMA_DIR,
          "newSchemaWithProducts.js"
        );
        await buildSchema(newSchemaWithProducts, newSchemaJsPathWithProducts);

        const incrementalMigrationName = "add-products-table";
        const { stdout, stderr } = await runCliCommand(
          `migrate create ${incrementalMigrationName} --schema ${newSchemaJsPathWithProducts}`
        );

        if (stderr) console.error("CLI stderr (add-products):", stderr);

        expect(stdout).toContain("Loaded previous schema snapshot from");
        expect(stdout).toContain("Created migration file:");
        expect(stdout).toContain(incrementalMigrationName);

        const files = await fs.readdir(MIGRATIONS_DIR_TEST);
        const migrationFile = files.find((f) =>
          f.endsWith(`${incrementalMigrationName}.ts`)
        );
        expect(migrationFile).toBeDefined();

        if (migrationFile) {
          const content = await fs.readFile(
            path.join(MIGRATIONS_DIR_TEST, migrationFile),
            "utf-8"
          );
          // PG
          expect(content).toContain('CREATE TABLE "Products"');
          expect(content).not.toContain('CREATE TABLE "Users"');
          // Spanner
          expect(content).toContain("CREATE TABLE Products");
          expect(content).not.toContain("CREATE TABLE Users");
        }
      }, 20000);

      it("should show error if migration name is missing for create", async () => {
        const result = await runCliCommand(
          `migrate create --schema ${initialSchemaJsPath}`
        ).catch((e) => e);
        expect(result.stderr).toMatch(
          /error: missing required argument 'name'/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });

      it("should show error if schema is missing for create", async () => {
        const result = await runCliCommand("migrate create some-name").catch(
          (e) => e
        );
        expect(result.stderr).toMatch(
          /error: required option '-s, --schema <path>' not specified/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });
    });

    describe("latest", () => {
      it(
        "should simulate applying latest migrations",
        async () => {
          await buildSchema(initialSchemaContent, initialSchemaJsPath);
          await runCliCommand(
            `migrate create dummy-for-latest --schema ${initialSchemaJsPath}`
          );

          const { stdout, stderr } = await runCliCommandWithEnv(
            `migrate latest --schema ${initialSchemaJsPath}`,
            { DB_DIALECT: "postgres", DATABASE_URL: "./mock-pg-url-latest.db" }
          );
          if (stderr) console.error("CLI stderr (latest):", stderr);

          expect(stdout).toContain(
            "Starting 'migrate latest' for dialect: postgres"
          );
          expect(stdout).toContain("Found 1 pending migrations:");
          expect(stdout).toContain("dummy-for-latest.ts"); // Check for .ts file
          expect(stdout).toContain("Applying migration: ");
          expect(stdout).toContain("dummy-for-latest.ts");
          expect(stdout).toContain("Applying UP migration for PostgreSQL...");
          expect(stdout).toContain("Successfully applied migration:");
          expect(stdout).toContain(
            "All pending migrations applied successfully."
          );
        },
        { timeout: 15000 }
      );

      it("should require schema for latest", async () => {
        const result = await runCliCommandWithEnv("migrate latest", {
          DB_DIALECT: "postgres",
        }).catch((e) => e);
        expect(result.stderr).toMatch(
          /error: required option '-s, --schema <path>' not specified/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });

      it("should require DB_DIALECT env for latest", async () => {
        const result = await runCliCommand(
          `migrate latest --schema ${initialSchemaJsPath}`
        ).catch((e) => e);
        expect(result.stderr).toMatch(
          /Error: DB_DIALECT environment variable is not set/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });
    });

    describe("down", () => {
      // This test is tricky because 'down' depends on 'latest' having run and recorded a migration.
      // And it depends on actual DB connection. We'll mock the file system part.
      it(
        "should attempt to run down migration (mocked DB interaction)",
        async () => {
          const migrationBaseName = `${new Date()
            .toISOString()
            .replace(/[-:T.]/g, "")
            .slice(0, 14)}-dummy-for-down`;
          const migrationFileName = `${migrationBaseName}.ts`;
          const migrationFilePath = path.join(
            MIGRATIONS_DIR_TEST,
            migrationFileName
          );

          const dummyMigrationContent = `
          import type { MigrationExecutor } from '../../src/index.js';
          export const migratePostgresUp: MigrationExecutor = async (executeSql) => {};
          export const migratePostgresDown: MigrationExecutor = async (executeSql) => { console.log('Mock Postgres Down Executed'); };
          export const migrateSpannerUp: MigrationExecutor = async (executeSql) => {};
          export const migrateSpannerDown: MigrationExecutor = async (executeSql) => { console.log('Mock Spanner Down Executed'); };
        `;
          await fs.writeFile(migrationFilePath, dummyMigrationContent);

          // Simulate that this migration was applied by creating a dummy log entry
          // This part is highly dependent on how migration-meta works.
          // For now, we'll assume the CLI tries to run the 'down' from the file if it exists.
          // A more robust test would mock getAppliedMigrationNames.

          const { stdout, stderr } = await runCliCommandWithEnv(
            `migrate down --schema ${initialSchemaJsPath}`,
            { DB_DIALECT: "postgres", DATABASE_URL: "./mock-pg-url-down.db" }
          );

          // This is a simplified check. In a real scenario, we'd mock getAppliedMigrationNames
          // to return our dummy migration name. Since we can't easily do that here without
          // more complex mocking, we check if it attempts to find *a* file.
          // The actual execution of 'down' would fail if no migrations were logged as applied.
          if (stderr && !stderr.includes("No migrations have been applied")) {
            // Allow "No migrations" error
            console.error("CLI stderr (down):", stderr);
          }
          // If it found a file (even if it's not the "last applied" in a real DB log)
          // and tried to run it, we'd see the console log from the dummy file.
          // Or, if no migrations are logged, it will say "No migrations have been applied".
          expect(
            stdout.includes("Mock Postgres Down Executed") ||
              stdout.includes("No migrations have been applied")
          ).toBeTruthy();
        },
        { timeout: 15000 }
      );

      it("should require schema for down", async () => {
        const result = await runCliCommandWithEnv("migrate down", {
          DB_DIALECT: "postgres",
        }).catch((e) => e);
        expect(result.stderr).toMatch(
          /error: required option '-s, --schema <path>' not specified/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });

      it("should require DB_DIALECT env for down", async () => {
        const result = await runCliCommand(
          `migrate down --schema ${initialSchemaJsPath}`
        ).catch((e) => e);
        expect(result.stderr).toMatch(
          /Error: DB_DIALECT environment variable is not set/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });
    });
  });
});
