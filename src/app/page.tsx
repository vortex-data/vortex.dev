import { HeroASCII } from "@/components/hero";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vortex | An extensible, SOTA columnar file format",
  applicationName: "Vortex",
  description:
    "Vortex is an extensible, state-of-the-art columnar file format, with associated tools for working with compressed Apache Arrow arrays in-memory, on-disk, and over-the-wire.",
  openGraph: {
    title: "Vortex | An extensible, SOTA columnar file format",
    description:
      "Vortex is an extensible, state-of-the-art columnar file format, with associated tools for working with compressed Apache Arrow arrays in-memory, on-disk, and over-the-wire.",
    siteName: "Vortex",
    url: "https://vortex.dev",
    type: "website",
    locale: "en_US"
  },
  alternates: {
    canonical: "https://vortex.dev"
  }
};

export default function Home() {
  return (
    <div className="h-full w-full relative">
      <HeroASCII />
    </div>
  );
}
