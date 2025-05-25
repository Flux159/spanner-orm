In migration-runner.ts ensureMigrationTable has a bug for spanner - read it and read getCreateMigrationTableDDL in migration-meta.ts - specifically there's no IF NOT EXISTS in Spanner DDL. You want to do this SQL (using execute not executeDDL):

```sql
SELECT
  *
FROM
  `INFORMATION_SCHEMA`.`TABLES` WHERE `table_name` = "spanner_orm_migrations_log";
```

If that returns 1 row, then it exists, if it returns no rows, then it doesn't exist.
