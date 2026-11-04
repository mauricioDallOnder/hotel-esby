"use client";

import { useState } from "react";

import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Toolbar from "@mui/material/Toolbar";

import { Sidebar } from "./SideBar";
import { Topbar } from "./TopBar";

const drawerWidth = 260;

type AppShellProps = {
  children: React.ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  function handleDrawerToggle() {
    setMobileOpen((current) => !current);
  }

  function handleDrawerClose() {
    setMobileOpen(false);
  }

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        bgcolor: "background.default",
        overflowX: "hidden",
      }}
    >
      <Topbar
        drawerWidth={drawerWidth}
        onMenuClick={handleDrawerToggle}
      />

      <Sidebar
        drawerWidth={drawerWidth}
        mobileOpen={mobileOpen}
        onMobileClose={handleDrawerClose}
      />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          width: {
            xs: "100%",
            md: `calc(100% - ${drawerWidth}px)`,
          },
          overflowX: "hidden",
        }}
      >
        <Toolbar />

        <Container
          maxWidth="xl"
          sx={{
            py: { xs: 2, sm: 3, md: 4 },
            px: { xs: 2, sm: 3 },
            maxWidth: "100%",
            overflowX: "hidden",
          }}
        >
          {children}
        </Container>
      </Box>
    </Box>
  );
}
