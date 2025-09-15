// src/lib/tones.ts
export type Tone = "warning" | "info" | "muted" | "success" | "danger";

/**
 * Form (TSB) -> tone mapping
 * > 20         yellow  -> warning (transition)
 * 5..20        blue    -> info    (fresh)
 * -10..5       grey    -> muted   (grey zone)
 * -30..-10     green   -> success (optimal)
 * < -30        red     -> danger  (high risk)
 */
export function formTone(tsb?: number | null): Tone {
  if (tsb == null || Number.isNaN(tsb)) return "muted";
  if (tsb > 20) return "warning";
  if (tsb >= 5) return "info";
  if (tsb >= -10) return "muted";
  if (tsb >= -30) return "success";
  return "danger";
}
