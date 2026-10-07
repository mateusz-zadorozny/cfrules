// Makes the zone routes match hosts.json after a deploy:
//   - every `<host>/*` route of the Worker is set to fail open
//     (`cf deploy` resets them to fail closed; the field is `request_limit_fail_open`,
//     returned by GET /zones/:id/workers/routes but not in the public API reference);
//   - script-less exclusion routes exist for the static/admin paths.
//
//   node scripts/ensure-routes.mjs           # fix what's wrong
//   node scripts/ensure-routes.mjs --check   # report only, exit 1 if anything is wrong
//
// Needs CLOUDFLARE_ROUTES_API_TOKEN (falls back to CLOUDFLARE_API_TOKEN) with
// Zone → Zone: Read and Zone → Workers Routes: Edit.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const WORKER = "strip-tracking-params";
export const EXCLUDED_PATHS = ["wp-content", "wp-includes", "wp-admin", "wp-json"];

export function plan(zones, routesByZone) {
	const actions = [];
	for (const { zone, hosts } of zones) {
		const routes = routesByZone[zone];
		for (const host of hosts) {
			const pattern = `${host}/*`;
			const route = routes.find((r) => r.pattern === pattern);
			// Without our own `<host>/*` route, exclusions would only carve holes into whatever
			// else serves the host — e.g. let /wp-admin/* bypass another Worker's access control.
			// Report and leave the host alone.
			if (!route) {
				actions.push({ zone, kind: "missing-worker-route", pattern });
				continue;
			}
			if (route.script !== WORKER) {
				actions.push({ zone, kind: "foreign-worker-route", pattern, script: route.script });
				continue;
			}
			if (route.request_limit_fail_open !== true) actions.push({ zone, kind: "fail-open", route });

			for (const path of EXCLUDED_PATHS) {
				const exclusion = `${host}/${path}/*`;
				const existing = routes.find((r) => r.pattern === exclusion);
				if (!existing) actions.push({ zone, kind: "create-exclusion", pattern: exclusion });
				else if (existing.script) actions.push({ zone, kind: "foreign-exclusion", pattern: exclusion, script: existing.script });
			}
		}
	}
	return actions;
}

// Only these are safe to apply automatically; the rest need a human (or `cf deploy`).
const FIXABLE = new Set(["fail-open", "create-exclusion"]);

export function api(token, fetchImpl = fetch) {
	return async (method, path, body) => {
		const res = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
			method,
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: body && JSON.stringify(body),
		});
		const json = await res.json();
		if (!json.success) throw new Error(`${method} ${path}: ${JSON.stringify(json.errors)}`);
		return json.result;
	};
}

export async function run({ zones, call, check, log = console.log }) {
	const zoneIds = {};
	const routesByZone = {};
	for (const { zone } of zones) {
		const [found] = await call("GET", `/zones?name=${encodeURIComponent(zone)}`);
		if (!found) throw new Error(`zone not found: ${zone}`);
		zoneIds[zone] = found.id;
		routesByZone[zone] = await call("GET", `/zones/${found.id}/workers/routes`);
	}

	const actions = plan(zones, routesByZone);
	let unresolved = 0;
	for (const a of actions) {
		const label = a.pattern ?? a.route.pattern;
		if (check || !FIXABLE.has(a.kind)) {
			log(`✖ ${a.zone}: ${a.kind} ${label}${a.script ? ` (script: ${a.script})` : ""}`);
			unresolved++;
		} else if (a.kind === "fail-open") {
			const { id, pattern, script } = a.route;
			await call("PUT", `/zones/${zoneIds[a.zone]}/workers/routes/${id}`, { pattern, script, request_limit_fail_open: true });
			log(`✔ ${a.zone}: fail open set on ${pattern}`);
		} else {
			await call("POST", `/zones/${zoneIds[a.zone]}/workers/routes`, { pattern: a.pattern });
			log(`✔ ${a.zone}: exclusion route created ${a.pattern}`);
		}
	}
	if (actions.length === 0) log("✔ all routes match hosts.json (fail open, exclusions present)");
	return unresolved;
}

// Compare real filesystem paths, not URL strings: import.meta.url percent-encodes spaces and
// resolves symlinks (macOS /var → /private/var), so `file://${argv[1]}` silently never matched.
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
if (isCli) {
	// A separate variable on purpose: CLOUDFLARE_API_TOKEN also replaces the `cf` CLI login, so a
	// routes-only token there would break `cf deploy` in the same shell.
	const token = process.env.CLOUDFLARE_ROUTES_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;
	if (!token) {
		console.error("Set CLOUDFLARE_ROUTES_API_TOKEN (Zone: Read + Workers Routes: Edit). See README → Setup.");
		process.exit(2);
	}
	const zones = JSON.parse(readFileSync(new URL("../hosts.json", import.meta.url), "utf8"));
	const unresolved = await run({ zones, call: api(token), check: process.argv.includes("--check") });
	process.exit(unresolved ? 1 : 0);
}
