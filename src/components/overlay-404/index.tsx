import { Link } from "../link";

export const Overlay404 = () => {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center">
      <div className="w-full h-full relative">
        <div className="absolute top-4 md:top-12 left-1/2 -translate-x-1/2 md:left-auto md:right-12 md:translate-x-0 text-white bg-background w-[174px] lg:w-[204px] text-right font-mono text-xs md:text-sm lg:pl-4 py-1 px-3 md:py-2">
          <Link href="/" className="z-10">
            Go back home
          </Link>
        </div>
      </div>
    </div>
  );
};
