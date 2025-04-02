import Logo from "@/assets/logo.svg";
import Image from "next/image";
import NextLink from "next/link";
import { Link } from "../link";

export const Header = () => {
  return (
    <div className="flex justify-between items-center m-4 mb-2 dashed-top dashed-bottom h-[72px] mx-2 md:h-[108px]">
      <NextLink
        href="/"
        className="flex items-center gap-4 dashed-right h-full px-8"
      >
        <Image src={Logo} alt="Logo" width={44} height={44} />
        <h1 className="text-4xl font-funnel text-white hidden md:inline-block">
          Vortex
        </h1>
      </NextLink>
      <div className="flex items-center gap-8 flex-1 justify-end md:flex-none dashed-left before:hidden md:before:block h-full px-10">
        <Link
          href="/"
          className="uppercase text-white font-mono text-base md:text-[18px] font-medium"
        >
          GitHub
        </Link>
        <Link
          href="/"
          className="uppercase text-white font-mono text-base md:text-[18px] font-medium"
        >
          Docs
        </Link>
      </div>
    </div>
  );
};
