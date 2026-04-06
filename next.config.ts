import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Aligné avec l’upload clips (multer 500 Mo) — sinon le proxy tronque à 10 Mo → multipart cassée (« Unexpected end of form »)
  experimental: {
    proxyClientMaxBodySize: 500 * 1024 * 1024,
  },
  // Fix Turbopack "Next.js package not found" when multiple lockfiles exist (e.g. backend-clips/)
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.youtube.com",
        pathname: "/vi/**",
      },
    ],
  },
};

export default nextConfig;
