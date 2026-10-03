import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

function localWebProxyOrigin() {
  if (process.env.VERCEL !== "1") return null;
  const candidate = process.env.LOCAL_WEB_ORIGIN?.trim().replace(/\/$/, "");
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".trycloudflare.com")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["discord.js"],
  async rewrites() {
    const origin = localWebProxyOrigin();
    if (!origin) return [];
    return {
      beforeFiles: [{ source: "/:path*", destination: `${origin}/:path*` }],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }] }];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "a.ppy.sh", pathname: "/**" },
      { protocol: "https", hostname: "assets.ppy.sh", pathname: "/**" },
      { protocol: "https", hostname: "osu.ppy.sh", pathname: "/images/**" },
    ],
  },
};

export default withWorkflow(nextConfig);
