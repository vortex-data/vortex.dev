import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { copyText, installTabs } from "@/lib/install";

const lines = (tab: ReturnType<typeof installTabs>[number] | undefined) =>
  tab?.lines.map((l) => [l.prompt, l.text]);

describe("installTabs", () => {
  it("opens on Rust, then Python, CLI, DuckDB, DataFusion and Spark", () => {
    assert.deepEqual(
      installTabs("0.90.0").map((t) => t.label),
      ["Rust", "Python", "CLI", "DuckDB", "DataFusion", "Spark"]
    );
  });

  it("draws a shell prompt before the shell commands only", () => {
    const [rust, python, cli, duckdb, datafusion, spark] =
      installTabs("0.90.0");
    assert.deepEqual(lines(rust), [["$", "cargo add vortex"]]);
    assert.deepEqual(lines(python), [["$", "uv add vortex-data"]]);
    assert.deepEqual(lines(duckdb), [
      [
        "",
        "INSTALL vortex; LOAD vortex; SELECT * FROM read_vortex('data.vortex');"
      ]
    ]);
    assert.deepEqual(lines(datafusion), [["$", "cargo add vortex-datafusion"]]);
    assert.deepEqual(lines(spark), [
      ["", 'implementation("dev.vortex:vortex-spark_2.13:0.90.0:all")']
    ]);
    assert.deepEqual(lines(cli), [["$", "uvx --from vortex-data vx --help"]]);
  });

  it("offers no Spark tab when the version is unknown, so nothing copies a coordinate Gradle cannot resolve", () => {
    assert.deepEqual(
      installTabs(null).map((t) => t.key),
      ["rust", "python", "cli", "duckdb", "datafusion"]
    );
  });

  it("gives every tab a unique key", () => {
    const keys = installTabs(null).map((t) => t.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  // Note 62: the block stacks every tab's commands in one cell, so it is
  // always as tall as the tallest. A two-line DuckDB tab made the homepage's
  // box two lines tall under a one-line command, so every tab is one line.
  it("keeps every tab to one line, the height the block reserves", () => {
    for (const t of installTabs("0.90.0"))
      assert.equal(t.lines.length, 1, t.key);
  });
});

describe("copyText", () => {
  it("copies the commands, one per line, without the prompts", () => {
    const tabs = installTabs("0.90.0");
    const copied = Object.fromEntries(tabs.map((t) => [t.key, copyText(t)]));
    assert.deepEqual(copied, {
      rust: "cargo add vortex",
      python: "uv add vortex-data",
      cli: "uvx --from vortex-data vx --help",
      datafusion: "cargo add vortex-datafusion",
      duckdb:
        "INSTALL vortex; LOAD vortex; SELECT * FROM read_vortex('data.vortex');",
      spark: 'implementation("dev.vortex:vortex-spark_2.13:0.90.0:all")'
    });
    for (const text of Object.values(copied)) assert.doesNotMatch(text, /^\$/m);
  });
});
