import { type CSSProperties, Fragment, type ReactNode } from "react";
import { OpenInNewIcon } from "@/components/icons";
import { type Bar, barRows, barsLabel, chainLabel } from "@/lib/figures";

/**
 * The parts a post draws with the design system's cards. Each takes the
 * post's own numbers and words.
 */

// A Geist Mono character at the Figure's 12.5px, for sizing the columns.
const MONO_CH = 7.6;

/**
 * The Figure card's bars: a `vx-label-sm` title, then one row per bar in
 * the post's order. `unit` and `better` ("↓" or "↑") follow the title.
 */
export function Bars({
  title,
  unit,
  better,
  bars,
  caption
}: {
  title: string;
  unit?: string;
  better?: "↓" | "↑";
  bars: Bar[];
  caption?: ReactNode;
}) {
  const rows = barRows(bars);
  const nameCh = Math.max(...rows.map((r) => r.name.length));
  const valueCh = Math.max(
    ...rows.map((r) => r.value.length + (r.extra ? r.extra.length + 1 : 0))
  );
  const style = {
    "--bar-name": `${Math.ceil(nameCh * MONO_CH)}px`,
    "--bar-value": `${Math.ceil(valueCh * MONO_CH) + 8}px`
  } as CSSProperties;
  return (
    <figure className="vx-figure">
      <div
        className="vx-figure-frame"
        role="img"
        aria-label={barsLabel(unit ? `${title}, ${unit}` : title, bars)}
      >
        <span className="vx-label-sm">
          {title}
          {unit && (
            <>
              {" · "}
              <span className="vx-keep-case">{unit}</span>
            </>
          )}
          {better && ` ${better}`}
        </span>
        <div className="vx-bars is-lg" style={style}>
          {rows.map((r) => (
            <div key={r.name} className={r.ours ? "vx-bar is-ours" : "vx-bar"}>
              <span>{r.name}</span>
              <span className="vx-bar-track">
                <span
                  className="vx-bar-fill"
                  style={{ width: `${r.width}%` }}
                />
              </span>
              <span className="vx-bar-value">
                {r.value}
                {r.extra && <span className="vx-bar-extra">{r.extra}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
      {caption && (
        <figcaption className="vx-figure-caption">{caption}</figcaption>
      )}
    </figure>
  );
}

/** An encoding chain, as the DetailStrip card draws it, on its own line. */
export function Chain({ steps }: { steps: string[] }) {
  return (
    <div className="vx-chain" role="img" aria-label={chainLabel(steps)}>
      {steps.map((step, i) => (
        <Fragment key={step}>
          {i > 0 && <span className="vx-chain-arrow">→</span>}
          <span className="vx-chain-step">{step}</span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * The Quote card: someone else's words, framed, with a link to where they
 * said them.
 */
export function Quote({
  source,
  href,
  children
}: {
  source: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <figure className="vx-quote">
      <blockquote className="vx-h5 vx-quote-text">{children}</blockquote>
      <figcaption className="vx-quote-source">
        <a className="vx-label-sm vx-source vx-nav-link" href={href}>
          {source}
          <OpenInNewIcon />
        </a>
      </figcaption>
    </figure>
  );
}

/** People named in a post: a grid of names, not a code block. */
export function Names({ names }: { names: string[] }) {
  return (
    <ul className="vx-names">
      {names.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}
