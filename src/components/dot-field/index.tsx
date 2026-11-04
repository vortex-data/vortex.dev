/**
 * The design system's DotField: the ASCII mark's dot field, still, behind
 * the page. Put it first in a host that has `has-dot-field`; it covers the
 * top of the host and fades toward every edge. It is decoration,
 * so it is hidden from assistive technology.
 */
export function DotField() {
  return <div className="vx-dot-field" aria-hidden="true" />;
}
