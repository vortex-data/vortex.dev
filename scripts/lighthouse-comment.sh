#!/usr/bin/env bash
# Print a pull request comment, in Markdown, from the Lighthouse reports in
# .lighthouseci/lhr-*.json:
#
#   LINKS_JSON='{"<url>": "<report url>", …}' scripts/lighthouse-comment.sh "<title>"
#
# LINKS_JSON is the treosh/lighthouse-ci-action's `links` output. Each
# config collects three runs per URL and asserts on the best one, so the
# table shows each URL's best run by performance, the run the check is
# judged by. `group_by(.url)` also keeps row order deterministic. The linked
# report is the one the action uploads for that URL and may be a different
# run.
#
# Each cell follows Lighthouse's own scoring buckets: 🟢 ≥90, 🟡 50–89,
# 🔴 <50. A threshold below the 🟢 cutoff lets a cell pass and still show 🟡,
# which says "locked in, but improvable".
set -euo pipefail

echo "## 🔦 $1"
echo ''
echo '| URL | Perf | A11y | Best practices | SEO | Report |'
echo '|---|:---:|:---:|:---:|:---:|---|'
jq -s --argjson links "${LINKS_JSON}" -r '
  def emo(s): if s >= 90 then "🟢" elif s >= 50 then "🟡" else "🔴" end;
  def cell(s): emo(s) + " " + (s | tostring);
  map({
    url: .finalUrl,
    perf: (.categories.performance.score * 100 | floor),
    a11y: (.categories.accessibility.score * 100 | floor),
    bp: (.categories["best-practices"].score * 100 | floor),
    seo: (.categories.seo.score * 100 | floor)
  })
  | group_by(.url)
  | map(max_by(.perf))
  | map(
      "| `" + (.url | sub("^https?://[^/]+"; "")) + "`"
      + " | " + cell(.perf)
      + " | " + cell(.a11y)
      + " | " + cell(.bp)
      + " | " + cell(.seo)
      + " | [report](" + ($links[.url] // "#") + ") |"
    )
  | join("\n")
' .lighthouseci/lhr-*.json
echo ''
echo "_Run [\`${GITHUB_RUN_ID}\`](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}) · $(date -u +'%Y-%m-%d %H:%M UTC')_"
