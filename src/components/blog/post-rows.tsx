import NextLink from "next/link";
import { ArrowOutwardIcon } from "@/components/icons";
import { formatPostDate, type IndexEntry } from "@/lib/posts";

function RowBody({ entry }: { entry: IndexEntry }) {
  return (
    <>
      <span className="vx-label vx-post-row-meta">
        <time dateTime={entry.date}>{formatPostDate(entry.date)}</time>
        {entry.authors.length > 0 && <span>{entry.authors.join(", ")}</span>}
        {entry.source && (
          <span className="vx-post-row-source">
            <span className="vx-sr-only">Elsewhere, on </span>
            {entry.source}
            <ArrowOutwardIcon className="vx-post-row-out" />
          </span>
        )}
      </span>
      <h2 className="vx-h4 vx-post-row-title">{entry.title}</h2>
      {entry.summary && (
        <p className="vx-small vx-post-row-excerpt">{entry.summary}</p>
      )}
    </>
  );
}

/**
 * The BlogIndex card's one list, newest first: each row the date over the
 * authors, then the title (an h2 under the index's h1) over the one-line
 * summary. A post on another site is an `is-external` row: a plain link to
 * the other page, with its source's host and `arrow_outward` closing the
 * meta, and screen-reader text that says the link leaves the site.
 */
export function PostRows({ entries }: { entries: readonly IndexEntry[] }) {
  return (
    <ul className="vx-posts">
      {entries.map((entry) => (
        <li key={entry.key}>
          {entry.source ? (
            <a className="vx-post-row is-external" href={entry.href}>
              <RowBody entry={entry} />
            </a>
          ) : (
            <NextLink className="vx-post-row" href={entry.href}>
              <RowBody entry={entry} />
            </NextLink>
          )}
        </li>
      ))}
    </ul>
  );
}
