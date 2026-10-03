import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "osu! Pulse Control",
    short_name: "osu! Pulse",
    description: "osu! analytics, replay rendering, music, and Discord bot control.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f5f7f9",
    theme_color: "#f48120",
    orientation: "any",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
  };
}
