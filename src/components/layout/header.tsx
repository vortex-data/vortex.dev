import NextLink from "next/link";
import { type ReactNode, Suspense } from "react";
import WordmarkLight from "@/assets/vortex_wordmark.svg";
import WordmarkDark from "@/assets/vortex_wordmark_dark_theme.svg";
import { StarIcon } from "@/components/icons";
import { MarkGithub } from "@/components/mark-github";
import { MarkSlack } from "@/components/mark-slack";
import { MarkX } from "@/components/mark-x";
import { formatStars, getStarCount, REPO, REPO_URL } from "@/lib/github";
import { socialLinks } from "@/lib/nav";
import { HeaderMenu, HeaderNav, type HeaderPlace } from "./header-nav";

/**
 * The design system's Header card, the one header every Vortex surface draws
 * (the system's DECISIONS 35): the wordmark, the links, a surface's own
 * `tools`, then the end group: the socials (X, Slack, and the GitHub button),
 * and on a narrow screen the Menu. The theme switch is in the Footer. The
 * system's CSS keeps the shared items in the same place at a given width
 * whatever the tools hold: below 960px the links, X, and Slack go behind the
 * Menu, and the GitHub button and the Menu are icon squares; below 640px
 * GitHub follows.
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
  const social = socialLinks(bench);
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
        <div className="vx-header-social">
          <a
            className="vx-nav-link vx-header-social-link"
            href={social.x}
            aria-label="Vortex on X"
            title="Vortex on X"
          >
            <MarkX />
          </a>
          <a
            className="vx-nav-link vx-header-social-link"
            href={social.slack}
            aria-label="Vortex on Slack"
            title="Vortex on Slack"
          >
            <MarkSlack />
          </a>
          {bench ? (
            <Suspense fallback={<GithubButton stars={null} />}>
              <BenchGithubButton />
            </Suspense>
          ) : (
            <GithubButton stars={await getStarCount()} />
          )}
        </div>
        <HeaderMenu
          bench={bench}
          spill={
            <>
              <a
                className="vx-label vx-nav-link vx-header-menu-spill is-social"
                href={REPO_URL}
                aria-label={`${REPO} on GitHub`}
              >
                GitHub
                <MarkGithub />
              </a>
              <a
                className="vx-label vx-nav-link vx-header-menu-spill is-social is-icon"
                href={social.slack}
                aria-label="Vortex on Slack"
              >
                Slack
                <MarkSlack />
              </a>
              <a
                className="vx-label vx-nav-link vx-header-menu-spill is-social is-icon"
                href={social.x}
                aria-label="Vortex on X"
              >
                X
                <MarkX />
              </a>
            </>
          }
        />
      </div>
    </header>
  );
}

/**
 * The GitHub button: the mark, and the repository's star count once it is
 * known. The repository's name is in the button's accessible name and title,
 * not on the row (Will, 4 Nov 2026: it "takes up too much real estate in the
 * social bar"). The name starts with the count, the visible text, as
 * Lighthouse's label-content-name-mismatch and voice control expect.
 */
function GithubButton({ stars }: { stars: number | null }) {
  return (
    <a
      className="vx-btn vx-btn-secondary is-mono vx-header-github"
      href={REPO_URL}
      aria-label={
        stars === null
          ? `${REPO} on GitHub`
          : `${formatStars(stars)} stars, ${REPO} on GitHub`
      }
      title={`${REPO} on GitHub`}
    >
      <MarkGithub />
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
