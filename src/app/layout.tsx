import { Analytics } from "@vercel/analytics/react";
import type { Metadata } from "next";
import { Funnel_Display, Geist, Geist_Mono } from "next/font/google";
import PlausibleProvider from "next-plausible";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { baseUrl } from "@/lib/constants";
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

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"]
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"]
});

const funnelDisplay = Funnel_Display({
  weight: ["300"],
  variable: "--font-funnel-display",
  subsets: ["latin"]
});

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${funnelDisplay.variable} antialiased`}
      >
        <PlausibleProvider
          domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? ""}
        >
          <Header />
          <main className="w-full h-auto mx-auto">
            <div className="flex flex-col mx-auto relative justify-center items-center">
              {children}
            </div>
          </main>
          <Footer />
        </PlausibleProvider>
        <Analytics />
      </body>
    </html>
  );
}
