export const REPO = "vortex-data/vortex";
export const REPO_URL = `https://github.com/${REPO}`;

const API_URL = `https://api.github.com/repos/${REPO}`;
const DAY_SECONDS = 86400;
const TIMEOUT_MS = 5000;

/**
 * The repository's star count for the header's GitHub button. It is read at
 * build time and again at most once a day (ISR). Any failure (a timeout, an
 * error status, a rate limit, a payload without a count) gives `null`, and
 * the button then shows no count. `fetchImpl` is for tests.
 */
export async function getStarCount(
  fetchImpl: typeof fetch = fetch
): Promise<number | null> {
  try {
    const res = await fetchImpl(API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      next: { revalidate: DAY_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const count =
      typeof body === "object" && body !== null
        ? (body as { stargazers_count?: unknown }).stargazers_count
        : undefined;
    return typeof count === "number" && Number.isInteger(count) && count >= 0
      ? count
      : null;
  } catch {
    return null;
  }
}

/** "950", "3.3k", "12k": one decimal below 10k, none above. The header sets it beside the star icon. */
export function formatStars(n: number): string {
  if (n < 1000) return `${n}`;
  const k = n < 9950 ? Math.round(n / 100) / 10 : Math.round(n / 1000);
  return `${k}k`;
}
