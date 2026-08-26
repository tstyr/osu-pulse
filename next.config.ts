import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "a.ppy.sh", pathname: "/**" },
      { protocol: "https", hostname: "assets.ppy.sh", pathname: "/**" },
    ],
  },
};

export default withWorkflow(nextConfig);
