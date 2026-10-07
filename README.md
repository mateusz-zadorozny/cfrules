# Cloudflare — strip tracking parameters before the origin, keep them in the browser

[![My Services](https://img.shields.io/badge/MY_SERVICES-SHIFT64.COM-C2703D?style=for-the-badge&labelColor=4A4A4A)](https://shift64.com)

> [!CAUTION]
> **Post-mortem (October 2026): the Transform Rule published here in v0.1.0 was broken. Don't use it.**
>
> - A tracking parameter in **first** position left a dangling `&` (`?fbclid=x&a=1` → origin got `?&a=1`), which WordPress answers with a 301.
> - `regex_replace()` replaces **only the first match**, so non-adjacent parameters were only partly removed.
> - **By design**, every redirect the origin issues (apex ↔ `www`, trailing slash, canonical) was built from the stripped URL, so `gclid` / `fbclid` / `gad_source` **disappeared from the browser URL**. On one store running Google Ads this hit 21 paid landings in the logs and, invisibly, every landing on the non-canonical host.
>
> The rule is withdrawn ([`legacy/`](legacy/)) and replaced by a **Worker** that strips the same parameters and puts them back on same-site redirects.
> Full write-up: **[POSTMORTEM.md](POSTMORTEM.md)** · report: [issue #1](https://github.com/mateusz-zadorozny/cfrules/issues/1) · fix: [PR #2](https://github.com/mateusz-zadorozny/cfrules/pull/2) · [CHANGELOG](CHANGELOG.md)
>
> **If you deployed v0.1.0:** disable the rule (Rules → Transform Rules → URL Rewrite). If the *Super Page Cache* WordPress plugin created a `[DO NOT EDIT]` rule with the same regex, switch off its "strip tracking parameters" option instead — the plugin owns that rule.

---

## What this does

Campaign links make one page look like thousands of URLs to a page cache:

```
/product/lamp/?utm_source=newsletter&utm_campaign=autumn
/product/lamp/?gclid=Cj0KCQjw…
/product/lamp/?fbclid=IwAR…
```

Each is a cache miss that renders the page from scratch. The Worker in [`worker/`](worker/)
removes marketing parameters from the request it sends to the origin, so all of these hit the
same cache entry — while the visitor's browser keeps the original URL for GA4, Meta Pixel and
Google Ads to read. The origin never sees them; see [When to use it](#when-to-use-it--and-when-not).

The part the v0.1.0 rule could not do: when the origin answers with a redirect, the Worker
appends the stripped parameters back to `Location`.

```
browser ── GET /lamp?gclid=G&a=1 ──▶ Worker ── GET /lamp?a=1 ──▶ origin
                                                                   │
browser ◀── 301 /lamp/?a=1&gclid=G ── Worker ◀── 301 /lamp/?a=1 ───┘
                        ▲ restored
```

## When to use it — and when not

The Worker keeps tracking parameters **in the browser URL** (including across origin
redirects). It deliberately hides them **from the origin**. That is the whole point — and the
condition for using it:

| Reads tracking params from… | Works? | Examples |
|---|---|---|
| the browser URL, client-side JS | ✅ | GA4 / gtag, Google Ads conversion linker, Meta Pixel (`_fbc` cookie), TikTok Pixel, WooCommerce Order Attribution (sourcebuster.js) |
| cookies set by that JS, sent to the server later | ✅ | Meta Conversions API using `_fbc` / `_fbp`, server-side GTM fed by the browser |
| **the incoming request on the server** (`$_GET`, `$request->query`, nginx `$arg_*`) | ❌ **data lost** | PHP plugins that store `utm_*` / `gclid` on the first request, affiliate plugins reading `?aff=` server-side, origin access-log attribution, CRMs that read UTMs from the landing request |

Before deploying, check every plugin and integration that touches campaign parameters. If one
reads them server-side, either remove that parameter from the Worker's list or don't use the
Worker on that site. Parameters that change page behaviour (`ref`, `ao_noptimize`, …) are already
excluded — see [Parameters stripped](#parameters-stripped).

## How it behaves

| Request | Origin receives | Response to the browser |
|---|---|---|
| `/?fbclid=x&a=1` | `/?a=1` | origin's response |
| `/p/?utm_source=a&page=2&gclid=b` | `/p/?page=2` | origin's response |
| `/p/?utm_source=a` | `/p/` | origin's response (cacheable) |
| `/p?gclid=G` → origin 301 `/p/` | `/p` | 301 **`/p/?gclid=G`** |
| `example.com/?gclid=G` → origin 301 `www.example.com/` | `/` | 301 **`www.example.com/?gclid=G`** |
| `/checkout/?fbclid=F` → origin 302 `payu.com/…` | `/checkout/` | 302 `payu.com/…` (cross-site, untouched) |
| `POST /?wc-ajax=…&utm_source=a` | unchanged | unchanged |
| `/p/?ref=abc&q=a%20b` | unchanged (nothing to strip) | unchanged |

- Matching is case-insensitive and works on raw `name=value` segments, so kept parameters reach
  the origin byte-for-byte (no `%20` → `+` re-encoding).
- If the origin already kept a parameter in `Location`, it is not duplicated.

### Parameters stripped

`utm_*`, `mtm_*`, `pk_*` (prefix), plus:

| Source | Parameters |
|---|---|
| Google | `gclid` `gclsrc` `gbraid` `wbraid` `gad` `gad_source` `gad_campaignid` `srsltid` `_ga` `_gl` `dclid` `campaignid` `adgroupid` `adid` `s_kwcid` `ef_id` `mkwid` `pcrid` |
| Meta | `fbclid` `fb_action_ids` `fb_action_types` `fb_source` |
| Microsoft, TikTok, Pinterest, LinkedIn, X | `msclkid` `ttclid` `epik` `pp` `li_fat_id` `twclid` |
| Mailing / affiliate | `mc_cid` `mc_eid` `_ke` `_kx` `trk_contact` `trk_msg` `trk_module` `trk_sid` `_bta_tid` `_bta_c` `gdfms` `gdftrk` `gdffi` `sscid` `dm_i` `ssp_iabi` `ssp_iaba` `vgo_ee` |

Deliberately **not** stripped (they were in v0.1.0 but change page behaviour): `ref` (affiliate
plugins), `ao_noptimize` (Autoptimize debug switch), `cn-reloaded` (Cookie Notice), `usqp`,
`age-verified`, `redirect_*mongo_id`, `sb_referer_host`.

Edit `TRACKING_PARAMS` / `TRACKING_PREFIXES` in [`worker/src/index.js`](worker/src/index.js) to change the list.

## Setup

Requires the [`cf` CLI](https://developers.cloudflare.com/) logged in to your account, Node 22+.

```bash
cd worker
npm install
npm test                                  # stub origin, see "Testing"
cp hosts.example.json hosts.json          # gitignored — your zones stay out of the repo
```

`hosts.json` lists the hosts the Worker is routed on. Include every host that can **issue** a
redirect, e.g. both apex and `www` when one redirects to the other:

```json
[
	{ "zone": "example.com", "hosts": ["example.com", "www.example.com"] }
]
```

Two credentials, on purpose:

- **`cf deploy`** uses your `cf` login (`cf auth create`). It uploads the script, which needs
  **Account → Workers Scripts → Edit**.
- **`scripts/ensure-routes.mjs`** uses `CLOUDFLARE_ROUTES_API_TOKEN` — a custom token
  (**My Profile → API Tokens**) with only **Zone → Zone → Read** and **Zone → Workers Routes → Edit**
  for the zones in `hosts.json`.

```bash
export CLOUDFLARE_ROUTES_API_TOKEN=…
npm run deploy        # cf deploy, then scripts/ensure-routes.mjs
npm run routes:check  # read-only: exit 1 if any route is wrong
```

> [!IMPORTANT]
> Don't put the routes token in `CLOUDFLARE_API_TOKEN`: `cf` uses that variable *instead of* your
> saved login, and `cf deploy` then fails for lack of Workers Scripts permission. If you do use one
> `CLOUDFLARE_API_TOKEN` for everything (e.g. in CI), give it all three permissions — the script
> falls back to it when `CLOUDFLARE_ROUTES_API_TOKEN` is unset.

`npm run deploy` runs `cf deploy` (uploads the Worker, creates `<host>/*` routes) and then
[`scripts/ensure-routes.mjs`](worker/scripts/ensure-routes.mjs), which makes the zone match
`hosts.json`:

1. **Fail open on every Worker route.** The default — and the state **`cf deploy` resets every
   route to on each deploy** — is *fail closed*: over the Free plan limit, the whole site returns
   error 1027. With fail open, traffic goes straight to the origin with the full URL: correct, just
   no cache gain. (The API field is `request_limit_fail_open`; it is returned by
   `GET /zones/:id/workers/routes` but missing from the public API reference.)
2. **Exclusion routes** with no Worker for `<host>/wp-content/*`, `/wp-includes/*`, `/wp-admin/*`,
   `/wp-json/*`. The more specific route wins, so assets never invoke the Worker and don't count
   toward limits.

If a host's `<host>/*` route is missing or belongs to another Worker, the script reports it,
exits 1 and **changes nothing for that host** — exclusion routes there would let `/wp-admin/*` and
friends bypass the other Worker. Without a
token, do both steps by hand in **zone → Workers Routes** (Edit → *Request limit failure mode*).

> [!WARNING]
> If you deploy with plain `cf deploy` (not `npm run deploy`), run `npm run routes` afterwards —
> otherwise the routes stay *fail closed*.

Finally, disable any Transform Rule that strips the same parameters — Transform Rules run
**before** Workers, so parameters removed there can't be restored.

## Testing

```bash
npm test
```

18 Worker cases with `fetch` replaced by a stub origin: parameter position, non-adjacent parameters,
redirect restoration (relative `Location`, apex ↔ `www`, cross-site), duplicates, `POST`,
byte-for-byte forwarding, encoded/upper-case names (`%67clid`, `GCLID`), malformed
percent-encoding — plus 7 cases for `ensure-routes.mjs` against a stub API (including a run from a path with a space). It proves the logic, not the Cloudflare
runtime — after deploying, check a real redirect:

```bash
curl -sI "https://example.com/some-page?gclid=T&a=1"
# if the origin redirects, `location:` must still contain gclid=T
```

On a WordPress site, a URL without the trailing slash is the easiest way to get an origin redirect.

## Cost and limits

Worker routes cannot match on the query string, so the Worker runs on **every** request of its
routes — hence the exclusions above. Security rules (WAF, rate limiting, Bot Fight Mode) run
before Workers; blocked requests don't count.

| Runtime | Runs on | Price | Limit |
|---|---|---|---|
| Workers Free | every routed request | $0 | 100,000 requests/day per **account** |
| Workers Paid | every routed request | $5/month per account | 10M requests/month, then $0.30/M |
| Snippets | only requests matching a rule expression | included in Pro+ | none per request |

[`worker/src/index.js`](worker/src/index.js) is plain JavaScript and works as a
[Snippet](https://developers.cloudflare.com/rules/snippets/) unchanged — with a rule such as
`http.request.uri.query contains "gclid" or …` it only runs for tracking URLs. Snippets need the
Pro plan per zone.

For reference: one mid-size WooCommerce store used ~2.8k Worker requests overnight with the
exclusions in place.

## Why not a Transform Rule?

Short version (details in [POSTMORTEM.md](POSTMORTEM.md#root-cause)):

- one `regex_replace()` per expression, first match only, RE2 without lookarounds — removing an
  arbitrary set of non-adjacent parameters cleanly is not expressible;
- even a perfect regex cannot fix redirects: the origin builds `Location` from the URL it was given.

If Cloudflare caches your HTML, a **Cache Rule** with *Cache key → Query string → Exclude* is the
other correct option: the cache ignores the parameters, the origin still receives them.

## Files

| Path | Purpose |
|---|---|
| [`worker/`](worker/) | The Worker (`src/index.js`), route setup (`scripts/ensure-routes.mjs`), tests, `cloudflare.config.ts`, `hosts.example.json`. |
| [`POSTMORTEM.md`](POSTMORTEM.md) | What went wrong with v0.1.0 and how it was found and fixed. |
| [`CHANGELOG.md`](CHANGELOG.md) | Release notes. |
| [`legacy/`](legacy/) | ⛔ The withdrawn v0.1.0 Transform Rule expressions, kept for reference only. |

## License

MIT — use it freely. Attribution appreciated but not required.

---

[![My Services](https://img.shields.io/badge/MY_SERVICES-SHIFT64.COM-C2703D?style=for-the-badge&labelColor=4A4A4A)](https://shift64.com)
