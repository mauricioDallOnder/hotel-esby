import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "Hôtel Contrôle", short_name: "Hôtel", lang: "fr-FR",
    description: "Chambres, maintenance et lingerie de l’hôtel.",
    start_url: "/lingerie", scope: "/", display: "standalone",
    background_color: "#f5f5f0", theme_color: "#245b4f",
    icons: [{ src: "/laundry-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
