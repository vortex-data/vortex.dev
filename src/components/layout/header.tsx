import NextLink from "next/link";
import { type ReactNode, Suspense } from "react";
import WordmarkLight from "@/assets/vortex_wordmark.svg";
import WordmarkDark from "@/assets/vortex_wordmark_dark_theme.svg";
import { StarIcon } from "@/components/icons";
import { MarkGithub } from "@/components/mark-github";
import { ThemeSwitch } from "@/components/theme-switch";
import { formatStars, getStarCount, REPO, REPO_URL } from "@/lib/github";
import { HeaderMenu, HeaderNav, type HeaderPlace } from "./header-nav";

/**
 * The design system's Header card, site variant: the wordmark, the nav and
 * the GitHub button, then on blog pages the ThemeSwitch, last in the end
 * group, and last the Menu button. The system's CSS shows the wordmark that
 * suits the theme, puts the links behind the Menu button below 800px (920px
 * with the switch), and drops the repository name on narrow phones. The button's name starts with its
 * visible text, as Lighthouse's label-content-name-mismatch requires.
 *
 * On bench, which is served from its own host, the wordmark and the site's
 * links point back to vortex.dev, and Bench is the current section. bench
 * takes the card's solid variant (`is-solid`), whose rules suit a tool's
 * tables better than the frame's dashes, and its tools variant (`has-tools`):
 * one sticky row with the page's h1, "Benchmarks", bench's controls (`tools`)
 * and its theme toggle (`theme`) in place of the ThemeSwitch, with the links
 * always behind the Menu button. On a phone the GitHub button and the toggle
 * move into the Menu's panel, the toggle as `themeRow`.
 *
 * bench renders on request, so its GitHub button waits for the star count
 * behind a Suspense boundary: a slow GitHub API delays only the count, never
 * the page. The site is static and reads the count at build time.
 */
export async function Header({
  bench,
  tools,
  theme,
  themeRow
}: HeaderPlace & {
  tools?: ReactNode;
  theme?: ReactNode;
  themeRow?: ReactNode;
} = {}) {
  const marks = (
    <>
      <img
        className="vx-header-mark is-dark"
        src={WordmarkDark.src}
        width={WordmarkDark.width}
        height={WordmarkDark.height}
        alt="Vortex"
      />
      {/* Lazy, so Dark pages never fetch the Light mark they hide. */}
      <img
        className="vx-header-mark is-light"
        src={WordmarkLight.src}
        width={WordmarkLight.width}
        height={WordmarkLight.height}
        alt="Vortex"
        loading="lazy"
      />
    </>
  );
  return (
    <header
      className={
        bench ? "vx-header has-nav has-tools is-solid" : "vx-header has-nav"
      }
    >
      <div className="vx-header-start">
        {bench ? (
          <>
            <a href="https://vortex.dev" aria-label="Vortex home">
              {marks}
            </a>
            <h1 className="vx-label vx-header-label">Benchmarks</h1>
          </>
        ) : (
          <NextLink href="/" aria-label="Vortex home">
            {marks}
          </NextLink>
        )}
      </div>
      <HeaderNav bench={bench} />
      {bench && <div className="vx-header-tools">{tools}</div>}
      <div className="vx-header-end">
        {bench && theme}
        {bench ? (
          <Suspense fallback={<GithubButton bench stars={null} />}>
            <BenchGithubButton />
          </Suspense>
        ) : (
          <GithubButton stars={await getStarCount()} />
        )}
        {!bench && <ThemeSwitch />}
        <HeaderMenu
          bench={bench}
          spill={
            bench && (
              <>
                <a
                  className="vx-label vx-nav-link vx-header-menu-spill"
                  href={REPO_URL}
                >
                  <MarkGithub />
                  GitHub
                </a>
                {themeRow}
              </>
            )
          }
        />
      </div>
    </header>
  );
}

/** The GitHub button, with the repository's star count once it is known. */
function GithubButton({
  bench,
  stars
}: {
  bench?: boolean;
  stars: number | null;
}) {
  return (
    <a
      className={
        bench
          ? "vx-btn vx-btn-secondary is-mono vx-header-spill"
          : "vx-btn vx-btn-secondary is-mono"
      }
      href={REPO_URL}
      aria-label={
        stars === null
          ? `${REPO} on GitHub`
          : `${REPO} ${formatStars(stars)} stars on GitHub`
      }
    >
      <MarkGithub />
      <span className="vx-header-repo">{REPO}</span>{" "}
      {stars !== null && (
        <span className="vx-btn-count">
          <StarIcon />
          {formatStars(stars)}
        </span>
      )}
    </a>
  );
}

/** bench's GitHub button, once the star count is read: the Suspense boundary's content. */
async function BenchGithubButton() {
  return <GithubButton bench stars={await getStarCount()} />;
}
