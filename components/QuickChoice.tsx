"use client";
import { useId } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";

export function QuickChoice<T extends string>({ label, value, options, onChange, error, hint }: {
  label: string; value: string | null | undefined;
  options: { value: T; label: string; color?: "success" | "error" | "warning" | "primary" }[];
  onChange: (value: T) => void; error?: boolean; hint?: React.ReactNode;
}) {
  const hintId = useId();
  const selected = options.findIndex(option => option.value === value);
  return <Box role="radiogroup" aria-label={label} aria-describedby={error || hint ? hintId : undefined} aria-invalid={error || undefined} tabIndex={error ? -1 : undefined}
    sx={{ p: 1.5, border: "1px solid", borderColor: error ? "error.main" : "divider", borderRadius: 2 }}>
    <Typography sx={{ fontWeight: 700, mb: 1 }}>{label}</Typography>
    <Stack direction="row" spacing={1}>
      {options.map((option, index) => <Button key={option.value} role="radio" aria-checked={value === option.value} tabIndex={index === (selected < 0 ? 0 : selected) ? 0 : -1}
        variant={value === option.value ? "contained" : "outlined"} color={option.color || "primary"}
        onKeyDown={event => {
          if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 :
            (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + options.length) % options.length;
          onChange(options[next].value);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
        }}
        onClick={() => onChange(option.value)} sx={{ flex: 1, minWidth: 0, minHeight: 48, px: 0.75, lineHeight: 1.2 }}>
        {option.label}
      </Button>)}
    </Stack>
    {(error || hint) && <Box id={hintId}>{error && <Typography variant="caption" color="error">Ce point reste à renseigner.</Typography>}
      {hint && <Box sx={{ mt: 1 }}>{hint}</Box>}
    </Box>}
  </Box>;
}
