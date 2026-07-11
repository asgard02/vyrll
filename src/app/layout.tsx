import type { Metadata } from "next";
import { Space_Grotesk, DM_Sans, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";
import { ProfileProvider } from "@/lib/profile-context";
import { localeToOg } from "@/i18n/config";

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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "metadata" });
  const metaTitle = t("title");
  const metaDescription = t("description");

  return {
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
      locale: localeToOg(locale as "fr" | "en"),
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: metaTitle,
      description: metaDescription,
      images: [`${siteUrl}/og-upcut-v2.png`],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body
        className={`${spaceGrotesk.variable} ${dmSans.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <NextIntlClientProvider messages={messages}>
          <ProfileProvider>{children}</ProfileProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
