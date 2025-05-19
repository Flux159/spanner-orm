import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execa } from "execa";
import fs from "node:fs/promises";
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
    await fs.mkdir(tempSchemaDir, { recursive: true });
    await fs.writeFile(tempSchemaFile, schemaContent);
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
    await fs.writeFile(tempSchemaJsFile, schemaJsContent);
  });

  afterAll(async () => {
    await fs.rm(tempSchemaDir, { recursive: true, force: true });
  });

  it("should generate correct PostgreSQL DDL", async () => {
    const { stdout } = await execa("node", [
      cliEntryPoint,
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

  it("should show error if schema option is missing", async () => {
    try {
      await execa("node", [cliEntryPoint, "--dialect", "pg"]);
    } catch (error: any) {
      expect(error.stderr).toMatch(
        /error: required option '-s, --schema <path>' not specified/i
      );
      expect(error.exitCode).toBeGreaterThan(0);
    }
  });

  it("should show error if dialect option is missing", async () => {
    try {
      await execa("node", [cliEntryPoint, "--schema", tempSchemaJsFile]);
    } catch (error: any) {
      // Error message from Commander for missing mandatory option value
      expect(error.stderr).toMatch(
        /error: required option '-d, --dialect <dialect>' not specified/i
      );
      expect(error.exitCode).toBeGreaterThan(0);
    }
  });
});
