import type { Metadata } from "next";
import { Space_Grotesk, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ProfileProvider } from "@/lib/profile-context";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-syne",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://upcut.app";

const metaTitle = "Upcut — Clips viraux depuis YouTube & Twitch";
const metaDescription =
  "Génère des clips verticaux 9:16 et 1:1 avec sous-titres IA à partir d'une URL YouTube ou Twitch.";

export const metadata: Metadata = {
  title: metaTitle,
  description: metaDescription,
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
    other: [
      { rel: "icon", url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
  },
  openGraph: {
    title: metaTitle,
    description: metaDescription,
    url: siteUrl,
    siteName: "Upcut",
    images: [
      {
        // Nom versionné : les scrapers (X, WhatsApp…) cachent l'image par URL —
        // changer le nom force la récupération de la nouvelle image au re-scrape.
        url: `${siteUrl}/og-upcut-v2.png`,
        width: 1200,
        height: 630,
        alt: metaTitle,
      },
    ],
    locale: "fr_FR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: metaTitle,
    description: metaDescription,
    images: [`${siteUrl}/og-upcut-v2.png`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body
        className={`${spaceGrotesk.variable} ${dmSans.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <ProfileProvider>{children}</ProfileProvider>
      </body>
    </html>
  );
}
