"use client";

import { useEffect, useRef, useState } from "react";
import { PauseFillIcon, PauseIcon } from "@/components/icons";
import { copiesNeeded } from "@/vendor/vortex-design/ascii-core.js";
import { LOGOS } from "./logos";

// copiesNeeded never asks for fewer than two, and two sets cover the page's
// widest strip, so the server draws two and the loop runs before hydration.
const FIRST_COPIES = 2;

/**
 * The design system's LogoBanner: the adopters' logos in a slow loop, in
 * monochrome white. The system's CSS runs the 48s loop, pauses it under the
 * pointer, with focus among the logos and while the pause control is pressed
 * (WCAG 2.2.2), and stops it under reduced motion. The first set carries the names;
 * the copies that keep the loop seamless are hidden from assistive
 * technology, and their links leave the tab order. Each logo links to its
 * owner's page about Vortex, or its homepage. `className` places the band on
 * the page. Without JavaScript the pause control cannot work, so the logos
 * sit still in rows, as under reduced motion, and the control hides
 * (globals.css).
 */
export function LogoBanner({ className }: { className?: string | undefined }) {
  const strip = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLDivElement>(null);
  const [copies, setCopies] = useState(FIRST_COPIES);
  const [paused, setPaused] = useState(false);

  // Enough sets that two loops cover the strip, as the LogoBanner card lays
  // them down, again whenever the strip changes width.
  useEffect(() => {
    const view = strip.current;
    const set = first.current;
    if (!view || !set) return;
    const fill = () =>
      setCopies(
        copiesNeeded(
          set.getBoundingClientRect().width,
          view.getBoundingClientRect().width
        )
      );
    fill();
    const observer = new ResizeObserver(fill);
    observer.observe(view);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      className={className ? `${className} vx-logos` : "vx-logos"}
      aria-label="Who builds on Vortex"
    >
      <span className="vx-label">Who builds on Vortex</span>
      {/* A toggle: the CSS reads aria-pressed, so the name stays the same. */}
      <button
        className="vx-logos-pause"
        type="button"
        aria-pressed={paused}
        aria-label="Pause the logos"
        data-requires-js
        onClick={() => setPaused((p) => !p)}
      >
        <PauseIcon />
        <PauseFillIcon />
      </button>
      <div ref={strip} className="vx-logos-strip">
        <div className="vx-logos-track">
          {Array.from({ length: copies }, (_, i) => (
            <div
              key={i}
              ref={i === 0 ? first : undefined}
              className="vx-logos-set"
              aria-hidden={i > 0 ? true : undefined}
            >
              {LOGOS.map(({ name, image, width, height, href }) => (
                <a key={name} href={href} tabIndex={i > 0 ? -1 : undefined}>
                  <img
                    src={image.src}
                    width={width}
                    height={height}
                    alt={i > 0 ? "" : name}
                    decoding="async"
                  />
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
