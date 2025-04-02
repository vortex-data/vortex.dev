export const Overlay = () => {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center">
      <div className="w-full h-full relative">
        <div className="absolute top-12 right-12 text-white bg-black w-[264px] text-right font-mono text-sm pl-4 py-2">
          Vortex is a highly performant, extensible columnar data format
        </div>

        <div className="absolute bottom-1 left-14 text-white bg-black w-[324px] text-left font-mono text-sm px-4 py-2">
          It&apos;s both a file format and a memory format, enabling compute
          over compressed data
        </div>
      </div>
    </div>
  );
};
