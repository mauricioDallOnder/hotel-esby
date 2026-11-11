"use client";

import DarkModeOutlined from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlined from "@mui/icons-material/LightModeOutlined";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useColorScheme } from "@mui/material/styles";

export function ThemeModeToggle() {
  const { mode, systemMode, setMode } = useColorScheme();
  const dark = (mode === "system" ? systemMode : mode) === "dark";
  const label = dark ? "Activer le mode clair" : "Activer le mode sombre";

  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          color="inherit"
          aria-label={label}
          disabled={!mode}
          onClick={() => setMode(dark ? "light" : "dark")}
        >
          {dark ? <LightModeOutlined /> : <DarkModeOutlined />}
        </IconButton>
      </span>
    </Tooltip>
  );
}
