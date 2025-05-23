Right now we have a fairly comprehensive README.md around how to use spanner-orm, but I want to ensure that we have good docs in our docusaurus website. This is currently inside of the "./website" directory and we should have a good split of docs there.

We actually have docusaurus setup in ./website, but I want to switch over to hugo and hextra: https://github.com/imfing/hextra - specifically we will still be publishing to gh-pages but with a hugo build and not via docusaurus. We should add https://github.com/fenneclab/hugo-bin as a dependency so we can still just use regular package.json scripts in order to build and it will work correctly in CI / CD too.

Specifically, a "getting started" page that is a quick intro, a "migrations" page for how spanner-orm generates & then applies migrations, a "querying" page that shows in depth how to query / connect via the db helper (also mentions the lower api around query builder if they need it), an "advanced" page that mentions interleaved tables & how to run GQL graph queries on spanner (and what it does in postgres since it's not supported in postgres, etc.).

You should write extensive documentation for end users of spanner-orm because we will publish this to github pages.
