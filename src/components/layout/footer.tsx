import LFMark from "@/assets/lf_white.svg";
import { ThemeSwitch } from "@/components/theme-switch";
import { REPO_URL } from "@/lib/github";

// No project code of conduct exists, so the LF Projects one applies
// (charter section 6.b). The charter is a route (src/app/(site)/charter.pdf), so it
// takes a plain link like the rest.
const links = (origin: string) => [
  { href: `${origin}/charter.pdf`, label: "Charter" },
  {
    href: "https://lfprojects.org/policies/code-of-conduct/",
    label: "Code of conduct"
  },
  { href: `${REPO_URL}/blob/develop/SECURITY.md`, label: "Security" },
  {
    href: "https://zoom-lfx.platform.linuxfoundation.org/meetings/vortex",
    label: "Calendar"
  }
];

/**
 * The design system's Footer card: The Linux Foundation's logo (the system's
 * CSS inverts it in Light), the line LF Projects requires, followed by the
 * card's credit, the project's links, and the ThemeSwitch, which the system's
 * CSS moves up to the mark's line on a phone. `origin` is the site's, for a page
 * served from another host (bench), where the charter's path is not the site's.
 * Every surface draws this same footer (the system's DECISIONS 36).
 */
export function Footer({ origin = "" }: { origin?: string } = {}) {
  return (
    <footer className="vx-footer">
      <img
        className="vx-footer-mark"
        src={LFMark.src}
        width={LFMark.width}
        height={LFMark.height}
        alt="The Linux Foundation"
        loading="lazy"
      />
      <p className="vx-footer-text">
        Copyright © Vortex a Series of LF Projects, LLC. For web site terms of
        use, trademark policy and other project policies please see{" "}
        <a className="vx-link" href="https://lfprojects.org/policies">
          lfprojects.org/policies
        </a>
        .{" "}
        <span className="vx-footer-credit">
          Donated by{" "}
          <a className="vx-link" href="https://spiraldb.com">
            Spiral
          </a>
          .
        </span>
      </p>
      <nav className="vx-footer-nav" aria-label="Project">
        {links(origin).map(({ href, label }) => (
          <a key={href} className="vx-label-sm vx-nav-link" href={href}>
            {label}
          </a>
        ))}
      </nav>
      <ThemeSwitch />
    </footer>
  );
}
