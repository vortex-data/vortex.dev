import rehypePrettyCode from "rehype-pretty-code";
import { defineCollection, defineConfig, s } from "velite";

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
      body: s.mdx({
        rehypePlugins: [
          [
            rehypePrettyCode,
            {
              theme: "night-owl",
              keepBackground: false
            }
          ]
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
