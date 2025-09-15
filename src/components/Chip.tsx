import React from "react";

export type ChipTone =
  | "ok" | "warn" | "bad"
  | "muted" | "info" | "warning" | "success" | "danger";

type Props = {
  label: string;
  value: React.ReactNode;
  tone: ChipTone;
  prefix?: React.ReactNode;
  className?: string;
};

function normalizeTone(t: ChipTone): "muted" | "info" | "warning" | "success" | "danger" {
  if (t === "ok") return "success";
  if (t === "warn") return "warning";
  if (t === "bad") return "danger";
  return t;
}

const toneClasses: Record<ReturnType<typeof normalizeTone>, string> = {
  muted:   "bg-slate-100 text-slate-700 border-slate-200",
  info:    "bg-blue-50 text-blue-700 border-blue-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  danger:  "bg-rose-50 text-rose-700 border-rose-200",
};

function Chip({ label, value, tone, prefix = "", className = "" }: Props) {
  const toneCls = toneClasses[normalizeTone(tone)];
  return (
    <div className={`rounded border px-2 py-1.5 ${toneCls} ${className}`}>
      <div className="text-[11px]">{label}</div>
      <div className="font-semibold tabular-nums truncate">{prefix}{value}</div>
    </div>
  );
}

export default Chip;   // <-- ensure this line exists
