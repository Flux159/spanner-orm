Right now in our DDL and DML we have to use tablename.columns.id with ".columns" for referencing any column. However, in most other ORMs you can just do tablename.id and it's added correctly to the root of the table definition rather than inside of a columns object.

We should update our types, the table definitions, and our tests and README to be closer to the non ".columns" ORMs for consistency.

We also don't want to use "\_name, \_indexes, etc." everywhere because that doesn't make sense from an API perspective either. If there's a column that overlaps, then we should stick with ".columns" (rename name to tableName, and indexes to tableIndexes so that it's less common to overlap by the way).

I think you will need to do a search across the entire codebase for this information - maybe starting with the types will help here in organizing your thoughts.
