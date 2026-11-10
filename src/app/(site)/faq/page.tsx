import type { Metadata } from "next";
import { Fragment } from "react";
import { LOGOS } from "@/components/logo-banner/logos";
import { getBenchSummary, summaryForPage } from "@/lib/bench-summary";
import { baseUrl } from "@/lib/constants";
import { faqJsonLd, faqs } from "@/lib/faq";
import { jsonLdScript } from "@/lib/json-ld";
import { getSparkVersion } from "@/lib/maven";

const TITLE = "FAQ | Vortex";
const DESCRIPTION =
  "Answers about Vortex, the open-source columnar file format: how it compares to Apache Parquet, why it is fast, who uses it, and how to install it.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Vortex",
    url: `${baseUrl}/faq`,
    type: "website",
    locale: "en_US"
  },
  alternates: {
    canonical: `${baseUrl}/faq`
  }
};

// The comparison with Parquet carries the homepage's figures, so the page is
// static and rebuilt at most once a day, like the homepage.
export const dynamic = "force-static";
export const revalidate = 86400;

/**
 * The design system's Article card, as a blog post draws it: the title and
 * the dek, then each question as a heading in the prose column. The page
 * carries the same questions and answers as FAQPage structured data.
 */
export default async function FaqPage() {
  const [sparkVersion, summary] = await Promise.all([
    getSparkVersion(),
    getBenchSummary()
  ]);
  const list = faqs({
    bench: summaryForPage(summary),
    sparkVersion,
    ecosystem: LOGOS
  });

  return (
    <div className="blog-page">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD from our own data; jsonLdScript escapes every <.
        dangerouslySetInnerHTML={{ __html: jsonLdScript(faqJsonLd(list)) }}
      />
      <article className="vx-article vx-reading">
        <header className="vx-article-head">
          <h1 className="vx-display-mono vx-article-title">FAQ</h1>
          <p className="vx-article-dek">
            Common questions about Vortex, the open-source columnar file format.
          </p>
        </header>
        <div className="vx-prose">
          {list.map((faq) => (
            <Fragment key={faq.id}>
              <h2 id={faq.id}>{faq.question}</h2>
              {faq.answer.map((p) => (
                <p key={p}>{p}</p>
              ))}
              {faq.list && (
                <ul>
                  {faq.list.map((item) => (
                    <li key={item.label}>
                      {item.text === undefined ? (
                        item.label
                      ) : (
                        <>
                          {`${item.label}: `}
                          {item.code ? <code>{item.text}</code> : item.text}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {faq.after?.map((p) => (
                <p key={p}>{p}</p>
              ))}
              {faq.links && (
                <p>
                  {faq.links.map((link, i) => (
                    <Fragment key={link.href}>
                      {i > 0 && " · "}
                      <a href={link.href}>{link.label}</a>
                    </Fragment>
                  ))}
                </p>
              )}
            </Fragment>
          ))}
        </div>
      </article>
    </div>
  );
}
