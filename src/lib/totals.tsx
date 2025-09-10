import React, { useMemo, useState } from "react";
import type { GuardrailConfig, HistoryInputs, WeekPlan } from "./guardrails";
import { computeGuardrails, DEFAULT_GUARDRAILS } from "./guardrails";

export type TotalsPanelProps = {
  week: WeekPlan;
  history?: HistoryInputs;
  config?: GuardrailConfig;
  className?: string;
  showDailyBreaches?: boolean;
};

export default function TotalsPanel({
  week,
  history,
  config = DEFAULT_GUARDRAILS,
  className,
  showDailyBreaches = true,
}: TotalsPanelProps) {
  const summary = useMemo(() => computeGuardrails(week, history, config), [week, history, config]);
  const [open, setOpen] = useState(true);

  const sev = summary.rampSeverity;
  const sevStyles: Record<string, string> = {
    none: "bg-gray-100 text-gray-800 border-gray-200",
    info: "bg-blue-100 text-blue-800 border-blue-200",
    warn: "bg-amber-100 text-amber-800 border-amber-200",
    stop: "bg-rose-100 text-rose-800 border-rose-200",
  };

  const sevLabel: Record<string, string> = {
    none: "OK",
    info: "Slight ↑",
    warn: "High ↑",
    stop: "Too High ↑",
  };

  const ramp = summary.rampPct;
  const rampFmt = `${ramp > 0 ? "+" : ""}${ramp.toFixed(1)}%`;

  const breaches = summary.daily.filter((d) => d.overBy > 0);

  return (
    <div className={`sticky top-0 z-40 backdrop-blur bg-white/80 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 ${className || ""}`}>
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Badge label="Planned" value={summary.plannedWeekLoad} />
          <Badge label="Baseline" value={summary.baselineWeeklyLoad} />
          <Badge label="Ramp" value={rampFmt} />

          <span className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1 text-sm font-medium ${sevStyles[sev]}`}>
            <span className="inline-block h-2 w-2 rounded-full bg-current opacity-70" />
            {sevLabel[sev]}
          </span>

          <div className="ml-auto flex items-center gap-2">
            {breaches.length > 0 ? (
              <span className="text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                {breaches.length} day{breaches.length !== 1 ? "s" : ""} over caps
              </span>
            ) : (
              <span className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                All days within caps
              </span>
            )}

            {showDailyBreaches && (
              <button
                className="text-xs rounded-lg border border-slate-300 px-2 py-1 hover:bg-slate-50"
                onClick={() => setOpen((v) => !v)}
              >
                {open ? "Hide" : "Show"} details
              </button>
            )}
          </div>
        </div>

        {showDailyBreaches && open && breaches.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-slate-600">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Total Load</th>
                  <th className="px-3 py-2">Cap</th>
                  <th className="px-3 py-2">Over By</th>
                  <th className="px-3 py-2">Breaches</th>
                </tr>
              </thead>
              <tbody>
                {breaches.map((d) => (
                  <tr key={d.date} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">{d.date}</td>
                    <td className="px-3 py-2 capitalize">{d.dayType}</td>
                    <td className="px-3 py-2">{d.totalLoad}</td>
                    <td className="px-3 py-2">{d.capApplied ?? "—"}</td>
                    <td className="px-3 py-2 text-rose-700">+{d.overBy}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {d.breaches.map((b) => humanizeBreach(b)).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Info banner under the totals */}
        <div className="mt-3 text-xs text-slate-500">
          Baseline uses last {config.baseline_window_days} days of actuals when available; otherwise, average of the last two planned weeks.
        </div>
      </div>
    </div>
  );
}

function Badge({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </span>
  );
}

function humanizeBreach(code: "hard_cap" | "endurance_cap" | "long_ride_cap") {
  switch (code) {
    case "hard_cap":
      return "Hard-day cap";
    case "endurance_cap":
      return "Endurance-day cap";
    case "long_ride_cap":
      return "Long-ride cap";
  }
}
