import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo-metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/clips/",
          "/projets",
          "/parametres",
          "/checkout/",
          "/upgrade",
          "/verify-email",
          "/login",
          "/register",
          "/forgot-password",
          "/reset-password",
          "/api/",
          "/auth/",
          "/s/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
