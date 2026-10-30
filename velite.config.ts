import rehypePrettyCode from "rehype-pretty-code";
import { defineCollection, defineConfig, s } from "velite";
import {
  rehypeAsides,
  rehypeHeadingIds,
  rehypeHeadingLevels,
  rehypeRefs,
  rehypeTables
} from "./src/lib/rehype-blog";
import { shikiTheme } from "./src/vendor/vortex-design/code-block.js";

const blog = defineCollection({
  name: "Blog",
  pattern: "blog/**/*.mdx",
  schema: s
    .object({
      slug: s.path(),
      title: s.string().max(99),
      date: s.isodate(),
      authors: s.array(s.string()),
      // The dek under the title and the index's one-line summary.
      excerpt: s.string().optional(),
      published: s.boolean().default(true),
      metadata: s.metadata(),
      body: s.mdx({
        rehypePlugins: [
          [
            rehypePrettyCode,
            {
              // The design system's Shiki theme: colours from its syntax-*
              // tokens, so code follows the blog's Light and Dark themes.
              theme: shikiTheme,
              keepBackground: false,
              // A fence with no language is still a CodeBlock.
              defaultLang: { block: "plaintext" }
            }
          ],
          rehypeHeadingLevels,
          rehypeHeadingIds,
          rehypeAsides,
          rehypeTables,
          rehypeRefs
        ]
      })
    })
    .transform((data) => ({
      ...data,
      slugAsParams: data.slug.split("/").slice(1).join("/")
    }))
});

export default defineConfig({
  root: "./src/content",
  output: {
    data: ".velite",
    assets: "public/static",
    base: "/static/",
    name: "[name]-[hash:6].[ext]",
    clean: true
  },
  collections: { blog }
});
