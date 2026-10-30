// The homepage's install commands, from docs.vortex.dev: getting-started/install,
// user-guide/duckdb, user-guide/datafusion and user-guide/spark.

/** One line of a command block. `prompt` is "$" for a shell command, else "". */
export type InstallLine = { prompt: string; text: string };

export type InstallTab = { key: string; label: string; lines: InstallLine[] };

const shell = (text: string): InstallLine => ({ prompt: "$", text });
const code = (text: string): InstallLine => ({ prompt: "", text });

/**
 * The InstallTabs card's tabs: Rust, Python, the CLI, then the engines,
 * DuckDB, DataFusion and Spark. `sparkVersion` is from
 * `getSparkVersion`; without it there is no Spark tab, because a coordinate
 * without a real version would copy a command Gradle cannot resolve.
 */
export function installTabs(sparkVersion: string | null): InstallTab[] {
  const tabs: InstallTab[] = [
    { key: "rust", label: "Rust", lines: [shell("cargo add vortex")] },
    {
      key: "python",
      label: "Python",
      lines: [shell("uv add vortex-data")]
    },
    {
      key: "cli",
      label: "CLI",
      lines: [shell("uvx --from vortex-data vx --help")]
    },
    {
      key: "duckdb",
      label: "DuckDB",
      lines: [
        // One line, like every tab: the block is the tallest tab's height.
        code(
          "INSTALL vortex; LOAD vortex; SELECT * FROM read_vortex('data.vortex');"
        )
      ]
    },
    {
      key: "datafusion",
      label: "DataFusion",
      lines: [shell("cargo add vortex-datafusion")]
    },
    ...(sparkVersion
      ? [
          {
            key: "spark",
            label: "Spark",
            lines: [
              code(
                `implementation("dev.vortex:vortex-spark_2.13:${sparkVersion}:all")`
              )
            ]
          }
        ]
      : [])
  ];
  return tabs;
}

/** What the copy button writes: the commands, one per line, never the prompts. */
export function copyText(tab: InstallTab): string {
  return tab.lines.map((l) => l.text).join("\n");
}
