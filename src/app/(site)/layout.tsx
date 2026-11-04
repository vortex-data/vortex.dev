import { Analytics } from "@vercel/analytics/react";
import type { Metadata } from "next";
import PlausibleProvider from "next-plausible";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { RouteTheme } from "@/components/route-theme";
import { baseUrl } from "@/lib/constants";
import { FONT_CLASSES } from "@/lib/fonts";
import { THEME_BOOTSTRAP } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  // public/favicon.ico, not the app/ file convention: that would put the icon
  // on every root layout's pages, bench's too, which have their own icons.
  icons: {
    icon: { url: "/favicon.ico", sizes: "256x256", type: "image/x-icon" }
  },
  alternates: {
    types: {
      "application/rss+xml": [
        { url: "/rss/feed.xml", title: "Vortex Blog (RSS)" },
        { url: "/rss/feed.atom", title: "Vortex Blog (Atom)" }
      ],
      "application/feed+json": [
        { url: "/rss/feed.json", title: "Vortex Blog (JSON Feed)" }
      ]
    }
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The design system's page frame (globals.css): header, main and footer in
  // one --page-max column. Each section pads itself by --page-pad. The skip
  // link comes first, so it is the first tab stop; main takes focus from it
  // (tabIndex -1), so the next Tab starts in the content.
  const content = (
    <>
      <a className="vx-skip-link" href="#main">
        Skip to content
      </a>
      <div className="site-frame">
        <Header />
        <main className="site-main" id="main" tabIndex={-1}>
          {children}
        </main>
        <Footer />
      </div>
    </>
  );

  // Dark is the server-rendered default; THEME_BOOTSTRAP corrects it before
  // first paint on the blog, so React must not flag the attribute it changed.
  // It also swaps `no-js` for `js` first, so controls that need JavaScript
  // hide only when no script runs (globals.css).
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`no-js ${FONT_CLASSES}`}
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script that sets the theme before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <RouteTheme />
        {process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_SRC ? (
          <PlausibleProvider>{content}</PlausibleProvider>
        ) : (
          content
        )}
        {/* Vercel serves the Analytics script only on its own deployments.
            Elsewhere, such as the local build that Lighthouse audits, the
            script is a 404 and logs a console error. */}
        {process.env.VERCEL && <Analytics />}
      </body>
    </html>
  );
}
