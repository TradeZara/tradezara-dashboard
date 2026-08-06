# TradeZara // Developer Dashboard

Organisation-wide contribution panel, published as static HTML.

**`index.html` is build output — do not edit it by hand.** Any manual edit is
discarded on the generator's next run. To change the look, edit `template.html`;
to change the numbers, edit `generate.mjs`.

## How it works

`generate.mjs` (plain Node, no dependencies) discovers the organisation's active
repositories through the GitHub API, collects contributor statistics and merged
pull requests, and rewrites `index.html` from `template.html`.

Only people listed as **organisation members** reach the dashboard. Bots, outside
maintainers and authors whose commits are not linked to a GitHub account are left
out — which is why the token must be able to see the member list, or the filter
would empty the panel (the generator aborts in that case). Someone new joined the
team? Adding them to the org is enough.

A GitHub Action runs this hourly. Expect one `chore: refresh dashboard` commit
per hour whether or not any number moved: the page carries the sync timestamp,
so the HTML differs on every run by design. That is what keeps the
`SYNCED … AGO` badge honest — a dead pipeline shows up on the page instead of
quietly serving stale data.

Don't shorten the interval without measuring the Pages build first. Every commit
fires a Pages deploy, and deploys that overlap queue up and time out. Scheduled
workflows are also best-effort: GitHub delays or drops runs under load, so
hourly is a target, not a guarantee.

`.nojekyll` at the root keeps Pages from running Jekyll over a page that doesn't
need it — it's the difference between a deploy of seconds and one of minutes.

If collecting any repository fails after the retries, the generator aborts
without writing anything: a partial panel looks current while reporting numbers
that are far too low, which is worse than a stale panel.

## Required secret

`DASHBOARD_READ_TOKEN` — an organisation token with read access to
**repositories**, **metadata** and **members**, and nothing beyond that. The
Action's default `GITHUB_TOKEN` won't do: it only sees this repository, and
almost every repository we measure is private.

The token exists only inside CI. It is read from an environment variable and
never reaches `index.html` — this repository is public, and a token on the page
would hand any visitor read access to the organisation's private code.

## Running locally

```sh
GITHUB_TOKEN=$(gh auth token) node generate.mjs   # rewrites index.html
node --test                                       # transform tests
```

Check the result with `git diff index.html` before opening a PR.

## Manual run

**Actions** tab → **Refresh dashboard** → **Run workflow**. Useful to force a
refresh without waiting for the cron.

Credentials rejected by the API fail the build — an expired token shows up as a
red build, not as stale data served in silence.

## Reading the dates

`First` and `Last` come from GitHub's contributor statistics, which are weekly.
A date such as `2026-08-02` is the **Sunday that opens that week**, not the day
of the commit — so it means "active that week", today included.

If someone's commits are missing while their merged PRs show up, the commit email
is not linked to their GitHub account. Adding the address under
github.com/settings/emails makes GitHub reattribute those commits retroactively,
and they appear on the next sync.
