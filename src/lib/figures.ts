/** One bar of the Figure card: a name and its value. */
export interface Bar {
  name: string;
  value: number;
  /** Vortex's own bar, in `chart-1`. People and other systems are grey. */
  ours?: boolean;
  /** A ratio after the value, such as "0.62×". */
  extra?: string;
}

const NUMBER = new Intl.NumberFormat("en-US");

/**
 * The Figure card's rows: each bar's width as a percentage of the largest
 * value, rounded to two places, and its value as the post prints it. The
 * rows keep the post's order.
 */
export function barRows(bars: readonly Bar[]) {
  const max = Math.max(...bars.map((b) => b.value));
  return bars.map((b) => ({
    name: b.name,
    width: Math.round((b.value / max) * 10_000) / 100,
    value: NUMBER.format(b.value),
    ours: b.ours ?? false,
    extra: b.extra
  }));
}

/** The figure's `aria-label`: its title, then every bar's figure. */
export function barsLabel(title: string, bars: readonly Bar[]): string {
  return `${title}: ${bars.map((b) => `${b.name} ${NUMBER.format(b.value)}`).join(", ")}`;
}

/** An encoding chain as a screen reader hears it. */
export function chainLabel(steps: readonly string[]): string {
  return steps.join(", then ");
}
