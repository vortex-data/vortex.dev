export const Overlay = () => {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center">
      <div className="w-full h-full relative">
        <div className="absolute top-4 md:top-3 left-1/2 -translate-x-1/2 md:left-auto md:right-14 md:translate-x-0 text-white bg-background w-[274px] lg:w-[264px] text-right font-mono text-xs md:text-sm lg:pl-4 py-1 px-3 md:py-2">
          Vortex is a highly performant, extensible columnar data format
        </div>

        <div className="absolute bottom-5 md:bottom-3 left-1/2 -translate-x-1/2 md:left-14 md:translate-x-0 text-white bg-background w-[274px] lg:w-[324px] text-left font-mono text-xs md:text-sm lg:px-4 py-1 px-3 md:py-2">
          200x faster random access
          <br />
          2-10x faster scans
          <br />
          5x faster writes
          <br />
          Similar compression ratio
          <br />
          (vs. Apache Parquet)
        </div>
      </div>
    </div>
  );
};
