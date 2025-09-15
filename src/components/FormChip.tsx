// src/components/FormChip.tsx
import React from "react";
import Chip from "./Chip";
import { f1 } from "../lib/format";

// Your requested mapping:
// >20 yellow (warning) | 5..20 blue (info) | -10..5 grey (muted) | -30..-10 green (success) | < -30 red (danger)
function formTone(tsb?: number | null): "muted" | "info" | "warning" | "success" | "danger" {
  if (tsb == null || Number.isNaN(tsb)) return "muted";
  if (tsb > 20) return "warning";
  if (tsb >= 5) return "info";
  if (tsb >= -10) return "muted";
  if (tsb >= -30) return "success";
  return "danger";
}

export default function FormChip({ value }: { value?: number | null }) {
  const display = value == null || Number.isNaN(value) ? "–" : f1(value);
  return <Chip label="Form" value={display} tone={formTone(value)} />;
}
