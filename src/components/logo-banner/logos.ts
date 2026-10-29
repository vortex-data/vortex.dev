import type { StaticImageData } from "next/image";
import clickhouse from "@/assets/logos/clickhouse.svg";
import dash0 from "@/assets/logos/dash0.svg";
import datafusion from "@/assets/logos/datafusion.svg";
import duckdb from "@/assets/logos/duckdb.svg";
import firebolt from "@/assets/logos/firebolt.svg";
import hudi from "@/assets/logos/hudi.png";
import langchain from "@/assets/logos/langchain.svg";
import microsoft from "@/assets/logos/microsoft.png";
import milvus from "@/assets/logos/milvus.svg";
import paimon from "@/assets/logos/paimon.png";
import palantir from "@/assets/logos/palantir.svg";
import spark from "@/assets/logos/spark.svg";
import spiral from "@/assets/logos/spiral.svg";

export type Logo = {
  name: string;
  image: StaticImageData;
  width: number;
  height: number;
  /** The owner's page about its Vortex use, else its homepage. */
  href: string;
};

// The adopters cleared for public use, in the Home card's order. Each size is
// the card's, from the system's tools/logo-fit.mjs (--area 3360 --max 170x40),
// so every mark carries the same ink. Each file is its owner's own, from the
// source recorded in the system's assets/Adopters/README.md. Add a mark only once its owner has
// cleared it, and run logo-fit again when one changes or joins. Spiral, who
// donated Vortex, sits third, so it is in view when the page loads. Each
// links to the owner's own page that mentions Vortex where there is one
// (docs, a post or a list of users), else to the owner's homepage. Dash0
// links to the Vortex post by Polar Signals, which it acquired.
export const LOGOS: readonly Logo[] = [
  {
    name: "Microsoft",
    image: microsoft,
    width: 122,
    height: 30,
    href: "https://www.microsoft.com"
  },
  {
    name: "Palantir",
    image: palantir,
    width: 119,
    height: 29,
    href: "https://www.palantir.com"
  },
  {
    name: "Spiral",
    image: spiral,
    width: 114,
    height: 31,
    href: "https://spiraldb.com"
  },
  {
    name: "Firebolt",
    image: firebolt,
    width: 137,
    height: 22,
    href: "https://www.firebolt.io"
  },
  {
    name: "LangChain",
    image: langchain,
    width: 136,
    height: 25,
    href: "https://www.langchain.com/blog/introducing-smithdb"
  },
  {
    name: "Dash0",
    image: dash0,
    width: 123,
    height: 23,
    href: "https://www.polarsignals.com/blog/posts/2025/11/25/interface-parquet-vortex"
  },
  {
    name: "Milvus",
    image: milvus,
    width: 131,
    height: 30,
    href: "https://milvus.io/docs/storage-v3.md"
  },
  {
    name: "DuckDB",
    image: duckdb,
    width: 107,
    height: 31,
    href: "https://duckdb.org/docs/current/core_extensions/vortex"
  },
  {
    name: "Apache DataFusion",
    image: datafusion,
    width: 133,
    height: 28,
    href: "https://datafusion.apache.org/user-guide/introduction.html"
  },
  {
    name: "Apache Spark",
    image: spark,
    width: 78,
    height: 41,
    href: "https://spark.apache.org"
  },
  {
    name: "ClickHouse",
    image: clickhouse,
    width: 156,
    height: 48,
    href: "https://clickhouse.com/docs/reference/formats/Vortex"
  },
  {
    name: "Apache Hudi",
    image: hudi,
    width: 105,
    height: 33,
    href: "https://hudi.apache.org"
  },
  {
    name: "Apache Paimon",
    image: paimon,
    width: 137,
    height: 35,
    href: "https://paimon.apache.org/docs/master/concepts/spec/fileformat/"
  }
];
