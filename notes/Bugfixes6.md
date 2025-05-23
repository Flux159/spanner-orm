In our codebase, we generate two different migration files when we generate migrations.

One for .pg.ts (postgres) and one for .spanner.ts (spanner). We should generate a single file and use two different migrate functions for each (so like migratePostgresUp, migratePostgresDown, migrateSpannerUp, migrateSpannerDown). Then when we do a migration giving a dialect, we should use the correct function. This is only a slight refactor since we need to change how we generate, but also need to only use one file during migrations, just different functions from that file depending on dialect.

