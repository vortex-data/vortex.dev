import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  formatReadDate,
  getBenchSummary,
  groupTimes,
  type Panel,
  panelsFrom,
  type Row
} from "@/lib/bench-summary";
import { geomean } from "@/lib/geomean";
import { GPU_PANEL, GPU_QUERIES, gpuTimes } from "@/lib/gpu-result";
import {
  panelFactor,
  panelNote,
  versusParquet
} from "@/vendor/vortex-design/benchmark-card.js";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
  ) as Record<string, unknown>;

// bench.vortex.dev/api/groups as it answered on 29 Oct 2026, cut down to each
// group's name, slug and summary: the four groups the card reads, Random
// Access (S3), which it no longer reads, and one it ignores.
const PAYLOAD = fixture("bench-groups.json") as {
  groups: Record<string, unknown>[];
};
// bench.vortex.dev/api/group/{slug}?n=20 for the two time panels' groups, read
// at the same time, cut down to the series the card reads (and one it does
// not) and their last five commits.
const CHARTS = {
  Clickbench: fixture("bench-group-clickbench.json"),
  "Random Access (NVMe)": fixture("bench-group-random-access-nvme.json")
};

// A fresh copy each time, so a test can cut it without touching the others.
const groups = () =>
  structuredClone(PAYLOAD.groups) as {
    name: string;
    slug: string;
    summary: Record<string, { name: string; [k: string]: unknown }[]>;
  }[];
const group = (gs: ReturnType<typeof groups>, name: string) => {
  const g = gs.find((x) => x.name === name);
  assert.ok(g, name);
  return g;
};
type Chart = {
  name: string;
  unit_kind: string;
  series: Record<string, (number | null)[]>;
};
const charts = () =>
  structuredClone(CHARTS) as unknown as Record<
    keyof typeof CHARTS,
    { name: string; charts: Chart[] }
  >;

// Each system's geomean time in ms, computed from the fixture apart from the
// site's code (Python, 29 Oct 2026): the latest time per ClickBench query,
// and per random-access dataset the sum of its charts' latest times.
const CLICKBENCH_MS = {
  Vortex: 42.24600623816063,
  Parquet: 65.621614465414,
  Lance: 578.6306006236966
};
const RANDOM_ACCESS_MS = {
  Vortex: 2.222937250565255,
  Parquet: 70.3627371272798,
  Lance: 3.5349948744551765,
  Arrow: 3.716574078241951
};

// The six panels from the fixtures. The ratio panels carry bench's published
// geomean ratios, unrounded. The time panels carry each system's geomean
// time in ms (checked below to within 1e-9 of the values above), with its
// coverage in queries or datasets. The hand-kept GPU panel sits beside
// ClickBench. Each bench panel has a row for every system the card knows and
// names the ones it shows: Lance everywhere, Arrow only in random access and
// file size, where bench runs it. Titles join their parts with commas, so a
// line breaks cleanly.
const LANCE = ["Vortex", "Parquet", "Lance"];
const ARROW = ["Vortex", "Parquet", "Lance", "Arrow"];
const timeRows = (ms: Record<string, number>, total: number): Row[] =>
  ["Vortex", "Parquet", "Lance", "Arrow"].map((system) =>
    ms[system] === undefined
      ? { system, score: null }
      : { system, score: ms[system], measured: total, total }
  );
const PANELS: Panel[] = [
  {
    title: "Scan throughput",
    unit: "× Parquet",
    kind: "speed",
    better: "higher",
    rows: [
      { system: "Vortex", score: 4.928313629376676 },
      { system: "Parquet", score: 1 },
      { system: "Lance", score: 0.9008808638779875 },
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
      { system: "Vortex", score: 1.5802437835952796 },
      { system: "Parquet", score: 1 },
      { system: "Lance", score: 0.5339101291427459 },
      { system: "Arrow", score: null }
    ],
    systems: LANCE
  },
  {
    title: "ClickBench on DataFusion",
    unit: "ms",
    kind: "speed",
    better: "lower",
    rows: timeRows(CLICKBENCH_MS, 43),
    systems: LANCE
  },
  GPU_PANEL,
  {
    title: "Random access, NVMe, cold",
    unit: "ms",
    kind: "speed",
    better: "lower",
    rows: timeRows(RANDOM_ACCESS_MS, 4),
    systems: ARROW
  },
  {
    title: "Size vs Parquet+Zstd",
    unit: "×",
    kind: "size",
    better: "lower",
    rows: [
      { system: "Vortex", score: 1.0679582263325627 },
      { system: "Parquet", score: 1 },
      { system: "Lance", score: 1.9876533869960349 },
      { system: "Arrow", score: 5.590366300370603 }
    ],
    systems: ARROW
  }
];

// Panels as deepEqual can compare them: each time rounded to 1e-9 ms, which
// is far below what the card prints and far above float noise.
const near = (panels: Panel[] | null | undefined) =>
  panels?.map((p) => ({
    ...p,
    rows: p.rows.map((r) =>
      p.unit === "ms" && r.score !== null
        ? { ...r, score: Number(r.score.toFixed(9)) }
        : r
    )
  }));

describe("panelsFrom", () => {
  it("reads the six panels from bench's group summaries and charts, in order", () => {
    assert.deepEqual(near(panelsFrom(groups(), charts())), near(PANELS));
  });

  // Note 63: a time panel's bars are geomean times in ms over the same
  // queries or datasets as bench's score, so Parquet's time over Vortex's is
  // bench's score ratio, and the bars agree with the factor above them. Bench
  // adds 10ns to each time before it divides, which moves the ratio by about
  // 1e-5 on random access's millisecond times.
  it("keeps bench's score ratios in a time panel's times", () => {
    const panels = panelsFrom(groups(), charts());
    const scores = (g: string, key: string, name: (f: string) => string) => {
      const list = group(groups(), g).summary[key] ?? [];
      const of = (f: string) =>
        Number(list.find((r) => r.name === name(f))?.score);
      return { v: of("vortex-file-compressed"), p: of("parquet") };
    };
    for (const [i, g, key, name] of [
      [2, "Clickbench", "rankings", (f: string) => `datafusion:${f}`],
      [4, "Random Access (NVMe)", "coldRankings", (f: string) => f]
    ] as const) {
      const rows = panels?.[i]?.rows ?? [];
      const ms = (s: string) => rows.find((r) => r.system === s)?.score ?? NaN;
      const { v, p } = scores(g, key, name);
      assert.ok(
        Math.abs(ms("Parquet") / ms("Vortex") / (p / v) - 1) < 1e-4,
        `${g}: ${ms("Parquet") / ms("Vortex")} against ${p / v}`
      );
    }
  });

  it("keeps a system bench did not report, as Not measured", () => {
    const gs = groups();
    const compression = group(gs, "Compression").summary;
    compression.rankings = (compression.rankings ?? []).filter(
      (r) => !(r.name === "lance" && r.operation === "decode")
    );
    const scan = panelsFrom(gs, charts())?.[0];
    assert.deepEqual(scan?.rows[2], { system: "Lance", score: null });
    // The write panel reads the same group and keeps its Lance row.
    assert.equal(
      panelsFrom(gs, charts())?.[1]?.rows[2]?.score,
      0.5339101291427459
    );
  });

  it("drops a time that bench does not score", () => {
    const gs = groups();
    const cold = group(gs, "Random Access (NVMe)").summary;
    cold.coldRankings = (cold.coldRankings ?? []).filter(
      (r) => r.name !== "lance"
    );
    assert.deepEqual(panelsFrom(gs, charts())?.[4]?.rows[2], {
      system: "Lance",
      score: null,
      measured: 4,
      total: 4
    });
  });

  // bench serves its scores and its charts from two endpoints, and a build can
  // read them a commit apart. The card shows the times it read, and its factor
  // comes from the same times, so the bars and the factor still agree. It never
  // blanks a panel because the two answers were a commit apart.
  it("keeps times read a commit apart from the scores, and takes the factor from them", () => {
    const cs = charts();
    for (const chart of cs.Clickbench.charts) {
      const s = chart.series["datafusion:parquet"];
      if (Array.isArray(s))
        chart.series["datafusion:parquet"] = s.map((v) =>
          typeof v === "number" ? v * 1.1 : v
        );
    }
    const rows = panelsFrom(groups(), cs)?.[2]?.rows;
    const parquet = rows?.find((r) => r.system === "Parquet");
    const vortex = rows?.find((r) => r.system === "Vortex");
    assert.ok(parquet?.score, "Parquet keeps its time");
    assert.ok(vortex?.score, "Vortex keeps its time");
  });

  it("counts a query a system has no time for, so the card says Not measured", () => {
    const cs = charts();
    const q5 = cs.Clickbench.charts[5];
    assert.ok(q5);
    q5.series["datafusion:lance"] = [null, null];
    const lance = panelsFrom(groups(), cs)?.[2]?.rows[2];
    assert.equal(lance?.measured, 42);
    assert.equal(lance?.total, 43);
  });

  // A window that holds only some of a benchmark's queries would give a
  // Random access sums several charts into one dataset's bucket, so a
  // window missing one of them would sum part of the dataset. bench's group
  // list names every chart, so each bucket is checked against it.
  it("falls back to bench's scores when a bucket misses one of the group's charts", () => {
    const gs = groups();
    const cs = charts();
    const ra = group(gs, "Random Access (NVMe)") as Record<string, unknown>;
    ra.charts = cs["Random Access (NVMe)"].charts.map((c) => ({
      name: c.name
    }));
    assert.equal(
      panelsFrom(gs, cs)?.[4]?.unit,
      "ms",
      "a full window keeps its times"
    );
    const dropped = charts();
    dropped["Random Access (NVMe)"].charts =
      dropped["Random Access (NVMe)"].charts.slice(1);
    assert.equal(panelsFrom(gs, dropped)?.[4]?.unit, "× fastest");
  });
  // geomean over a partial set, so the panel shows bench's scores instead.
  it("falls back to bench's scores when the window holds only some of the queries", () => {
    const cs = charts();
    cs.Clickbench.charts = cs.Clickbench.charts.slice(1);
    const panel = panelsFrom(groups(), cs)?.[2];
    assert.equal(panel?.unit, "× fastest");
  });

  // bench's chart window counts commits across the whole repository, so a
  // benchmark that has not run lately has no times in it while bench still
  // publishes its scores. The panel then shows those scores, relative to the
  // fastest, and the card stays on the page.
  it("falls back to bench's scores when a time panel's charts are missing or not times", () => {
    const check = (panels: ReturnType<typeof panelsFrom>, i: number) => {
      const panel = panels?.[i];
      assert.ok(panel, "the card keeps all six panels");
      assert.equal(panel.unit, "× fastest");
      const vortex = panel.rows.find((r) => r.system === "Vortex");
      assert.ok(vortex?.score && vortex.score >= 1, "Vortex shows its score");
    };
    check(panelsFrom(groups()), 2);
    check(panelsFrom(groups()), 4);
    const cs = charts();
    for (const c of cs["Random Access (NVMe)"].charts) c.unit_kind = "bytes";
    check(panelsFrom(groups(), cs), 4);
    assert.equal(
      panelsFrom(groups(), cs)?.[2]?.unit,
      "ms",
      "ClickBench keeps its times"
    );
    for (const bad of [null, {}, { charts: "Q0" }, { charts: [null] }])
      check(panelsFrom(groups(), { ...charts(), Clickbench: bad }), 2);
  });

  it("gives null when no system in a group has a score", () => {
    const gs = groups();
    for (const r of group(gs, "Compression").summary.rankings ?? [])
      r.ratio = 0;
    assert.equal(panelsFrom(gs, charts()), null);
  });

  it("drops a score that is not a positive number", () => {
    const gs = groups();
    const parquet = group(gs, "Compression Size").summary.rankings?.find(
      (r) => r.name === "parquet"
    );
    assert.ok(parquet);
    parquet.ratio = "1";
    assert.deepEqual(panelsFrom(gs, charts())?.[5]?.rows[1], {
      system: "Parquet",
      score: null
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
      assert.equal(panelsFrom(gs, charts()), null, name);
    }
  });

  it("gives null when a group reports none of the systems it shows", () => {
    const gs = groups();
    group(gs, "Random Access (NVMe)").summary.coldRankings = [];
    assert.equal(panelsFrom(gs, charts()), null);
    // Arrow alone is shown only where bench runs it, so a scan ranking that
    // listed only Arrow still counts as none.
    const only = groups();
    group(only, "Compression").summary.rankings = [
      { name: "arrow-ipc", operation: "decode", ratio: 2 },
      ...(group(only, "Compression").summary.rankings ?? []).filter(
        (r) => r.operation === "encode"
      )
    ];
    assert.equal(panelsFrom(only, charts()), null);
  });

  it("no longer needs bench's S3 group", () => {
    const gs = groups().filter((g) => g.name !== "Random Access (S3)");
    assert.deepEqual(near(panelsFrom(gs, charts())), near(PANELS));
  });

  it("gives null for groups that are not bench's shape", () => {
    for (const bad of [
      null,
      "groups",
      {},
      [null],
      [{ name: "Compression", summary: null }]
    ]) {
      assert.equal(panelsFrom(bad, charts()), null, JSON.stringify(bad));
    }
  });
});

// Bench's random-access score puts each dataset's charts in one bucket and
// sums their times, so the legacy "taxi" chart joins taxi/correlated and
// taxi/uniform.
describe("groupTimes", () => {
  const chart = (name: string, series: Record<string, (number | null)[]>) => ({
    name,
    unit_kind: "time_ns",
    series
  });
  const byDataset = (c: string) => c.split("/")[0] ?? c;

  it("sums a dataset's latest times and takes the geomean in ms", () => {
    const times = groupTimes(
      {
        charts: [
          chart("taxi", { a: [3e6, 1e6], b: [4e6] }),
          chart("taxi/uniform", { a: [2e6, null], b: [4e6] }),
          chart("lists/uniform", { a: [8e6], b: [1e6] })
        ]
      },
      byDataset
    );
    assert.deepEqual(times?.get("a"), {
      ms: (geomean([1e6 + 2e6, 8e6]) ?? 0) / 1e6,
      measured: 2,
      total: 2
    });
    assert.deepEqual(times?.get("b"), {
      ms: (geomean([8e6, 1e6]) ?? 0) / 1e6,
      measured: 2,
      total: 2
    });
  });

  it("leaves a dataset out of a series that lacks one of its charts, and a chart no series ran out of every series", () => {
    const times = groupTimes(
      {
        charts: [
          chart("taxi", { a: [1e6], b: [1e6] }),
          chart("taxi/uniform", { a: [1e6] }),
          chart("lists", { a: [1e6], b: [2e6] }),
          chart("empty", { a: [null], b: [] })
        ]
      },
      byDataset
    );
    assert.deepEqual(times?.get("b"), {
      ms: (geomean([2e6]) ?? 0) / 1e6,
      measured: 1,
      total: 2
    });
    assert.equal(times?.get("a")?.measured, 2);
  });
});

// A stand-in for fetch that records its calls and answers each by its URL.
function stub(respond: (url: string) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond(String(input));
  }) as typeof fetch;
  return { fake, calls };
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });

const slugOf = (name: string) => group(groups(), name).slug;
// bench as the fixtures saw it: the groups, then each time panel's charts.
const bench =
  (groupsBody: unknown = PAYLOAD, headers: HeadersInit = {}) =>
  (url: string) => {
    if (url === "https://bench.vortex.dev/api/groups")
      return json(groupsBody, 200, headers);
    for (const name of ["Clickbench", "Random Access (NVMe)"] as const)
      if (url === `https://bench.vortex.dev/api/group/${slugOf(name)}?n=20`)
        return json(CHARTS[name]);
    return json({ error: "not_found" }, 404);
  };

describe("getBenchSummary", () => {
  it("reads bench's groups and the time panels' charts, cached for a day, dated by bench's answer", async () => {
    const { fake, calls } = stub(
      bench(PAYLOAD, { Date: "Thu, 29 Oct 2026 21:23:34 GMT" })
    );
    const summary = await getBenchSummary(fake);
    assert.deepEqual(near(summary?.panels), near(PANELS));
    assert.equal(summary?.readAt.toISOString(), "2026-10-29T21:23:34.000Z");
    assert.deepEqual(
      calls.map((c) => c.url),
      [
        "https://bench.vortex.dev/api/groups",
        `https://bench.vortex.dev/api/group/${slugOf("Clickbench")}?n=20`,
        `https://bench.vortex.dev/api/group/${slugOf("Random Access (NVMe)")}?n=20`
      ]
    );
    for (const call of calls) {
      const init = call.init as RequestInit & {
        next?: { revalidate?: number };
      };
      assert.equal(init.next?.revalidate, 86400);
      assert.ok(
        init.signal instanceof AbortSignal,
        "the request has a timeout"
      );
    }
  });

  it("dates the read now when bench sends no usable Date", async () => {
    for (const headers of [{}, { Date: "yesterday" }]) {
      const before = Date.now();
      const summary = await getBenchSummary(stub(bench(PAYLOAD, headers)).fake);
      const at = summary?.readAt.getTime() ?? 0;
      assert.ok(at >= before && at <= Date.now(), JSON.stringify(headers));
    }
  });

  it("gives null when bench answers with an error", async () => {
    const { fake } = stub(() => json(PAYLOAD, 500));
    assert.equal(await getBenchSummary(fake), null);
  });

  it("shows bench's scores when a group's charts answer with an error or fail", async () => {
    const ok = bench();
    const units = async (fake: typeof fetch) =>
      (await getBenchSummary(fake))?.panels.map((p) => p.unit);
    const failing = stub((url) =>
      url.includes("/api/group/") ? json({}, 503) : ok(url)
    );
    const throwing = stub((url) => {
      if (url.includes("/api/group/")) throw new TypeError("fetch failed");
      return ok(url);
    });
    for (const fake of [failing.fake, throwing.fake]) {
      const u = await units(fake);
      assert.equal(u?.length, 6, "the card keeps all six panels");
      assert.equal(u?.[2], "× fastest");
      assert.equal(u?.[4], "× fastest");
    }
  });

  it("gives null when a time panel's group has no usable slug", async () => {
    const gs = groups();
    group(gs, "Clickbench").slug = "../groups";
    const { fake, calls } = stub(bench({ groups: gs }));
    assert.equal(await getBenchSummary(fake), null);
    assert.equal(calls.length, 1);
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
      const { fake } = stub(bench(body));
      assert.equal(await getBenchSummary(fake), null, JSON.stringify(body));
    }
  });

  it("gives null when the body is not JSON", async () => {
    const { fake } = stub(() => new Response("<html>", { status: 200 }));
    assert.equal(await getBenchSummary(fake), null);
  });
});

// The GPU panel is kept by hand (gpu-result.ts): Will's mean query times in
// ms, hot. Its rows are the geomeans of those times, computed in code, so an
// update to the table cannot leave the panel behind.
describe("GPU_PANEL", () => {
  it("shows each system's geomean time in ms, Parquet at its fastest per query", () => {
    const { vortex, parquet } = gpuTimes(GPU_QUERIES);
    assert.equal(vortex?.toFixed(2), "17.00");
    assert.equal(parquet?.toFixed(2), "65.88");
    assert.equal(GPU_QUERIES.length, 5);
    assert.deepEqual(
      GPU_PANEL.rows.map((r) => [r.system, r.score]),
      [
        ["Vortex", vortex],
        ["Parquet", parquet],
        ["Lance", null]
      ]
    );
    assert.equal(GPU_PANEL.unit, "ms");
    assert.equal(GPU_PANEL.better, "lower");
  });

  it("reads 3.9× faster than Parquet, as the talk's slide does", () => {
    const vs = versusParquet(GPU_PANEL.rows, GPU_PANEL.better);
    assert.ok(Math.abs((vs.factor ?? 0) - 3.875) < 0.001, String(vs.factor));
    assert.equal(panelFactor("speed", vs), "3.9×");
    assert.equal(panelNote("speed", vs), "faster than Parquet");
  });

  it("names its source, and shows Lance as N/A", () => {
    assert.deepEqual(GPU_PANEL.systems, ["Vortex", "Parquet", "Lance"]);
    assert.match(GPU_PANEL.source?.note ?? "", /hot.*UW–Madison talk/);
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
