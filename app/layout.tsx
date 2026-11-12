import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import { ThemeRegistry } from "@/theme/ThemeRegistry";
import { AppProvider } from "@/context/AppContext";
import "./globals.css";

// Revalidate the document on every opening, preserving immutable hashed assets.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hôtel Contrôle · Chambres et maintenance",
  description: "Chambres, tâches du jour, anomalies et suivi des interventions de l’hôtel.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr-FR" suppressHydrationWarning>
      <body>
        <InitColorSchemeScript attribute="class" defaultMode="system" modeStorageKey="hotel-color-mode" />
        <AppRouterCacheProvider>
          <ThemeRegistry>
            <CssBaseline />
            <AppProvider>
              {children}
            </AppProvider>
          </ThemeRegistry>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
