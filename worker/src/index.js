// Strips marketing params from the query before it reaches the origin (better page-cache
// hit rate), and puts them back on any same-site redirect the origin returns, so e.g.
// WordPress's `/page` → `/page/` 301 doesn't lose fbclid/gclid.
//
// Plain JS on purpose: the same file works as a Cloudflare Snippet (Pro plan) unchanged.

const TRACKING_PREFIXES = ["utm_", "mtm_", "pk_"];

const TRACKING_PARAMS = new Set([
	// Google
	"gclid", "gclsrc", "gbraid", "wbraid", "gad", "gad_source", "gad_campaignid", "srsltid",
	"_ga", "_gl", "dclid",
	"campaignid", "adgroupid", "adid", "s_kwcid", "ef_id", "mkwid", "pcrid",
	// Meta
	"fbclid", "fb_action_ids", "fb_action_types", "fb_source",
	// Microsoft, TikTok, Pinterest, LinkedIn, X
	"msclkid", "ttclid", "epik", "pp", "li_fat_id", "twclid",
	// Mailchimp, Klaviyo, other mailing / affiliate trackers
	"mc_cid", "mc_eid", "_ke", "_kx", "trk_contact", "trk_msg", "trk_module", "trk_sid",
	"_bta_tid", "_bta_c", "gdfms", "gdftrk", "gdffi", "sscid", "dm_i",
	"ssp_iabi", "ssp_iaba", "vgo_ee",
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function isTrackingParam(rawName) {
	let name;
	try {
		name = decodeURIComponent(rawName.replace(/\+/g, " ")).toLowerCase();
	} catch {
		return false;
	}
	return TRACKING_PARAMS.has(name) || TRACKING_PREFIXES.some((p) => name.startsWith(p));
}

// Works on raw `a=1&b=2` segments instead of URLSearchParams so the kept params reach
// the origin byte-for-byte (URLSearchParams would re-encode them, e.g. %20 → +).
export function splitQuery(search) {
	const kept = [];
	const stripped = [];
	for (const segment of search.replace(/^\?/, "").split("&")) {
		if (segment === "") continue;
		const name = segment.split("=", 1)[0];
		(isTrackingParam(name) ? stripped : kept).push(segment);
	}
	return { kept, stripped };
}

function sameSite(a, b) {
	const bare = (host) => host.replace(/^www\./, "");
	return bare(a) === bare(b);
}

export function restoreParams(location, requestUrl, stripped) {
	const target = new URL(location, requestUrl);
	if (!sameSite(target.hostname, requestUrl.hostname)) return null;

	const present = new Set(splitQuery(target.search).stripped.map((s) => s.split("=", 1)[0]));
	const missing = stripped.filter((s) => !present.has(s.split("=", 1)[0]));
	if (missing.length === 0) return null;

	const query = target.search.replace(/^\?/, "");
	target.search = (query ? query + "&" : "") + missing.join("&");
	return target.toString();
}

export default {
	async fetch(request) {
		if (request.method !== "GET" && request.method !== "HEAD") return fetch(request);

		const url = new URL(request.url);
		const { kept, stripped } = splitQuery(url.search);
		if (stripped.length === 0) return fetch(request);

		url.search = kept.join("&");
		const response = await fetch(new Request(url, request), { redirect: "manual" });

		const location = response.headers.get("Location");
		if (!REDIRECT_STATUSES.has(response.status) || !location) return response;

		const restored = restoreParams(location, url, stripped);
		if (!restored) return response;

		const redirected = new Response(response.body, response);
		redirected.headers.set("Location", restored);
		return redirected;
	},
};
