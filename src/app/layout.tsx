import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";
import { ProfileProvider } from "@/lib/profile-context";
import { SupportChatHost } from "@/components/support/SupportChat";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { THEME_INIT_SCRIPT } from "@/components/theme/theme-script";
import { localeToOg } from "@/i18n/config";
import { SITE_URL } from "@/lib/seo-metadata";

const inter = localFont({
  src: [
    { path: "../fonts/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: [
    { path: "../fonts/jetbrains-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/jetbrains-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "metadata" });
  const metaTitle = t("title");
  const metaDescription = t("description");

  return {
    metadataBase: new URL(SITE_URL),
    title: metaTitle,
    description: metaDescription,
    alternates: {
      canonical: "/",
    },
    icons: {
      // Nouveau chemin : les navigateurs gardent l’ancien fichier servi à la même URL.
      icon: [
        { url: "/icons/trimoai-ta-32.png", sizes: "32x32", type: "image/png" },
      ],
      shortcut: "/icons/trimoai-ta-32.png",
      apple: [
        { url: "/icons/trimoai-ta-180.png", sizes: "180x180", type: "image/png" },
      ],
    },
    openGraph: {
      title: metaTitle,
      description: metaDescription,
      url: "/",
      siteName: "TrimoAI",
      images: [
        {
          // Nom versionné : les scrapers (X, WhatsApp…) cachent l'image par URL —
          // changer le nom force la récupération de la nouvelle image au re-scrape.
          url: "/og-trimoai.png",
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
      images: ["/og-trimoai.png"],
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
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <Script id="upcut-theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <ProfileProvider>
              {children}
              <SupportChatHost />
            </ProfileProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
