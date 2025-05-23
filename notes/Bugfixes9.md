Right now we have a fairly comprehensive README.md around how to use spanner-orm, but I want to ensure that we have good docs in our docusaurus website. This is currently inside of the "./website" directory and we should have a good split of docs there.

Specifically, a "getting started" page that is a quick intro, a "migrations" page for how spanner-orm generates & then applies migrations, a "querying" page that shows in depth how to query / connect via the db helper (also mentions the lower api around query builder if they need it), an "advanced" page that mentions interleaved tables & how to run GQL graph queries on spanner (and what it does in postgres since it's not supported in postgres, etc.).

You should write extensive documentation for end users of spanner-orm because we will publish this to github pages.
