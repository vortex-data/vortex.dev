import type { ExternalPost } from "@/lib/posts";

/**
 * Posts on other sites that the blog index lists among its own, newest
 * first. The BlogIndex card's rule: each is the owner's own page (an official
 * blog, or an engineer's or researcher's own blog or newsletter), not a news
 * site, an aggregator, a repost, a landing page or docs, and Vortex is a
 * significant part of it. The title, date, authors and summary are the page's
 * own, as published: the summary is its description. The feeds and the
 * sitemap list the site's own posts only.
 */
export const externalPosts: readonly ExternalPost[] = [
  {
    title: "Faster DuckDB Queries with Vortex",
    url: "https://spiraldb.com/blog/duckdb-and-vortex",
    date: "2026-10-21T12:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Connor Tsui"],
    summary:
      "With the release of DuckDB 2.0, we look at how the Vortex core extension speeds up queries by computing over compressed data, and how to read and write Vortex files from DuckDB."
  },
  {
    title: "What Vortex Has to Prove Before Iceberg Adds a Fourth File Format",
    url: "https://datalakehousehub.com/blog/iceberg-new-file-format-criteria-vortex/",
    date: "2026-10-21T09:00:00.000Z",
    source: "datalakehousehub.com",
    authors: ["Alex Merced"],
    summary:
      "The Vortex proposal split into criteria and candidate. What field IDs, statistics, governance, and ecosystem support a new Iceberg file format must prove."
  },
  {
    title: "Statistics are aggregates",
    url: "https://spiraldb.com/blog/statistics-are-aggregates",
    date: "2026-10-14T12:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Nicholas Gates"],
    summary:
      "Min-max statistics are aggregates computed at write time. Treated that way, they can answer queries, not just skip data."
  },
  {
    title: "Fusing GPU Kernels with Dynamic Dispatch",
    url: "https://spiraldb.com/blog/fusing-gpu-kernels-with-dynamic-dispatch",
    date: "2026-10-07T00:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Alexander Droste"],
    summary:
      "GPU decompression at 2 TB/s with Fused Dynamic Dispatch. How Vortex doubles throughput by fusing CUDA kernels."
  },
  {
    title: "From S3 to GPU in One Copy",
    url: "https://spiraldb.com/blog/from-s3-to-gpu-in-one-copy",
    date: "2026-09-30T12:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Onur Satici"],
    summary:
      "We optimized Vortex so it can stream data from object storage into GPU memory fast enough to saturate a 100 Gbps network link. The first step to get this performance is to make sure each byte is only copied once between the kernel and the GPU."
  },
  {
    title: "Vortex: One Format for Any Shape",
    url: "https://spiraldb.com/blog/vortex-one-format-for-any-shape",
    date: "2026-09-16T12:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Connor Tsui"],
    summary:
      "How Vortex keeps logical types, physical encodings, and storage layouts open to extension so one columnar format can fit any shape of data."
  },
  {
    title: "ParquetReader Now Supports Vortex Files",
    url: "https://parquetreader.com/blog/parquetreader-vortex-support",
    date: "2026-08-31T00:00:00.000Z",
    source: "parquetreader.com",
    authors: [],
    summary:
      "ParquetReader now supports Vortex files. Learn what the Vortex columnar format is and how to open, inspect, and convert Vortex data to CSV, JSON, or Parquet."
  },
  {
    title: "The Storage Layer for the Composable Data Stack",
    url: "https://spiraldb.com/blog/vortex-the-storage-layer-for-the-composable-data-stack",
    date: "2026-08-14T00:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Nicholas Gates"],
    summary:
      "A composable query engine deserves a composable storage layer. Build the format your workload needs without rebuilding the storage stack."
  },
  {
    title: "Compile or Prefilter? Matching LIKE over Compressed Strings",
    url: "https://spiraldb.com/blog/compile-or-prefilter-like-over-strings",
    date: "2026-07-14T12:01:00.000Z",
    source: "spiraldb.com",
    authors: ["Martin Prammer", "Joe Isaacs"],
    summary:
      "Two teams independently built SQL LIKE over FSST-compressed strings: Vortex prefilters candidates, TU Munich compiles the pattern. One experiment across seven x86 generations maps where each wins, where they cross, and why the two hot loops belong in one system."
  },
  {
    title: "Pattern Matching on Compressed Strings without Decompression",
    url: "https://spiraldb.com/blog/pattern-matching-strings-without-decompression",
    date: "2026-07-14T12:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Joe Isaacs", "Martin Prammer"],
    summary:
      "Evaluating SQL LIKE directly on FSST-compressed strings: a symbol-aware automaton and a SIMD prefilter let Vortex match without decompressing the column first."
  },
  {
    title: "My Journey Optimizing a CUDA Kernel with Polar Signals",
    url: "https://www.polarsignals.com/blog/posts/2026/06/24/optimizing-fsst-cuda",
    date: "2026-06-24T00:00:00.000Z",
    source: "polarsignals.com",
    authors: ["Alfonso Subiotto Marqués"],
    summary:
      "A storage engineer's descent into warp stalls, memory throttles, and aligned stores"
  },
  {
    title: "AI Datasets Are Never Done. So We Built Loon.",
    url: "https://zilliz.com/blog/why-we-built-loon-a-storage-engine-for-ai-data-that-never-stops-changing",
    date: "2026-06-05T04:00:00.000Z",
    source: "zilliz.com",
    authors: ["Ted Xu"],
    summary:
      "Loon is a new storage engine for Milvus 3.0 and Zilliz Vector Lakebase, built to manage evolving vector datasets with ColumnGroups, row ID alignment, and Manifests."
  },
  {
    title: "We built SmithDB, the data layer for agent observability",
    url: "https://www.langchain.com/blog/introducing-smithdb",
    date: "2026-05-13T17:39:00.000Z",
    source: "langchain.com",
    authors: ["Ankush Gola"],
    summary:
      "Introducing SmithDB: LangSmith's purpose-built distributed database for agent observability, delivering up to 12x faster performance with full portability."
  },
  {
    title: "Vortex: The Columnar Format for Data Workloads",
    url: "https://spice.ai/blog/vortex-at-spice-ai-the-columnar-format-for-data-intensive-workloads",
    date: "2026-04-07T00:00:00.000Z",
    source: "spice.ai",
    authors: [],
    summary:
      "Learn how Spice AI uses the Vortex columnar format in Cayenne to speed data-intensive workloads, reduce memory use, and scale concurrent ingestion and queries."
  },
  {
    title: "Introducing the Apache Iceberg File Format API",
    url: "https://iceberg.apache.org/blog/apache-iceberg-file-format-api/",
    date: "2026-02-20T00:00:00.000Z",
    source: "iceberg.apache.org",
    authors: ["Apache Iceberg PMC"],
    summary:
      "The Apache Iceberg community is excited to announce the finalization of the File Format API, a major architectural milestone that makes file formats pluggable, consistent, and engine‑agnostic across the Iceberg Java codebase."
  },
  {
    title: "Announcing Vortex Support in DuckDB",
    url: "https://duckdb.org/2026/01/23/duckdb-vortex-extension",
    date: "2026-01-23T00:00:00.000Z",
    source: "duckdb.org",
    authors: ["Guillermo Sanchez"],
    summary:
      "Vortex is a new columnar file format with a very promising design. SpiralDB and DuckLabs have partnered to give you a very fast experience while reading and writing Vortex files!"
  },
  {
    title: "Introducing the Spice Cayenne Data Accelerator",
    url: "https://spice.ai/blog/introducing-spice-cayenne-data-accelerator",
    date: "2025-12-17T00:00:00.000Z",
    source: "spice.ai",
    authors: [],
    summary:
      "Spice Cayenne is the next-generation Spice.ai data accelerator built on the Vortex columnar format for high-scale, low-latency data lake acceleration workloads."
  },
  {
    title: "Great Lakes: A Delta Lake Fork",
    url: "https://www.polarsignals.com/blog/posts/2025/12/04/great-lakes",
    date: "2025-12-04T00:00:00.000Z",
    source: "polarsignals.com",
    authors: ["Thor Hansen"],
    summary: "Our updates to Delta Lake Table Format"
  },
  {
    title: "Questioning an Interface: From Parquet to Vortex",
    url: "https://www.polarsignals.com/blog/posts/2025/11/25/interface-parquet-vortex",
    date: "2025-11-25T00:00:00.000Z",
    source: "polarsignals.com",
    authors: ["Alfonso Subiotto Marqués"],
    summary:
      "Breaking free from the shackles of interface-imposed performance limitations"
  },
  {
    title:
      "Exploring the Evolving File Format Landscape in AI Era: Parquet, Lance, Nimble and Vortex And What It Means for Apache Iceberg",
    url: "https://www.dremio.com/blog/exploring-the-evolving-file-format-landscape-in-ai-era-parquet-lance-nimble-and-vortex-and-what-it-means-for-apache-iceberg/",
    date: "2025-10-20T00:00:00.000Z",
    source: "dremio.com",
    authors: ["Alex Merced"],
    summary:
      "Formats like Lance, Nimble, and Vortex show that innovation is accelerating. Each one introduces new ideas about how to structure, index, and access data. But none of them exist in isolation. They need to integrate with engines, catalogs, and governance layers to be truly useful."
  },
  {
    title:
      "Is Parquet becoming the bottleneck? Why new storage formats are emerging in 2025 (Lance, Vortex, and more)",
    url: "https://www.databend.com/blog/category-engineering/2025-09-15-storage-format/",
    date: "2025-09-15T00:00:00.000Z",
    source: "databend.com",
    authors: ["ZhiHanZ"],
    summary:
      "Parquet gave data lakes a common language: columnar layout, good compression, and fast scans."
  },
  {
    title: "Vortex: a Linux Foundation Project",
    url: "https://spiraldb.com/blog/vortex-a-linux-foundation-project",
    date: "2025-08-06T00:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Nicholas Gates", "Will Manning"],
    summary: "Building the Future of Open Source, Columnar Storage"
  },
  {
    title: "Vortex on Ice",
    url: "https://spiraldb.com/blog/vortex-on-ice",
    date: "2025-04-30T00:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Andrew Duffy"],
    summary: "Using Vortex to accelerate Apache Iceberg queries up to 4x"
  },
  {
    title: "Towards Vortex 1.0",
    url: "https://spiraldb.com/blog/towards-vortex-10",
    date: "2025-04-24T00:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Nicholas Gates"],
    summary: "Preparing to launch Vortex 1.0 and the 2025.05 Edition"
  },
  {
    title: "What if we just didn’t decompress it?",
    url: "https://spiraldb.com/blog/what-if-we-just-didnt-decompress-it",
    date: "2025-03-05T00:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Nicholas Gates"],
    summary: "How push-down compute helps Vortex run faster and decompress less"
  },
  {
    title: "Zone maps, or “queries go brrr”",
    url: "https://spiraldb.com/blog/zone-maps-or-queries-go-brrr",
    date: "2025-02-25T00:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Daniel King"],
    summary: "Waiting sucks. Let's use zone maps to move fast and read less."
  },
  {
    title: "Data Layouts: Where Bytes Find Their Forever Home",
    url: "https://spiraldb.com/blog/data-layouts-where-bytes-find-their-forever-home",
    date: "2025-02-10T00:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Robert Kruszewski"],
    summary:
      "How Vortex tackles data layout challenges across analytics and machine learning workflows."
  },
  {
    title: "Logical vs Physical data types",
    url: "https://spiraldb.com/blog/logical-vs-physical-data-types",
    date: "2025-02-08T00:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Nicholas Gates"],
    summary: "The rationale behind the Vortex logical type system."
  },
  {
    title: "Compressing strings with FSST",
    url: "https://spiraldb.com/blog/compressing-strings-with-fsst",
    date: "2024-11-09T00:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Andrew Duffy"],
    summary: "Random access string compression with FSST and Rust."
  },
  {
    title: "Trick-or-treating with Vortex",
    url: "https://spiraldb.com/blog/trick-or-treating-with-vortex",
    date: "2024-10-31T00:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Andrew Duffy"],
    summary: "On a journey to make your data more fun sized."
  },
  {
    title: "Life in the fastlanes",
    url: "https://spiraldb.com/blog/life-in-the-fastlanes",
    date: "2024-06-19T00:00:00.000Z",
    source: "spiraldb.com",
    authors: ["Nicholas Gates"],
    summary: "Decoding > 100 billion integers per second with scalar Rust."
  }
];
