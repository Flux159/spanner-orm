import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";

const tempTestDir = path.join(__dirname, "temp_cli_test_data");
const tempSchemaDir = path.join(tempTestDir, "schema");
const tempMigrationsDir = path.join(tempTestDir, "spanner-orm-migrations"); // Default migrations dir

const tempSchemaFile = path.join(tempSchemaDir, "schema.ts");
const tempSchemaJsFile = path.join(tempSchemaDir, "schema.js");

const cliEntryPoint = path.resolve(__dirname, "../dist/cli.js");

const schemaContent = `
import { table, text, integer } from '../../../src/core/schema.js'; // Corrected path for replacement

export const users = table('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
});

export const products = table('products', {
  sku: text('sku').primaryKey(),
  description: text('description'),
});
`; // Added semicolon

// Example of a schema with tables nested under a 'schema' export
export const nestedSchemaContent = `
import { table, text, integer } from '../../../src/core/schema.js'; // Corrected path

const notes = table('notes', {
  id: integer('id').primaryKey(),
  content: text('content'),
});

export const schema = {
  notesTable: notes,
};
`; // Added semicolon
const tempNestedSchemaFile = path.join(tempSchemaDir, "nestedSchema.ts");
const tempNestedSchemaJsFile = path.join(tempSchemaDir, "nestedSchema.js");

describe("CLI Operations", () => {
  beforeAll(async () => {
    await fs.mkdir(tempSchemaDir, { recursive: true });
    await fs.writeFile(tempSchemaFile, schemaContent);

    // Simulate JS build for schema.ts
    // The source schemaContent uses '../../../src/core/schema.js'
    // The compiled tempSchemaJsFile needs to point to the compiled dist output
    const schemaJsContent = schemaContent.replace(
      /'\.\.\/\.\.\/\.\.\/src\/core\/schema\.js'/g,
      "'../../../dist/core/schema.js'"
    );
    await fs.writeFile(tempSchemaJsFile, schemaJsContent);

    // Simulate JS build for nestedSchema.ts
    await fs.writeFile(tempNestedSchemaFile, nestedSchemaContent);
    const nestedSchemaJsContent = nestedSchemaContent.replace(
      /'\.\.\/\.\.\/\.\.\/src\/core\/schema\.js'/g, // Target the corrected path
      "'../../../dist/core/schema.js'"
    );
    await fs.writeFile(tempNestedSchemaJsFile, nestedSchemaJsContent);
  });

  afterAll(async () => {
    await fs.rm(tempTestDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clean up migrations directory before each migration test
    await fs
      .rm(tempMigrationsDir, { recursive: true, force: true })
      .catch(() => {});
    // Recreate it for tests that expect it to exist (or let the CLI create it)
  });

  describe("DDL Generation (generate-ddl command)", () => {
    it("should generate correct PostgreSQL DDL", async () => {
      const { stdout } = await execa("node", [
        cliEntryPoint,
        "generate-ddl", // Subcommand
        "--schema",
        tempSchemaJsFile,
        "--dialect",
        "pg",
      ]);

      const expectedPgDdlUsers = `CREATE TABLE "users" (
  "id" INTEGER NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT UNIQUE
);`;
      // Removed PRIMARY KEY ("id") as it's usually on the column for single PKs
      // and our generator might only do it once.

      const expectedPgDdlProducts = `CREATE TABLE "products" (
  "sku" TEXT NOT NULL PRIMARY KEY,
  "description" TEXT
);`;

      expect(stdout).toContain(expectedPgDdlUsers);
      expect(stdout).toContain(expectedPgDdlProducts);
    });

    it("should generate DDL from nested schema export", async () => {
      const { stdout } = await execa("node", [
        cliEntryPoint,
        "generate-ddl",
        "--schema",
        tempNestedSchemaJsFile, // Use the schema with nested tables
        "--dialect",
        "pg",
      ]);
      const expectedPgDdlNotes = `CREATE TABLE "notes" (
  "id" INTEGER NOT NULL PRIMARY KEY,
  "content" TEXT
);`;
      expect(stdout).toContain(expectedPgDdlNotes);
    });

    it("should generate correct Spanner DDL", async () => {
      const { stdout } = await execa("node", [
        cliEntryPoint,
        "generate-ddl", // Subcommand
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

    it("should show error for invalid dialect for generate-ddl", async () => {
      try {
        await execa("node", [
          cliEntryPoint,
          "generate-ddl",
          "--schema",
          tempSchemaJsFile,
          "--dialect",
          "mysql",
        ]);
      } catch (error: any) {
        expect(error.stderr).toMatch(
          /error: option '-d, --dialect <dialect>' argument 'mysql' is invalid. Allowed choices are pg, spanner/i
        );
        expect(error.exitCode).toBeGreaterThan(0);
      }
    });

    it("should show error if schema file not found for generate-ddl", async () => {
      try {
        await execa("node", [
          cliEntryPoint,
          "generate-ddl",
          "--schema",
          "./nonexistent.js",
          "--dialect",
          "pg",
        ]);
      } catch (error: any) {
        expect(error.stderr).toContain("Error: Schema file not found at");
        expect(error.exitCode).toBeGreaterThan(0);
      }
    });
  }); // End of DDL Generation describe

  describe("Migration Commands (migrate)", () => {
    const defaultMigrationsPath = path.join(
      process.cwd(),
      "spanner-orm-migrations"
    ); // Relative to where CLI is run from (project root)

    beforeEach(async () => {
      // Ensure the default migration directory is clean before each test in this suite
      await fs
        .rm(defaultMigrationsPath, { recursive: true, force: true })
        .catch(() => {});
    });

    afterAll(async () => {
      // Clean up default migration directory after all tests in this suite
      await fs
        .rm(defaultMigrationsPath, { recursive: true, force: true })
        .catch(() => {});
    });

    it("migrate create <name> should create a new migration file in default directory", async () => {
      const migrationName = "my_test_migration";
      const { stdout, exitCode } = await execa("node", [
        cliEntryPoint,
        "migrate",
        "create",
        migrationName,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain(`Created migration: \${defaultMigrationsPath}`); // Check part of path

      const files = await fs.readdir(defaultMigrationsPath);
      const migrationFile = files.find(
        (f) => f.includes(migrationName) && f.endsWith(".ts")
      );
      expect(migrationFile).toBeDefined();

      if (migrationFile) {
        const content = await fs.readFile(
          path.join(defaultMigrationsPath, migrationFile),
          "utf-8"
        );
        expect(content).toContain(`// Migration: ${migrationName}`);
        expect(content).toContain("export const up: Migration = {");
        expect(content).toContain("export const down: Migration = {");
        expect(content).toContain(
          'import type { Migration } from "spanner-orm";'
        );
      }
    });

    it("migrate create <name> --outDir should create file in specified directory", async () => {
      const migrationName = "another_migration";
      const customMigrationsPath = path.join(
        tempTestDir,
        "custom_migrations_dir"
      );

      // Clean custom dir before test
      await fs
        .rm(customMigrationsPath, { recursive: true, force: true })
        .catch(() => {});

      const { stdout, exitCode } = await execa("node", [
        cliEntryPoint,
        "migrate",
        "create",
        migrationName,
        "--outDir",
        customMigrationsPath,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain(`Created migration: ${customMigrationsPath}`);

      const files = await fs.readdir(customMigrationsPath);
      const migrationFile = files.find(
        (f) => f.includes(migrationName) && f.endsWith(".ts")
      );
      expect(migrationFile).toBeDefined();

      // Clean up custom dir after test
      await fs
        .rm(customMigrationsPath, { recursive: true, force: true })
        .catch(() => {});
    });

    it("migrate latest should require --dialect", async () => {
      try {
        await execa("node", [cliEntryPoint, "migrate", "latest"]);
      } catch (error: any) {
        expect(error.stderr).toContain(
          "error: required option '--dialect <dialect>' not specified"
        );
        expect(error.exitCode).toBeGreaterThan(0);
      }
    });

    it("migrate down should require --dialect", async () => {
      try {
        await execa("node", [cliEntryPoint, "migrate", "down"]);
      } catch (error: any) {
        expect(error.stderr).toContain(
          "error: required option '--dialect <dialect>' not specified"
        );
        expect(error.exitCode).toBeGreaterThan(0);
      }
    });

    // Placeholder tests for 'latest' and 'down' as they are not fully implemented
    it("migrate latest --dialect pg should output placeholder message", async () => {
      const { stdout } = await execa("node", [
        cliEntryPoint,
        "migrate",
        "latest",
        "--dialect",
        "pg",
      ]);
      expect(stdout).toContain("Running 'migrate latest' for dialect: pg");
      expect(stdout).toContain("This command is not yet fully implemented");
    });

    it("migrate down --dialect spanner should output placeholder message", async () => {
      const { stdout } = await execa("node", [
        cliEntryPoint,
        "migrate",
        "down",
        "--dialect",
        "spanner",
      ]);
      expect(stdout).toContain("Running 'migrate down' for dialect: spanner");
      expect(stdout).toContain("This command is not yet fully implemented");
    });
  }); // End of Migration Commands describe
});
