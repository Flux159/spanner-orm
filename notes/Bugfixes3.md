
In our readme we have this:

1. Create a new migration:

This command generates a pair of timestamped migration files (one for PostgreSQL, one for Spanner) with up and down function templates.

# Example: Create migration files for adding a 'posts' table
# This requires your schema file (e.g., dist/schema.js) to be built and specified.
npx spanner-orm-cli migrate create add-posts-table --schema ./dist/schema.js

# This will create files like:
# ./spanner-orm-migrations/YYYYMMDDHHMMSS-add-posts-table.pg.ts
# ./spanner-orm-migrations/YYYYMMDDHHMMSS-add-posts-table.spanner.ts
# Currently, these files are pre-populated with DDL based on changes detected against an empty schema.
# For true incremental migrations (diffing from the last known state), see task T5.7 in the roadmap.
2. Apply pending migrations:

This command applies all pending migrations to your database for the specified dialect. (Requires database connection to be configured - e.g., via environment variables, specific adapter setup needed).

# Apply latest migrations (dialect determined by DB_DIALECT environment variable)
# Example: export DB_DIALECT=postgres
#          export DATABASE_URL=postgresql://user:pass@host:port/db
npx spanner-orm-cli migrate latest --schema ./dist/schema.js

# Example for Spanner:
# export DB_DIALECT=spanner
# export SPANNER_PROJECT_ID=my-gcp-project
# export SPANNER_INSTANCE_ID=my-spanner-instance
# export SPANNER_DATABASE_ID=my-spanner-database
npx spanner-orm-cli migrate latest --schema ./dist/schema.js

Why do we need to specify the schema as part of migrate latest? We already have a latest.snapshot.json that should tell us which migration was last run so we should only need to do "npx spanner-orm-cli migrate latest" right?

Same with migrate down - shouldn't that take a specific migration name to migrate down instead of schema? That way it will only run that "migrate down" command?

