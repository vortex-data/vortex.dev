import LFMark from "@/assets/lf_white.svg";
import { REPO_URL } from "@/lib/github";

// No project code of conduct exists, so the LF Projects one applies
// (charter section 6.b). The charter is a route (src/app/charter.pdf), so it
// takes a plain link like the rest.
const LINKS = [
  { href: "/charter.pdf", label: "Charter" },
  {
    href: "https://lfprojects.org/policies/code-of-conduct/",
    label: "Code of conduct"
  },
  { href: `${REPO_URL}/blob/develop/SECURITY.md`, label: "Security" },
  {
    href: "https://zoom-lfx.platform.linuxfoundation.org/meetings/vortex",
    label: "Calendar"
  }
] as const;

/**
 * The design system's Footer card: The Linux Foundation's logo (the system's
 * CSS inverts it in Light), the line LF Projects requires, and the project's
 * links.
 */
export function Footer() {
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
        .
      </p>
      <nav className="vx-footer-nav" aria-label="Project">
        {LINKS.map(({ href, label }) => (
          <a key={href} className="vx-label-sm vx-nav-link" href={href}>
            {label}
          </a>
        ))}
      </nav>
    </footer>
  );
}
