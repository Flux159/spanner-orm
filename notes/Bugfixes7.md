Right now in our DDL and DML we have to use tablename.columns.id with ".columns" for referencing any column. However, in most other ORMs you can just do tablename.id and it's added correctly to the root of the table definition rather than inside of a columns object.

We should update our types, the table definitions, and our tests and README to be closer to the non ".columns" ORMs for consistency.

I think you will need to do a search across the entire codebase for this information - maybe starting with the types will help here in organizing your thoughts.
