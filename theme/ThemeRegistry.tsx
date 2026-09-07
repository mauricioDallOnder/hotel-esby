"use client";

import { ThemeProvider } from "@mui/material/styles";
import { theme } from "./theme";

type ThemeRegistryProps = {
  children: React.ReactNode;
};

export function ThemeRegistry({ children }: ThemeRegistryProps) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
