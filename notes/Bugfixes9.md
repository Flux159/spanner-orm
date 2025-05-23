Right now we have a fairly comprehensive README.md around how to use spanner-orm, but I want to ensure that we have good docs to publish onto github pages.

We should use hugo (and use hugo-bin as a devDependency in our regular package.json) and store the site in "./website".

For the docs themselves, read the README and come up with a good architecture for ORM docs.

Specifically, a "getting started" page that is a quick intro, a "migrations" page for how spanner-orm generates & then applies migrations, a "querying" page that shows in depth how to query / connect via the db helper (also mentions the lower api around query builder if they need it), an "advanced" page that mentions interleaved tables & how to run GQL graph queries on spanner (and what it does in postgres since it's not supported in postgres, etc.).

You should write extensive documentation for end users of spanner-orm because we will publish this to github pages.

We should also add a new github workflow "deploy-docs.yml" that will be able to deploy these docs to gh-pages (the default pages branch).
