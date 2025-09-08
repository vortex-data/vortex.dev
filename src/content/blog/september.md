---
title: "September Bulletin"
date: "2025-09-08"
authors: ["Community Team"]
excerpt: "Overview of all work happening in Vortex"
published: true
---

Its been a month since Vortex was contributed to the Linux Foundation, and its been amazing to see the response and community interest, we start seeing more and more people taking a deep look at Vortex for their various use-cases, and even some moving real production workloads to it!

This month we accepted 232 commits from 16 different (mostly) human contributors, together we’ve done a few cool things:

1. Added a new Ray Datasource, allowing users to read directories of Vortex files. [#4339](https://github.com/vortex-data/vortex/pull/4339)
2. Improved DuckDB support, we can pass list arrays from/to Vortex [#4169](https://github.com/vortex-data/vortex/pull/4169)
3. Improved Arrow and Apache DataFusion support [#4157](https://github.com/vortex-data/vortex/pull/4157) [#4227](https://github.com/vortex-data/vortex/pull/4227) [#4237](https://github.com/vortex-data/vortex/pull/4237) [#4180](https://github.com/vortex-data/vortex/pull/4180)
4. Improved Spark support, including expanding Java platform support to Ubuntu 20.04+ and Amazon Linux 2023 [#4246](https://github.com/vortex-data/vortex/pull/4246) [#4335](https://github.com/vortex-data/vortex/pull/4335)
5. Added two new benchmarks to our benchmarking suite:
   1. TPC-DS, comparing DuckDB and Apache DataFusion with Vortex, Parquet and DuckDB’s native format [#4155](https://github.com/vortex-data/vortex/pull/4155)
   2. StatPopGen, our own collection of [Statistical Genetics](https://en.wikipedia.org/wiki/Statistical_genetics) queries rendered in SQL over a [VCF-like](https://en.wikipedia.org/wiki/Variant_Call_Format) schema. Our [benchmarks website](https://bench.vortex.dev/?group=Statistical+and+Population+Genetics) presents the results, per commit, of executing these queries, in DuckDB, on 100,000 rows of [gnomAD's 1kg+HGDP dataset](https://gnomad.broadinstitute.org/news/2020-10-gnomad-v3-1-new-content-methods-annotations-and-data-availability/#the-gnomad-hgdp-and-1000-genomes-callset) stored in Parquet, Vortex, and Vortex-Compact (a version of vortex with the [pco](https://github.com/pcodec/pcodec) and zstd encodings). This is the only benchmark in our suite which includes queries on list-typed columns. [#4175](https://github.com/vortex-data/vortex/pull/4175)
6. Added a new scalar type and array - FixedSizeList [#4385](https://github.com/vortex-data/vortex/pull/4385) [#4405](https://github.com/vortex-data/vortex/pull/4405) [#4428](https://github.com/vortex-data/vortex/pull/4428)
7. Started laying down the groundwork for major changes in the IO system and better ways of supporting different async runtimes, more details to come soon!
8. Significantly improved the Rust API, by improving test and documentation coverage, made APIs more consistent and fixed more bugs and other small issues than we can count.

We intend to start yanking some older Vortex version that have known bugs, in order to improve the experience for new users while we improve overall stability and correctness.

We want to thank to anyone who has tried Vortex, provided feedback, asked question and filed issues.

Special thanks go for all the contributors who took the time and care to contribute to Vortex this month (in descending count of commits):

```
    29  Connor Tsui
    28  Joe Isaacs
    27  Robert Kruszewski
    27  Adam Gutglick
    26  Dan King
    20  Will Manning
    18  Andrew Duffy
    13  Nicholas Gates
    13  Alexander Droste
     6  Dmitrii Blaginin
     6  Alfonso Subiotto Marqués
     5  Onur Satici
     2  Xinyu Zeng
     2  Liang-Chi Hsieh
     1  Scott S. McCoy
     1  Marko Bakovic
```
