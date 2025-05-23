In spanner-orm we currently have hard dependencies on our 3 client libraries (see package.json):

```json
"@electric-sql/pglite": "0.3.1",
"@google-cloud/spanner": "^7.0.0",
"pg": "^8.7.1"
```

We do use them in migrate, but most ORMs do not end up having hard dependencies here - they use peer dependencies and then only call one of them at runtime depending on what config / dialect you've specified.

We should migrate to this approach and make sure we're only doing the imports as dynamic imports to not break the orm.

We also need to update the readme so that the user knows that they should probably install all 3 deps when installing spanner-orm too (pglite is optional if they want to use pglite).
