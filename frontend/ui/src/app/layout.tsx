import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { publicApiBaseUrl } from "@/lib/api-public";
import { MultiplexProvider } from "@/lib/multiplex";

import "./globals.css";

export const metadata: Metadata = {
  title: "Palamedes",
  description: "Online chess tournament management",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Single MultiplexProvider for the entire app. App-router layouts
  // persist across page navigations, so the underlying WebSocket
  // stays open while the operator clicks between rounds, jobs, and
  // event detail pages — nested ``MultiplexProvider`` instances in
  // legacy ``*Live`` components reuse this client via the
  // ``useContext`` short-circuit.
  const apiBaseUrl = publicApiBaseUrl();
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-screen antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <MultiplexProvider apiBaseUrl={apiBaseUrl}>{children}</MultiplexProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
