# Cloudflare Transform Rule — Strip Tracking Parameters from URLs

[![My Services](https://img.shields.io/badge/MY_SERVICES-SHIFT64.COM-C2703D?style=for-the-badge&labelColor=4A4A4A)](https://shift64.com)

A single Cloudflare **Transform Rule** that detects and removes tracking / analytics query parameters (UTM, Facebook `fbclid`, Google `gclid`, Matomo, Piwik, Mailchimp, Klaviyo, Microsoft `msclkid`, and many more) from incoming request URLs — **before** the request reaches your origin or cache.

The result: clean, canonical URLs. One cache entry per page instead of one per campaign link, better cache hit ratios, cleaner analytics, and no tracking junk leaking into logs or referrers.

---

## Table of contents

- [How it works](#how-it-works)
- [Why do this at the edge?](#why-do-this-at-the-edge)
- [Prerequisites](#prerequisites)
- [Step-by-step setup (Cloudflare Dashboard)](#step-by-step-setup-cloudflare-dashboard)
- [The two expressions](#the-two-expressions)
- [Understanding the regex](#understanding-the-regex)
- [Testing](#testing)
- [Customizing the parameter list](#customizing-the-parameter-list)
- [Caveats & gotchas](#caveats--gotchas)
- [Files in this repo](#files-in-this-repo)

---

## How it works

A Transform Rule has two halves:

| Half | Cloudflare term | What it does here |
|------|-----------------|-------------------|
| **If** | *Custom filter expression* | Fires only when the query string contains at least one tracking parameter. |
| **Then** | *Rewrite URL → Query → Rewrite to → Dynamic* | Runs a `regex_replace()` that strips every known tracking parameter from the query string, leaving the rest intact. |

A visitor lands on:

```
https://example.com/blog/post?id=42&utm_source=newsletter&utm_medium=email&fbclid=AbC123
```

Cloudflare rewrites it to:

```
https://example.com/blog/post?id=42
```

The legitimate `id=42` parameter survives; the tracking ones are gone.

> **Note on rewrite vs. redirect:** This is a **rewrite** (a *Transform Rule*), not a 301/302 redirect. The visitor's address bar still shows the original messy URL, but Cloudflare and your origin/cache see the clean version. If you want the browser's address bar cleaned too, you need a **Redirect Rule** instead — see [Caveats](#caveats--gotchas).

---

## Why do this at the edge?

- **Cache efficiency.** `?utm_source=a` and `?utm_source=b` are, by default, two different cache keys for the *same* page. Stripping them collapses thousands of campaign variants into one cached object → far higher cache hit ratio and less origin load.
- **Cleaner analytics & logs.** Tracking params stop polluting your server logs and origin-side analytics.
- **Zero origin code.** No plugin, no `.htaccess`, no application change. It runs in Cloudflare's network.
- **Privacy hygiene.** Click identifiers like `fbclid`/`gclid` never reach your backend.

**Trade-off to be aware of:** because this is a *rewrite*, server-side analytics on your origin won't see the UTM values either. If your campaign attribution depends on the origin reading UTMs, do attribution **client-side** (the params are still in the browser URL) or use a Redirect Rule and capture them before redirecting. See [Caveats](#caveats--gotchas).

---

## Prerequisites

- A domain active on Cloudflare (any plan — Transform Rules are available on Free and up).
- Access to the Cloudflare Dashboard with permission to edit **Rules**.

---

## Step-by-step setup (Cloudflare Dashboard)

1. **Log in** to the [Cloudflare Dashboard](https://dash.cloudflare.com) and select your domain (zone).

2. In the left sidebar go to **Rules → Overview** (on some accounts: **Rules → Transform Rules**).

3. Click **Create rule**, then choose **Rewrite URL**.
   *(Menu wording varies slightly by account — you want the rule type that lets you rewrite the **Path** and **Query**, not the Redirect type.)*

4. **Name your rule**, e.g. `Strip tracking parameters`.

5. Under **If… / When incoming requests match…**, select **Custom filter expression**.

   > *"Only apply the rule to requests matching the custom filter expression."*

6. Click **Edit expression** (the `</>` toggle) to switch to the raw expression editor and paste the contents of **[`filter-expression.txt`](filter-expression.txt)** (also shown [below](#1-filter-expression-the-if)).

7. Scroll to the **Then… / Set Rewrite parameters** section.

   - **Path** → leave on **Preserve** (we are not touching the path).
   - **Query** → select **Rewrite to…**
   - In the dropdown next to the Query field, choose **Dynamic** (not *Static*). Dynamic lets you use an expression/function as the value.
   - Paste the contents of **[`rewrite-expression.txt`](rewrite-expression.txt)** (also shown [below](#2-rewrite-expression-the-then)) into the value field.

8. Click **Deploy** (or **Save**).

That's it. Hit a URL with a `?utm_source=...` and watch it get cleaned.

---

## The two expressions

### 1. Filter expression (the *If*)

This decides **whether** the rule runs. It checks if the query string contains any of the tracked parameter names.

```
(http.request.uri.query contains "utm_source") or (http.request.uri.query contains "utm_medium") or (http.request.uri.query contains "utm_campaign") or (http.request.uri.query contains "utm_expid") or (http.request.uri.query contains "utm_term") or (http.request.uri.query contains "utm_content") or (http.request.uri.query contains "utm_id") or (http.request.uri.query contains "utm_source_platform") or (http.request.uri.query contains "utm_creative_format") or (http.request.uri.query contains "utm_marketing_tactic") or (http.request.uri.query contains "mtm_source") or (http.request.uri.query contains "mtm_medium") or (http.request.uri.query contains "mtm_campaign") or (http.request.uri.query contains "mtm_keyword") or (http.request.uri.query contains "mtm_cid") or (http.request.uri.query contains "mtm_content") or (http.request.uri.query contains "pk_source") or (http.request.uri.query contains "pk_medium") or (http.request.uri.query contains "pk_campaign") or (http.request.uri.query contains "pk_keyword") or (http.request.uri.query contains "pk_cid") or (http.request.uri.query contains "pk_content") or (http.request.uri.query contains "fb_action_ids") or (http.request.uri.query contains "fb_action_types") or (http.request.uri.query contains "fb_source") or (http.request.uri.query contains "fbclid") or (http.request.uri.query contains "campaignid") or (http.request.uri.query contains "adgroupid") or (http.request.uri.query contains "adid") or (http.request.uri.query contains "gclid") or (http.request.uri.query contains "age-verified") or (http.request.uri.query contains "ao_noptimize") or (http.request.uri.query contains "usqp") or (http.request.uri.query contains "cn-reloaded") or (http.request.uri.query contains "_ga") or (http.request.uri.query contains "sscid") or (http.request.uri.query contains "gclsrc") or (http.request.uri.query contains "_gl") or (http.request.uri.query contains "mc_cid") or (http.request.uri.query contains "mc_eid") or (http.request.uri.query contains "_bta_tid") or (http.request.uri.query contains "_bta_c") or (http.request.uri.query contains "trk_contact") or (http.request.uri.query contains "trk_msg") or (http.request.uri.query contains "trk_module") or (http.request.uri.query contains "trk_sid") or (http.request.uri.query contains "gdfms") or (http.request.uri.query contains "gdftrk") or (http.request.uri.query contains "gdffi") or (http.request.uri.query contains "_ke") or (http.request.uri.query contains "_kx") or (http.request.uri.query contains "redirect_log_mongo_id") or (http.request.uri.query contains "redirect_mongo_id") or (http.request.uri.query contains "sb_referer_host") or (http.request.uri.query contains "mkwid") or (http.request.uri.query contains "pcrid") or (http.request.uri.query contains "ef_id") or (http.request.uri.query contains "s_kwcid") or (http.request.uri.query contains "msclkid") or (http.request.uri.query contains "dm_i") or (http.request.uri.query contains "epik") or (http.request.uri.query contains "pp") or (http.request.uri.query contains "gbraid") or (http.request.uri.query contains "wbraid") or (http.request.uri.query contains "ssp_iabi") or (http.request.uri.query contains "ssp_iaba") or (http.request.uri.query contains "gad") or (http.request.uri.query contains "vgo_ee") or (http.request.uri.query contains "gad_source") or (http.request.uri.query contains "ref") or (http.request.uri.query contains "ttclid")
```

### 2. Rewrite expression (the *Then*)

This is the **Query → Rewrite to → Dynamic** value. It rebuilds the query string without the tracking parameters.

```
regex_replace(http.request.uri.query, "(?:(?:^|&)(?:utm_source|utm_medium|utm_campaign|utm_expid|utm_term|utm_content|utm_id|utm_source_platform|utm_creative_format|utm_marketing_tactic|mtm_source|mtm_medium|mtm_campaign|mtm_keyword|mtm_cid|mtm_content|pk_source|pk_medium|pk_campaign|pk_keyword|pk_cid|pk_content|fb_action_ids|fb_action_types|fb_source|fbclid|campaignid|adgroupid|adid|gclid|age-verified|ao_noptimize|usqp|cn-reloaded|_ga|sscid|gclsrc|_gl|mc_cid|mc_eid|_bta_tid|_bta_c|trk_contact|trk_msg|trk_module|trk_sid|gdfms|gdftrk|gdffi|_ke|_kx|redirect_log_mongo_id|redirect_mongo_id|sb_referer_host|mkwid|pcrid|ef_id|s_kwcid|msclkid|dm_i|epik|pp|gbraid|wbraid|ssp_iabi|ssp_iaba|gad|vgo_ee|gad_source|ref|ttclid)=[^&]*)+", "")
```

---

## Understanding the regex

If you've never read a regex like this, here's the intuition. We're operating on the **query string only** — the part after the `?`, e.g. `id=42&utm_source=news&fbclid=abc`.

```
(?:(?:^|&)(?:utm_source|utm_medium|...|ttclid)=[^&]*)+
```

Breaking it down piece by piece:

- `(?: ... )` — a **non-capturing group**. It groups things together without saving a numbered backreference (slightly faster, cleaner).
- `(?:^|&)` — match either the **start of the string** (`^`) or a **`&`** separator. This is what anchors us to the *beginning of a parameter*, so we don't accidentally match `utm_source` if it appeared inside some value.
- `(?:utm_source|utm_medium|...|ttclid)` — the **alternation list**: match any one of these parameter names. The `|` means "or".
- `=[^&]*` — match the `=` and then the value: `[^&]*` means "any number of characters that are **not** an `&`", i.e. everything up to the next parameter.
- The trailing `+` — match **one or more** consecutive tracking params in a row. This is the clever part: if you have `&utm_source=a&utm_medium=b&fbclid=c` all in a row, they get consumed in a single match (including their leading `&`s), so you don't end up with leftover `&&` gaps.

Replacing all matches with `""` (empty string) deletes them.

### Why `contains` in the filter but a strict regex in the rewrite?

- The **filter** uses cheap `contains` checks just to decide *should we even run this rule?* It's intentionally loose and fast — false positives are harmless because the rewrite does the real work.
- The **rewrite regex** is strict (`=` and `&` boundaries) so it only removes genuine `key=value` parameters and never mangles a path or a legitimate value that merely happens to contain a tracking word.

> **Compared to other approaches:** doing this in Nginx (`map`/`rewrite`), Apache (`mod_rewrite`), or app middleware all work too — but they run *on your origin*, after the request has already crossed the network and possibly missed cache. Cloudflare does it one hop earlier, at the edge, with no deploy.

---

## Testing

After deploying, test with `curl` (look at the final resolved URL / response) or just your browser's network tab.

Cloudflare also provides an **Expression Preview / Trace** tool under **Rules → Trace** where you can feed in a sample URL and confirm which rules fire.

Sample URLs to try:

| Input | Expected output query |
|-------|----------------------|
| `?utm_source=x` | *(empty)* |
| `?id=42&utm_source=x&utm_medium=y` | `id=42` |
| `?gclid=abc&page=2` | `page=2` |
| `?fbclid=a&utm_campaign=b&ref=c` | *(empty)* |
| `?q=hello` | `q=hello` *(rule doesn't fire — nothing to strip)* |

---

## Customizing the parameter list

The list is deliberately broad but you may want to **add** or **remove** entries:

- **To add a parameter:** add it to *both* expressions — a new `or (http.request.uri.query contains "yourparam")` in the filter, and a new `|yourparam` inside the alternation in the rewrite regex.
- **To remove one:** delete it from both places.

### ⚠️ Watch out for `ref` and `pp`

This list includes a couple of **short, generic** names that are common tracking params but can collide with legitimate ones:

- **`ref`** — widely used as a tracking/referrer param, but some apps use `ref` for real functionality (e.g. referral codes, git refs in API calls). If your site uses `ref` meaningfully, **remove it** from both expressions.
- **`pp`** — even more generic. Remove it if you use it for anything real.

Always review the list against your own application's known query parameters before deploying.

---

## Caveats & gotchas

- **Rewrite ≠ redirect (address bar stays dirty).** This Transform Rule cleans the URL that Cloudflare/origin/cache see, but the visitor's browser still shows the original link. To clean the **address bar**, create a **Redirect Rule** that 301s to the stripped URL instead. Downside of redirecting: an extra round-trip for every campaign click.
- **Origin-side attribution.** Since UTMs are stripped before reaching origin, any server-side analytics relying on them won't see them. Move attribution client-side or use a redirect approach that logs first.
- **One leading `?` edge case.** Cloudflare handles the `?` for you (the expression operates on `http.request.uri.query`, which excludes the `?`). You don't need to account for it.
- **Order of rules matters.** If you have other Transform/Redirect rules touching the query, check their execution order under **Rules → Overview**.
- **Expression size limits.** Very large parameter lists can hit the dashboard's expression character limit (the editor shows a counter, e.g. `3434 / 4096`). If you exceed it, split into multiple rules or trim the list.

---

## Files in this repo

| File | Purpose |
|------|---------|
| [`README.md`](README.md) | This guide. |
| [`filter-expression.txt`](filter-expression.txt) | The *If* — paste into the custom filter expression editor. |
| [`rewrite-expression.txt`](rewrite-expression.txt) | The *Then* — paste into Query → Rewrite to → Dynamic. |

---

## License

MIT — use it freely. Attribution appreciated but not required.

---

[![My Services](https://img.shields.io/badge/MY_SERVICES-SHIFT64.COM-C2703D?style=for-the-badge&labelColor=4A4A4A)](https://shift64.com)
