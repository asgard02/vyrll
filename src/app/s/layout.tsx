import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Dossier partagé",
};

export default function SharedFolderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
