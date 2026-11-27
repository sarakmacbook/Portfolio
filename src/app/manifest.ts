import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Portfolio",
    short_name: "Portfolio",
    description: "Track cash, stocks and crypto holdings.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    lang: "en",
    dir: "ltr",
    background_color: "#f8fafc",
    theme_color: "#4f46e5",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icon-144.png", sizes: "144x144", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      {
        name: "Dashboard",
        short_name: "Home",
        description: "Open the portfolio dashboard",
        url: "/",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Refresh prices",
        short_name: "Prices",
        description: "Fetch live market prices",
        url: "/prices",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Alerts",
        short_name: "Alerts",
        description: "Price alerts and scheduled recaps",
        url: "/alerts",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
