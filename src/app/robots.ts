import type { MetadataRoute } from "next";
import { baseUrl } from "@/lib/constants";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api"
    },
    sitemap: `${baseUrl}/sitemap.xml`
  };
}
