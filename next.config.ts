import type { NextConfig } from "next";
import { withPlausibleProxy } from "next-plausible";

const nextConfig: NextConfig = withPlausibleProxy()({
  /* config options here */
});

export default nextConfig;
