import NextLink from "next/link";
import { Fragment } from "react";
import { ArrowOutwardIcon } from "@/components/icons";
import { byYear, formatPostDate, type IndexEntry } from "@/lib/posts";

function RowBody({ entry }: { entry: IndexEntry }) {
  return (
    <>
      <span className="vx-label vx-post-row-meta">
        <time dateTime={entry.date}>{formatPostDate(entry.date)}</time>
        {entry.authors.length > 0 && <span>{entry.authors.join(", ")}</span>}
        {entry.source && (
          <span className="vx-post-row-source" title={entry.source}>
            <span className="vx-sr-only">Elsewhere, on </span>
            <span className="vx-post-row-host">{entry.source}</span>
            <ArrowOutwardIcon className="vx-post-row-out" />
          </span>
        )}
      </span>
      <h3 className="vx-h4 vx-post-row-title">{entry.title}</h3>
      {entry.summary && (
        <p className="vx-small vx-post-row-excerpt">{entry.summary}</p>
      )}
    </>
  );
}

/**
 * The BlogIndex card's rows, newest first, grouped by year: a quiet mono h2
 * per year over that year's own list. Each row is the date over the authors,
 * then the title (an h3 under its year) over the one-line summary. A post on
 * another site is an `is-external` row: a plain link to the other page, with
 * its source's host (cut with an ellipsis if it is too long for the meta
 * column, and whole in the title) and `arrow_outward` closing the meta, and
 * screen-reader text that says the link leaves the site.
 */
export function PostRows({ entries }: { entries: readonly IndexEntry[] }) {
  return byYear(entries).map(({ year, entries: rows }) => (
    <Fragment key={year}>
      <h2 className="vx-label vx-posts-year" id={`posts-${year}`}>
        {year}
      </h2>
      <ul className="vx-posts">
        {rows.map((entry) => (
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
    </Fragment>
  ));
}
