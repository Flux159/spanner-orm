I want to add the following functions to our query builder - "eq", "and", "or", "not", "ne", "gt", "gte", "lt", "lte" - I believe that these functions should be in src/core/functions.ts and utilized in src/core/query-builder.ts

I think that we should follow drizzle here because we're trying to make sure that our library is compatible as a drizzle-orm replacement for spanner.

Here are the typescript types from drizzle for their conditions:

/\*\*

- Test that two values are equal.
-
- Remember that the SQL standard dictates that
- two NULL values are not equal, so if you want to test
- whether a value is null, you may want to use
- `isNull` instead.
-
- ## Examples
-
- ```ts

  ```

- // Select cars made by Ford
- db.select().from(cars)
- .where(eq(cars.make, 'Ford'))
- ```

  ```

-
- @see isNull for a way to test equality to NULL.
  \*/
  export declare const eq: BinaryOperator;
  /\*\*
- Test that two values are not equal.
-
- Remember that the SQL standard dictates that
- two NULL values are not equal, so if you want to test
- whether a value is not null, you may want to use
- `isNotNull` instead.
-
- ## Examples
-
- ```ts

  ```

- // Select cars not made by Ford
- db.select().from(cars)
- .where(ne(cars.make, 'Ford'))
- ```

  ```

-
- @see isNotNull for a way to test whether a value is not null.
  \*/
  export declare const ne: BinaryOperator;
  /\*\*
- Combine a list of conditions with the `and` operator. Conditions
- that are equal `undefined` are automatically ignored.
-
- ## Examples
-
- ```ts

  ```

- db.select().from(cars)
- .where(
-     and(
-       eq(cars.make, 'Volvo'),
-       eq(cars.year, 1950),
-     )
- )
- ```
   */
  export declare function and(...conditions: (SQLWrapper | undefined)[]): SQL | undefined;
  /**
  ```
- Combine a list of conditions with the `or` operator. Conditions
- that are equal `undefined` are automatically ignored.
-
- ## Examples
-
- ```ts

  ```

- db.select().from(cars)
- .where(
-     or(
-       eq(cars.make, 'GM'),
-       eq(cars.make, 'Ford'),
-     )
- )
- ```
   */
  export declare function or(...conditions: (SQLWrapper | undefined)[]): SQL | undefined;
  /**
  ```
- Negate the meaning of an expression using the `not` keyword.
-
- ## Examples
-
- ```ts

  ```

- // Select cars _not_ made by GM or Ford.
- db.select().from(cars)
- .where(not(inArray(cars.make, ['GM', 'Ford'])))
- ```
   */
  export declare function not(condition: SQLWrapper): SQL;
  /**
  ```
- Test that the first expression passed is greater than
- the second expression.
-
- ## Examples
-
- ```ts

  ```

- // Select cars made after 2000.
- db.select().from(cars)
- .where(gt(cars.year, 2000))
- ```

  ```

-
- @see gte for greater-than-or-equal
  \*/
  export declare const gt: BinaryOperator;
  /\*\*
- Test that the first expression passed is greater than
- or equal to the second expression. Use `gt` to
- test whether an expression is strictly greater
- than another.
-
- ## Examples
-
- ```ts

  ```

- // Select cars made on or after 2000.
- db.select().from(cars)
- .where(gte(cars.year, 2000))
- ```

  ```

-
- @see gt for a strictly greater-than condition
  \*/
  export declare const gte: BinaryOperator;
  /\*\*
- Test that the first expression passed is less than
- the second expression.
-
- ## Examples
-
- ```ts

  ```

- // Select cars made before 2000.
- db.select().from(cars)
- .where(lt(cars.year, 2000))
- ```

  ```

-
- @see lte for less-than-or-equal
  \*/
  export declare const lt: BinaryOperator;
  /\*\*
- Test that the first expression passed is less than
- or equal to the second expression.
-
- ## Examples
-
- ```ts

  ```

- // Select cars made before 2000.
- db.select().from(cars)
- .where(lte(cars.year, 2000))
- ```

  ```

-
- @see lt for a strictly less-than condition
  \*/
  export declare const lte: BinaryOperator;
  /\*\*
- Test whether the first parameter, a column or expression,
- has a value from a list passed as the second argument.
-
- ## Examples
-
- ```ts

  ```

- // Select cars made by Ford or GM.
- db.select().from(cars)
- .where(inArray(cars.make, ['Ford', 'GM']))
- ```

  ```

-
- @see notInArray for the inverse of this test
  \*/
  export declare function inArray<T>(column: SQL.Aliased<T>, values: (T | Placeholder)[] | SQLWrapper): SQL;
  export declare function inArray<TColumn extends Column>(column: TColumn, values: ReadonlyArray<GetColumnData<TColumn, 'raw'> | Placeholder> | SQLWrapper): SQL;
  export declare function inArray<T extends SQLWrapper>(column: Exclude<T, SQL.Aliased | Column>, values: ReadonlyArray<unknown | Placeholder> | SQLWrapper): SQL;
  /\*\*
- Test whether the first parameter, a column or expression,
- has a value that is not present in a list passed as the
- second argument.
-
- ## Examples
-
- ```ts

  ```

- // Select cars made by any company except Ford or GM.
- db.select().from(cars)
- .where(notInArray(cars.make, ['Ford', 'GM']))
- ```

  ```

-
- @see inArray for the inverse of this test
  \*/
  export declare function notInArray<T>(column: SQL.Aliased<T>, values: (T | Placeholder)[] | SQLWrapper): SQL;
  export declare function notInArray<TColumn extends Column>(column: TColumn, values: (GetColumnData<TColumn, 'raw'> | Placeholder)[] | SQLWrapper): SQL;
  export declare function notInArray<T extends SQLWrapper>(column: Exclude<T, SQL.Aliased | Column>, values: (unknown | Placeholder)[] | SQLWrapper): SQL;
  /\*\*
- Test whether an expression is NULL. By the SQL standard,
- NULL is neither equal nor not equal to itself, so
- it's recommended to use `isNull` and `notIsNull` for
- comparisons to NULL.
-
- ## Examples
-
- ```ts

  ```

- // Select cars that have no discontinuedAt date.
- db.select().from(cars)
- .where(isNull(cars.discontinuedAt))
- ```

  ```

-
- @see isNotNull for the inverse of this test
  \*/
  export declare function isNull(value: SQLWrapper): SQL;
  /\*\*
- Test whether an expression is not NULL. By the SQL standard,
- NULL is neither equal nor not equal to itself, so
- it's recommended to use `isNull` and `notIsNull` for
- comparisons to NULL.
-
- ## Examples
-
- ```ts

  ```

- // Select cars that have been discontinued.
- db.select().from(cars)
- .where(isNotNull(cars.discontinuedAt))
- ```

  ```

-
- @see isNull for the inverse of this test
  \*/
  export declare function isNotNull(value: SQLWrapper): SQL;
  /\*\*
- Test whether a subquery evaluates to have any rows.
-
- ## Examples
-
- ```ts

  ```

- // Users whose `homeCity` column has a match in a cities
- // table.
- db
- .select()
- .from(users)
- .where(
-     exists(db.select()
-       .from(cities)
-       .where(eq(users.homeCity, cities.id))),
- );
- ```

  ```

-
- @see notExists for the inverse of this test
  \*/
  export declare function exists(subquery: SQLWrapper): SQL;
  /\*\*
- Test whether a subquery doesn't include any result
- rows.
-
- ## Examples
-
- ```ts

  ```

- // Users whose `homeCity` column doesn't match
- // a row in the cities table.
- db
- .select()
- .from(users)
- .where(
-     notExists(db.select()
-       .from(cities)
-       .where(eq(users.homeCity, cities.id))),
- );
- ```

  ```

-
- @see exists for the inverse of this test
  \*/
  export declare function notExists(subquery: SQLWrapper): SQL;
  /\*\*
- Test whether an expression is between two values. This
- is an easier way to express range tests, which would be
- expressed mathematically as `x <= a <= y` but in SQL
- would have to be like `a >= x AND a <= y`.
-
- Between is inclusive of the endpoints: if `column`
- is equal to `min` or `max`, it will be TRUE.
-
- ## Examples
-
- ```ts

  ```

- // Select cars made between 1990 and 2000
- db.select().from(cars)
- .where(between(cars.year, 1990, 2000))
- ```

  ```

-
- @see notBetween for the inverse of this test
  \*/
  export declare function between<T>(column: SQL.Aliased, min: T | SQLWrapper, max: T | SQLWrapper): SQL;
  export declare function between<TColumn extends AnyColumn>(column: TColumn, min: GetColumnData<TColumn, 'raw'> | SQLWrapper, max: GetColumnData<TColumn, 'raw'> | SQLWrapper): SQL;
  export declare function between<T extends SQLWrapper>(column: Exclude<T, SQL.Aliased | Column>, min: unknown, max: unknown): SQL;
  /\*\*
- Test whether an expression is not between two values.
-
- This, like `between`, includes its endpoints, so if
- the `column` is equal to `min` or `max`, in this case
- it will evaluate to FALSE.
-
- ## Examples
-
- ```ts

  ```

- // Exclude cars made in the 1970s
- db.select().from(cars)
- .where(notBetween(cars.year, 1970, 1979))
- ```

  ```

-
- @see between for the inverse of this test
  \*/
  export declare function notBetween<T>(column: SQL.Aliased, min: T | SQLWrapper, max: T | SQLWrapper): SQL;
  export declare function notBetween<TColumn extends AnyColumn>(column: TColumn, min: GetColumnData<TColumn, 'raw'> | SQLWrapper, max: GetColumnData<TColumn, 'raw'> | SQLWrapper): SQL;
  export declare function notBetween<T extends SQLWrapper>(column: Exclude<T, SQL.Aliased | Column>, min: unknown, max: unknown): SQL;
