// Stub Cloudflare API: proves the plan/apply logic, not the real API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { run, WORKER } from "../scripts/ensure-routes.mjs";

const zones = [{ zone: "x.pl", hosts: ["x.pl"] }];
const exclusions = ["wp-content", "wp-includes", "wp-admin", "wp-json"].map((p, i) => ({
	id: `e${i}`, pattern: `x.pl/${p}/*`, script: null, request_limit_fail_open: false,
}));

function stubApi(routes) {
	const calls = [];
	const call = async (method, path, body) => {
		calls.push({ method, path, body });
		if (path.startsWith("/zones?name=")) return [{ id: "Z" }];
		if (method === "GET") return routes;
		return {};
	};
	return { call, calls };
}

const quiet = () => {};

test("deploy reset (fail closed) → PUT with request_limit_fail_open: true", async () => {
	const { call, calls } = stubApi([{ id: "w", pattern: "x.pl/*", script: WORKER, request_limit_fail_open: false }, ...exclusions]);
	const unresolved = await run({ zones, call, check: false, log: quiet });
	assert.equal(unresolved, 0);
	assert.deepEqual(calls.filter((c) => c.method !== "GET"), [
		{ method: "PUT", path: "/zones/Z/workers/routes/w", body: { pattern: "x.pl/*", script: WORKER, request_limit_fail_open: true } },
	]);
});

test("missing exclusions are created without a script", async () => {
	const { call, calls } = stubApi([{ id: "w", pattern: "x.pl/*", script: WORKER, request_limit_fail_open: true }]);
	await run({ zones, call, check: false, log: quiet });
	const posts = calls.filter((c) => c.method === "POST");
	assert.deepEqual(posts.map((c) => c.body), [
		{ pattern: "x.pl/wp-content/*" }, { pattern: "x.pl/wp-includes/*" },
		{ pattern: "x.pl/wp-admin/*" }, { pattern: "x.pl/wp-json/*" },
	]);
});

test("--check only reports and counts problems", async () => {
	const { call, calls } = stubApi([{ id: "w", pattern: "x.pl/*", script: WORKER, request_limit_fail_open: false }]);
	const unresolved = await run({ zones, call, check: true, log: quiet });
	assert.equal(unresolved, 5);
	assert.equal(calls.filter((c) => c.method !== "GET").length, 0);
});

test("everything correct → no writes, exit code 0", async () => {
	const { call, calls } = stubApi([{ id: "w", pattern: "x.pl/*", script: WORKER, request_limit_fail_open: true }, ...exclusions]);
	assert.equal(await run({ zones, call, check: true, log: quiet }), 0);
	assert.equal(calls.filter((c) => c.method !== "GET").length, 0);
});

test("host served by another Worker: reported, no exclusions carved into it", async () => {
	const { call, calls } = stubApi([{ id: "w", pattern: "x.pl/*", script: "other-worker", request_limit_fail_open: true }]);
	assert.equal(await run({ zones, call, check: false, log: quiet }), 1);
	assert.equal(calls.filter((c) => c.method !== "GET").length, 0);
});

test("our <host>/* route missing: reported, no exclusions created", async () => {
	const { call, calls } = stubApi([]);
	assert.equal(await run({ zones, call, check: false, log: quiet }), 1);
	assert.equal(calls.filter((c) => c.method !== "GET").length, 0);
});

test("CLI entrypoint runs from a path with a space", () => {
	const dir = mkdtempSync(join(tmpdir(), "dir with space "));
	mkdirSync(join(dir, "scripts"));
	copyFileSync(fileURLToPath(new URL("../scripts/ensure-routes.mjs", import.meta.url)), join(dir, "scripts", "ensure-routes.mjs"));
	const env = { ...process.env };
	delete env.CLOUDFLARE_ROUTES_API_TOKEN;
	delete env.CLOUDFLARE_API_TOKEN;
	const res = spawnSync(process.execPath, [join(dir, "scripts", "ensure-routes.mjs")], { env, encoding: "utf8" });
	rmSync(dir, { recursive: true });
	// exit 2 + message = the main block ran; before the fix it exited 0 silently
	assert.equal(res.status, 2);
	assert.match(res.stderr, /CLOUDFLARE_ROUTES_API_TOKEN/);
});
