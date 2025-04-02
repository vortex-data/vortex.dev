import { HeroASCII } from "@/components/hero";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home",
  description: "Home"
};

export default function Home() {
  return (
    <div className="h-full w-full relative">
      <HeroASCII />
    </div>
  );
}
