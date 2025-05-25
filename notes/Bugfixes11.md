I'm getting an error trying to run migrations against spanner - apparently DDL statements can't use the query API

Running Spanner migrations using spanner-orm-cli...
Connecting to spanner...
Spanner adapter connected successfully.
Successfully connected to spanner.
Starting 'migrate latest' for dialect: spanner using schema: ./dist/src/server/db/schema.js
Ensuring migration tracking table '\_spanner_orm_migrations_log' exists...
Error executing command with Spanner adapter: Error: 3 INVALID_ARGUMENT: DDL statements cannot be processed by the Query API. Please use DDL API or DDL UI instead. Statement not supported: CreateTableStmt [at 1:1]\nCREATE TABLE \_spanner_orm_migrations_log (\n^
at callErrorFromStatus (/home/runner/work/pixlr/pixlr/node_modules/@grpc/grpc-js/build/src/call.js:32:19)
at Object.onReceiveStatus (/home/runner/work/pixlr/pixlr/node_modules/@grpc/grpc-js/build/src/client.js:359:73)
at /home/runner/work/pixlr/pixlr/node_modules/@grpc/grpc-js/build/src/call-interface.js:78:35
at Object.onReceiveStatus (/home/runner/work/pixlr/pixlr/node_modules/grpc-gcp/build/src/index.js:73:29)
at InterceptingListenerImpl.onReceiveStatus (/home/runner/work/pixlr/pixlr/node_modules/@grpc/grpc-js/build/src/call-interface.js:73:23)
at Object.onReceiveStatus (/home/runner/work/pixlr/pixlr/node_modules/@grpc/grpc-js/build/src/client-interceptors.js:324:181)
at /home/runner/work/pixlr/pixlr/node_modules/@grpc/grpc-js/build/src/resolving-call.js:135:78
at process.processTicksAndRejections (node:internal/process/task_queues:77:11)
for call at
at ServiceClientImpl.makeServerStreamRequest (/home/runner/work/pixlr/pixlr/node_modules/@grpc/grpc-js/build/src/client.js:342:32)
at ServiceClientImpl.<anonymous> (/home/runner/work/pixlr/pixlr/node_modules/@grpc/grpc-js/build/src/make-client.js:105:19)
at /home/runner/work/pixlr/pixlr/node_modules/@google-cloud/spanner/build/src/v1/spanner_client.js:235:29
at /home/runner/work/pixlr/pixlr/node_modules/google-gax/build/src/streamingCalls/streamingApiCaller.js:38:28
at /home/runner/work/pixlr/pixlr/node_modules/google-gax/build/src/normalCalls/timeout.js:44:16
at Object.request (/home/runner/work/pixlr/pixlr/node_modules/google-gax/build/src/streamingCalls/streaming.js:376:40)
at makeRequest (/home/runner/work/pixlr/pixlr/node_modules/retry-request/index.js:159:28)
at retryRequest (/home/runner/work/pixlr/pixlr/node_modules/retry-request/index.js:119:5)
at StreamProxy.setStream (/home/runner/work/pixlr/pixlr/node_modules/google-gax/build/src/streamingCalls/streaming.js:367:37)
at StreamingApiCaller.call (/home/runner/work/pixlr/pixlr/node_modules/google-gax/build/src/streamingCalls/streamingApiCaller.js:54:16) {
code: 3,
details: 'DDL statements cannot be processed by the Query API. Please use DDL API or DDL UI instead. Statement not supported: CreateTableStmt [at 1:1]\\nCREATE TABLE \_spanner_orm_migrations_log (\\n^',
metadata: Metadata {
internalRepr: Map(5) {
'endpoint-load-metrics-bin' => [Array],
'grpc-server-stats-bin' => [Array],
'google.rpc.localizedmessage-bin' => [Array],
'x-goog-ext-75712901-bin' => [Array],
'grpc-status-details-bin' => [Array]
},
options: {}
},
statusDetails: [
LocalizedMessage {
locale: 'en-US',
message: 'DDL statements cannot be processed by the Query API. Please use DDL API or DDL UI instead. Statement not supported: CreateTableStmt [at 1:1]\n' +
'CREATE TABLE \_spanner_orm_migrations_log (\n' +
'^'
}
],
requestID: '1.9da3d551.1.1.3.1'
}

I looked at src/core/migration-runner.ts and it uses this to get the cmd sql to run:

```typescript
const executeCmdSql = adapter.execute.bind(adapter);
```

I don't want us updating execute though, so I decided to make a special executeDDL inside of src/spanner/adapter.ts that can be used specifically for Spanner.

I found that there is an updateDDL statement as part of the admin client and started initial work on that (it's not tested or verified yet - just the types work).

The return value seems to be this longrunning operation type:

```typescript
interface IOperation {
  /** Operation name */
  name?: string | null;

  /** Operation metadata */
  metadata?: google.protobuf.IAny | null;

  /** Operation done */
  done?: boolean | null;

  /** Operation error */
  error?: google.rpc.IStatus | null;

  /** Operation response */
  response?: google.protobuf.IAny | null;
}
```

What I want to do is for spanner migrations, use this custom executeDDL command (we might want to make that admin client on spanner adapter's initialization by the way) and then make it work correctly so that we wait until the long running operation is actually complete (Spanner migrations can take a while).

This will allow us to fix up spanner migrations in CI correctly.
