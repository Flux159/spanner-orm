import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { execa } from "execa";
import fsPromises from "node:fs/promises";
import fsSync from "node:fs"; // For existsSync
import path from "node:path";

const tempSchemaDir = path.join(__dirname, "temp_cli_schema");
const tempSchemaFile = path.join(tempSchemaDir, "schema.ts");
const tempSchemaJsFile = path.join(tempSchemaDir, "schema.js"); // Output of tsc

const cliEntryPoint = path.resolve(__dirname, "../dist/cli.js"); // Adjust if your entry point is different

const schemaContent = `
import { table, text, integer } from '../src/core/schema.js'; // Adjust path based on actual structure

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

describe("CLI DDL Generation", () => {
  beforeAll(async () => {
    await fsPromises.mkdir(tempSchemaDir, { recursive: true });
    await fsPromises.writeFile(tempSchemaFile, schemaContent);
    // We need to "compile" this TS schema to JS for the CLI to import it,
    // as the CLI runs on the built .js files.
    // A simple way is to just copy and rename for this test, assuming direct import works.
    // For a more robust test, you might invoke tsc or esbuild.
    // For now, we'll assume the CLI can import .ts if ts-node or similar is used,
    // or that we are testing against a .js file.
    // The CLI currently imports .js, so we need a .js file.
    // Let's simulate a build step for this dummy schema.
    // This is a simplified approach. A real build step might be more complex.
    const schemaJsContent = schemaContent
      .replace(/'\.\.\/src\/core\/schema\.js'/g, "'../../dist/core/schema.js'") // Adjust import for JS output to point to dist
      .replace(/\.js';/g, ".js';"); // Ensure .js extension if not already
    await fsPromises.writeFile(tempSchemaJsFile, schemaJsContent);
  });

  afterAll(async () => {
    await fsPromises.rm(tempSchemaDir, { recursive: true, force: true });
  });

  it("should generate correct PostgreSQL DDL", async () => {
    const { stdout } = await execa("node", [
      cliEntryPoint,
      "generate-ddl",
      "--schema",
      tempSchemaJsFile,
      "--dialect",
      "pg",
    ]);

    const expectedPgDdlUsers = `CREATE TABLE "users" (
  "id" INTEGER NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT UNIQUE,
  PRIMARY KEY ("id")
);`; // Note: Drizzle often puts PK on column for single, and table level for composite. Our generator might do both or one.
    // Let's assume our generator does it like this for now.

    const expectedPgDdlProducts = `CREATE TABLE "products" (
  "sku" TEXT NOT NULL PRIMARY KEY,
  "description" TEXT,
  PRIMARY KEY ("sku")
);`;

    expect(stdout).toContain(expectedPgDdlUsers);
    expect(stdout).toContain(expectedPgDdlProducts);
    // A more precise test would check the full output if order is guaranteed.
    // For now, checking containment is fine.
  });

  it("should generate correct Spanner DDL", async () => {
    const { stdout } = await execa("node", [
      cliEntryPoint,
      "generate-ddl",
      "--schema",
      tempSchemaJsFile,
      "--dialect",
      "spanner",
    ]);

    const expectedSpannerDdlUsers = `CREATE TABLE users (
  id INT64 NOT NULL,
  name STRING(MAX) NOT NULL,
  email STRING(MAX)
) PRIMARY KEY (id);`; // Spanner unique index for email would be separate.

    const expectedSpannerDdlProducts = `CREATE TABLE products (
  sku STRING(MAX) NOT NULL,
  description STRING(MAX)
) PRIMARY KEY (sku);`;

    expect(stdout).toContain(expectedSpannerDdlUsers);
    expect(stdout).toContain(expectedSpannerDdlProducts);
  });

  it("should show error for invalid dialect", async () => {
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
      // Error message from Commander for invalid choice
      expect(error.stderr).toMatch(
        /error: option '-d, --dialect <dialect>' argument 'mysql' is invalid. Allowed choices are pg, spanner/i
      );
      expect(error.exitCode).toBeGreaterThan(0);
    }
  });

  it("should show error if schema file not found", async () => {
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

  it("should show error if schema option is missing for generate-ddl", async () => {
    try {
      await execa("node", [cliEntryPoint, "generate-ddl", "--dialect", "pg"]);
    } catch (error: any) {
      expect(error.stderr).toMatch(
        /error: required option '-s, --schema <path>' not specified/i
      );
      expect(error.exitCode).toBeGreaterThan(0);
    }
  });

  it("should show error if dialect option is missing for generate-ddl", async () => {
    try {
      await execa("node", [
        cliEntryPoint,
        "generate-ddl",
        "--schema",
        tempSchemaJsFile,
      ]);
    } catch (error: any) {
      // Error message from Commander for missing mandatory option value
      expect(error.stderr).toMatch(
        /error: required option '-d, --dialect <dialect>' not specified/i
      );
      expect(error.exitCode).toBeGreaterThan(0);
    }
  });
});

describe("CLI Migration Commands", () => {
  const migrationsDir = path.join(__dirname, "temp_migrations_dir");
  const cliCmd = "node";
  const cliArgsBase = [cliEntryPoint, "migrate"];

  beforeAll(async () => {
    // Ensure migrations directory exists and is clean before all tests in this describe block
    await fsPromises.rm(migrationsDir, { recursive: true, force: true });
    await fsPromises.mkdir(migrationsDir, { recursive: true });
  });

  afterAll(async () => {
    // Clean up migrations directory after all tests
    await fsPromises.rm(migrationsDir, { recursive: true, force: true });
  });

  describe("migrate create", () => {
    const migrationName = "test_create_users";
    let createdMigrationFileName: string | undefined;

    // Clean up any specific migration file created by a test
    afterEach(async () => {
      if (createdMigrationFileName) {
        const filePath = path.join(migrationsDir, createdMigrationFileName);
        try {
          await fsPromises.unlink(filePath);
        } catch (e) {
          // ignore if file doesn't exist
        }
        createdMigrationFileName = undefined;
      }
      // Re-ensure the main migrations dir exists if a test accidentally removed it
      await fsPromises.mkdir(migrationsDir, { recursive: true });
    });

    it("should create a new migration file with correct name format", async () => {
      const { stdout } = await execa(cliCmd, [
        ...cliArgsBase,
        "create",
        "--name",
        migrationName,
      ]);

      const files = await fsPromises.readdir(migrationsDir);
      expect(files.length).toBe(1);
      createdMigrationFileName = files[0];

      expect(createdMigrationFileName).toMatch(
        /^\d{14}_test_create_users\.ts$/
      );
      expect(stdout).toContain(
        `Created migration file: ${path.join(
          migrationsDir,
          createdMigrationFileName
        )}`
      );
    });

    it("should create a migration file with correct placeholder content", async () => {
      await execa(cliCmd, [...cliArgsBase, "create", "--name", migrationName]);
      const files = await fsPromises.readdir(migrationsDir);
      createdMigrationFileName = files[0];
      const filePath = path.join(migrationsDir, createdMigrationFileName);
      const content = await fsPromises.readFile(filePath, "utf-8");

      expect(content).toContain(`// Migration: ${migrationName}`);
      expect(content).toContain(
        "export async function upPg(): Promise<string[]> {"
      );
      expect(content).toContain(
        "export async function downPg(): Promise<string[]> {"
      );
      expect(content).toContain(
        "export async function upSpanner(): Promise<string[]> {"
      );
      expect(content).toContain(
        "export async function downSpanner(): Promise<string[]> {"
      );
      expect(content).toContain("// Add your PostgreSQL DDL statements here");
      expect(content).toContain(
        "// Add your Google Spanner DDL statements here"
      );
    });

    it("should create the migrations directory if it does not exist", async () => {
      const tempSubMigrationsDir = path.join(migrationsDir, "sub_test_dir");
      await fsPromises.rm(tempSubMigrationsDir, {
        recursive: true,
        force: true,
      }); // Ensure it's gone

      // Modify the CLI command to attempt creation in a non-existent directory
      // This requires modifying the CLI's internal logic for where it creates files,
      // or testing the side effect of the main migrationsDir creation.
      // The current CLI creates 'migrations' in CWD.
      // For this test, we'll rely on the fact that `migrate create` creates `process.cwd()/migrations`
      // So, we'll temporarily rename the main migrationsDir, run create, and check if it's recreated.

      const originalMigrationsDir = path.join(process.cwd(), "migrations");
      const backupMigrationsDir = path.join(
        process.cwd(),
        "migrations_backup_test"
      );

      let wasOriginalMoved = false;
      try {
        await fsPromises.rename(originalMigrationsDir, backupMigrationsDir);
        wasOriginalMoved = true;
      } catch (e) {
        // If originalMigrationsDir doesn't exist, that's fine, the command should create it.
      }

      // Now run the command, it should create `process.cwd()/migrations`
      const { stdout } = await execa(cliCmd, [
        ...cliArgsBase,
        "create",
        "--name",
        "dir_creation_test",
      ]);

      const newMigrationFile = stdout
        .split("Created migration file: ")[1]
        ?.trim();
      expect(newMigrationFile).toBeDefined();
      if (newMigrationFile) {
        createdMigrationFileName = path.basename(newMigrationFile); // Store for cleanup
        // Check if the directory was created by the command
        const newMigrationsDirPath = path.dirname(newMigrationFile);
        expect(fsSync.existsSync(newMigrationsDirPath)).toBe(true);
        // And that it's the one in CWD
        expect(newMigrationsDirPath).toBe(originalMigrationsDir);
      }

      // Cleanup: remove the newly created dir and file, then restore backup if needed
      if (newMigrationFile && fsSync.existsSync(newMigrationFile))
        await fsPromises.unlink(newMigrationFile);
      if (fsSync.existsSync(originalMigrationsDir))
        await fsPromises.rm(originalMigrationsDir, {
          recursive: true,
          force: true,
        });

      if (wasOriginalMoved) {
        try {
          await fsPromises.rename(backupMigrationsDir, originalMigrationsDir);
        } catch (e) {
          // If restoration fails, it might be because the test created the dir again.
          // Ensure cleanup of backup dir if it still exists.
          if (fsSync.existsSync(backupMigrationsDir))
            await fsPromises.rm(backupMigrationsDir, {
              recursive: true,
              force: true,
            });
        }
      }
      // Ensure our test-specific migrationsDir is back for other tests
      await fsPromises.mkdir(migrationsDir, { recursive: true });
    });

    it("should show error if name option is missing for create", async () => {
      try {
        await execa(cliCmd, [...cliArgsBase, "create"]);
      } catch (error: any) {
        expect(error.stderr).toMatch(
          /error: required option '-n, --name <name>' not specified/i
        );
        expect(error.exitCode).toBeGreaterThan(0);
      }
    });
  });

  describe("migrate latest", () => {
    it("should output 'Not yet implemented' message", async () => {
      const { stdout, stderr } = await execa(cliCmd, [
        ...cliArgsBase,
        "latest",
      ]);
      expect(stderr).toBe(""); // No errors
      expect(stdout).toContain("Applying latest migrations...");
      expect(stdout).toContain(
        "Functionality for 'migrate latest' is not yet implemented."
      );
    });
  });

  describe("migrate down", () => {
    it("should output 'Not yet implemented' message", async () => {
      const { stdout, stderr } = await execa(cliCmd, [...cliArgsBase, "down"]);
      expect(stderr).toBe(""); // No errors
      expect(stdout).toContain("Rolling back last migration...");
      expect(stdout).toContain(
        "Functionality for 'migrate down' is not yet implemented."
      );
    });
  });
});
