import { CircularProgress, Stack, Typography } from "@mui/material";

export default function Loading() {
  return <Stack role="status" spacing={2} sx={{ py: 8, alignItems: "center" }}>
    <CircularProgress size={28} aria-hidden />
    <Typography color="text.secondary">Chargement de la page…</Typography>
  </Stack>;
}
