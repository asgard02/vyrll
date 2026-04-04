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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://vyrll.com";

const metaTitle = "Vyrll — Clips viraux depuis YouTube & Twitch";
const metaDescription =
  "Génère des clips verticaux 9:16 et 1:1 avec sous-titres IA à partir d'une URL YouTube ou Twitch.";

export const metadata: Metadata = {
  title: metaTitle,
  description: metaDescription,
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: metaTitle,
    description: metaDescription,
    url: siteUrl,
    siteName: "Vyrll",
    images: [
      {
        url: `${siteUrl}/og-image.png`,
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
    images: [`${siteUrl}/og-image.png`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="dark">
      <body
        className={`${spaceGrotesk.variable} ${dmSans.variable} ${jetbrainsMono.variable} antialiased bg-[#080809] text-zinc-300`}
      >
        <ProfileProvider>{children}</ProfileProvider>
      </body>
    </html>
  );
}
