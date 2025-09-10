// src/components/ExportButton.tsx
import React from "react";
import type { WeekPlan } from "../lib/guardrails";

export default function ExportButton({ week }: { week: WeekPlan }) {
  const onExport = () => {
    const fn = `week-${week.week_start}.json`;
    const blob = new Blob([JSON.stringify({ events: week.events }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fn; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button className="rounded-lg border px-3 py-1 text-sm hover:bg-slate-50" onClick={onExport}>
      Download JSON
    </button>
  );
}
