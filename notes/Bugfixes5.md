When we created a second migration for a new table (posts), we have a bug where the latest.snapshot.json did not have the correct information. Specifically look at spanner-orm-migrations/20250522175251-add-posts-table.pg.ts and how it has `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP` (there's something similar for spanner too).

In the follow up migration spanner-orm-migrations/20250522175732-add-posts.pg.ts - we see that there's an alter column changing it to CURRENT_TIMESTAMP again:

```javascript
await executeSql(
  `ALTER TABLE "uploads" ALTER COLUMN "createdAt" DEFAULT CURRENT_TIMESTAMP;`
);
```

That same migration actually gives us a hint, in the migrate down portion, it has:

```javascript
await executeSql(
  `ALTER TABLE "uploads" ALTER COLUMN "createdAt" DEFAULT '{"_isSQL":true}';`
);
```

This was a previous bug that was fixed at initial generation (from an empty schema), but I think it wasn't fixed up from an existing `latest.snapshot.json` - and infact if you look at the spanner-orm-migrations/latest.snapshot.json you can still see this in different schemas:

```
"default": {
    "_isSQL": true
}
```

However it shouldn't be using this for migrations since the actual default for posts should be CURRENT_TIMESTAMP.

I believe that this is a bug in generating follow up migrations - please look into fixing it up.
