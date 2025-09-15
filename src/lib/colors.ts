// src/lib/colors.ts

// Returns Tailwind classes for a small badge background/text/border
export function formBadge(tsb?: number | null): string {
  const t = typeof tsb === "number" ? tsb : NaN;
  if (Number.isNaN(t)) return "bg-slate-100 text-slate-600 border-slate-200";

  // > 20  => yellow (transition)
  if (t > 20) return "bg-yellow-100 text-yellow-800 border-yellow-200";

  // 5..20 => blue (fresh)
  if (t >= 5 && t <= 20) return "bg-blue-100 text-blue-800 border-blue-200";

  // -10..5 => grey (grey zone)
  if (t >= -10 && t < 5) return "bg-slate-100 text-slate-800 border-slate-200";

  // -30..-10 => green (optimal)
  if (t >= -30 && t < -10) return "bg-green-100 text-green-800 border-green-200";

  // < -30 => red (high risk)
  return "bg-red-100 text-red-800 border-red-200";
}
