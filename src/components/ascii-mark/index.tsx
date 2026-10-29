"use client";

import { useEffect, useRef, useState } from "react";
import symbol from "@/assets/vortex_symbol_dark_theme.svg";

const IDLE_TIMEOUT_MS = 2000;

// Runs `run` once the page has loaded and the main thread is idle, so the
// mark's code never delays first paint or hydration. Returns a cancel function.
function whenIdle(run: () => void): () => void {
  let idle = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (typeof requestIdleCallback === "function")
      idle = requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    else timer = setTimeout(run, 200);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
  return () => {
    window.removeEventListener("load", schedule);
    if (idle) cancelIdleCallback(idle);
    clearTimeout(timer);
  };
}

// The static symbol's place and size in the host: the design system's own
// fallback for the mark (ascii-mark.js), so the two look the same.
const STILL_STYLE = {
  position: "absolute",
  inset: 0,
  margin: "auto",
  width: "40%",
  height: "auto",
  opacity: 0.85
} as const;

/**
 * The design system's AsciiMark card: the Vortex mark turning in 3D, drawn
 * as Geist Mono characters. It is decorative, so the host is hidden from
 * assistive technology. `className` positions and sizes the host.
 *
 * The server renders the static symbol in the host, so the page shows a mark
 * before any script runs, and without scripts at all. Once the page is idle
 * the live (or reduced-motion) mark mounts and the symbol goes. Without
 * WebGL, when three.js cannot load, or when mounting throws, the symbol
 * stays.
 */
export function AsciiMark({ className }: { className?: string | undefined }) {
  const host = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let mounted = true;
    let destroy = () => {};
    const mount = async () => {
      // Both load only now, so neither is in the page's first JavaScript. A
      // three.js module without WebGLRenderer makes mountAsciiMark return a
      // static mark, so a three.js chunk that fails to load leaves the
      // symbol in place.
      const [{ mountAsciiMark }, three] = await Promise.all([
        import("@/vendor/vortex-design/ascii-mark.js"),
        import("three").catch(() => ({}))
      ]);
      if (!mounted) return;
      // The token's family list, so the canvas gets next/font's face and its
      // metrics-matched fallback, as the page's text does.
      const font = getComputedStyle(el).getPropertyValue("--font-mono").trim();
      // No fallbackSrc: the static mark is the symbol the server rendered.
      const mark = await mountAsciiMark(el, {
        three,
        ...(font ? { font } : {})
      });
      if (!mounted) return mark.destroy();
      destroy = mark.destroy;
      // live, reduced or static: what the browser could draw. Tests read it.
      el.dataset.markMode = mark.mode;
      // A drawn mark covers the host, so the symbol goes.
      if (mark.mode !== "static") setDrawn(true);
    };
    // If mounting throws, the symbol stays, and the host says so, so a test
    // reports the failure instead of an empty box.
    const fallBack = (err: unknown) => {
      if (!mounted) return;
      el.dataset.markMode = "error";
      el.dataset.markError = String(
        err instanceof Error ? err.message : err
      ).slice(0, 200);
    };
    const cancel = whenIdle(() => {
      mount().catch(fallBack);
    });
    return () => {
      mounted = false;
      cancel();
      destroy();
    };
  }, []);

  return (
    <div ref={host} className={className} aria-hidden="true">
      {!drawn && (
        <img
          className="ascii-mark-still"
          src={symbol.src}
          alt=""
          style={STILL_STYLE}
        />
      )}
    </div>
  );
}
