#!/usr/bin/env bash
# Vercel's Ignored Build Step for the `vortex` project, which serves the
# marketing site from the repository root. Vercel skips the build when this
# exits 0 and builds on any other exit status.
#
# It skips only when every change since the branch's last successful deployment
# is under bench/ or is a bench workflow, since neither can change the marketing
# site. bench deploys to its own Vercel project from GitHub Actions. With
# nothing to compare against (a branch's first deployment, or a commit missing
# from Vercel's shallow clone), it builds.
set -uo pipefail

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "${base}" ] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "No previous deployment to compare against; building."
  exit 1
fi

# `git diff --quiet` exits 1 when files differ and 128 on error, so both build.
if git diff --quiet "${base}" HEAD -- . ':(exclude)bench' ':(exclude).github/workflows/bench-*'; then
  echo "Only bench/ changed since ${base}; skipping the marketing-site build."
  exit 0
fi

echo "Marketing-site files changed since ${base}; building."
exit 1
