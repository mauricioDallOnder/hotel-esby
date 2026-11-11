"use client";

import { MenuItem, TextField } from "@mui/material";
import type { ReactNode } from "react";

type Option = { id: string; label: string };

export function ProblemTypeSelect({ value, onChange, options, label = "Problème constaté", helperText, error, disabled, emptyLabel }: {
  value: string;
  onChange: (value: string) => void;
  options: readonly Option[];
  label?: string;
  helperText?: ReactNode;
  error?: boolean;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  return <TextField select fullWidth label={label} value={value} onChange={event => onChange(event.target.value)}
    helperText={helperText} error={error} disabled={disabled}
    sx={{ "& .MuiSelect-select": { whiteSpace: "normal", overflowWrap: "anywhere" } }}>
    {emptyLabel && <MenuItem value="" sx={{ whiteSpace: "normal" }}>{emptyLabel}</MenuItem>}
    {options.map(option => <MenuItem key={option.id} value={option.id}
      sx={{ whiteSpace: "normal", overflowWrap: "anywhere", maxWidth: "calc(100vw - 32px)" }}>{option.label}</MenuItem>)}
  </TextField>;
}
