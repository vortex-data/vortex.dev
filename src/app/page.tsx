import { HeroASCII } from "@/components/hero";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vortex | An extensible, SOTA columnar file format",
  description:
    "Vortex is an extensible, state-of-the-art columnar file format, with associated tools for working with compressed Apache Arrow arrays in-memory, on-disk, and over-the-wire."
};

export default function Home() {
  return (
    <div className="h-full w-full relative">
      <HeroASCII />
    </div>
  );
}
