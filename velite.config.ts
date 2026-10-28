import rehypePrettyCode from "rehype-pretty-code";
import { defineCollection, defineConfig, s } from "velite";
import {
  rehypeAsides,
  rehypeHeadingLevels,
  rehypeTables
} from "./src/lib/rehype-blog";
import { syntaxTheme } from "./src/lib/syntax-theme";

const blog = defineCollection({
  name: "Blog",
  pattern: "blog/**/*.mdx",
  schema: s
    .object({
      slug: s.path(),
      title: s.string().max(99),
      date: s.isodate(),
      authors: s.array(s.string()),
      excerpt: s.string().optional(),
      published: s.boolean().default(true),
      metadata: s.metadata(),
      body: s.mdx({
        rehypePlugins: [
          [
            rehypePrettyCode,
            {
              // Colours from the design system's syntax-* tokens, so code
              // follows the blog's Light and Dark themes.
              theme: syntaxTheme,
              keepBackground: false,
              // A fence with no language is still a CodeBlock.
              defaultLang: { block: "plaintext" }
            }
          ],
          rehypeHeadingLevels,
          rehypeAsides,
          rehypeTables
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
