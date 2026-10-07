# Changelog

## [0.2.1] — 2026-10-07

### Fixed

- `ensure-routes.mjs` no longer creates exclusion routes for a host whose `<host>/*` route is
  missing or owned by another Worker. Before, `/wp-admin/*` etc. could be carved out of that
  Worker, bypassing it (and any access control it does).
- `ensure-routes.mjs` silently did nothing (exit 0) when run from a path with a space or through
  a symlink (e.g. macOS `/var` → `/private/var`). CLI detection now compares real paths.
- The routes token moved to `CLOUDFLARE_ROUTES_API_TOKEN` (falls back to `CLOUDFLARE_API_TOKEN`).
  Exporting a routes-only token as `CLOUDFLARE_API_TOKEN`, as the 0.2.0 README said, replaced the
  `cf` login and broke `cf deploy`. README documents both credentials and their permissions.

## [0.2.0] — 2026-10-07

### ⚠️ Breaking

- **The v0.1.0 Transform Rule is withdrawn** and moved to [`legacy/`](legacy/). It dropped click IDs
  (`gclid`, `fbclid`, `gad_source`) on origin redirects and produced `?&` query strings that
  WordPress answers with a 301. See [POSTMORTEM.md](POSTMORTEM.md) and
  [issue #1](https://github.com/mateusz-zadorozny/cfrules/issues/1).

### Added

- [`worker/`](worker/): Cloudflare Worker that strips marketing parameters before the origin and
  re-appends them to same-site redirect `Location` headers. Works unchanged as a Snippet.
- `scripts/ensure-routes.mjs` (run by `npm run deploy`): sets every Worker route to fail open —
  `cf deploy` resets them to fail closed — and creates the static/admin exclusion routes;
  `npm run routes:check` verifies without writing.
- Test suite (`npm test`: 18 Worker cases against a stub origin, 5 route-script cases against a stub API).
- `hosts.json` (gitignored) for per-account routes; `hosts.example.json` as a template.
- Parameters: `gad_campaignid`, `srsltid`, `dclid`, `li_fat_id`, `twclid`; any `utm_*`, `mtm_*`,
  `pk_*` by prefix; case-insensitive and percent-decoded name matching (also when de-duplicating
  restored params against `Location`).
- [POSTMORTEM.md](POSTMORTEM.md); README section on when the Worker fits (server-side readers of
  tracking params lose them).

### Removed

- Non-marketing parameters from the strip list: `ref`, `ao_noptimize`, `cn-reloaded`, `usqp`,
  `age-verified`, `redirect_log_mongo_id`, `redirect_mongo_id`, `sb_referer_host`.

## [0.1.0] — 2026-06

- Cloudflare URL Rewrite Transform Rule stripping tracking parameters. **Withdrawn in 0.2.0.**

[0.2.1]: https://github.com/mateusz-zadorozny/cfrules/releases/tag/v0.2.1
[0.2.0]: https://github.com/mateusz-zadorozny/cfrules/releases/tag/v0.2.0
