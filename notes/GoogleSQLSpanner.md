# Google SQL for Spanner Notes

See the pages [here](https://cloud.google.com/spanner/docs/reference/standard-sql/overview) and the linked pages (need to use toc on the left to get to functions, etc.)

See this about [DDL](https://cloud.google.com/spanner/docs/reference/standard-sql/data-definition-language).

This is the [link](https://cloud.google.com/spanner/docs/reference/standard-sql/functions-all) for all functions available.

## DDL Statements that require validation

You can only do 10 per batch / query. So spanner-orm should generate multiple migration files if that is the case.

## LIKE & ILIKE vs REGEXP_CONTAINS & Alternatives

From Gemini / AI Studio:

You're right, Google Cloud Spanner's SQL dialect (Google Standard SQL) does not have the traditional LIKE or ILIKE operators.
The primary alternative is to use regular expressions with the REGEXP_CONTAINS function. You can also use specific string functions for simpler cases.
Here's how to achieve common LIKE patterns:
REGEXP_CONTAINS(value, pattern):
This is the most versatile function. It returns TRUE if value matches the regular expression pattern.
The regex syntax used is RE2.
Common LIKE Equivalents:
column LIKE 'prefix%' (starts with prefix)
REGEXP_CONTAINS(column, r'^prefix')
Alternatively, and often simpler/more direct: STARTS_WITH(column, 'prefix')
column LIKE '%suffix' (ends with suffix)
REGEXP_CONTAINS(column, r'suffix$')
Alternatively: ENDS_WITH(column, 'suffix')
column LIKE '%substring%' (contains substring)
REGEXP_CONTAINS(column, r'substring') (no anchors needed)
Alternatively: CONTAINS_SUBSTR(column, 'substring')
column LIKE 'prefix%suffix' (starts with prefix, ends with suffix, anything in between)
REGEXP_CONTAINS(column, r'^prefix.*suffix$')
column LIKE 'char1_char3' (wildcard for a single character)
REGEXP_CONTAINS(column, r'^char1.char3$') (The . matches any single character. ^ and $ ensure it's the whole string.)
column LIKE 'exact_match' (exact match)
column = 'exact_match' (This is the standard way)
Or REGEXP_CONTAINS(column, r'^exact_match$')
Case-Insensitive Matching (like ILIKE):
Using REGEXP_CONTAINS with the case-insensitive flag (?i):
REGEXP_CONTAINS(column, r'(?i)pattern')
Example: column ILIKE 'prefix%' becomes REGEXP_CONTAINS(column, r'(?i)^prefix')
Example: column ILIKE '%substring%' becomes REGEXP_CONTAINS(column, r'(?i)substring')
Using LOWER() or UPPER() (less ideal with regex, but possible with other functions):
STARTS_WITH(LOWER(column), LOWER('prefix'))
CONTAINS_SUBSTR(LOWER(column), LOWER('substring'))
LOWER(column) = LOWER('exact_match')
While you could do REGEXP_CONTAINS(LOWER(column), r'^prefix_in_lower'), using the (?i) flag within the regex pattern itself is generally cleaner and more idiomatic for regex.
Examples:
Let's say you have a table products with a column name:
-- Find products starting with 'Laptop' (case-sensitive)
SELECT name FROM products WHERE STARTS_WITH(name, 'Laptop');
-- OR
SELECT name FROM products WHERE REGEXP_CONTAINS(name, r'^Laptop');

-- Find products starting with 'laptop' (case-insensitive)
SELECT name FROM products WHERE REGEXP_CONTAINS(name, r'(?i)^laptop');
-- OR
SELECT name FROM products WHERE STARTS_WITH(LOWER(name), 'laptop');

-- Find products containing 'Pro' (case-sensitive)
SELECT name FROM products WHERE CONTAINS_SUBSTR(name, 'Pro');
-- OR
SELECT name FROM products WHERE REGEXP_CONTAINS(name, r'Pro');

-- Find products containing 'pro' (case-insensitive)
SELECT name FROM products WHERE REGEXP_CONTAINS(name, r'(?i)pro');
-- OR
SELECT name FROM products WHERE CONTAINS_SUBSTR(LOWER(name), 'pro');

-- Find products ending with 'Edition' (case-sensitive)
SELECT name FROM products WHERE ENDS_WITH(name, 'Edition');
-- OR
SELECT name FROM products WHERE REGEXP_CONTAINS(name, r'Edition$');

-- Find products like 'MacBook _ir' (e.g., MacBook Air)
SELECT name FROM products WHERE REGEXP_CONTAINS(name, r'^MacBook .ir$');
Use code with caution.
SQL
Summary of Alternatives:
LIKE Pattern	Spanner REGEXP_CONTAINS (Case-Sensitive)	Spanner REGEXP_CONTAINS (Case-Insensitive)	Simpler Spanner Functions (if applicable)
prefix%	REGEXP_CONTAINS(col, r'^prefix')	REGEXP_CONTAINS(col, r'(?i)^prefix')	STARTS_WITH(col, 'prefix')
ILike prefix%	N/A	REGEXP_CONTAINS(col, r'(?i)^prefix')	STARTS_WITH(LOWER(col), 'prefix_lower')
%suffix	REGEXP_CONTAINS(col, r'suffix$') REGEXP_CONTAINS(col, r'(?i)suffix$')	ENDS_WITH(col, 'suffix')
%substring%	REGEXP_CONTAINS(col, r'substring')	REGEXP_CONTAINS(col, r'(?i)substring')	CONTAINS_SUBSTR(col, 'substring')
prefix%suffix	REGEXP_CONTAINS(col, r'^prefix.*suffix$') REGEXP_CONTAINS(col, r'(?i)^prefix.\*suffix$')	(Combine STARTS_WITH & ENDS_WITH or use regex)
a_c (single char)	REGEXP_CONTAINS(col, r'^a.c$') REGEXP_CONTAINS(col, r'(?i)^a.c$') (Regex is best here)
For most cases, REGEXP_CONTAINS is your go-to, especially when you need the flexibility of _ and % combined or case-insensitivity. For simple prefix, suffix, or substring checks, STARTS_WITH, ENDS_WITH, and CONTAINS_SUBSTR can be more readable.
