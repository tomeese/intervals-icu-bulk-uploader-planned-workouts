// src/components/GuardrailsPanel.tsx
import React from "react";
import type { GuardrailSummary } from "../lib/guardrails";

// Small helpers
function wday(iso: string) {
  // iso = YYYY-MM-DD
  const d = new Date(iso + "T00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" });
}
function fmt(n: number | null | undefined) {
  return typeof n === "number" ? Math.round(n).toString() : "-";
}
function rampTone(pct: number | null | undefined) {
  const p = typeof pct === "number" ? pct : 0;
  if (p >= 20) return "bg-rose-50 text-rose-700 border-rose-200";
  if (p >= 10) return "bg-amber-50 text-amber-700 border-amber-200";
  if (p <= -20) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

export default function GuardrailsPanel({
  summary,
}: {
  summary: GuardrailSummary | null;
}) {
  if (!summary) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-500">
        No guardrails yet.
      </div>
    );
  }

  const daily = Array.isArray(summary.daily) ? summary.daily : [];

  return (
    <div className="space-y-3">
      {/* Week summary strip */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900">
        <div className="grid grid-cols-4 gap-2 text-sm">
          <div className="rounded border px-2 py-1.5 bg-slate-50 text-slate-700 border-slate-200">
            <div className="text-[11px]">Planned</div>
            <div className="font-semibold tabular-nums">
              {fmt(summary.plannedWeekLoad)}
            </div>
          </div>
          <div className="rounded border px-2 py-1.5 bg-slate-50 text-slate-700 border-slate-200">
            <div className="text-[11px]">Baseline</div>
            <div className="font-semibold tabular-nums">
              {fmt(summary.baselineWeeklyLoad)}
            </div>
          </div>
          <div className={`rounded border px-2 py-1.5 ${rampTone(summary.rampPct)}`}>
            <div className="text-[11px]">Ramp</div>
            <div className="font-semibold tabular-nums">
              {typeof summary.rampPct === "number"
                ? `${summary.rampPct.toFixed(1)}%`
                : "-"}
            </div>
          </div>
          <div className="rounded border px-2 py-1.5 bg-slate-50 text-slate-700 border-slate-200">
            <div className="text-[11px]">Severity</div>
            <div className="font-semibold">{summary.rampSeverity ?? "-"}</div>
          </div>
        </div>
      </div>

      {/* Daily table */}
      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full text-sm table-fixed">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="w-16 py-2 pr-2">Day</th>
              <th className="w-24 py-2 pr-2">Cap</th>
              <th className="w-24 py-2 pr-2">Over</th>
              <th className="w-28 py-2 pr-2">Type</th>
              <th className="py-2 pr-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => {
              // be tolerant to missing fields
              const day = (d as any) || {};
              const flags: string[] = Array.isArray(day.breaches)
                ? day.breaches
                : [];
              return (
                <tr key={day.date} className="border-t border-slate-200">
                  <td className="py-2 pr-2 font-medium">{wday(day.date)}</td>
                  <td className="py-2 pr-2 tabular-nums">
                    {fmt(day.capApplied)}
                  </td>
                  <td className="py-2 pr-2 tabular-nums">
                    {fmt(day.overBy)}
                  </td>
                  <td className="py-2 pr-2">{day.dayType ?? "-"}</td>
                  <td className="py-2 pr-2">
                    {flags.length ? flags.join(", ") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
