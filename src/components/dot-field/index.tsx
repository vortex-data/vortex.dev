/**
 * The design system's DotField: the ASCII mark's dot field, still, behind
 * the page. Put it first in a host that has `has-dot-field`; it covers the
 * top of the host and fades toward every edge. With `margins`, for a page
 * whose column of text clears the field (`vx-dot-clear`), it keeps the
 * margins at full strength and fades only from the top and the outer edges.
 * It is decoration, so it is hidden from assistive technology.
 */
export function DotField({ margins = false }: { margins?: boolean }) {
  return (
    <div
      className={margins ? "vx-dot-field is-margins" : "vx-dot-field"}
      aria-hidden="true"
    />
  );
}
