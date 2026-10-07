import type { NextConfig } from "next";
import { frameAncestorsEmbed } from "./src/shared/lib/frame-ancestors";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
  // Quem pode embutir o ShopFloor em iframe.
  // Docs do Next (headers): se duas regras casam o mesmo caminho e definem a mesma chave,
  // a ÚLTIMA vence (sobrescreve, não concatena). Por isso a regra geral vem PRIMEIRO e a
  // de /embed por ÚLTIMO: em /embed/* sobra um único Content-Security-Policy.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }],
      },
      {
        source: "/embed/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${frameAncestorsEmbed({
              EMBED_FRAME_ANCESTORS: process.env.EMBED_FRAME_ANCESTORS,
              DASHBOARD_ORIGIN: process.env.DASHBOARD_ORIGIN,
            })}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
