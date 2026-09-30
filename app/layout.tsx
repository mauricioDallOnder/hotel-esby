import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeRegistry } from "@/theme/ThemeRegistry";
import { AppProvider } from "@/context/AppContext";
import { VersionNotice } from "@/components/VersionNotice";
import "./globals.css";

// Revalidate the document on every opening, preserving immutable hashed assets.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hôtel Contrôle · Rondes et maintenance",
  description: "Inspections quotidiennes, anomalies et suivi des interventions de l’hôtel.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr-FR">
      <body>
        <AppRouterCacheProvider>
          <ThemeRegistry>
            <CssBaseline />
            <VersionNotice />
            <AppProvider>
              {children}
            </AppProvider>
          </ThemeRegistry>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
