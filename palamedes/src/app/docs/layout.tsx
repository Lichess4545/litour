import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Docs — Palamedes",
};

export default function DocsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
