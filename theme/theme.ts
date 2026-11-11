"use client";

import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "class" },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: "#245b4f" },
        secondary: { main: "#d9822b" },
        info: { main: "#2563a6" },
        success: { main: "#28734a" },
        warning: { main: "#9a590d" },
        error: { main: "#b33430" },
        text: { primary: "#172b28", secondary: "#52655f" },
        divider: "#dbe3df",
        background: { default: "#f5f5f0", paper: "#ffffff" },
      },
    },
    dark: {
      palette: {
        primary: { main: "#90d3bb", contrastText: "#10271f" },
        secondary: { main: "#f1b66f", contrastText: "#2b1b09" },
        info: { main: "#8ec8ff" },
        success: { main: "#8bd4a1" },
        warning: { main: "#f2c078" },
        error: { main: "#ffaaa3" },
        text: { primary: "#e6eeea", secondary: "#b4c4bd" },
        divider: "#3b5046",
        background: { default: "#101917", paper: "#192522" },
      },
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
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: "none" } },
    },
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
