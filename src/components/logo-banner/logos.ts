import type { StaticImageData } from "next/image";
import clickhouse from "@/assets/logos/clickhouse.svg";
import datafusion from "@/assets/logos/datafusion.svg";
import duckdb from "@/assets/logos/duckdb.svg";
import firebolt from "@/assets/logos/firebolt.svg";
import hudi from "@/assets/logos/hudi.png";
import langchain from "@/assets/logos/langchain.svg";
import microsoft from "@/assets/logos/microsoft.svg";
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
// so every mark carries the same ink. Add a mark only once its owner has
// cleared it, and run logo-fit again when one changes or joins.
export const LOGOS: readonly Logo[] = [
  { name: "Microsoft", image: microsoft, width: 123, height: 51 },
  { name: "Palantir", image: palantir, width: 119, height: 29 },
  { name: "Firebolt", image: firebolt, width: 111, height: 54 },
  { name: "LangChain", image: langchain, width: 137, height: 49 },
  { name: "Polar Signals", image: polarSignals, width: 161, height: 22 },
  { name: "Milvus", image: milvus, width: 123, height: 28 },
  { name: "DuckDB", image: duckdb, width: 108, height: 50 },
  { name: "Apache DataFusion", image: datafusion, width: 80, height: 52 },
  { name: "Apache Spark", image: spark, width: 78, height: 51 },
  { name: "ClickHouse", image: clickhouse, width: 157, height: 48 },
  { name: "Apache Hudi", image: hudi, width: 105, height: 33 },
  { name: "Apache Paimon", image: paimon, width: 106, height: 32 }
];
