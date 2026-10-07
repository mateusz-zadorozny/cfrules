# ⛔ Withdrawn — v0.1.0 Transform Rule

These two expressions were the Cloudflare URL Rewrite Transform Rule published in v0.1.0.
**Don't deploy them.** They leave a dangling `&` when a tracking parameter comes first, remove
only the first group of parameters, and make every origin redirect drop `gclid` / `fbclid` from
the browser URL.

See [../POSTMORTEM.md](../POSTMORTEM.md) and use the Worker in [../worker/](../worker/) instead.
