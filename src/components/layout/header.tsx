import NextLink from "next/link";
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
 * links point back to vortex.dev, Bench is the current section, and there is
 * no ThemeSwitch: bench's theme toggle is in its toolbar. bench takes the
 * card's solid variant (`is-solid`), whose rules suit a tool's toolbar and
 * tables better than the frame's dashes.
 */
export async function Header({ bench }: HeaderPlace = {}) {
  const stars = await getStarCount();
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
      className={bench ? "vx-header has-nav is-solid" : "vx-header has-nav"}
    >
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
      <div className="vx-header-end">
        <a
          className="vx-btn vx-btn-secondary is-mono"
          href={REPO_URL}
          aria-label={
            stars === null
              ? `${REPO} on GitHub`
              : `${REPO} ${formatStars(stars)} stars on GitHub`
          }
        >
          <MarkGithub />
          <span className="vx-header-repo">{REPO}</span>
          {stars !== null && (
            <span className="vx-btn-count">
              <StarIcon />
              {formatStars(stars)}
            </span>
          )}
        </a>
        {!bench && <ThemeSwitch />}
        <HeaderMenu bench={bench} />
      </div>
    </header>
  );
}
