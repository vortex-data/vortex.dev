import LFLogo from "@/assets/lf_white.svg";
import SpiralLogo from "@/assets/spiral.svg";
import Image from "next/image";
import { Link } from "../link";

export const Footer = () => {
  return (
    <div className="flex flex-col mx-4 mt-2 md:mt-4 md:mx-10">
      <div className="flex justify-center items-center gap-16 dashed-top dashed-bottom after:hidden md:after:block md:h-[84px]">
        <div className="flex items-center h-full lg:px-10">
          <div className="flex flex-col md:flex-row items-center gap-2 py-4 md:py-0">
            <span className="text-white font-mono text-sm flex items-center gap-1">
              Copyright © Vortex a Series of{" "}
              <Link href="https://lfprojects.org" target="_blank">
                LF Projects, LLC.
              </Link>
            </span>
          </div>
        </div>
        <div className="flex items-center h-full lg:px-10 py-4 pb-4 md:py-0">
          <span className="text-sm font-mono text-white flex items-center gap-2">
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
      <div className="text-center py-8">
        <span className="text-xs font-mono text-gray-500 flex items-center justify-center gap-2">
          <Image src={SpiralLogo} alt="Spiral Logo" width={15} height={15} />
          Donated by{" "}
          <Link href="https://spiraldb.com" target="_blank">
            Spiral.
          </Link>
        </span>
      </div>
    </div>
  );
};
