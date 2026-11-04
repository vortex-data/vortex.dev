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
 * The design system's Header card, the one header every Vortex surface draws
 * (the system's DECISIONS 35): the wordmark, the links, a surface's own
 * `tools`, then the end group: the ThemeSwitch, the GitHub button, and on a
 * narrow screen the Menu. The system's CSS keeps the shared items in the same
 * place at a given width whatever the tools hold: below 1180px the GitHub
 * button keeps its mark, below 960px the links go behind the Menu, and below
 * 640px the switch and the GitHub button move to twin rows in the Menu's
 * panel. The button's name starts with its visible text, as Lighthouse's
 * label-content-name-mismatch requires.
 *
 * On bench, which is served from its own host, the wordmark and the site's
 * links point back to vortex.dev, Bench is the current link, and bench's
 * controls are the tools.
 *
 * bench renders on request, so its GitHub button waits for the star count
 * behind a Suspense boundary: a slow GitHub API delays only the count, never
 * the page. The site is static and reads the count at build time.
 */
export async function Header({
  bench,
  tools
}: HeaderPlace & { tools?: ReactNode } = {}) {
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
    <header className="vx-header">
      <div className="vx-header-start">
        {bench ? (
          <a href="https://vortex.dev" aria-label="Vortex home">
            {marks}
          </a>
        ) : (
          <NextLink href="/" aria-label="Vortex home">
            {marks}
          </NextLink>
        )}
      </div>
      <HeaderNav bench={bench} />
      {tools && <div className="vx-header-tools">{tools}</div>}
      <div className="vx-header-end">
        <ThemeSwitch />
        {bench ? (
          <Suspense fallback={<GithubButton stars={null} />}>
            <BenchGithubButton />
          </Suspense>
        ) : (
          <GithubButton stars={await getStarCount()} />
        )}
        <HeaderMenu
          bench={bench}
          spill={
            <>
              <div className="vx-header-menu-spill">
                <span className="vx-label">Theme</span>
                <ThemeSwitch />
              </div>
              <a
                className="vx-label vx-nav-link vx-header-menu-spill"
                href={REPO_URL}
                aria-label={`${REPO} on GitHub`}
              >
                GitHub
                <MarkGithub />
              </a>
            </>
          }
        />
      </div>
    </header>
  );
}

/** The GitHub button, with the repository's star count once it is known. */
function GithubButton({ stars }: { stars: number | null }) {
  return (
    <a
      className="vx-btn vx-btn-secondary is-mono vx-header-github"
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
  return <GithubButton stars={await getStarCount()} />;
}
