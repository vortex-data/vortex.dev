#!/usr/bin/env bun
/**
 * End-to-end verification suite for vortex.dev.
 *
 * Runs against a live server (default http://localhost:3000, override with
 * `BASE`). Designed to be run after `bun run start` — checks sitemap, robots,
 * RSS feeds, OG images, canonicals, JSON-LD on posts, and internal links.
 *
 * Usage:
 *   bun run start &
 *   BASE=http://localhost:3000 bun scripts/verify.ts
 *
 * Exits 1 if any check fails.
 */

const BASE = process.env.BASE ?? "http://localhost:3000";

type CheckResult = {
  name: string;
  ok: boolean;
  msg?: string | undefined;
};

const results: CheckResult[] = [];

function pass(name: string, msg?: string): void {
  results.push({ name, ok: true, msg });
}

function fail(name: string, msg: string): void {
  results.push({ name, ok: false, msg });
}

function localize(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, BASE);
}

async function fetchText(
  url: string
): Promise<{ ok: boolean; status: number; body: string; ctype: string }> {
  try {
    const res = await fetch(url);
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      body,
      ctype: res.headers.get("content-type") ?? ""
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: err instanceof Error ? err.message : String(err),
      ctype: ""
    };
  }
}

async function fetchBytes(url: string): Promise<{
  ok: boolean;
  status: number;
  bytes: Uint8Array;
  ctype: string;
}> {
  try {
    const res = await fetch(url);
    const buf = new Uint8Array(await res.arrayBuffer());
    return {
      ok: res.ok,
      status: res.status,
      bytes: buf,
      ctype: res.headers.get("content-type") ?? ""
    };
  } catch {
    return { ok: false, status: 0, bytes: new Uint8Array(), ctype: "" };
  }
}

function pngDimensions(
  bytes: Uint8Array
): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== sig[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function metaContent(html: string, key: string): string | null {
  const a = new RegExp(
    `<meta[^>]+(?:name|property)="${key}"[^>]*\\scontent="([^"]*)"`,
    "i"
  );
  const b = new RegExp(
    `<meta[^>]+content="([^"]*)"[^>]*\\s(?:name|property)="${key}"`,
    "i"
  );
  return html.match(a)?.[1] ?? html.match(b)?.[1] ?? null;
}

function linkRel(html: string, rel: string): string | null {
  const a = new RegExp(`<link[^>]+rel="${rel}"[^>]*\\shref="([^"]*)"`, "i");
  const b = new RegExp(`<link[^>]+href="([^"]*)"[^>]*\\srel="${rel}"`, "i");
  return html.match(a)?.[1] ?? html.match(b)?.[1] ?? null;
}

type JsonLdResult =
  | { ok: true; blocks: Array<Record<string, unknown>> }
  | { ok: false; parseError: string };

function jsonLd(html: string): JsonLdResult {
  const blocks: Array<Record<string, unknown>> = [];
  const re =
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1] ?? "";
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      return { ok: false, parseError: raw.trim().slice(0, 80) };
    }
  }
  return { ok: true, blocks };
}

function internalHrefs(html: string): string[] {
  const hrefs = new Set<string>();
  const re = /<a[^>]+href="(\/[^"#]*)(?:#[^"]*)?"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href) continue;
    if (href.startsWith("//")) continue;
    if (href === "/") {
      hrefs.add("/");
      continue;
    }
    const clean = href.split("?")[0] ?? href;
    if (clean) hrefs.add(clean);
  }
  return [...hrefs];
}

// === Checks ============================================================

async function checkSitemap(): Promise<string[]> {
  const r = await fetchText(`${BASE}/sitemap.xml`);
  if (!r.ok) {
    fail("sitemap.xml", `status=${r.status}`);
    return [];
  }
  if (!r.ctype.includes("xml")) {
    fail("sitemap.xml", `content-type=${r.ctype}`);
    return [];
  }
  const locs = [...r.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  const required = ["/", "/blog"];
  const paths = locs.map((l) => l.replace(/^https?:\/\/[^/]+/, "") || "/");
  const missing = required.filter((p) => !paths.includes(p));
  if (missing.length > 0) {
    fail("sitemap.xml", `missing required entries: ${missing.join(", ")}`);
  } else if (!paths.some((p) => p.startsWith("/blog/") && p !== "/blog")) {
    fail("sitemap.xml", "no /blog/<slug> entries — posts not being included");
  } else {
    pass("sitemap.xml", `${locs.length} entries`);
  }
  return paths;
}

async function checkRobots(): Promise<void> {
  const r = await fetchText(`${BASE}/robots.txt`);
  if (!r.ok) {
    fail("robots.txt", `status=${r.status}`);
    return;
  }
  const allowsAll = /^Allow:\s*\/\s*$/im.test(r.body);
  const disallowsApi = /^Disallow:\s*\/api\b/im.test(r.body);
  const hasSitemap = /^Sitemap:\s*https?:\/\/\S+\/sitemap\.xml\b/im.test(
    r.body
  );
  if (!allowsAll) {
    fail("robots.txt", "missing `Allow: /`");
    return;
  }
  if (!disallowsApi) {
    fail("robots.txt", "missing `Disallow: /api`");
    return;
  }
  if (!hasSitemap) {
    fail("robots.txt", "missing Sitemap reference");
    return;
  }
  pass("robots.txt", "allows /, disallows /api, references sitemap");
}

async function checkRssXml(): Promise<void> {
  const r = await fetchText(`${BASE}/rss/feed.xml`);
  if (!r.ok) {
    fail("rss feed.xml", `status=${r.status}`);
    return;
  }
  if (!r.ctype.includes("xml")) {
    fail("rss feed.xml", `content-type=${r.ctype}`);
    return;
  }
  const items = (r.body.match(/<item>/g) ?? []).length;
  if (items < 1) {
    fail("rss feed.xml", "no <item> entries");
    return;
  }
  const titleMatch = r.body.match(/<channel>[\s\S]*?<title>([^<]+)<\/title>/);
  const title = titleMatch?.[1];
  if (title !== "Vortex Blog") {
    fail("rss feed.xml", `feed <title>="${title}" — expected "Vortex Blog"`);
    return;
  }
  pass("rss feed.xml", `${items} items, title="${title}"`);
}

async function checkRssJson(): Promise<void> {
  const r = await fetchText(`${BASE}/rss/feed.json`);
  if (!r.ok) {
    fail("rss feed.json", `status=${r.status}`);
    return;
  }
  try {
    const parsed = JSON.parse(r.body) as { items?: unknown[] };
    const itemCount = Array.isArray(parsed.items) ? parsed.items.length : 0;
    if (itemCount < 1) {
      fail("rss feed.json", "no items[]");
      return;
    }
    pass("rss feed.json", `${itemCount} items`);
  } catch (err) {
    fail("rss feed.json", `JSON parse failed: ${String(err).slice(0, 80)}`);
  }
}

async function checkRssAtom(): Promise<void> {
  const r = await fetchText(`${BASE}/rss/feed.atom`);
  if (!r.ok) {
    fail("rss feed.atom", `status=${r.status}`);
    return;
  }
  if (!r.ctype.includes("xml")) {
    fail("rss feed.atom", `content-type=${r.ctype}`);
    return;
  }
  const entries = (r.body.match(/<entry>/g) ?? []).length;
  if (entries < 1) {
    fail("rss feed.atom", "no <entry> elements");
    return;
  }
  pass("rss feed.atom", `${entries} entries`);
}

async function checkRoute(
  path: string
): Promise<{ html: string; routeOk: boolean }> {
  const r = await fetchText(`${BASE}${path}`);
  if (!r.ok) {
    fail(`page ${path}`, `status=${r.status}`);
    return { html: "", routeOk: false };
  }
  let allOk = true;

  // OG image — every page should have one and it should be 1200x630 PNG
  const og = metaContent(r.body, "og:image");
  if (!og) {
    fail(`og ${path}`, "no og:image meta");
    allOk = false;
  } else {
    const ogBytes = await fetchBytes(localize(og));
    if (!ogBytes.ok) {
      fail(`og ${path}`, `og fetch status=${ogBytes.status}`);
      allOk = false;
    } else if (!ogBytes.ctype.startsWith("image/")) {
      fail(`og ${path}`, `og ctype=${ogBytes.ctype}`);
      allOk = false;
    } else if (ogBytes.ctype === "image/png") {
      const dim = pngDimensions(ogBytes.bytes);
      if (!dim) {
        fail(`og ${path}`, "invalid PNG signature");
        allOk = false;
      } else if (dim.width !== 1200 || dim.height !== 630) {
        fail(`og ${path}`, `dimensions ${dim.width}x${dim.height}`);
        allOk = false;
      }
    }
  }

  // Canonical URL
  const canonical = linkRel(r.body, "canonical");
  if (!canonical) {
    fail(`canonical ${path}`, "no <link rel=canonical>");
    allOk = false;
  }

  // JSON-LD Article schema on blog posts
  if (path.startsWith("/blog/") && path !== "/blog") {
    const ld = jsonLd(r.body);
    if (!ld.ok) {
      fail(`json-ld ${path}`, `parse error: ${ld.parseError}`);
      allOk = false;
    } else {
      const article = ld.blocks.find((b) => b["@type"] === "Article");
      if (!article) {
        fail(`json-ld ${path}`, "no Article schema");
        allOk = false;
      }
    }
  }

  if (allOk) pass(`page ${path}`, "og ✓ canonical ✓");
  return { html: r.body, routeOk: allOk };
}

async function checkInternalLinks(
  htmlByPath: Map<string, string>,
  sitemapPaths: string[]
): Promise<void> {
  const firstPost = sitemapPaths.find(
    (p) => p.startsWith("/blog/") && p !== "/blog"
  );
  if (!firstPost) {
    fail("internal links", "no /blog/<slug> entries to seed link discovery");
    return;
  }
  const linkSources = ["/", "/blog", firstPost];
  const targets = new Set<string>();
  for (const src of linkSources) {
    const html = htmlByPath.get(src);
    if (!html) continue;
    for (const href of internalHrefs(html)) {
      if (href.startsWith("/api/")) continue;
      if (
        href.endsWith(".zip") ||
        href.endsWith(".svg") ||
        href.endsWith(".png") ||
        href.endsWith(".webp") ||
        href.endsWith(".pdf")
      )
        continue;
      targets.add(href);
    }
  }
  if (targets.size === 0) {
    fail("internal links", "no internal links to check");
    return;
  }
  const broken: string[] = [];
  for (const href of targets) {
    try {
      const r = await fetch(`${BASE}${href}`, { method: "HEAD" });
      if (r.status >= 400) broken.push(`${href} (${r.status})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      broken.push(`${href} (fetch error: ${msg})`);
    }
  }
  if (broken.length > 0) {
    fail("internal links", `${broken.length} broken: ${broken.join(", ")}`);
    return;
  }
  pass("internal links", `${targets.size} checked`);
}

// The /api/subscribe handler instantiates `new Resend(...)` *inside* the
// request handler so the build doesn't fail when RESEND_API_KEY is unset.
// When the env var is missing it returns 503 with a JSON error body. We
// assert that contract here so a regression (e.g. moving the Resend
// constructor to module scope, or removing the env-gate) surfaces in CI.
//
// In environments where RESEND_API_KEY *is* set (e.g. a dev with .env.local
// + the var exported into the verify shell), the test is skipped rather
// than calling the real Resend API.
async function checkSubscribe(): Promise<void> {
  if (process.env.RESEND_API_KEY) {
    pass("/api/subscribe", "skipped (RESEND_API_KEY is set in this shell)");
    return;
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "verify-suite@example.com" })
    });
  } catch (err) {
    fail(
      "/api/subscribe",
      `request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }
  if (res.status !== 503) {
    fail(
      "/api/subscribe",
      `expected 503 with RESEND_API_KEY unset, got ${res.status}`
    );
    return;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    fail("/api/subscribe", "response was not JSON");
    return;
  }
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { error?: unknown }).error !== "string"
  ) {
    fail("/api/subscribe", `response shape mismatch: ${JSON.stringify(body)}`);
    return;
  }
  pass(
    "/api/subscribe",
    `503 with error="${(body as { error: string }).error}"`
  );
}

// === Run ===============================================================

async function main(): Promise<void> {
  console.log(`Verifying ${BASE}\n`);

  const sitemapPaths = await checkSitemap();
  await checkRobots();
  await checkRssXml();
  await checkRssJson();
  await checkRssAtom();
  await checkSubscribe();

  const htmlByPath = new Map<string, string>();
  for (const path of sitemapPaths) {
    const { html } = await checkRoute(path);
    if (html) htmlByPath.set(path, html);
  }

  await checkInternalLinks(htmlByPath, sitemapPaths);

  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const tag = r.ok ? "  ok  " : "  FAIL";
    const detail = r.msg ? `  ${r.msg}` : "";
    console.log(`${tag}  ${r.name.padEnd(60)}${detail}`);
    if (r.ok) passed++;
    else failed++;
  }

  console.log(`\nTotal: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.name}: ${r.msg ?? "(no detail)"}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verify.ts crashed:", err);
  process.exit(1);
});
