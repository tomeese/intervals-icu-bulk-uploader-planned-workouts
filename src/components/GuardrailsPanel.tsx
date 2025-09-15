/* /src/components/GuardrailsPanel.tsx */

import React from "react";
import {
  computeGuardrails,
  DEFAULT_GUARDRAILS,
} from "../lib/guardrails";

// Use the function’s return type for strong typing
type GuardrailsSummary = ReturnType<typeof computeGuardrails>;

function toneForRamp(sev: string) {
  // map the ramp severity to a pill style
  if (sev === "stop") return "bg-rose-50 text-rose-700 border-rose-200";
  if (sev === "warn") return "bg-amber-50 text-amber-700 border-amber-200";
  if (sev === "info") return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

export default function GuardrailsPanel({
  summary,
}: {
  summary: GuardrailsSummary | null;
}) {
  if (!summary) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900">
        <h2 className="text-base font-semibold mb-2">Guardrails</h2>
        <div className="text-sm text-slate-600">
          No data yet — add some planned events to this week.
        </div>
      </div>
    );
  }

  const {
    plannedWeekLoad,
    baselineWeeklyLoad,
    rampPct,
    rampSeverity,
    daily,
  } = summary;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">Guardrails</h2>
        <span
          className={`text-xs rounded border px-2 py-1 ${toneForRamp(
            rampSeverity
          )}`}
          title="Weekly ramp vs baseline"
        >
          Ramp&nbsp;{rampPct.toFixed(1)}%
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm mb-3">
        <KV label="Planned week" value={plannedWeekLoad.toFixed(0)} />
        <KV label="Baseline week" value={baselineWeeklyLoad.toFixed(0)} />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <thead className="bg-slate-50 dark:bg-slate-800/50">
            <tr className="text-left">
              <Th>Day</Th>
              <Th>Type</Th>
              <Th>Cap</Th>
              <Th>Over</Th>
              <Th>Flags</Th>
            </tr>
          </thead>
          <tbody>
            {daily
              // ensure stable Monday→Sunday order
              .slice()
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((d) => (
                <tr
                  key={d.date}
                  className="border-t border-slate-200 dark:border-slate-800"
                >
                  <Td>
                    <div className="font-mono">{d.date}</div>
                  </Td>
                  <Td className="capitalize">{d.dayType}</Td>
                  <Td>{Math.round(d.capApplied)}</Td>
                  <Td className={d.overBy > 0 ? "text-rose-600" : ""}>
                    {Math.max(0, Math.round(d.overBy))}
                  </Td>
                  <Td>
                    {d.breaches?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {d.breaches.map((b) => (
                          <span
                            key={b}
                            className="text-[11px] rounded border px-1.5 py-0.5 bg-amber-50 text-amber-700 border-amber-200"
                          >
                            {b.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </Td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Caps apply the most conservative limit for the inferred day type (plus
        long-ride limits when duration exceeds threshold). “Over” shows how far
        the plan exceeds the cap.
      </p>
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-slate-200 dark:border-slate-800 px-2 py-1.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-2 text-[12px] font-semibold">{children}</th>;
}
function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-2 py-2 ${className}`}>{children}</td>;
}
