# Cloudflare — strip tracking parameters without breaking attribution

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
Google Ads to read.

The part the v0.1.0 rule could not do: when the origin answers with a redirect, the Worker
appends the stripped parameters back to `Location`.

```
browser ── GET /lamp?gclid=G&a=1 ──▶ Worker ── GET /lamp?a=1 ──▶ origin
                                                                   │
browser ◀── 301 /lamp/?a=1&gclid=G ── Worker ◀── 301 /lamp/?a=1 ───┘
                        ▲ restored
```

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

```bash
npm run deploy                            # cf deploy — uploads the Worker and creates the routes
```

Then, in the dashboard (**zone → Workers Routes**) — the `cf` CLI has no command for these yet:

1. **Exclude static and admin paths.** Add routes with **Worker = None** for each host that serves
   pages: `<host>/wp-content/*`, `<host>/wp-includes/*`, `<host>/wp-admin/*`, `<host>/wp-json/*`.
   The more specific route wins, so assets never invoke the Worker and don't count toward limits.
2. **Set every Worker route to *Fail open (proceed)*** (Edit → *Request limit failure mode*).
   The default is *fail closed*: over the Free plan limit, the whole site returns error 1027.
   With fail open, traffic goes straight to the origin with the full URL — correct, just no cache gain.

> [!WARNING]
> **Every `cf deploy` resets all routes of the Worker to *fail closed*.** Re-check step 2 after each deploy.

Finally, disable any Transform Rule that strips the same parameters — Transform Rules run
**before** Workers, so parameters removed there can't be restored.

## Testing

```bash
npm test
```

16 cases with `fetch` replaced by a stub origin: parameter position, non-adjacent parameters,
redirect restoration (relative `Location`, apex ↔ `www`, cross-site), duplicates, `POST`,
byte-for-byte forwarding, malformed percent-encoding. It proves the logic, not the Cloudflare
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
| [`worker/`](worker/) | The Worker: `src/index.js`, tests, `cloudflare.config.ts`, `hosts.example.json`. |
| [`POSTMORTEM.md`](POSTMORTEM.md) | What went wrong with v0.1.0 and how it was found and fixed. |
| [`CHANGELOG.md`](CHANGELOG.md) | Release notes. |
| [`legacy/`](legacy/) | ⛔ The withdrawn v0.1.0 Transform Rule expressions, kept for reference only. |

## License

MIT — use it freely. Attribution appreciated but not required.

---

[![My Services](https://img.shields.io/badge/MY_SERVICES-SHIFT64.COM-C2703D?style=for-the-badge&labelColor=4A4A4A)](https://shift64.com)
