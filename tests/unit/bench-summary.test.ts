import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  formatReadDate,
  getBenchSummary,
  type Panel,
  panelsFrom
} from "@/lib/bench-summary";
import { GPU_PANEL, PER_QUERY } from "@/lib/gpu-result";

// bench.vortex.dev/api/groups as it answered on 28 Oct 2026, cut down to each
// group's name and summary: the four groups the card reads, Random Access
// (S3), which it no longer reads, and one it ignores.
const PAYLOAD = JSON.parse(
  readFileSync(new URL("./fixtures/bench-groups.json", import.meta.url), "utf8")
) as { groups: Record<string, unknown>[] };

// A fresh copy each time, so a test can cut it without touching the others.
const groups = () =>
  structuredClone(PAYLOAD.groups) as {
    name: string;
    summary: Record<string, { name: string; [k: string]: unknown }[]>;
  }[];
const group = (gs: ReturnType<typeof groups>, name: string) => {
  const g = gs.find((x) => x.name === name);
  assert.ok(g, name);
  return g;
};

// The six panels from the fixture: bench's published geomean scores,
// unrounded, with bench's coverage where it gives one, and the hand-kept GPU
// panel beside ClickBench. Each bench panel has a row for every system the
// card knows and names the ones it shows: Lance everywhere, Arrow only in
// random access and file size, where bench runs it. The card prints each
// score as bench does (benchmark-card.js's formatScore), so the site does not
// round them. Titles join their parts with commas, so a line breaks cleanly.
const LANCE = ["Vortex", "Parquet", "Lance"];
const ARROW = ["Vortex", "Parquet", "Lance", "Arrow"];
const PANELS: Panel[] = [
  {
    title: "Scan throughput",
    unit: "× Parquet",
    kind: "speed",
    better: "higher",
    rows: [
      { system: "Vortex", score: 5.11549948136936 },
      { system: "Parquet", score: 1 },
      { system: "Lance", score: 0.9003144780651322 },
      { system: "Arrow", score: null }
    ],
    systems: LANCE
  },
  {
    title: "Write throughput",
    unit: "× Parquet",
    kind: "speed",
    better: "higher",
    rows: [
      { system: "Vortex", score: 1.5744172249047315 },
      { system: "Parquet", score: 1 },
      { system: "Lance", score: 0.5357674304281903 },
      { system: "Arrow", score: null }
    ],
    systems: LANCE
  },
  {
    title: "ClickBench on DataFusion",
    unit: "× fastest",
    kind: "speed",
    better: "lower",
    rows: [
      { system: "Vortex", score: 1.2606848438809655, measured: 43, total: 43 },
      { system: "Parquet", score: 2.0073889499374, measured: 43, total: 43 },
      { system: "Lance", score: 17.499514076001677, measured: 43, total: 43 },
      { system: "Arrow", score: null }
    ],
    systems: LANCE
  },
  GPU_PANEL,
  {
    title: "Random access, NVMe, cold",
    unit: "× fastest",
    kind: "speed",
    better: "lower",
    rows: [
      { system: "Vortex", score: 1.181104702076434, measured: 4, total: 4 },
      { system: "Parquet", score: 38.20111652800704, measured: 4, total: 4 },
      { system: "Lance", score: 1.8986894799471206, measured: 4, total: 4 },
      { system: "Arrow", score: 2.103207656693982, measured: 4, total: 4 }
    ],
    systems: ARROW
  },
  {
    title: "File size against Parquet + zstd",
    unit: "×",
    kind: "size",
    better: "lower",
    rows: [
      { system: "Vortex", score: 1.0679702496972 },
      { system: "Parquet", score: 1 },
      { system: "Lance", score: 1.9857446360880464 },
      { system: "Arrow", score: 5.590366300370603 }
    ],
    systems: ARROW
  }
];

describe("panelsFrom", () => {
  it("reads the six panels from bench's group summaries, in order", () => {
    assert.deepEqual(panelsFrom(groups()), PANELS);
  });

  it("keeps a system bench did not report, as Not measured", () => {
    const gs = groups();
    const compression = group(gs, "Compression").summary;
    compression.rankings = (compression.rankings ?? []).filter(
      (r) => !(r.name === "lance" && r.operation === "decode")
    );
    const scan = panelsFrom(gs)?.[0];
    assert.deepEqual(scan?.rows[2], { system: "Lance", score: null });
    // The write panel reads the same group and keeps its Lance row.
    assert.equal(panelsFrom(gs)?.[1]?.rows[2]?.score, 0.5357674304281903);
  });

  it("passes bench's coverage on, so the card can say Not measured", () => {
    const gs = groups();
    const lance = group(gs, "Random Access (NVMe)").summary.coldRankings?.find(
      (r) => r.name === "lance"
    );
    assert.ok(lance);
    lance.measured = 3;
    assert.deepEqual(panelsFrom(gs)?.[4]?.rows[2], {
      system: "Lance",
      score: 1.8986894799471206,
      measured: 3,
      total: 4
    });
  });

  it("gives null when no system in a group ran the whole workload", () => {
    const gs = groups();
    for (const r of group(gs, "Clickbench").summary.rankings ?? [])
      r.measured = 1;
    assert.equal(panelsFrom(gs), null);
  });

  it("drops a score that is not a positive number", () => {
    const gs = groups();
    const parquet = group(gs, "Clickbench").summary.rankings?.find(
      (r) => r.name === "datafusion:parquet"
    );
    assert.ok(parquet);
    parquet.score = "2.0";
    assert.deepEqual(panelsFrom(gs)?.[2]?.rows[1], {
      system: "Parquet",
      score: null,
      measured: 43,
      total: 43
    });
  });

  it("gives null when a group is missing, so the card never shows five panels", () => {
    for (const name of [
      "Compression",
      "Compression Size",
      "Random Access (NVMe)",
      "Clickbench"
    ]) {
      const gs = groups().filter((g) => g.name !== name);
      assert.equal(panelsFrom(gs), null, name);
    }
  });

  it("gives null when a group reports none of the systems it shows", () => {
    const gs = groups();
    group(gs, "Random Access (NVMe)").summary.coldRankings = [];
    assert.equal(panelsFrom(gs), null);
    // Arrow alone is shown only where bench runs it, so a scan ranking that
    // listed only Arrow still counts as none.
    const only = groups();
    group(only, "Compression").summary.rankings = [
      { name: "arrow-ipc", operation: "decode", ratio: 2 },
      ...(group(only, "Compression").summary.rankings ?? []).filter(
        (r) => r.operation === "encode"
      )
    ];
    assert.equal(panelsFrom(only), null);
  });

  it("no longer needs bench's S3 group", () => {
    const gs = groups().filter((g) => g.name !== "Random Access (S3)");
    assert.deepEqual(panelsFrom(gs), PANELS);
  });

  it("gives null for groups that are not bench's shape", () => {
    for (const bad of [
      null,
      "groups",
      {},
      [null],
      [{ name: "Compression", summary: null }]
    ]) {
      assert.equal(panelsFrom(bad), null, JSON.stringify(bad));
    }
  });
});

// A stand-in for fetch that records its call and answers with `respond`.
function stub(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond();
  }) as typeof fetch;
  return { fake, calls };
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });

describe("getBenchSummary", () => {
  it("reads bench's groups, cached for a day, dated by bench's answer", async () => {
    const { fake, calls } = stub(() =>
      json(PAYLOAD, 200, { Date: "Wed, 28 Oct 2026 22:55:18 GMT" })
    );
    const summary = await getBenchSummary(fake);
    assert.deepEqual(summary?.panels, PANELS);
    assert.equal(summary?.readAt.toISOString(), "2026-10-28T22:55:18.000Z");
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call?.url, "https://bench.vortex.dev/api/groups");
    const init = call?.init as RequestInit & { next?: { revalidate?: number } };
    assert.equal(init.next?.revalidate, 86400);
    assert.ok(init.signal instanceof AbortSignal, "the request has a timeout");
  });

  it("dates the read now when bench sends no usable Date", async () => {
    for (const headers of [{}, { Date: "yesterday" }]) {
      const before = Date.now();
      const summary = await getBenchSummary(
        stub(() => json(PAYLOAD, 200, headers)).fake
      );
      const at = summary?.readAt.getTime() ?? 0;
      assert.ok(at >= before && at <= Date.now(), JSON.stringify(headers));
    }
  });

  it("gives null when bench answers with an error", async () => {
    const { fake } = stub(() => json(PAYLOAD, 500));
    assert.equal(await getBenchSummary(fake), null);
  });

  it("gives null when the request fails", async () => {
    const { fake } = stub(() => {
      throw new TypeError("fetch failed");
    });
    assert.equal(await getBenchSummary(fake), null);
  });

  it("gives null when the payload is malformed", async () => {
    for (const body of [
      null,
      [],
      {},
      { groups: "Compression" },
      { groups: [] },
      { groups: PAYLOAD.groups.slice(1) }
    ]) {
      const { fake } = stub(() => json(body));
      assert.equal(await getBenchSummary(fake), null, JSON.stringify(body));
    }
  });

  it("gives null when the body is not JSON", async () => {
    const { fake } = stub(() => new Response("<html>", { status: 200 }));
    assert.equal(await getBenchSummary(fake), null);
  });
});

// The GPU panel is kept by hand (gpu-result.ts). Its score must be the
// geomean of the talk's per-query speedups, so an update to one cannot leave
// the other behind.
describe("GPU_PANEL", () => {
  it("scores the geomean of its per-query speedups, against the fastest Parquet", () => {
    const qs = Object.values(PER_QUERY);
    const geomean = Math.exp(
      qs.reduce((a, q) => a + Math.log(q), 0) / qs.length
    );
    const vortex = GPU_PANEL.rows.find((r) => r.system === "Vortex");
    const parquet = GPU_PANEL.rows.find((r) => r.system === "Parquet");
    assert.equal(vortex?.score, Number(geomean.toFixed(1)));
    assert.equal(parquet?.score, 1);
    assert.deepEqual(GPU_PANEL.systems, ["Vortex", "Parquet", "Lance"]);
    assert.match(GPU_PANEL.source?.note ?? "", /UW–Madison talk/);
    assert.deepEqual(GPU_PANEL.rows.at(-1), {
      system: "Lance",
      score: null,
      unavailable: "no cuDF integration"
    });
  });
});

describe("formatReadDate", () => {
  it("writes the read date as the source line shows it, in UTC", () => {
    const CASES: [string, string][] = [
      ["2026-10-28T22:55:18Z", "28 Oct 2026"],
      ["2026-09-04T12:00:00Z", "4 Sep 2026"],
      ["2027-01-01T00:30:00Z", "1 Jan 2027"],
      ["2026-12-31T23:59:59Z", "31 Dec 2026"]
    ];
    for (const [iso, want] of CASES)
      assert.equal(formatReadDate(new Date(iso)), want, iso);
  });
});
