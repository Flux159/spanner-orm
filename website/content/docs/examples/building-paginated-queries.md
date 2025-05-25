---
title: "Building Paginated Queries"
weight: 10 # Adjust weight as needed to position in sidebar
description: "Learn how to construct paginated queries and retrieve total counts using Spanner-ORM's QueryBuilder."
---

## Building Paginated Queries with Spanner-ORM

`spanner-orm` provides all the necessary building blocks through its `QueryBuilder` and `OrmClient` to construct sophisticated paginated query logic. This guide demonstrates how to retrieve a slice of data (a "page") and the total number of records that match the query criteria.

This is useful for building UI components like tables with pagination, infinite scrolling lists, and more.

### Core Concepts

To implement pagination, you typically need:

1.  **Data Query**: Fetches a specific "page" of items. This involves:
    - Filtering (`WHERE` clauses)
    - Sorting (`ORDER BY` clauses)
    - Limiting the number of results (`LIMIT` clause)
    - Skipping a certain number of results (`OFFSET` clause)
    - Optionally, joining related data (`include` or manual joins)
    - Optionally, grouping data (`GROUP BY` clauses)
2.  **Count Query**: Fetches the total number of items that match the filtering criteria (without `LIMIT` and `OFFSET`). This total is essential for calculating the total number of pages.

### Example: Fetching Paginated Posts

Let's assume you have `posts` and `users` tables defined in your schema.

```typescript
// src/schema.ts (simplified example)
import { table, text, timestamp, uuid, integer, sql } from "spanner-orm";

export const users = table("users", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
});

export const posts = table("posts", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  viewCount: integer("view_count").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});
```

Here's how you might construct a function to fetch paginated posts:

```typescript
import {
  OrmClient,
  SQL,
  sql,
  posts,
  users,
  count,
  and,
  or,
  like,
  desc,
  asc,
} from "spanner-orm";
// Assuming 'db' is an initialized OrmClient instance

interface PaginatedPostsArgs {
  page?: number;
  limit?: number;
  searchTerm?: string;
  sortBy?: "title" | "createdAt" | "viewCount" | "userName";
  sortOrder?: "asc" | "desc";
  userId?: string; // Filter by a specific user
}

interface PaginatedPostsResult {
  items: Array<Record<string, any>>; // Consider defining a more specific type for post items
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

async function getPaginatedPosts(
  db: OrmClient,
  args: PaginatedPostsArgs
): Promise<PaginatedPostsResult> {
  const {
    page = 1,
    limit = 10,
    searchTerm,
    sortBy = "createdAt",
    sortOrder = "desc",
    userId,
  } = args;

  const offset = (page - 1) * limit;

  // --- 1. Build WHERE conditions ---
  const whereConditions: SQL[] = [];
  if (userId) {
    whereConditions.push(sql`${posts.userId} = ${userId}`);
  }
  if (searchTerm) {
    // Example: search in title and content of posts, and user's name
    whereConditions.push(
      or(
        like(posts.title, `%${searchTerm}%`),
        like(posts.content, `%${searchTerm}%`),
        like(users.name, `%${searchTerm}%`) // Requires a join
      )
    );
  }
  const finalWhereClause =
    whereConditions.length > 0 ? and(...whereConditions) : undefined;

  // --- 2. Construct the Count Query ---
  // Select a non-null column for counting, or use count(*)
  // If joining, ensure the count is distinct if necessary or count from the primary table.
  let countQueryBuilder = db.select({ total: count(posts.id) }).from(posts);

  if (searchTerm || userId) {
    // Only join for count if search/filter requires it
    // Join with users if searchTerm involves users.name or if filtering by user-related criteria
    countQueryBuilder = countQueryBuilder.leftJoinRelation("users"); // Assuming relation is auto-detectable or use explicit join
  }

  if (finalWhereClause) {
    countQueryBuilder = countQueryBuilder.where(finalWhereClause);
  }

  const countResult = await countQueryBuilder;
  const total = Number(countResult[0]?.total) || 0;

  // --- 3. Construct the Data Query ---
  let dataQueryBuilder = db
    .select({
      postId: posts.id,
      title: posts.title,
      content: posts.content,
      createdAt: posts.createdAt,
      viewCount: posts.viewCount,
      authorName: users.name, // Select from joined users table
      authorEmail: users.email,
    })
    .from(posts)
    .leftJoinRelation("users"); // Join with users table, relation name 'users' assumed from posts.userId FK

  if (finalWhereClause) {
    dataQueryBuilder = dataQueryBuilder.where(finalWhereClause);
  }

  // --- Sorting ---
  const sortColumnMap = {
    title: posts.title,
    createdAt: posts.createdAt,
    viewCount: posts.viewCount,
    userName: users.name, // Sort by user's name
  };

  if (sortBy && sortColumnMap[sortBy]) {
    const sortDirection = sortOrder.toUpperCase() as "ASC" | "DESC";
    dataQueryBuilder = dataQueryBuilder.orderBy(
      sortColumnMap[sortBy],
      sortDirection
    );
  } else {
    // Default sort
    dataQueryBuilder = dataQueryBuilder.orderBy(posts.createdAt, "DESC");
  }

  dataQueryBuilder = dataQueryBuilder.limit(limit).offset(offset);

  const items = await dataQueryBuilder;

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

// --- Example Usage ---
// async function main(db: OrmClient) {
//   try {
//     const result = await getPaginatedPosts(db, {
//       page: 1,
//       limit: 5,
//       searchTerm: "Spanner",
//       sortBy: "userName",
//       sortOrder: "asc"
//     });
//     console.log("Paginated Posts:", JSON.stringify(result, null, 2));
//     console.log(`Page ${result.page} of ${result.totalPages}, Total Items: ${result.total}`);
//   } catch (error) {
//     console.error("Failed to fetch paginated posts:", error);
//   }
// }

// // Initialize db and call main(db)
```

### Key `spanner-orm` Features Used:

- **`db.select().from()`**: To start building the SELECT query.
- **`ColumnConfig` objects (e.g., `posts.id`, `users.name`)**: Used directly in `select`, `where`, and `orderBy` clauses for type safety and correct SQL generation.
- **`leftJoinRelation("users")`**: (Or `db.leftJoin(users, sql`${posts.userId} = ${users.id}`)`) To join related tables. The `include` method on the query builder can also be used for simpler eager loading scenarios if result shaping is handled by the ORM client.
- **SQL Condition Functions (`and`, `or`, `like`, `eq`)**: To build dynamic `WHERE` clauses.
- **`sql` template tag**: For embedding parameters safely or constructing parts of SQL expressions.
- **`count()` function**: For the count query.
- **`.where(condition)`**: To apply filters.
- **`.orderBy(column, direction)`**: For sorting.
- **`.limit(count)`**: To limit the number of results.
- **`.offset(count)`**: To skip results for pagination.

### Considerations for `groupBy`:

If your pagination query involves `GROUP BY` (e.g., to get the latest post per user, or count posts per category), the logic for both the data query and the count query needs careful consideration:

- **Data Query with `groupBy`**:
  - Your `select` list should typically include the grouping columns and aggregate functions (e.g., `MAX(posts.createdAt)`, `COUNT(posts.id)`).
  - `orderBy` can use grouping columns or aggregates.
- **Count Query with `groupBy`**:
  - If you need the total number of _groups_, you would typically perform a query like:
    ```typescript
    // To count the number of distinct groups
    const countGroupsQuery = db
      .select({ _group_key_: yourGroupByColumn }) // or sql`1`
      .from(yourTable)
      // .where(...) // apply same filters
      .groupBy(yourGroupByColumn, ...otherGroupByColumns);
    const groups = await countGroupsQuery;
    const totalGroups = groups.length;
    ```
  - This `totalGroups` would then be your `total` for pagination purposes.

Building robust pagination logic requires understanding your specific data model and query needs. `spanner-orm` provides the flexible tools to construct these queries effectively for both PostgreSQL and Spanner.
Remember to test your pagination logic thoroughly, especially with edge cases like empty results, single pages, and varying search terms.
