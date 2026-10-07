// Local stub harness: global fetch is replaced by a fake origin. Proves the Worker logic,
// not Cloudflare's runtime or a real WordPress.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { splitQuery } from "../src/index.js";

function fakeOrigin(respond) {
	const seen = [];
	globalThis.fetch = async (input, init = {}) => {
		const req = new Request(input, init);
		seen.push({ url: req.url, redirect: init.redirect ?? req.redirect });
		return respond(new URL(req.url));
	};
	return seen;
}

const ok = () => new Response("ok", { status: 200 });
const redirectTo = (location, status = 301) => () =>
	new Response(null, { status, headers: { Location: location } });

const run = (url, method = "GET") => worker.fetch(new Request(url, { method }));

test("issue #1: tracking param first, normal param after — no dangling &", async () => {
	const seen = fakeOrigin(ok);
	await run("https://wceu.shift64.com/?fbclid=123&non_ma=123");
	assert.equal(seen[0].url, "https://wceu.shift64.com/?non_ma=123");
});

test("non-contiguous tracking params are all removed", async () => {
	const seen = fakeOrigin(ok);
	await run("https://x.pl/p/?utm_source=a&page=2&gclid=b&utm_medium=c&q=d");
	assert.equal(seen[0].url, "https://x.pl/p/?page=2&q=d");
});

test("only tracking params → origin gets no query at all", async () => {
	const seen = fakeOrigin(ok);
	await run("https://x.pl/p/?utm_source=a&fbclid=b");
	assert.equal(seen[0].url, "https://x.pl/p/");
});

test("no tracking params → request passed through untouched", async () => {
	const seen = fakeOrigin(ok);
	await run("https://x.pl/p/?ref=abc&a=%20b&utm=x");
	assert.equal(seen[0].url, "https://x.pl/p/?ref=abc&a=%20b&utm=x");
});

test("kept params are forwarded byte-for-byte", async () => {
	const seen = fakeOrigin(ok);
	await run("https://x.pl/?q=a%20b+c&s=%C5%BC&gclid=1");
	assert.equal(seen[0].url, "https://x.pl/?q=a%20b+c&s=%C5%BC");
});

test("names match case-insensitively and with any utm_* suffix", async () => {
	const seen = fakeOrigin(ok);
	await run("https://x.pl/?FBCLID=1&UTM_Source=2&utm_whatever=3&a=1");
	assert.equal(seen[0].url, "https://x.pl/?a=1");
});

test("look-alike names are kept (referrer, gadget, ppc, ref)", async () => {
	const seen = fakeOrigin(ok);
	await run("https://x.pl/?referrer=1&gadget=2&ppc=3&ref=4&fbclid=5");
	assert.equal(seen[0].url, "https://x.pl/?referrer=1&gadget=2&ppc=3&ref=4");
});

test("Google Ads landing on apex, origin 301s to www: gad_source + gad_campaignid + gbraid + gclid", async () => {
	const seen = fakeOrigin(redirectTo("https://www.store.example/"));
	const res = await run("https://store.example/?gad_source=1&gad_campaignid=9&gbraid=B&gclid=G");
	assert.equal(seen[0].url, "https://store.example/");
	assert.equal(res.headers.get("Location"), "https://www.store.example/?gad_source=1&gad_campaignid=9&gbraid=B&gclid=G");
});

test("origin redirect (WP trailing slash) gets the stripped params back", async () => {
	fakeOrigin(redirectTo("https://x.pl/page/?a=1"));
	const res = await run("https://x.pl/page?fbclid=F&a=1&gclid=G");
	assert.equal(res.status, 301);
	assert.equal(res.headers.get("Location"), "https://x.pl/page/?a=1&fbclid=F&gclid=G");
});

test("relative Location is resolved and restored", async () => {
	fakeOrigin(redirectTo("/page/", 302));
	const res = await run("https://x.pl/page?fbclid=F");
	assert.equal(res.headers.get("Location"), "https://x.pl/page/?fbclid=F");
});

test("www ↔ apex redirect counts as same site", async () => {
	fakeOrigin(redirectTo("https://www.x.pl/"));
	const res = await run("https://x.pl/?gclid=G");
	assert.equal(res.headers.get("Location"), "https://www.x.pl/?gclid=G");
});

test("redirect to another site is left alone", async () => {
	fakeOrigin(redirectTo("https://payu.com/pay?id=1", 302));
	const res = await run("https://x.pl/checkout/?fbclid=F");
	assert.equal(res.headers.get("Location"), "https://payu.com/pay?id=1");
});

test("params the origin already kept in Location are not duplicated", async () => {
	fakeOrigin(redirectTo("https://x.pl/b/?fbclid=F"));
	const res = await run("https://x.pl/a/?fbclid=F&utm_source=s");
	assert.equal(res.headers.get("Location"), "https://x.pl/b/?fbclid=F&utm_source=s");
});

test("origin redirects are not followed by the Worker", async () => {
	const seen = fakeOrigin(redirectTo("/b/"));
	await run("https://x.pl/a/?fbclid=F");
	assert.equal(seen.length, 1);
	assert.equal(seen[0].redirect, "manual");
});

test("POST is never rewritten", async () => {
	const seen = fakeOrigin(ok);
	await run("https://x.pl/?wc-ajax=add&utm_source=a", "POST");
	assert.equal(seen[0].url, "https://x.pl/?wc-ajax=add&utm_source=a");
});

test("malformed percent-encoding does not throw", () => {
	assert.deepEqual(splitQuery("?%E0%A4%A=1&fbclid=2"), { kept: ["%E0%A4%A=1"], stripped: ["fbclid=2"] });
});
