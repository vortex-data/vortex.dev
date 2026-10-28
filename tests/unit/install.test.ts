import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { copyText, installTabs } from "@/lib/install";

const lines = (tab: ReturnType<typeof installTabs>[number] | undefined) =>
  tab?.lines.map((l) => [l.prompt, l.text]);

describe("installTabs", () => {
  it("opens on Rust, then Python, DuckDB, Spark and CLI", () => {
    assert.deepEqual(
      installTabs("0.90.0").map((t) => t.label),
      ["Rust", "Python", "DuckDB", "Spark", "CLI"]
    );
  });

  it("draws a shell prompt before the shell commands only", () => {
    const [rust, python, duckdb, spark, cli] = installTabs("0.90.0");
    assert.deepEqual(lines(rust), [["$", "cargo add vortex"]]);
    assert.deepEqual(lines(python), [["$", "pip install vortex-data"]]);
    assert.deepEqual(lines(duckdb), [
      ["", "INSTALL vortex; LOAD vortex;"],
      ["", "SELECT * FROM read_vortex('data.vortex');"]
    ]);
    assert.deepEqual(lines(spark), [
      ["", 'implementation("dev.vortex:vortex-spark_2.13:0.90.0:all")']
    ]);
    assert.deepEqual(lines(cli), [["$", "uvx --from vortex-data vx --help"]]);
  });

  it("writes <latest> in the Spark coordinate when the version is unknown", () => {
    const spark = installTabs(null).find((t) => t.label === "Spark");
    assert.deepEqual(lines(spark), [
      ["", 'implementation("dev.vortex:vortex-spark_2.13:<latest>:all")']
    ]);
  });

  it("gives every tab a unique key", () => {
    const keys = installTabs(null).map((t) => t.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("holds no tab taller than DuckDB's two lines, the height the block reserves", () => {
    // The block stacks every tab's commands in one cell, so it is always as tall as the
    // tallest. This pins that tallest tab, so a longer one is a deliberate change.
    const tabs = installTabs("0.90.0");
    assert.equal(Math.max(...tabs.map((t) => t.lines.length)), 2);
    for (const t of tabs) assert.ok(t.lines.length >= 1, t.label);
  });
});

describe("copyText", () => {
  it("copies the commands, one per line, without the prompts", () => {
    const tabs = installTabs("0.90.0");
    const copied = Object.fromEntries(tabs.map((t) => [t.key, copyText(t)]));
    assert.deepEqual(copied, {
      rust: "cargo add vortex",
      python: "pip install vortex-data",
      duckdb:
        "INSTALL vortex; LOAD vortex;\nSELECT * FROM read_vortex('data.vortex');",
      spark: 'implementation("dev.vortex:vortex-spark_2.13:0.90.0:all")',
      cli: "uvx --from vortex-data vx --help"
    });
    for (const text of Object.values(copied)) assert.doesNotMatch(text, /^\$/m);
  });
});
