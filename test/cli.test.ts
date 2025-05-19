import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";

const tempSchemaDir = path.join(__dirname, "temp_cli_schema");
// const tempSchemaFile = path.join(tempSchemaDir, "schema.ts");
const tempSchemaJsFile = path.join(tempSchemaDir, "schema.js"); // Output of tsc
const migrationsDir = path.join(process.cwd(), "spanner-orm-migrations"); // Default migrations dir

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

// Helper to create a JS version of the schema for CLI to import
async function createJsSchema() {
  // In a real scenario, this would be a build step (tsc, esbuild, etc.)
  // For testing, we'll just write the content as if it were JS.
  // The import path in schemaContent is already adjusted for dist.
  await fs.writeFile(tempSchemaJsFile, schemaContent);
}

describe("spanner-orm-cli", () => {
  beforeAll(async () => {
    await fs.mkdir(tempSchemaDir, { recursive: true });
    await createJsSchema();
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
      const { stdout } = await execa("node", [
        cliEntryPoint,
        "ddl",
        "--schema",
        tempSchemaJsFile,
        "--dialect",
        "postgres",
      ]);

      const expectedPgDdlUsers = `CREATE TABLE "users" (
  "id" INTEGER NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT UNIQUE,
  PRIMARY KEY ("id")
);`;
      const expectedPgDdlProducts = `CREATE TABLE "products" (
  "sku" TEXT NOT NULL PRIMARY KEY,
  "description" TEXT,
  PRIMARY KEY ("sku")
);`;
      expect(stdout).toContain(expectedPgDdlUsers);
      expect(stdout).toContain(expectedPgDdlProducts);
    });

    it("should generate correct Spanner DDL", async () => {
      const { stdout } = await execa("node", [
        cliEntryPoint,
        "ddl",
        "--schema",
        tempSchemaJsFile,
        "--dialect",
        "spanner",
      ]);

      const expectedSpannerDdlUsers = `CREATE TABLE users (
  id INT64 NOT NULL,
  name STRING(MAX) NOT NULL,
  email STRING(MAX)
) PRIMARY KEY (id);`;
      const expectedSpannerDdlProducts = `CREATE TABLE products (
  sku STRING(MAX) NOT NULL,
  description STRING(MAX)
) PRIMARY KEY (sku);`;
      expect(stdout).toContain(expectedSpannerDdlUsers);
      expect(stdout).toContain(expectedSpannerDdlProducts);
    });

    it("should write DDL to output file if --output is specified", async () => {
      const outputFile = path.join(tempSchemaDir, "output.sql");
      await execa("node", [
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
      const result = await execa("node", [
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
      const result = await execa("node", [
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
      const stats = await fs.stat(migrationsDir).catch(() => null);
      if (stats) {
        await fs.rm(migrationsDir, { recursive: true, force: true });
      }
    });

    describe("create", () => {
      it("should create pg and spanner migration files", async () => {
        const migrationName = "test-migration";
        const { stdout } = await execa("node", [
          cliEntryPoint,
          "migrate",
          "create",
          migrationName,
        ]);

        expect(stdout).toContain("Created PostgreSQL migration file:");
        expect(stdout).toContain(".pg.ts");
        expect(stdout).toContain(migrationName);
        expect(stdout).toContain("Created Spanner migration file:");
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
        }
        if (spannerFile) {
          const content = await fs.readFile(
            path.join(migrationsDir, spannerFile),
            "utf-8"
          );
          expect(content).toContain("export const up: MigrationExecutor");
          expect(content).toContain('currentDialect === "spanner"');
        }
      });

      it("should show error if migration name is missing for create", async () => {
        const result = await execa("node", [
          cliEntryPoint,
          "migrate",
          "create",
        ]).catch((e) => e);
        expect(result.stderr).toMatch(
          /error: missing required argument 'name'/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });
    });

    describe("latest", () => {
      it("should simulate applying latest migrations", async () => {
        // First, create a dummy migration file to simulate 'latest'
        await execa("node", [
          cliEntryPoint,
          "migrate",
          "create",
          "dummy-for-latest",
        ]);

        const { stdout } = await execa("node", [
          cliEntryPoint,
          "migrate",
          "latest",
          "--schema",
          tempSchemaJsFile,
          "--dialect",
          "postgres",
        ]);
        expect(stdout).toContain(
          "Simulating 'migrate latest' for dialect: postgres"
        );
        // Add more specific checks if the simulation output becomes more detailed
      });

      it("should require schema for latest", async () => {
        const result = await execa("node", [
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
        const result = await execa("node", [
          cliEntryPoint,
          "migrate",
          "latest",
          "--schema",
          tempSchemaJsFile,
        ]).catch((e) => e);
        expect(result.stderr).toMatch(
          /error: required option '-d, --dialect <dialect>' not specified/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });
    });

    describe("down", () => {
      it("should simulate reverting last migration", async () => {
        // First, create a dummy migration file to simulate 'down'
        await execa("node", [
          cliEntryPoint,
          "migrate",
          "create",
          "dummy-for-down",
        ]);

        const { stdout } = await execa("node", [
          cliEntryPoint,
          "migrate",
          "down",
          "--schema",
          tempSchemaJsFile,
          "--dialect",
          "spanner",
        ]);
        expect(stdout).toContain(
          "Simulating 'migrate down' for dialect: spanner"
        );
      });

      it("should require schema for down", async () => {
        const result = await execa("node", [
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
        const result = await execa("node", [
          cliEntryPoint,
          "migrate",
          "down",
          "--schema",
          tempSchemaJsFile,
        ]).catch((e) => e);
        expect(result.stderr).toMatch(
          /error: required option '-d, --dialect <dialect>' not specified/i
        );
        expect(result.exitCode).toBeGreaterThan(0);
      });
    });
  });
});
