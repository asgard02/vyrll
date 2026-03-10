import type { Metadata } from "next";
import { Syne, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://flopcheck.com";

export const metadata: Metadata = {
  title: "flopcheck — YouTube Video Analyzer",
  description: "Pourquoi ta vidéo a floppé ? Diagnostic IA brutal pour tes vidéos YouTube.",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "flopcheck — YouTube Video Analyzer",
    description: "Pourquoi ta vidéo a floppé ? Diagnostic IA brutal pour tes vidéos YouTube.",
    url: siteUrl,
    siteName: "flopcheck",
    images: [
      {
        url: `${siteUrl}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "flopcheck — YouTube Video Analyzer",
      },
    ],
    locale: "fr_FR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "flopcheck — YouTube Video Analyzer",
    description: "Pourquoi ta vidéo a floppé ? Diagnostic IA brutal pour tes vidéos YouTube.",
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
        className={`${syne.variable} ${dmSans.variable} ${jetbrainsMono.variable} antialiased bg-[#080809] text-zinc-300`}
      >
        {children}
      </body>
    </html>
  );
}
