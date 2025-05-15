import SpiralLogo from "@/assets/spiral.svg";
import Image from "next/image";
import NextLink from "next/link";
import { Link } from "../link";
export const Footer = () => {
  return (
    <div className="flex flex-col-reverse md:flex-row justify-between items-center m-4 mt-2 md:mt-4 md:m-10 dashed-top dashed-bottom after:hidden md:after:block md:h-[84px]">
      <div className="flex items-center gap-4 dashed-right after:hidden lg:after:block h-full md:pl-2 lg:px-10 py-4 pb-4 md:py-0">
        <span className="text-sm font-mono text-white">
          Copyright © Vortex a Series of{" "}
          <Link href="https://lfprojects.org" target="_blank">
            LF Projects, LLC
          </Link>
          .
        </span>
      </div>
      <div className="dashed-top md:hidden w-full"></div>
      <div className="dashed-right h-full lg:hidden"></div>
      <div className="flex items-center gap-8 dashed-left before:hidden lg:before:block h-full lg:px-10">
        <div className="flex flex-col md:flex-row items-center gap-2 py-4 md:py-0">
          <span className="text-white font-mono text-sm flex gap-3 items-center">
            <NextLink
              href="https://spiraldb.com"
              target="_blank"
              className="uppercase text-white font-mono text-sm"
            >
              <Image
                src={SpiralLogo}
                alt="Spiral Logo"
                width={15}
                height={18}
              />
            </NextLink>
            <span>
              Donated by{" "}
              <Link href="https://spiraldb.com" target="_blank">
                Spiral
              </Link>
              .
            </span>
          </span>
        </div>
      </div>
    </div>
  );
};
