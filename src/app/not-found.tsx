import { HeroASCIINotFound } from "@/components/hero-404";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "404",
  description: "404"
};

export default function NotFound() {
  return (
    <div className="h-full w-full relative">
      <HeroASCIINotFound />
    </div>
  );
}
