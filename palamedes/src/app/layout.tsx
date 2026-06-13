import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { UiStoreProvider } from "@/stores/ui-store";
import { TRPCReactProvider } from "@/trpc/react";

export const metadata: Metadata = {
  title: "Palamedes",
  description: "Next.js + tRPC + Prisma + Better Auth scaffold",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // No next/font: the v2 design (frontend/ui) uses the default system font
  // stacks for sans and mono.
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <TRPCReactProvider>
          <UiStoreProvider>{children}</UiStoreProvider>
        </TRPCReactProvider>
        <Toaster />
      </body>
    </html>
  );
}
