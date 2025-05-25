### 3 more bugs

3 more bugs (note that create user works fine & migrations seem to actually work now too along with creating posts. Only thing that needs some work is the pagination query stuff I think & then cleaning up the rest of the stuff / tests too - groupBy is feature / count is also feature, join config thing is also feature):

groupBy:
Just not implemented at all
if (groupBy && groupBy.length > 0) {
// query = query.groupBy(...groupBy); // spanner-orm groupBy syntax might differ
console.warn(
"GroupBy for data query is not fully implemented for spanner-orm yet."
);
}

Count Query:
// TODO: Implement count query correctly for spanner-orm, considering filters.
let countQuery = db.select({ value: count() }).from(table);
if (finalWhereClause) {
countQuery = countQuery.where(finalWhereClause);
}
// GroupBy for count is complex, often requires subquery.
if (groupBy && groupBy.length > 0) {
console.warn(
"Count query with groupBy is not accurately implemented for spanner-orm yet."
);
// countQuery = countQuery.groupBy(...groupBy); // This might not be correct for count
}

getPaginatedData:
TODO: Implement user join for spanner-orm in getPaginatedData. User fields might be missing.
Error fetching posts: 322 | const colConfig = field;
323 | const tableAlias = colConfig.\_tableName
324 | ? aliasMap.get(colConfig.\_tableName)
325 | : this.\_targetTableAlias;
326 | if (!tableAlias) {
327 | throw new Error(`PG Alias not found for table of column: ${colConfig.name} (table: ${colConfig._tableName})`);
^
error: PG Alias not found for table of column: name (table: users)
at <anonymous> (/Users/suyogsonwalkar/Projects/pixlr/node_modules/spanner-orm/dist/core/query-builder.js:327:27)
at map (1:11)
at buildSelectPgSQL (/Users/suyogsonwalkar/Projects/pixlr/node_modules/spanner-orm/dist/core/query-builder.js:313:52)
at prepare (/Users/suyogsonwalkar/Projects/pixlr/node_modules/spanner-orm/dist/core/query-builder.js:189:30)
at then (/Users/suyogsonwalkar/Projects/pixlr/node_modules/spanner-orm/dist/client.js:94:57)

This is code that failed here:
if (shouldIncludeUserJoin && primaryTableColumns.userId) {
// For spanner-orm, aliasing is typically done in the select map
if (!excludeUserFields.includes("name")) {
selectFields["userName"] = users.columns.name; // Assuming users.columns.name is the column object
}
if (!excludeUserFields.includes("id")) {
selectFields["userIdFromUserTable"] = users.columns.id;
}
// TODO: spanner-orm join logic is different. This push to allJoinConfigs is Drizzle-style.
// This will need to be handled by how spanner-orm's fluent API or QueryBuilder handles joins (e.g., .include())
// For now, commenting out the direct join push. The 'include' feature of spanner-orm might be relevant.
// allJoinConfigs.push({
// joinTable: users,
// onCondition: eq(primaryTableColumns.userId, users.id),
// joinType: "leftJoin", // This concept might not map directly
// });
console.warn(
"TODO: Implement user join for spanner-orm in getPaginatedData. User fields might be missing."
);

[05/24/2025 - 22:14:27.009 PDT] GET /api/posts?onlyUser=true - 500 (3ms)

The code for this is here:

export async function getPaginatedData<
TTable extends SpannerOrmTable, // Changed type
TItem extends Record<string, any>

> ({
> db,
> table,
> page = 1,
> limit = 10,
> sortBy,
> sortOrder = "desc",
> sortableColumnsMap: explicitSortableColumnsMap,
> searchTerm,
> searchableColumns = [],
> permissionClause,
> joinConfigs: \_customJoinConfigs = [], // Prefixed with underscore
> additionalWhereClauses = [],
> groupBy,
> excludeSelectFields = [],
> includeUserJoin,
> excludeUserFields = ["password"], // Always exclude password by default
> }: PaginatedQueryArgs<TTable>): Promise<PaginatedQueryResult<TItem>> {
> const offset = (page - 1) \* limit;

// --- Determine if user join should be included ---
const primaryTableColumns = table.columns; // Changed from getTableColumns
const shouldIncludeUserJoin =
includeUserJoin === undefined
? !!primaryTableColumns.userId
: includeUserJoin;

// --- Build Select Fields ---
// spanner-orm select takes an object mapping output name to column or SQL
const selectFields: Record<string, SpannerOrmColumn | SQL> = {};
for (const colName in primaryTableColumns) {
if (!excludeSelectFields.includes(colName as any)) {
selectFields[colName] = primaryTableColumns[colName];
}
}

// const allJoinConfigs = [..._customJoinConfigs]; // If used, would use \_customJoinConfigs
// Joins need significant rework for spanner-orm and this variable is currently unused.
// If/when joins are re-implemented for spanner-orm, this might be reintroduced or handled differently.

let shouldIncludeUserTable = false;
if (shouldIncludeUserJoin && primaryTableColumns.userId) {
// For spanner-orm, aliasing is typically done in the select map
if (!excludeUserFields.includes("name")) {
selectFields["userName"] = users.columns.name; // Assuming users.columns.name is the column object
}
if (!excludeUserFields.includes("id")) {
selectFields["userIdFromUserTable"] = users.columns.id;
}
// TODO: spanner-orm join logic is different. This push to allJoinConfigs is Drizzle-style.
// This will need to be handled by how spanner-orm's fluent API or QueryBuilder handles joins (e.g., .include())
// For now, commenting out the direct join push. The 'include' feature of spanner-orm might be relevant.
// allJoinConfigs.push({
// joinTable: users,
// onCondition: eq(primaryTableColumns.userId, users.id),
// joinType: "leftJoin", // This concept might not map directly
// });
console.warn(
"TODO: Implement user join for spanner-orm in getPaginatedData. User fields might be missing."
);
shouldIncludeUserTable = true;
} else if (includeUserJoin && !primaryTableColumns.userId) {
console.warn(
`User join was requested for table ${table.tableName}, but it does not have a 'userId' column.`
);
}

// --- Build WHERE Clause ---
const whereClausesInternal: (SQL | undefined)[] = []; // Allow undefined initially
if (permissionClause) {
whereClausesInternal.push(permissionClause);
}

// Use a mutable copy for additionalWhereClauses to add the UUID search
// Removed duplicate declaration of allAdditionalWhereClauses
const allAdditionalWhereClauses = additionalWhereClauses
? [...additionalWhereClauses]
: [];

let uuidSpecificSearchCondition: SQL | undefined = undefined;

if (
searchTerm &&
primaryTableColumns.id &&
searchTerm.match(
/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
)
) {
uuidSpecificSearchCondition = eq(primaryTableColumns.id, searchTerm);
}

const textSearchConditions: SQL[] = [];
if (searchTerm && searchableColumns.length > 0) {
searchableColumns.forEach((col) => {
// Ensure 'col' is a valid column object for spanner-orm's sql tag.
// If 'col' is a string, this will likely fail at runtime without a helper like sql.identifier().
// For now, assuming 'col' is a SpannerOrmColumn object.
textSearchConditions.push(
sql`lower(${col}) LIKE ${`%${searchTerm.toLocaleLowerCase()}%`}` // Removed sql.raw, assume col is a column object
);
});
}

let combinedSearchCondition: SQL | undefined;
if (uuidSpecificSearchCondition && textSearchConditions.length > 0) {
combinedSearchCondition = or(
uuidSpecificSearchCondition,
...textSearchConditions
);
} else if (uuidSpecificSearchCondition) {
combinedSearchCondition = uuidSpecificSearchCondition;
} else if (textSearchConditions.length > 0) {
combinedSearchCondition = or(...textSearchConditions);
}

if (combinedSearchCondition) {
allAdditionalWhereClauses.push(combinedSearchCondition);
}

whereClausesInternal.push(...allAdditionalWhereClauses.filter(Boolean));

const finalWhereClauses = whereClausesInternal.filter(
(c): c is SQL => c !== undefined
);
const finalWhereClause =
finalWhereClauses.length > 0 ? and(...finalWhereClauses) : undefined;

// --- Base Query Construction (spanner-orm fluent API style) ---
// This part needs significant rework as spanner-orm's fluent API is different from Drizzle's dynamic builder.
// The .select().from().where().orderBy().limit().offset() chain is common.
// Joins are handled differently (e.g., via 'include' or separate queries).

// TODO: Refactor query construction for spanner-orm. The following is a placeholder.
let query = db.select(selectFields).from(table);
// TODO: Figure out if this is right, also use debug() to see the actual query now...
// Also need to add groupBy as well as potentially that joinConfigs thing?
if (shouldIncludeUserTable) {
query = query.include({ user: { relationTable: users } });
}
if (finalWhereClause) {
query = query.where(finalWhereClause);
}

// --- Count Query (Placeholder) ---
// TODO: Implement count query correctly for spanner-orm, considering filters.
let countQuery = db.select({ value: count() }).from(table);
if (finalWhereClause) {
countQuery = countQuery.where(finalWhereClause);
}
// GroupBy for count is complex, often requires subquery.
if (groupBy && groupBy.length > 0) {
console.warn(
"Count query with groupBy is not accurately implemented for spanner-orm yet."
);
// countQuery = countQuery.groupBy(...groupBy); // This might not be correct for count
}
const totalResult = await countQuery;
const total = Number(totalResult[0]?.value) || 0;

// --- Data Query Sorting & Pagination (Placeholder) ---
const sortableColumns: Record<string, SpannerOrmColumn | SQL> = {
...primaryTableColumns,
};
if (shouldIncludeUserJoin && primaryTableColumns.userId) {
sortableColumns["userName"] = users.columns.name;
}
if (explicitSortableColumnsMap) {
Object.assign(sortableColumns, explicitSortableColumnsMap);
}

let effectiveSortBy = sortBy;
if (!effectiveSortBy && primaryTableColumns.createdAt) {
effectiveSortBy = "createdAt";
}

if (effectiveSortBy && sortableColumns[effectiveSortBy]) {
const sortColumn = sortableColumns[effectiveSortBy];
// spanner-orm uses .orderBy(column, "ASC" | "DESC")
// Ensure sortColumn is a valid column reference for spanner-orm.
// If sortColumn is a string name, this might need adjustment (e.g. table.columns[sortColumn])
query = query.orderBy(
sortColumn, // Assume sortColumn is a valid SpannerOrmColumn object or SQL fragment
sortOrder.toUpperCase() as "ASC" | "DESC"
);
} else if (effectiveSortBy) {
console.warn(`Sort column '${effectiveSortBy}' not found or not sortable.`);
if (primaryTableColumns.createdAt) {
const createdAtCol = primaryTableColumns.createdAt;
query = query.orderBy(createdAtCol, "DESC");
}
}

query = query.limit(limit).offset(offset);
if (groupBy && groupBy.length > 0) {
// query = query.groupBy(...groupBy); // spanner-orm groupBy syntax might differ
console.warn(
"GroupBy for data query is not fully implemented for spanner-orm yet."
);
}

const items = (await query) as TItem[];
return { items, total, page, limit };
}

We want to ensure that this can work correctly for users making these style of list queries.

Fix up this error:

Error fetching posts: 322 | const colConfig = field;
323 | const tableAlias = colConfig.\_tableName
324 | ? aliasMap.get(colConfig.\_tableName)
325 | : this.\_targetTableAlias;
326 | if (!tableAlias) {
327 | throw new Error(`PG Alias not found for table of column: ${colConfig.name} (table: ${colConfig._tableName})`);
^
error: PG Alias not found for table of column: name (table: users)
at <anonymous> (/Users/suyogsonwalkar/Projects/pixlr/node_modules/spanner-orm/dist/core/query-builder.js:327:27)
at map (1:11)
at buildSelectPgSQL (/Users/suyogsonwalkar/Projects/pixlr/node_modules/spanner-orm/dist/core/query-builder.js:313:52)
at prepare (/Users/suyogsonwalkar/Projects/pixlr/node_modules/spanner-orm/dist/core/query-builder.js:189:30)
at then (/Users/suyogsonwalkar/Projects/pixlr/node_modules/spanner-orm/dist/client.js:94:57)
