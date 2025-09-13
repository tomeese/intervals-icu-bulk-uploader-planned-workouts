import React, { useMemo } from "react";
import {
  computeGuardrails,
  DEFAULT_GUARDRAILS,
  type GuardrailHistory,
  type WeekPlan,
} from "../lib/guardrails";

export default function GuardrailsPanel({
  week,
  history,
}: {
  week: WeekPlan;
  history: GuardrailHistory;
}) {
  const res = useMemo(
    () => computeGuardrails(week, history || {}, DEFAULT_GUARDRAILS),
    [week, history]
  );

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900">
      <h2 className="text-base font-semibold mb-3">Guardrails</h2>

      <div className="text-sm text-slate-600 mb-3">
        Planned (week): <b>{res.plannedWeekLoad}</b>{" "}
        &nbsp; Baseline: <b>{res.baselineWeeklyLoad}</b>{" "}
        &nbsp; Ramp: <b>{res.rampPct.toFixed(1)}%</b> &nbsp; Severity:{" "}
        <b>{res.rampSeverity}</b>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-2 pr-3">Day</th>
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Planned TL</th>
              <th className="py-2 pr-3">Cap</th>
              <th className="py-2 pr-3">Over</th>
              <th className="py-2 pr-3">Breaches</th>
            </tr>
          </thead>
          <tbody>
            {res.daily.map((d, i) => (
              <tr key={d.date} className="border-t">
                <td className="py-2 pr-3">
                  {new Intl.DateTimeFormat(undefined, {
                    weekday: "short",
                  }).format(new Date(`${d.date}T00:00`))}
                </td>
                <td className="py-2 pr-3 font-mono">{d.date}</td>
                <td className="py-2 pr-3">{d.dayType}</td>
                <td className="py-2 pr-3">{d.plannedTL ?? 0}</td>
                <td className="py-2 pr-3">{d.capApplied ?? "—"}</td>
                <td className="py-2 pr-3">
                  {d.overBy && d.overBy > 0 ? d.overBy : "—"}
                </td>
                <td className="py-2 pr-3">
                  {d.breaches && d.breaches.length
                    ? d.breaches.join(", ")
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
