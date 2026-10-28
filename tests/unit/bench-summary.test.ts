import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  formatReadDate,
  getBenchSummary,
  type Panel,
  panelsFrom
} from "@/lib/bench-summary";

// bench.vortex.dev/api/groups as it answered on 28 Oct 2026, cut down to each
// group's name and summary: the five groups the card reads and one it ignores.
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

// The six panels from the fixture: the values as bench's summary cards show
// them, and bench's own geomean ratios as the scores.
const PANELS: Panel[] = [
  {
    title: "Scan throughput",
    unit: "GB/s",
    kind: "speed",
    better: "higher",
    rows: [
      { system: "Vortex", value: 52.8, score: 5.11549948136936 },
      { system: "Parquet", value: 10.35, score: 1 },
      { system: "Lance", value: 8.06, score: 0.9003144780651322 }
    ]
  },
  {
    title: "Random access · NVMe · cold",
    unit: "ms",
    kind: "speed",
    better: "lower",
    rows: [
      { system: "Vortex", value: 2.71, score: 1.181104702076434 },
      { system: "Parquet", value: 79.66, score: 38.20111652800704 },
      { system: "Lance", value: 4.56, score: 1.8986894799471206 }
    ]
  },
  {
    title: "Random access · S3 · cold",
    unit: "ms",
    kind: "speed",
    better: "lower",
    rows: [
      { system: "Vortex", value: 267.39, score: 1 },
      { system: "Parquet", value: 702.03, score: 2.5452014906806983 },
      { system: "Lance", value: 611.15, score: 2.184430006681497 }
    ]
  },
  {
    title: "Write throughput",
    unit: "MB/s",
    kind: "speed",
    better: "higher",
    rows: [
      { system: "Vortex", value: 2127, score: 1.5744172249047315 },
      { system: "Parquet", value: 1489, score: 1 },
      { system: "Lance", value: 754, score: 0.5357674304281903 }
    ]
  },
  {
    title: "ClickBench on DataFusion",
    unit: "s",
    kind: "speed",
    better: "lower",
    rows: [
      { system: "Vortex", value: 3.86, score: 1.2606848438809655 },
      { system: "Parquet", value: 5.91, score: 2.0073889499374 },
      { system: "Lance", value: 48.02, score: 17.499514076001677 }
    ]
  },
  {
    title: "File size against Parquet + zstd",
    unit: "×",
    kind: "size",
    better: "lower",
    rows: [
      { system: "Vortex", value: 1.07, score: 1.0679702496972 },
      { system: "Parquet", value: 1, score: 1 },
      { system: "Lance", value: 1.99, score: 1.9857446360880464 }
    ]
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
    assert.deepEqual(scan?.rows[2], {
      system: "Lance",
      value: null,
      score: null
    });
    // The write panel reads the same group and keeps its Lance row.
    assert.equal(panelsFrom(gs)?.[3]?.rows[2]?.value, 754);
  });

  it("treats a system measured on only some datasets as Not measured", () => {
    const gs = groups();
    const lance = group(gs, "Random Access (NVMe)").summary.coldRankings?.find(
      (r) => r.name === "lance"
    );
    assert.ok(lance);
    lance.measured = 3;
    assert.deepEqual(panelsFrom(gs)?.[1]?.rows[2], {
      system: "Lance",
      value: null,
      score: null
    });
  });

  it("drops a score that is not a positive number, and keeps the value", () => {
    const gs = groups();
    const parquet = group(gs, "Clickbench").summary.rankings?.find(
      (r) => r.name === "datafusion:parquet"
    );
    assert.ok(parquet);
    parquet.score = "2.0";
    assert.deepEqual(panelsFrom(gs)?.[4]?.rows[1], {
      system: "Parquet",
      value: 5.91,
      score: null
    });
  });

  it("gives null when a group is missing, so the card never shows five panels", () => {
    for (const name of [
      "Compression",
      "Compression Size",
      "Random Access (NVMe)",
      "Random Access (S3)",
      "Clickbench"
    ]) {
      const gs = groups().filter((g) => g.name !== name);
      assert.equal(panelsFrom(gs), null, name);
    }
  });

  it("gives null when a group reports none of the three systems", () => {
    const gs = groups();
    group(gs, "Random Access (S3)").summary.coldRankings = [];
    assert.equal(panelsFrom(gs), null);
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
