import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Résultat d'analyse — Vyrll",
  description:
    "Résultat du diagnostic YouTube : score, conseils SEO, titre, description, tags et quick wins.",
};

export default function AnalyseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
