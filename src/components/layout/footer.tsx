import SpiralLogo from "@/assets/spiral.svg";
import Image from "next/image";
import Link from "next/link";

export const Footer = () => {
  return (
    <div className="flex flex-col-reverse md:flex-row justify-between items-center m-4 dashed-top dashed-bottom after:hidden md:after:block md:h-[84px]">
      <div className="flex items-center gap-4 dashed-right after:hidden lg:after:block h-full pl-2 lg:px-10 py-8 pb-4 md:py-0">
        <span className="text-sm font-mono text-white">
          © {new Date().getFullYear()} All rights reserved.
        </span>
      </div>
      <div className="dashed-top md:hidden w-full"></div>
      <div className="dashed-right h-full lg:hidden"></div>
      <div className="flex items-center gap-8 dashed-left before:hidden lg:before:block h-full lg:px-10">
        <div className="flex flex-col md:flex-row items-center gap-2 py-8 md:py-0">
          <span className="text-white font-mono text-sm flex gap-4">
            <Link href="/" className="uppercase text-white font-mono text-sm">
              <Image
                src={SpiralLogo}
                alt="Spiral Logo"
                width={15}
                height={18}
              />
            </Link>
            <span>
              Made by <Link href="https://spiraldb.com">Spiral</Link>.
            </span>
          </span>
          <span className="text-white font-mono text-sm text-center md:text-left">
            In collaboration with Creators United
          </span>
        </div>
      </div>
    </div>
  );
};
