# Changelog

## [0.2.0] — 2026-10-07

### ⚠️ Breaking

- **The v0.1.0 Transform Rule is withdrawn** and moved to [`legacy/`](legacy/). It dropped click IDs
  (`gclid`, `fbclid`, `gad_source`) on origin redirects and produced `?&` query strings that
  WordPress answers with a 301. See [POSTMORTEM.md](POSTMORTEM.md) and
  [issue #1](https://github.com/mateusz-zadorozny/cfrules/issues/1).

### Added

- [`worker/`](worker/): Cloudflare Worker that strips marketing parameters before the origin and
  re-appends them to same-site redirect `Location` headers. Works unchanged as a Snippet.
- Test suite (`npm test`, stub origin, 16 cases).
- `hosts.json` (gitignored) for per-account routes; `hosts.example.json` as a template.
- Parameters: `gad_campaignid`, `srsltid`, `dclid`, `li_fat_id`, `twclid`; any `utm_*`, `mtm_*`,
  `pk_*` by prefix; case-insensitive matching.
- [POSTMORTEM.md](POSTMORTEM.md).

### Removed

- Non-marketing parameters from the strip list: `ref`, `ao_noptimize`, `cn-reloaded`, `usqp`,
  `age-verified`, `redirect_log_mongo_id`, `redirect_mongo_id`, `sb_referer_host`.

## [0.1.0] — 2026-06

- Cloudflare URL Rewrite Transform Rule stripping tracking parameters. **Withdrawn in 0.2.0.**

[0.2.0]: https://github.com/mateusz-zadorozny/cfrules/releases/tag/v0.2.0
