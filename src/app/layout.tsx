import { Analytics } from "@vercel/analytics/react";
import type { Metadata } from "next";
import { Funnel_Display, Geist, Geist_Mono } from "next/font/google";
import PlausibleProvider from "next-plausible";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { RouteTheme } from "@/components/route-theme";
import { baseUrl } from "@/lib/constants";
import { THEME_BOOTSTRAP } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
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

// The design system's three faces, self-hosted by next/font. Its tokens read
// them through these variables (src/styles/vortex-tokens.css), which carry
// next/font's metrics-matched fallback faces as well as the fonts.
const geistSans = Geist({
  variable: "--vx-face-sans",
  subsets: ["latin"]
});

const geistMono = Geist_Mono({
  variable: "--vx-face-mono",
  subsets: ["latin"]
});

const funnelDisplay = Funnel_Display({
  weight: ["500", "600"],
  variable: "--vx-face-display",
  subsets: ["latin"]
});

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The design system's page frame (globals.css): header, main and footer in
  // one --page-max column. Each section pads itself by --page-pad.
  const content = (
    <div className="site-frame">
      <Header />
      <main className="site-main">{children}</main>
      <Footer />
    </div>
  );

  // Dark is the server-rendered default; THEME_BOOTSTRAP corrects it before
  // first paint on the blog, so React must not flag the attribute it changed.
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${funnelDisplay.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="antialiased">
        <RouteTheme />
        {process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_SRC ? (
          <PlausibleProvider>{content}</PlausibleProvider>
        ) : (
          content
        )}
        <Analytics />
      </body>
    </html>
  );
}
