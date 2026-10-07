import { existsSync, readFileSync } from "node:fs";
import { defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.js" with { type: "cf-worker" };

// One Worker per account; zones are attached by routes. The host list lives in
// hosts.json (gitignored, see hosts.example.json) so client domains stay out of the repo.
// Without it the Worker deploys with no routes, i.e. it receives no traffic.
type Zone = { zone: string; hosts: string[] };
const hostsFile = new URL("./hosts.json", import.meta.url);
const zones: Zone[] = existsSync(hostsFile) ? JSON.parse(readFileSync(hostsFile, "utf8")) : [];

export default defineConfig({
	worker: {
		name: "strip-tracking-params",
		compatibilityDate: "2026-09-25",
		entrypoint,
		workersDev: false,
		triggers: zones.flatMap(({ zone, hosts }) =>
			hosts.map((host) => triggers.fetch({ pattern: `${host}/*`, zone })),
		),
	},
});
