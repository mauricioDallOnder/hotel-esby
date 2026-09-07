"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";

const menuItems = [
  {
    label: "Vue d’ensemble",
    path: "/",
  },
  {
    label: "Checklist du jour",
    path: "/checklist",
  },
  {
    label: "Ronde quotidienne",
    path: "/rondes",
  },
  {
    label: "Anomalies & suivi",
    path: "/anomalies",
  },
  {
    label: "Rapports & bilan mensuel",
    path: "/relatorios",
  },
];

type SidebarProps = {
  drawerWidth: number;
  mobileOpen: boolean;
  onMobileClose: () => void;
};

export function Sidebar({
  drawerWidth,
  mobileOpen,
  onMobileClose,
}: SidebarProps) {
  const pathname = usePathname();

  const drawerContent = (
    <Box
      sx={{
        height: "100%",
        bgcolor: "background.paper",
      }}
    >
      <Toolbar
        sx={{
          minHeight: 72,
          px: 3,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Box>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 800,
              color: "primary.main",
              lineHeight: 1.1,
            }}
          >
            Hôtel Contrôle
          </Typography>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "block",
              mt: 0.5,
            }}
          >
            Rondes & maintenance
          </Typography>
        </Box>
      </Toolbar>

      <Box sx={{ px: 2, py: 3 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            display: "block",
            px: 1.5,
            mb: 1.5,
            textTransform: "uppercase",
            fontWeight: 700,
            letterSpacing: "0.08em",
          }}
        >
          Votre espace
        </Typography>

        <List disablePadding>
          {menuItems.map((item) => {
            const selected =
              pathname === item.path ||
              (
                item.path !== "/" &&
                pathname.startsWith(
                  item.path
                )
              );

            return (
              <ListItemButton
                key={item.path}
                component={Link}
                href={item.path}
                selected={selected}
                onClick={onMobileClose}
                sx={{
                  borderRadius: 999,
                  mb: 0.75,
                  px: 2,
                  py: 1.25,

                  color: selected
                    ? "primary.main"
                    : "text.primary",

                  "&.Mui-selected": {
                    bgcolor:
                      "rgba(31,111,74,0.10)",
                  },

                  "&.Mui-selected:hover": {
                    bgcolor:
                      "rgba(31,111,74,0.14)",
                  },
                }}
              >
                <ListItemText
                  primary={item.label}
                  slotProps={{
                    primary: {
                      sx: {
                        fontWeight:
                          selected
                            ? 700
                            : 500,
                      },
                    },
                  }}
                />
              </ListItemButton>
            );
          })}
        </List>
      </Box>
    </Box>
  );

  return (
    <>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{
          keepMounted: true,
        }}
        sx={{
          display: {
            xs: "block",
            md: "none",
          },

          "& .MuiDrawer-paper": {
            width: drawerWidth,
            boxSizing: "border-box",
          },
        }}
      >
        {drawerContent}
      </Drawer>

      <Drawer
        variant="permanent"
        open
        sx={{
          display: {
            xs: "none",
            md: "block",
          },

          width: drawerWidth,
          flexShrink: 0,

          "& .MuiDrawer-paper": {
            width: drawerWidth,
            boxSizing: "border-box",
            borderRight: "1px solid",
            borderColor: "divider",
          },
        }}
      >
        {drawerContent}
      </Drawer>
    </>
  );
}