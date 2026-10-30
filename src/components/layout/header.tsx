import NextLink from "next/link";
import WordmarkLight from "@/assets/vortex_wordmark.svg";
import WordmarkDark from "@/assets/vortex_wordmark_dark_theme.svg";
import { StarIcon } from "@/components/icons";
import { MarkGithub } from "@/components/mark-github";
import { ThemeSwitch } from "@/components/theme-switch";
import { formatStars, getStarCount, REPO, REPO_URL } from "@/lib/github";
import { HeaderNav } from "./header-nav";

/**
 * The design system's Header card, site variant: the wordmark, the nav and
 * the GitHub button, then on blog pages the ThemeSwitch, last in the end
 * group. The system's CSS shows the wordmark that suits the theme, moves the
 * nav to a second row below 800px (920px with the switch), and drops the
 * repository name on narrow phones. The button's name starts with its
 * visible text, as Lighthouse's label-content-name-mismatch requires.
 */
export async function Header() {
  const stars = await getStarCount();
  return (
    <header className="vx-header has-nav">
      <div className="vx-header-start">
        <NextLink href="/" aria-label="Vortex home">
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
        </NextLink>
      </div>
      <HeaderNav />
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
        <ThemeSwitch />
      </div>
    </header>
  );
}
