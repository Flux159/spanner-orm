I'm getting an error executing a query in spanner (so using src/spanner/adapter.ts's execute via runTransactionAsync)

[2025-05-26T04:53:26.390Z] GET /api/posts/3f418d17-93d1-4258-99f9-d26eebfdabff - 304 (76ms)
--- SQL Query ---
INSERT INTO `comments` (`content`, `created_at`, `entity_type`, `id`, `parent_id`, `root_id`, `updated_at`, `upload_id`, `user_id`, `visibility`) VALUES (@p1, CURRENT_TIMESTAMP, @p2, @p3, @p4, @p5, CURRENT_TIMESTAMP, @p6, @p7, @p8) THEN RETURN \*
--- Parameters ---
{
p1: "Test comment",
p2: "post",
p3: "f08e7ca1-06f3-4592-94ce-07ec579b6a8b",
p4: null,
p5: "3f418d17-93d1-4258-99f9-d26eebfdabff",
p6: null,
p7: "db2c2e9b-2d99-46e9-a768-f9509e544a3b",
p8: "public",
}

---

Error during transaction: 36372 | const message = `${status.code} ${constants_1.Status[status.code]}: ${status.details}`;
36373 | const error = new Error(message);
36374 | const stack = `${error.stack}
36375 | for call at
36376 | ${callerStack}`;
36377 | return Object.assign(new Error(message), status, { stack });
^
error: 3 INVALID_ARGUMENT: The code field is required for types.
code: 3,
details: "The code field is required for types.",
metadata: Metadata {
internalRepr: Map(3) {
"endpoint-load-metrics-bin": [
Buffer(27) [ 49, 152, 190, 65, 41, 102, 3, 164, 64, 57, 107, 17, 93, 147, 204, 204, 50, 64, 73, 122, 134, 5, 110, 155, 133, 200, 63 ]
],
"grpc-server-stats-bin": [
Buffer(10) [ 0, 0, 147, 138, 128, 0, 0, 0, 0, 0 ]
],
"x-goog-ext-75712901-bin": [
"\n.\n\u001Fx-google-spanner-primary-region\u0012\vus-central1"
],
},
options: [Object ...],
set: [Function: set],
add: [Function: add],
remove: [Function: remove],
get: [Function: get],
getMap: [Function: getMap],
clone: [Function: clone],
merge: [Function: merge],
setOptions: [Function: setOptions],
getOptions: [Function: getOptions],
toHttp2Headers: [Function: toHttp2Headers],
toJSON: [Function: toJSON],
},
requestID: "1.aa4cc86d.1.1.9.1",

      at callErrorFromStatus (/$bunfs/root/out:36377:35)

I believe it's because I'm passing null for parent_id and upload_id?

This is the schema for comments

export const comments = table("comments", {
...permissibleResource, // Includes id, createdAt, updatedAt, userId, visibility
content: text("content").notNull(),
rootId: uuid("root_id").notNull(), // ID of the root entity (e.g., post, image)
entityType: text("entity_type").notNull(), // Type of the root entity (e.g., 'post', 'image')
parentId: uuid("parent_id").references((): any => comments.id, {
// Reference to parent comment for threading
// onDelete: "cascade", // If a parent comment is deleted, its replies are also deleted
}),
uploadId: uuid("upload_id").references(() => uploads.id, {
// onDelete: "set null",
}), // Link to uploads table for a single attachment
});

Also, this is the code I'm using:

    const [createdCommentForResponse] = await db
      .insert(commentsTable)
      .values(newComment)
      .debug()
      .returning();

The issue seems to be explained by this stack overflow post copied below:

Not able to insert null values using the below sql statement:

const query = {
sql: 'SELECT \* FROM Singers WHERE name = @name AND id = @id',
params: {
id: spanner.int(8),
name: null
},
types: {
id: 'int64',
name: 'string'
}
};
I am getting the error: Error: 3 INVALID_ARGUMENT: The code field is required for types.

Answers:

Please try param_types instead of types. BTW, the query will return an empty result because NULL = NULL is always false.

Try below code to insert null values in NodeJS

database.runTransaction(async (err, transaction) => {
const [updateCount] = await transaction.runUpdate({
sql:
'INSERT Into Singers (SingerId, FirstName, LastName)' +
'VALUES (104, @FirstName, @LastName)',
params: {
FirstName: "Test",
LastName: null,
},
types: {
FirstName: 'string',
LastName: 'string',
},
});
});

So essentially in our code in spanner/adapter.ts:

```
const [rows] = await transaction.run({ sql, params, json: true });
```

We need to be able to pass the types for the parameters we specified. However this will require us to store information about the types when we do query building (query-builder.ts) with the info we have about our tables (from schema definitions).

In addition we should try this first:

```
const [rows] = await transaction.run({
    sql,
    params,
    json: true,
    types: {
        // Types for all params here
    } });
```

And if that doesn't work, then there's a "paramTypes" argument for transaction.run too.
