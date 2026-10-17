"use client";
import { Box, Button, Stack, Typography } from "@mui/material";

export function QuickChoice<T extends string>({ label, value, options, onChange, error, hint }: {
  label: string; value: string | null | undefined;
  options: { value: T; label: string; color?: "success" | "error" | "warning" | "primary" }[];
  onChange: (value: T) => void; error?: boolean; hint?: React.ReactNode;
}) {
  return <Box role="radiogroup" aria-label={label} aria-invalid={error || undefined} tabIndex={error ? -1 : undefined}
    sx={{ p: 1.5, border: "1px solid", borderColor: error ? "error.main" : "divider", borderRadius: 2 }}>
    <Typography sx={{ fontWeight: 700, mb: 1 }}>{label}</Typography>
    <Stack direction="row" spacing={1}>
      {options.map(option => <Button key={option.value} role="radio" aria-checked={value === option.value}
        variant={value === option.value ? "contained" : "outlined"} color={option.color || "primary"}
        onClick={() => onChange(option.value)} sx={{ flex: 1, minWidth: 0, minHeight: 48, px: 0.75, lineHeight: 1.2 }}>
        {option.label}
      </Button>)}
    </Stack>
    {error && <Typography variant="caption" color="error">Ce point reste à renseigner.</Typography>}
    {hint && <Box sx={{ mt: 1 }}>{hint}</Box>}
  </Box>;
}
