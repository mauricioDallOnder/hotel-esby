"use client";

import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: "light",
    primary: {
      main: "#245b4f",
    },
    secondary: {
      main: "#d9822b",
    },
    info: { main: "#2563a6" },
    success: { main: "#28734a" },
    warning: { main: "#9a590d" },
    error: { main: "#b33430" },
    text: { primary: "#172b28", secondary: "#52655f" },
    divider: "#dbe3df",
    background: {
      default: "#f5f5f0",
      paper: "#ffffff",
    },
  },
  typography: {
    fontFamily: "Arial, Helvetica, sans-serif",
    h4: {
      fontWeight: 700,
    },
    h5: {
      fontWeight: 700,
    },
    h6: {
      fontWeight: 700,
    },
    body1: { lineHeight: 1.55 },
    body2: { lineHeight: 1.5 },
  },
  shape: {
    borderRadius: 14,
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid",
          borderColor: "var(--mui-palette-divider)",
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 700,
          minHeight: 44,
          borderRadius: 10,
        },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { minWidth: 44, minHeight: 44 } },
    },
    MuiCheckbox: {
      styleOverrides: { root: { minWidth: 44, minHeight: 44 } },
    },
    MuiChip: {
      styleOverrides: {
        clickable: { minHeight: 44, fontWeight: 600 },
      },
    },
    MuiFormControlLabel: {
      styleOverrides: { root: { minHeight: 44 } },
    },
  },
});
