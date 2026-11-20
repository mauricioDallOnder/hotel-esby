"use client";

import { Box, Button } from "@mui/material";
import Link from "next/link";
import { usePathname } from "next/navigation";

const views = [
  { href: "/checklist", label: "Checklist" },
  { href: "/occupation", label: "Occupation" },
];

export function RoomNavigation() {
  const pathname = usePathname();
  return (
    <Box component="nav" aria-label="Vues des chambres"
      sx={{ display: "flex", gap: 1, mb: 2, width: { xs: "100%", sm: "fit-content" } }}>
      {views.map(({ href, label }) => (
        <Button key={href} component={Link} href={href}
          aria-current={pathname === href ? "page" : undefined}
          variant={pathname === href ? "contained" : "outlined"}
          sx={{ flex: { xs: 1, sm: "none" }, minHeight: 44 }}>
          {label}
        </Button>
      ))}
    </Box>
  );
}
