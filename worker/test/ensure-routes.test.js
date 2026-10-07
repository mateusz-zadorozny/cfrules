// Stub Cloudflare API: proves the plan/apply logic, not the real API.
import { test } from "node:test";
import assert from "node:assert/strict";
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

test("a route owned by another Worker is reported, never overwritten", async () => {
	const { call, calls } = stubApi([{ id: "w", pattern: "x.pl/*", script: "other-worker", request_limit_fail_open: true }, ...exclusions]);
	assert.equal(await run({ zones, call, check: false, log: quiet }), 1);
	assert.equal(calls.filter((c) => c.method !== "GET").length, 0);
});
