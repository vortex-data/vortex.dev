import { HeroASCIINotFound } from "@/components/hero-404";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "404 | Page not found",
  applicationName: "Vortex",
  description: "404 | Page not found",
  openGraph: {
    title: "404 | Page not found",
    description: "404 | Page not found",
    siteName: "Vortex",
    url: "https://vortex.dev",
    type: "website",
    locale: "en_US"
  },
  alternates: {
    canonical: "https://vortex.dev"
  }
};

export default function NotFound() {
  return (
    <div className="h-full w-full relative">
      <HeroASCIINotFound />
    </div>
  );
}
