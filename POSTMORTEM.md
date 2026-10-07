# Post-mortem: tracking-parameter Transform Rule dropped click IDs and caused extra redirects

| | |
|---|---|
| **Status** | Resolved — rule withdrawn, replaced by a Worker ([`worker/`](worker/)) |
| **Severity** | Medium — marketing attribution data loss on paid traffic, no downtime |
| **Window** | at least 2026-09-13 → 2026-10-07 (earliest available logs: 2026-09-11) |
| **Reported** | 2026-10-06 — [issue #1](https://github.com/mateusz-zadorozny/cfrules/issues/1) |
| **Fixed in** | [v0.2.0](CHANGELOG.md), [PR #2](https://github.com/mateusz-zadorozny/cfrules/pull/2) |

## Summary

Up to v0.1.0 this repository published a Cloudflare **URL Rewrite Transform Rule** that removed
tracking parameters (`utm_*`, `gclid`, `fbclid`, `_gl`, …) from the query string before the
request reached the origin. It was meant to improve the page-cache hit ratio while the browser's
address bar kept the parameters for client-side analytics (GA4, Meta Pixel, Google Ads).

The rule had two defects in its regex and one in its design:

1. When a tracking parameter came **first** and a regular parameter followed, the rule left a
   dangling separator: `?fbclid=x&a=1` reached the origin as `?&a=1`. WordPress canonicalises
   that URL with a **301** to `?a=1`.
2. `regex_replace()` replaces **only the first match**, so tracking parameters separated by a
   regular one were only partially removed.
3. **Design flaw:** the origin never sees the stripped parameters, so **any redirect the origin
   issues** (non-canonical host, missing trailing slash, the 301 from defect 1) is built from the
   stripped URL. The browser follows it and the click IDs disappear from the address bar —
   exactly where the analytics scripts read them.

Defect 3 cannot be fixed inside a Transform Rule. The rule was disabled on every zone that used it
and replaced by a Worker that strips the same parameters but **re-appends them to same-site
`Location` headers**.

## Impact

Five Cloudflare zones had the rule (or a variant of it). Measured on the origin's nginx access logs:

| Site | Rule | Observed effect |
|---|---|---|
| wceu.shift64.com | full list | Reproduced manually; this is how the bug was found. |
| Store C (WooCommerce, Google Ads) | full list | **21 real visits** (20 with referrer `google.com`) reached the origin as `GET /?&gad_campaignid=…&gclid=…` and received a 301, between 2026-09-13 and 2026-10-06. `gad_source` was lost on every one of them, and each paid landing paid for an extra redirect round-trip. |
| Store C | full list | Canonical host is `www`. Every landing on the **apex** host lost **all** stripped parameters, `gclid` included (see reproduction below). This is invisible in origin logs — the origin only ever saw the already-stripped URL — so it cannot be counted retroactively. |
| Store B (WooCommerce) | full list | No `?&` requests in logs since 2026-10-02; exposed to defect 3 on trailing-slash redirects. |
| Store D | `_gl` only | Same regex shape; no `?&` requests observed. |
| Store E | full list, created by the *Super Page Cache* WordPress plugin | No `?&` requests observed; pending (rule is owned by the plugin). |

Not affected: page rendering, checkout, payments. The loss is limited to attribution parameters on
the first request of a visit.

## Timeline (UTC)

| Time | Event |
|---|---|
| 2026-09-13 10:23 | Earliest `GET /?&gad_campaignid=…` → 301 on Store C (logs start 2026-09-11). |
| 2026-10-06 ~19:20 | Test request `/?fbclid=123&non_ma=123` on wceu.shift64.com ends on `/?non_ma=123`. nginx access log shows `GET /?&non_ma=123` — the parameter was removed before the origin. |
| 2026-10-06 20:54 | Issue #1 opened. Proxy disabled on wceu.shift64.com as a stop-gap. |
| 2026-10-06 ~21:45 | Rule analysed; disabled (not deleted) on shift64.com and Store B after a backup. |
| 2026-10-06 22:17 | Worker deployed as a pilot on Store B. Verified with curl: origin redirects keep the parameters. |
| 2026-10-07 (night) | Script-less routes added for `/wp-content/*`, `/wp-includes/*`, `/wp-admin/*`, `/wp-json/*`; route switched to *fail open*. |
| 2026-10-07 ~06:30 | All 17 zones on the account scanned for the rule; origin logs of every affected site analysed. |
| 2026-10-07 06:53 | Defect 3 reproduced live on Store C (apex → `www` 301 drops `gclid`). |
| 2026-10-07 ~06:55 | Rule disabled on Store C and Store D. Worker routed on Store C. `gad_campaignid`, `srsltid`, `pp` added to the Worker's list. |
| 2026-10-07 ~07:05 | Discovered that `cf deploy` had reset Store B's route to *fail closed*; fixed. |

## Root cause

### Defect 1 — the separator on the wrong side

```
(?:(?:^|&)(?:utm_source|…|fbclid|…)=[^&]*)+   →   ""
```

Each match consumes a parameter together with the separator **before** it (`^` or `&`). That is
correct in the middle or at the end of the query, but for a parameter at the start, the `&` that
separates it from the next parameter stays:

| Query in | Query sent to origin |
|---|---|
| `a=1&fbclid=x` | `a=1` |
| `a=1&fbclid=x&b=2` | `a=1&b=2` |
| `fbclid=x` | *(empty)* |
| **`fbclid=x&a=1`** | **`&a=1`** |

Google Ads auto-tagging produces exactly this shape: `?gad_source=1&gad_campaignid=…&gclid=…`.
`gad_source` was in the list, `gad_campaignid` was not, so every paid landing arrived as
`?&gad_campaignid=…&gclid=…`.

### Defect 2 — `regex_replace()` is not global

From the Cloudflare docs: *"When there are multiple matches, only one replacement occurs (the
first one)"* — `regex_replace("/a/a", "/a", "/b") == "/b/a"`. The trailing `+` only merges
**adjacent** parameters, so `utm_source=a&page=2&gclid=b` became `&page=2&gclid=b`. The v0.1.0
README stated that all matches were replaced; that was wrong. A Transform Rule allows a single
`regex_replace()` per expression and no nesting, so this cannot be worked around with a second
pass.

### Defect 3 — rewriting the upstream request breaks redirects

The v0.1.0 README argued that analytics keep working because the rewrite only affects the request
sent to the origin. That holds only when the origin answers **200**. Any 3xx is generated from the
URL the origin received:

```
$ curl -sIL 'https://store-c.example/?gclid=T'
HTTP/2 301
location: https://www.store-c.example/          ← gclid gone
HTTP/2 200

$ curl -sIL 'https://store-c.example/category?gclid=T&a=1'
HTTP/2 301
location: https://www.store-c.example/category?&a=1 ← gclid gone, dangling &
HTTP/2 301
location: https://www.store-c.example/category/?a=1
HTTP/2 200
```

Typical WordPress/WooCommerce sources of such redirects: apex ↔ `www`, missing trailing slash,
`redirect_canonical()`, the Redirection plugin, language switchers. No regex can fix this, because
the information the redirect needs has already been removed.

### Where the regex came from

The *Super Page Cache* WordPress plugin (formerly *WP Cloudflare Super Page Cache*) creates an
identical rule (`[DO NOT EDIT] WP Super Page Cache Plugin rules for …`) when its "strip tracking
parameters" option is enabled. v0.1.0 of this repository published that rule as a standalone
template.

## Detection

Manual. A test URL with `fbclid` in the first position ended on a URL without it, and the nginx
access log showed a query string starting with `&`. No monitoring would have caught it: the
origin returns valid 301s and 200s, and the loss happens in the visitor's browser.

## Resolution

1. **Rule disabled** on every affected zone, after exporting the phase to a backup. Store E's rule
   is owned by the plugin and has to be switched off there.
2. **Worker** ([`worker/src/index.js`](worker/src/index.js)) on the affected zones:
   - strips marketing parameters from `GET`/`HEAD` in any position and any number, working on raw
     `name=value` segments so kept parameters reach the origin byte-for-byte;
   - fetches the origin with `redirect: "manual"`;
   - if the response is a 3xx to the **same site** (`www` ↔ apex included), appends the stripped
     parameters to `Location`, skipping any the origin already kept;
   - leaves cross-site redirects (payment gateways) untouched.

   Trade-off, unchanged from v0.1.0 and now documented: the origin does not see the stripped
   parameters, so anything that reads them server-side from the landing request loses them.
3. **Same requests after the fix** (Store C):

   ```
   $ curl -sIL 'https://store-c.example/?gad_source=1&gad_campaignid=1&gbraid=B&gclid=T'
   HTTP/2 301
   location: https://www.store-c.example/?gad_source=1&gad_campaignid=1&gbraid=B&gclid=T
   HTTP/2 200
   cf-cache-status: HIT                            ← the cache gain the rule was for

   $ curl -sIL 'https://store-c.example/category?gclid=T&a=1'
   HTTP/2 301
   location: https://www.store-c.example/category?a=1&gclid=T
   HTTP/2 301
   location: https://www.store-c.example/category/?a=1&gclid=T
   HTTP/2 200
   ```

4. Parameter list reviewed: non-marketing entries (`ref`, `ao_noptimize`, `cn-reloaded`, `usqp`,
   `age-verified`, `redirect_*mongo_id`, `sb_referer_host`) removed; `gad_campaignid`, `srsltid`,
   `dclid`, `li_fat_id`, `twclid` added; `utm_*`, `mtm_*`, `pk_*` matched by prefix.

## What went well

- Origin access logs with the full query string made the root cause provable in minutes.
- Rules were disabled, not deleted, with a JSON backup of each phase — rollback stayed one call away.
- A single-zone pilot surfaced the deployment gotchas below before the second zone.

## What went wrong

- The rule was published and deployed without a test matrix that covered parameter **position**
  or origin **redirects**.
- The README's claim about analytics was reasoned, not tested.
- The rule was copied from a widely installed plugin and trusted for that reason.

## Gotchas found while fixing

- **Workers route failure mode defaults to *fail closed*.** On the Free plan (100,000 Worker
  requests/day per account), exceeding the limit would make the whole site return error 1027.
  Set *fail open* so traffic goes straight to the origin with the full URL instead.
- **`cf deploy` resets every route of the Worker to *fail closed*.** Fixed by
  [`scripts/ensure-routes.mjs`](worker/scripts/ensure-routes.mjs), run as part of `npm run deploy`.
- **Worker routes cannot match on the query string**, so the Worker runs on every request of its
  route. Script-less routes for static and admin paths keep the request count down.
  On Store B: ~2.8k Worker requests overnight versus ~7.2k origin requests.
- Cloudflare **Snippets** would be the ideal runtime (they trigger on a rule expression, so only
  for URLs that carry tracking parameters, and are not billed per request), but they require the
  Pro plan. The Worker is plain JavaScript and runs as a Snippet unchanged.

## Action items

| | Item | Status |
|---|---|---|
| ✅ | Disable the rule on all zones that had it (except the plugin-owned one) | Done |
| ✅ | Replace with a Worker that restores parameters on same-site redirects | Done |
| ✅ | Test matrix: position, non-adjacent params, redirects, cross-site redirects, encoding | Done (`npm test`, stub origin) |
| ✅ | Mark the v0.1.0 expressions as withdrawn ([`legacy/`](legacy/)) | Done |
| ⬜ | Switch off "strip tracking parameters" in Super Page Cache on Store E | Open |
| ⬜ | Report the defect upstream to the Super Page Cache plugin | Open |
| ✅ | Stop relying on manual dashboard fixes for fail open: `npm run deploy` re-applies it via the API, `npm run routes:check` verifies | Done (stub API tests; first real run pending an API token) |
| ✅ | Document that the origin no longer sees tracking params (server-side readers lose them) | Done — README *When to use it* |
