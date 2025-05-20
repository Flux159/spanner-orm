import { describe, it, expect, vi, beforeEach } from "vitest";
import { shapeResults } from "../../src/core/result-shaper";
import { table, text, integer } from "../../src/core/schema";
import type { IncludeClause, TableConfig } from "../../src/types/common";

// Mock console.warn
const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

const usersTable = table("users", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
});

const postsTable = table("posts", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  user_id: integer("user_id").references(() => usersTable.columns.id),
  content: text("content"),
});

// Manually add _tableName to column configs for these test tables
// In a real scenario, the table() function does this.
Object.values(usersTable.columns).forEach(
  (col) => (col._tableName = usersTable.name)
);
Object.values(postsTable.columns).forEach(
  (col) => (col._tableName = postsTable.name)
);

describe("shapeResults", () => {
  beforeEach(() => {
    consoleWarnSpy.mockClear();
  });

  it("should return raw data if includeClause is undefined or empty", () => {
    const rawData = [{ id: 1, name: "User 1" }];
    expect(shapeResults(rawData, usersTable, undefined)).toEqual(rawData);
    expect(shapeResults(rawData, usersTable, {})).toEqual(rawData);
  });

  it("should return raw data if rawData is empty", () => {
    const includeClause: IncludeClause = { posts: true };
    expect(shapeResults([], usersTable, includeClause)).toEqual([]);
  });

  it("should return raw data and warn if primary table has no primary key", () => {
    const noPkTable = table("no_pk", { name: text("name") }) as TableConfig<
      any,
      any
    >;
    const rawData = [{ name: "Test" }];
    const includeClause: IncludeClause = { posts: true };
    expect(shapeResults(rawData, noPkTable, includeClause)).toEqual(rawData);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      `Warning: Cannot shape results for table ${noPkTable.name} as it has no defined primary key. Returning raw data.`
    );
  });

  it("should shape one-to-many relationship (user with multiple posts)", () => {
    const rawData = [
      {
        id: 1,
        name: "User 1",
        email: "user1@example.com",
        posts__id: 101,
        posts__title: "Post 1",
        posts__user_id: 1,
        posts__content: "Content 1",
      },
      {
        id: 1,
        name: "User 1",
        email: "user1@example.com",
        posts__id: 102,
        posts__title: "Post 2",
        posts__user_id: 1,
        posts__content: "Content 2",
      },
    ];
    const includeClause: IncludeClause = { posts: true };
    const shaped = shapeResults(rawData, usersTable, includeClause);

    expect(shaped).toHaveLength(1);
    expect(shaped[0]).toEqual({
      id: 1,
      name: "User 1",
      email: "user1@example.com",
      posts: [
        { id: 101, title: "Post 1", user_id: 1, content: "Content 1" },
        { id: 102, title: "Post 2", user_id: 1, content: "Content 2" },
      ],
    });
  });

  it("should shape one-to-many relationship (user with no posts)", () => {
    const rawData = [
      // Note: Spanner/PG LEFT JOIN on no match for posts would have nulls for posts__* fields
      {
        id: 1,
        name: "User 1",
        email: "user1@example.com",
        posts__id: null,
        posts__title: null,
        posts__user_id: null,
        posts__content: null,
      },
    ];
    const includeClause: IncludeClause = { posts: true };
    const shaped = shapeResults(rawData, usersTable, includeClause);

    expect(shaped).toHaveLength(1);
    expect(shaped[0]).toEqual({
      id: 1,
      name: "User 1",
      email: "user1@example.com",
      posts: [], // Expect empty array for posts
    });
  });

  it("should shape multiple users, some with posts, some without", () => {
    const rawData = [
      {
        id: 1,
        name: "User 1",
        email: "user1@example.com",
        posts__id: 101,
        posts__title: "Post 1",
        posts__user_id: 1,
        posts__content: "Content 1",
      },
      {
        id: 2,
        name: "User 2",
        email: "user2@example.com",
        posts__id: null,
        posts__title: null,
        posts__user_id: null,
        posts__content: null,
      },
      {
        id: 1,
        name: "User 1",
        email: "user1@example.com",
        posts__id: 102,
        posts__title: "Post 2",
        posts__user_id: 1,
        posts__content: "Content 2",
      },
      {
        id: 3,
        name: "User 3",
        email: "user3@example.com",
        posts__id: 103,
        posts__title: "Post 3",
        posts__user_id: 3,
        posts__content: "Content 3",
      },
    ];
    const includeClause: IncludeClause = { posts: true };
    const shaped = shapeResults(rawData, usersTable, includeClause);

    expect(shaped).toHaveLength(3);
    expect(shaped).toContainEqual({
      id: 1,
      name: "User 1",
      email: "user1@example.com",
      posts: [
        { id: 101, title: "Post 1", user_id: 1, content: "Content 1" },
        { id: 102, title: "Post 2", user_id: 1, content: "Content 2" },
      ],
    });
    expect(shaped).toContainEqual({
      id: 2,
      name: "User 2",
      email: "user2@example.com",
      posts: [],
    });
    expect(shaped).toContainEqual({
      id: 3,
      name: "User 3",
      email: "user3@example.com",
      posts: [{ id: 103, title: "Post 3", user_id: 3, content: "Content 3" }],
    });
  });

  it("should handle specific fields selected from related table (though shaper is unaware of this)", () => {
    // The shaper itself doesn't know which fields were selected, it just processes what's given.
    // The QueryBuilder ensures only selected fields (aliased) are in rawData.
    const rawData = [
      {
        id: 1,
        name: "User 1",
        email: "user1@example.com",
        posts__title: "Post 1",
      },
    ];
    const includeClause: IncludeClause = { posts: { select: { title: true } } }; // This clause is for QB, shaper just sees posts__title
    const shaped = shapeResults(rawData, usersTable, includeClause);

    expect(shaped).toHaveLength(1);
    expect(shaped[0]).toEqual({
      id: 1,
      name: "User 1",
      email: "user1@example.com",
      posts: [{ title: "Post 1" }],
    });
  });

  it("should correctly group when primary key is not named 'id'", () => {
    const tasksTable = table("tasks", {
      task_uuid: text("task_uuid").primaryKey(),
      description: text("description"),
    });
    Object.values(tasksTable.columns).forEach(
      (col) => (col._tableName = tasksTable.name)
    );

    const subTasksTable = table("sub_tasks", {
      sub_id: integer("sub_id").primaryKey(),
      task_id: text("task_id").references(() => tasksTable.columns.task_uuid),
      name: text("name"),
    });
    Object.values(subTasksTable.columns).forEach(
      (col) => (col._tableName = subTasksTable.name)
    );

    const rawData = [
      {
        task_uuid: "uuid1",
        description: "Task 1",
        sub_tasks__sub_id: 1,
        sub_tasks__task_id: "uuid1",
        sub_tasks__name: "Subtask 1.1",
      },
      {
        task_uuid: "uuid1",
        description: "Task 1",
        sub_tasks__sub_id: 2,
        sub_tasks__task_id: "uuid1",
        sub_tasks__name: "Subtask 1.2",
      },
      {
        task_uuid: "uuid2",
        description: "Task 2",
        sub_tasks__sub_id: null,
        sub_tasks__task_id: null,
        sub_tasks__name: null,
      },
    ];
    const includeClause: IncludeClause = { sub_tasks: true };
    const shaped = shapeResults(rawData, tasksTable, includeClause);

    expect(shaped).toHaveLength(2);
    expect(shaped).toContainEqual({
      task_uuid: "uuid1",
      description: "Task 1",
      sub_tasks: [
        { sub_id: 1, task_id: "uuid1", name: "Subtask 1.1" },
        { sub_id: 2, task_id: "uuid1", name: "Subtask 1.2" },
      ],
    });
    expect(shaped).toContainEqual({
      task_uuid: "uuid2",
      description: "Task 2",
      sub_tasks: [],
    });
  });
});
