import LFLogo from "@/assets/lf_white.svg";
import SpiralLogo from "@/assets/spiral.svg";
import Image from "next/image";
import NextLink from "next/link";
import { Link } from "../link";

export const Footer = () => {
  return (
    <div className="flex flex-col m-4 mb-2 md:m-10">
      <div className="flex flex-col sm:flex-row justify-center items-center px-4 sm:px-0 gap-4 md:gap-16 dashed-top dashed-bottom after:hidden md:after:block py-4 md:py-0 md:h-[84px]">
        <div className="flex items-center h-full lg:px-10">
          <div className="flex flex-col md:flex-row items-center gap-2">
            <span className="text-sm font-mono text-white items-center gap-2">
              Incubating @{" "}
              <Image
                src={LFLogo}
                alt="Linux Foundation logo"
                height={10}
                className="inline"
              />
            </span>
          </div>
        </div>
        <div className="flex items-center h-full lg:px-10">
          <span className="text-white font-mono text-sm items-center gap-1 text-center sm:text-left">
            Copyright © Vortex a Series of{" "}
            <Link href="https://lfprojects.org" target="_blank">
              LF Projects, LLC.
            </Link>
          </span>
        </div>
        <div className="flex items-center h-full lg:px-10">
          <span className="text-xs font-mono text-white items-center gap-2 flex">
            <NextLink href="https://spiraldb.com" target="_blank">
              <Image
                src={SpiralLogo}
                alt="Spiral Logo"
                width={15}
                height={18}
              />
            </NextLink>
            Donated by{" "}
            <Link href="https://spiraldb.com" target="_blank">
              Spiral.
            </Link>
          </span>
        </div>
      </div>
      {/* <div className="py-6 flex justify-center">
        <div className="w-full max-w-md">
          <NewsletterForm />
        </div>
      </div> */}
    </div>
  );
};
