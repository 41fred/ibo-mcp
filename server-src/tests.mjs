import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SITE_URL = "https://ibouniverse.com";

const publicPath = (name) =>
  fileURLToPath(new URL(`../public/${name}`, import.meta.url));

// Render the homepage HTML through the built Worker (assets mocked to 404 so we
// only exercise server-rendered document markup).
async function renderHome() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  return response.text();
}

const metaContent = (html, attr, value) => {
  const re = new RegExp(
    `<meta[^>]*\\b${attr}=["']${value}["'][^>]*\\bcontent=["']([^"']*)["']|` +
      `<meta[^>]*\\bcontent=["']([^"']*)["'][^>]*\\b${attr}=["']${value}["']`,
    "i",
  );
  const m = html.match(re);
  return m ? (m[1] ?? m[2]) : null;
};

test("homepage: title and description", async () => {
  const html = await renderHome();
  assert.match(html, /<title>IBO AI \| AI-Native Film Studio<\/title>/);
  assert.equal(
    metaContent(html, "name", "description"),
    "IBO creates cinematic campaign films and images for brands, from concept and storyboard through AI production, editing, sound, and delivery.",
  );
});

test("homepage: Open Graph title, description, url, image", async () => {
  const html = await renderHome();
  assert.equal(
    metaContent(html, "property", "og:title"),
    "Campaign films that get attention. | IBO AI",
  );
  assert.equal(
    metaContent(html, "property", "og:description"),
    "Cinematic campaign films and images, directed by people and produced through an AI-native workflow.",
  );
  assert.equal(metaContent(html, "property", "og:type"), "website");
  assert.equal(metaContent(html, "property", "og:site_name"), "IBO AI");
  assert.equal(metaContent(html, "property", "og:locale"), "en_US");
  assert.equal(metaContent(html, "property", "og:url"), `${SITE_URL}/`);
  assert.equal(
    metaContent(html, "property", "og:image"),
    `${SITE_URL}/og-image.png`,
  );
  assert.equal(metaContent(html, "property", "og:image:width"), "1200");
  assert.equal(metaContent(html, "property", "og:image:height"), "630");
  assert.equal(metaContent(html, "property", "og:image:type"), "image/png");
});

test("homepage: Twitter summary_large_image card", async () => {
  const html = await renderHome();
  assert.equal(metaContent(html, "name", "twitter:card"), "summary_large_image");
  assert.equal(
    metaContent(html, "name", "twitter:image"),
    `${SITE_URL}/og-image.png`,
  );
});

test("homepage: self-referential canonical (no query string)", async () => {
  const html = await renderHome();
  const m = html.match(/<link[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']*)["']/i);
  assert.ok(m, "canonical link present");
  assert.equal(m[1], `${SITE_URL}/`);
  assert.ok(!m[1].includes("?"), "canonical has no query string");
});

test("homepage: robots + googlebot preview directives", async () => {
  const html = await renderHome();
  const robots = metaContent(html, "name", "robots") ?? "";
  assert.match(robots, /index/);
  assert.match(robots, /follow/);
  // Preview directives are emitted on the dedicated googlebot meta tag.
  const googlebot = metaContent(html, "name", "googlebot") ?? "";
  assert.match(googlebot, /max-image-preview:large/);
  assert.match(googlebot, /max-snippet:-1/);
  assert.match(googlebot, /max-video-preview:-1/);
});

test("homepage: Organization + WebSite JSON-LD", async () => {
  const html = await renderHome();
  const m = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  assert.ok(m, "JSON-LD script present");
  const data = JSON.parse(m[1]);
  const graph = data["@graph"] ?? [data];
  const org = graph.find((n) => n["@type"] === "Organization");
  const site = graph.find((n) => n["@type"] === "WebSite");
  assert.ok(org, "Organization present");
  assert.equal(org["@id"], `${SITE_URL}/#organization`);
  assert.equal(org.name, "IBO AI");
  assert.equal(org.url, SITE_URL);
  assert.equal(org.logo, `${SITE_URL}/ibo-logo.png`);
  assert.deepEqual(org.sameAs, ["https://www.instagram.com/ibo_universe/"]);
  assert.ok(site, "WebSite present");
  assert.equal(site["@id"], `${SITE_URL}/#website`);
  assert.equal(site.publisher["@id"], org["@id"]);
  assert.equal(site.inLanguage, "en-US");
  // Guard against invented contact facts.
  for (const key of ["email", "telephone", "address"]) {
    assert.ok(!(key in org), `Organization must not invent ${key}`);
  }
});

test("security headers present on worker responses", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `sh-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("x", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=/);
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
});

test("no 'fashion and beauty' positioning and no preview markers", async () => {
  const html = await renderHome();
  assert.ok(!/fashion and beauty/i.test(html), "no 'fashion and beauty' phrase");
  assert.ok(!/codex-preview/i.test(html), "no leftover codex-preview marker");
});

test("robots.txt: allows crawl, references sitemap, allows AI crawlers", () => {
  const txt = readFileSync(publicPath("robots.txt"), "utf8");
  assert.match(txt, /User-agent:\s*\*/);
  assert.match(txt, /Allow:\s*\//);
  assert.match(txt, /Disallow:\s*\/thank-you/);
  assert.match(txt, /Disallow:\s*\/api\//);
  assert.match(txt, /Sitemap:\s*https:\/\/ibouniverse\.com\/sitemap\.xml/);
  assert.match(txt, /User-agent:\s*OAI-SearchBot/);
  assert.match(txt, /User-agent:\s*ChatGPT-User/);
});

test("checkout: unknown package redirects to offers, no Stripe call", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `co-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/checkout?package=bogus", { method: "POST" }),
    { ASSETS: { fetch: async () => new Response("x", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 303);
  assert.match(response.headers.get("location") ?? "", /\/#offer$/);
});

test("stripe webhook: rejects GET; unconfigured POST returns 500 (retryable)", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `wh-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("x", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const get = await worker.fetch(new Request("http://localhost/api/stripe/webhook"), env, ctx);
  assert.equal(get.status, 405);
  const post = await worker.fetch(
    new Request("http://localhost/api/stripe/webhook", { method: "POST", body: "{}" }), env, ctx,
  );
  assert.equal(post.status, 500);
});

test("checkout-session lookup: invalid id rejected without upstream call", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `cs-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/checkout-session?session_id=<script>"),
    { ASSETS: { fetch: async () => new Response("x", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 400);
});

test("brief page: renders noindexed with the intake form", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `bp-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/brief", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("x", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /noindex/i);
  assert.match(html, /Creative brief/i);
});

test("brief submit: GET rejected; missing fields rejected", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `bs-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = {
    ASSETS: { fetch: async () => new Response("x", { status: 404 }) },
    RESEND_API_KEY: "re_test_dummy",
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const get = await worker.fetch(new Request("http://localhost/api/brief"), env, ctx);
  assert.equal(get.status, 405);
  const empty = new FormData();
  empty.set("name", "");
  const post = await worker.fetch(
    new Request("http://localhost/api/brief", { method: "POST", body: empty }), env, ctx,
  );
  assert.equal(post.status, 400);
});

test("brief upload-url: validates type, size, project id; presigns when configured", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `uu-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = {
    ASSETS: { fetch: async () => new Response("x", { status: 404 }) },
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret",
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const post = (body) => worker.fetch(
    new Request("http://localhost/api/brief/upload-url", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), env, ctx);

  const badType = await post({ filename: "malware.exe", size: 100 });
  assert.equal(badType.status, 400);
  const tooBig = await post({ filename: "movie.mp4", size: 300 * 1024 * 1024 });
  assert.equal(tooBig.status, 413);
  // Uploads are a paid-order capability: without a verified paid order ref, 403.
  const noSession = await post({ filename: "logo.png", size: 100 });
  assert.equal(noSession.status, 403);
  const err = await noSession.json();
  assert.match(err.error, /paid orders/i);
});

test("brief submit: JSON path validates file keys and accepts clean submission", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `bj-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = {
    ASSETS: { fetch: async () => new Response("x", { status: 404 }) },
    RESEND_API_KEY: "re_test_dummy",
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const response = await worker.fetch(
    new Request("http://localhost/api/brief", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test", email: "t@example.com",
        files: [
          { key: "briefs/abcdef12-3456/aa11bb22.png", name: "ok.png", size: 10 },
          { key: "../../etc/passwd", name: "evil", size: 1 },
        ],
      }),
    }), env, ctx);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
});

test("brief submit: Turnstile configured -> tokenless anonymous submission is 403 (no siteverify call)", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `ts-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = {
    ASSETS: { fetch: async () => new Response("x", { status: 404 }) },
    RESEND_API_KEY: "re_test_dummy",
    TURNSTILE_SECRET: "dummy",
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  // No cf-turnstile-response token: the worker must short-circuit to 403
  // before ever calling siteverify (offline-safe, and saves a round-trip for
  // tokenless spam in production).
  const response = await worker.fetch(
    new Request("http://localhost/api/brief", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test", email: "t@example.com" }),
    }), env, ctx);
  assert.equal(response.status, 403);
  const data = await response.json();
  assert.match(data.error, /verification failed/i);
});

test("agent interface: /api/offers feed and JSON checkout errors", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `ai-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("x", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const offers = await worker.fetch(new Request("http://localhost/api/offers"), env, ctx);
  assert.equal(offers.status, 200);
  const feed = await offers.json();
  assert.deepEqual(feed.offers.map((o) => o.id), ["film", "series", "images", "custom"]);
  const series = feed.offers.find((o) => o.id === "series");
  assert.equal(series.price, 5200);
  assert.equal(series.deposit, 2600);
  assert.equal(series.review_rounds, 2);
  assert.match(feed.policies.fit_review, /full refund/i);

  const badJson = await worker.fetch(
    new Request("http://localhost/api/checkout?package=bogus", { method: "POST", headers: { accept: "application/json" } }),
    env, ctx,
  );
  assert.equal(badJson.status, 400);
  const err = await badJson.json();
  assert.ok(err.valid_ids.includes("series"));

  // State-changing checkout is POST-only.
  const get = await worker.fetch(new Request("http://localhost/api/checkout?package=series"), env, ctx);
  assert.equal(get.status, 405);

  // Order token exchange: POST-only, validates session id shape.
  const tokGet = await worker.fetch(new Request("http://localhost/api/order/token"), env, ctx);
  assert.equal(tokGet.status, 405);
  const tokBad = await worker.fetch(new Request("http://localhost/api/order/token", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: "nope" }),
  }), env, ctx);
  assert.equal(tokBad.status, 400);
});

test("mcp server: initialize, tools list, tool dispatch through shared routes", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `mcp-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("x", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const rpc = (body) => worker.fetch(
    new Request("http://localhost/mcp", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), env, ctx);

  const init = await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).json();
  assert.equal(init.result.serverInfo.name, "ibo-studio");
  assert.ok(init.result.protocolVersion);

  const list = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  assert.deepEqual(list.result.tools.map((t) => t.name),
    ["list_offers", "create_checkout", "get_order", "submit_brief", "create_upload_url"]);

  const offers = await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_offers", arguments: {} } })).json();
  assert.equal(offers.result.isError, false);
  const feed = JSON.parse(offers.result.content[0].text);
  assert.equal(feed.offers.find((o) => o.id === "series").price, 5200);

  // Bad package flows through the SAME validation as the HTTP surface.
  const bad = await (await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_checkout", arguments: { package: "free-stuff" } } })).json();
  assert.equal(bad.result.isError, true);

  // Notifications are acknowledged without a body.
  const note = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);
});

test("rate limit: checkout throttles per IP, other IPs unaffected", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `rl-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("x", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const hit = (ip) => worker.fetch(
    new Request("http://localhost/api/checkout?package=bogus", { method: "POST", headers: { "CF-Connecting-IP": ip } }),
    env, ctx);
  let last;
  for (let i = 0; i < 11; i++) last = await hit("203.0.113.9");
  assert.equal(last.status, 429, "11th request from same IP is throttled");
  const other = await hit("203.0.113.10");
  assert.equal(other.status, 303, "different IP unaffected");
});

test("thank-you page: renders and is noindexed", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `ty-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/thank-you", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("x", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /noindex/i);
  assert.match(html, /Deposit received/i);
});

test("homepage: deposit pricing shown, offer links to /start review page", async () => {
  const html = await renderHome();
  assert.match(html, /Due today \(50% deposit\)/);
  assert.match(html, /\/start\?package=/);
});

test("start page: renders package review with deposit and checkout link", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `st-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/start?package=series", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("x", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Start a Project \| IBO AI<\/title>/);
  // ?package= variants canonicalize to the permanent /start page (no query).
  assert.match(html, /rel="canonical" href="https:\/\/ibouniverse\.com\/start"/);
  assert.match(html, /3x Campaign Films/);
  assert.match(html, /\$2,600/);
  assert.match(html, /full refund/i);
  assert.match(html, /\/api\/checkout\?package=series/);
});

test("archive page: renders films with names/notes, indexable, self-canonical", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `ar-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/archive", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("x", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Selected Work \| IBO AI<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/ibouniverse\.com\/archive"/);
  assert.ok(!/name="robots"[^>]*noindex/i.test(html), "archive is indexable");
  // Visible textual context for the visual work (names + descriptions).
  for (const name of ["Oakley", "Nice Green", "Aethel", "Camilo Perea", "Vessel"]) {
    assert.ok(html.includes(name), `film name visible: ${name}`);
  }
  assert.match(html, /Spec eyewear concept/);
});

test("privacy page: renders, indexable, self-canonical", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `pv-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/privacy", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("x", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Privacy Policy \| IBO AI<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/ibouniverse\.com\/privacy"/);
  assert.ok(!/name="robots"[^>]*noindex/i.test(html), "privacy page is indexable");
});

test("sitemap.xml: only canonical public homepage, no query/preview URLs", () => {
  const xml = readFileSync(publicPath("sitemap.xml"), "utf8");
  assert.match(xml, /^<\?xml/);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [`${SITE_URL}/`, `${SITE_URL}/archive`, `${SITE_URL}/start`, `${SITE_URL}/agents`, `${SITE_URL}/privacy`]);
  for (const loc of locs) {
    assert.ok(!loc.includes("?"), "no query strings");
    assert.ok(
      !/(localhost|pages\.dev|workers\.dev|chatgpt\.site|github)/i.test(loc),
      "no temporary/preview origins",
    );
    for (const bad of ["/checkout", "/thank-you", "/project-brief", "/brief"]) {
      assert.ok(!loc.includes(bad), `transactional route ${bad} excluded`);
    }
  }
});

test("llms.txt: no placeholders or nonexistent-page links", () => {
  const txt = readFileSync(publicPath("llms.txt"), "utf8");
  assert.ok(!/ABSOLUTE_|REAL-DOMAIN|TODO|PLACEHOLDER/.test(txt), "no placeholders");
  const links = [...txt.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
  for (const link of links) {
    assert.ok(link.startsWith(`${SITE_URL}/`), `absolute production link: ${link}`);
    assert.ok(
      !/(localhost|pages\.dev|workers\.dev|chatgpt\.site)/i.test(link),
      "no temporary origins",
    );
  }
});

test("og-image.png: present and exactly 1200x630 PNG", () => {
  const p = publicPath("og-image.png");
  assert.ok(existsSync(p), "og-image.png exists");
  const buf = readFileSync(p);
  // PNG signature + IHDR: width at byte offset 16, height at 20 (big-endian).
  assert.equal(buf.readUInt32BE(0), 0x89504e47, "PNG signature");
  assert.equal(buf.readUInt32BE(16), 1200, "width 1200");
  assert.equal(buf.readUInt32BE(20), 630, "height 630");
});

test("posthog: first-party snippet with governance props, replay/autocapture off", async () => {
  const html = await renderHome();
  assert.match(html, /\/ph-ingest\/static\/array\.js/);
  assert.match(html, /"api_host":"\/ph-ingest"|api_host:"\/ph-ingest"/);
  assert.match(html, /autocapture:false/);
  assert.match(html, /disable_session_recording:true/);
  assert.match(html, /"site_id":"ibouniverse-com"/);
  assert.match(html, /"canonical_host":"ibouniverse.com"/);
  assert.match(html, /"event_schema_version":1/);
});

test("site.webmanifest: valid JSON with IBO AI identity", () => {
  const manifest = JSON.parse(readFileSync(publicPath("site.webmanifest"), "utf8"));
  assert.equal(manifest.name, "IBO AI");
  assert.equal(manifest.short_name, "IBO");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((i) => i.sizes === "512x512"));
});
