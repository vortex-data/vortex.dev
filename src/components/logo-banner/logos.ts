import type { StaticImageData } from "next/image";
import clickhouse from "@/assets/logos/clickhouse.svg";
import datafusion from "@/assets/logos/datafusion.svg";
import duckdb from "@/assets/logos/duckdb.svg";
import firebolt from "@/assets/logos/firebolt.svg";
import hudi from "@/assets/logos/hudi.png";
import langchain from "@/assets/logos/langchain.svg";
import microsoft from "@/assets/logos/microsoft.png";
import milvus from "@/assets/logos/milvus.svg";
import paimon from "@/assets/logos/paimon.png";
import palantir from "@/assets/logos/palantir.svg";
import polarSignals from "@/assets/logos/polar-signals.svg";
import spark from "@/assets/logos/spark.svg";

export type Logo = {
  name: string;
  image: StaticImageData;
  width: number;
  height: number;
};

// The adopters cleared for public use, in the Home card's order. Each size is
// the card's, from the system's tools/logo-fit.mjs (--area 3360 --max 170x40),
// so every mark carries the same ink. Each file is its owner's own, from the
// source recorded in the system's assets/Adopters/README.md. Add a mark only once its owner has
// cleared it, and run logo-fit again when one changes or joins.
export const LOGOS: readonly Logo[] = [
  { name: "Microsoft", image: microsoft, width: 122, height: 30 },
  { name: "Palantir", image: palantir, width: 119, height: 29 },
  { name: "Firebolt", image: firebolt, width: 137, height: 22 },
  { name: "LangChain", image: langchain, width: 136, height: 25 },
  { name: "Polar Signals", image: polarSignals, width: 161, height: 24 },
  { name: "Milvus", image: milvus, width: 131, height: 30 },
  { name: "DuckDB", image: duckdb, width: 107, height: 31 },
  { name: "Apache DataFusion", image: datafusion, width: 133, height: 28 },
  { name: "Apache Spark", image: spark, width: 78, height: 41 },
  { name: "ClickHouse", image: clickhouse, width: 156, height: 48 },
  { name: "Apache Hudi", image: hudi, width: 105, height: 33 },
  { name: "Apache Paimon", image: paimon, width: 137, height: 35 }
];
