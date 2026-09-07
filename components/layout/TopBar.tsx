"use client";

import Link from "next/link";

import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";

import MenuIcon from "@mui/icons-material/Menu";
import ChecklistRounded from "@mui/icons-material/ChecklistRounded";

type TopbarProps = {
  drawerWidth: number;
  onMenuClick: () => void;
};

export function Topbar({
  drawerWidth,
  onMenuClick,
}: TopbarProps) {
  return (
    <AppBar
      position="fixed"
      elevation={0}
      sx={{
        width: {
          xs: "100%",
          md: `calc(100% - ${drawerWidth}px)`,
        },

        ml: {
          xs: 0,
          md: `${drawerWidth}px`,
        },

        bgcolor: "primary.main",
        color: "primary.contrastText",

        borderBottom: "1px solid",
        borderColor:
          "rgba(255,255,255,0.12)",

        zIndex: (theme) =>
          theme.zIndex.drawer + 1,
      }}
    >
      <Toolbar
        sx={{
          minHeight: {
            xs: 64,
            md: 72,
          },

          px: {
            xs: 2,
            sm: 3,
          },

          display: "flex",
          alignItems: "center",
          justifyContent:
            "space-between",
          gap: 2,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            minWidth: 0,
          }}
        >
          <IconButton
            color="inherit"
            edge="start"
            onClick={onMenuClick}
            aria-label="Ouvrir le menu"
            sx={{
              display: {
                xs: "inline-flex",
                md: "none",
              },

              flexShrink: 0,
            }}
          >
            <MenuIcon />
          </IconButton>

          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 800,
                lineHeight: 1.15,

                fontSize: {
                  xs: "1rem",
                  sm: "1.25rem",
                },

                whiteSpace: {
                  xs: "normal",
                  sm: "nowrap",
                },
              }}
            >
              Chaque détail compte.
            </Typography>
          </Box>
        </Box>

        <Button
          component={Link}
          href="/checklist"
          variant="outlined"
          color="inherit"
          size="small"
          startIcon={
            <ChecklistRounded />
          }
          sx={{
            borderColor:
              "rgba(255,255,255,0.8)",

            color: "inherit",
            borderRadius: 999,
            flexShrink: 0,

            display: {
              xs: "none",
              sm: "inline-flex",
            },

            "&:hover": {
              borderColor: "#fff",
              bgcolor:
                "rgba(255,255,255,0.08)",
            },
          }}
        >
          Checklist du jour
        </Button>
      </Toolbar>
    </AppBar>
  );
}