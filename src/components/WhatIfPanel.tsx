import React, { useMemo, useState } from "react";
import type { GuardrailConfig, HistoryInputs, WeekPlan } from "../lib/guardrails";
import { computeGuardrails, DEFAULT_GUARDRAILS } from "../lib/guardrails";
import { scaleWeekToTarget, type ScaleResult } from "../lib/scale";

export type WhatIfPanelProps = {
  week: WeekPlan;
  history?: HistoryInputs;
  config?: GuardrailConfig;
  onApply: (updated: WeekPlan) => void;
  className?: string;
};

export default function WhatIfPanel({ week, history, config = DEFAULT_GUARDRAILS, onApply, className }: WhatIfPanelProps) {
  // Inputs
  const [mode, setMode] = useState<"target" | "percent">("target");
  const [targetWeeklyLoad, setTargetWeeklyLoad] = useState<number | "">("");
  const [scalePct, setScalePct] = useState<number | "">(110);
  const [respectCaps, setRespectCaps] = useState(true);
  const [lockRestDays, setLockRestDays] = useState(true);

  // Preview state
  const [preview, setPreview] = useState<ScaleResult | null>(null);

  const current = useMemo(() => computeGuardrails(week, history, config), [week, history, config]);
  const prospective = useMemo(() =>
    preview ? computeGuardrails(preview.week, history, config) : null,
  [preview, history, config]);

  const canPreview = () => {
    if (mode === "target") return typeof targetWeeklyLoad === "number" && targetWeeklyLoad > 0;
    return typeof scalePct === "number" && scalePct > 0;
  };

  const handlePreview = () => {
    if (!canPreview()) return;
    const res = scaleWeekToTarget(week, config, {
      targetWeeklyLoad: mode === "target" ? Number(targetWeeklyLoad) : 0,
      scalePct: mode === "percent" ? Number(scalePct) : 0,
      lockRestDays,
      respectCaps,
    });
    setPreview(res);
  };

  const handleApply = () => {
    if (!preview) return;
    onApply(preview.week);
    setPreview(null);
  };

  const handleReset = () => setPreview(null);

  return (
    <div className={`mt-4 rounded-2xl border border-slate-200 bg-white/70 backdrop-blur ${className || ""}`}>
      <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-800">What‑If Auto‑Scale</h3>
        <span className="text-xs text-slate-500">Scale planned loads toward a target, respecting guardrails.</span>
      </div>

      <div className="p-4 space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">
              <input type="radio" name="mode" className="mr-1" checked={mode === "target"} onChange={() => setMode("target")} />
              Target weekly load
            </label>
            <input
              type="number"
              className="w-28 rounded-lg border px-2 py-1 text-sm"
              placeholder={String(current.plannedWeekLoad)}
              value={targetWeeklyLoad}
              onChange={(e) => setTargetWeeklyLoad(e.target.value === "" ? "" : Number(e.target.value))}
              disabled={mode !== "target"}
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">
              <input type="radio" name="mode" className="mr-1" checked={mode === "percent"} onChange={() => setMode("percent")} />
              Scale to % of current
            </label>
            <input
              type="number"
              className="w-24 rounded-lg border px-2 py-1 text-sm"
              placeholder="110"
              value={scalePct}
              onChange={(e) => setScalePct(e.target.value === "" ? "" : Number(e.target.value))}
              disabled={mode !== "percent"}
            />
            <span className="text-sm text-slate-500">%</span>
          </div>

          <label className="ml-2 text-sm text-slate-600">
            <input type="checkbox" className="mr-1" checked={respectCaps} onChange={(e) => setRespectCaps(e.target.checked)} />
            Respect caps
          </label>
          <label className="text-sm text-slate-600">
            <input type="checkbox" className="mr-1" checked={lockRestDays} onChange={(e) => setLockRestDays(e.target.checked)} />
            Lock rest days
          </label>

          <button
            className="ml-auto rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
            onClick={handlePreview}
            disabled={!canPreview()}
          >
            Preview
          </button>
        </div>

        {/* Current vs Prospective summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SummaryCard title="Current Week" planned={current.plannedWeekLoad} baseline={current.baselineWeeklyLoad} ramp={current.rampPct} sev={current.rampSeverity} />
          {prospective ? (
            <SummaryCard title="After Scaling" planned={prospective.plannedWeekLoad} baseline={prospective.baselineWeeklyLoad} ramp={prospective.rampPct} sev={prospective.rampSeverity} />
          ) : (
            <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-500">Click <b>Preview</b> to see the effect.</div>
          )}
        </div>

        {/* Changes table */}
        {preview && (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-slate-600">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Before</th>
                  <th className="px-3 py-2">Cap</th>
                  <th className="px-3 py-2">After</th>
                  <th className="px-3 py-2">Δ</th>
                </tr>
              </thead>
              <tbody>
                {preview.changes.map((c) => (
                  <tr key={c.date} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">{c.date}</td>
                    <td className="px-3 py-2">{c.before}</td>
                    <td className="px-3 py-2">{c.capApplied ?? "—"}</td>
                    <td className="px-3 py-2">{c.after}</td>
                    <td className={`px-3 py-2 ${c.appliedDelta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{c.appliedDelta > 0 ? "+" : ""}{c.appliedDelta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-sm text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            disabled={!preview}
            onClick={handleApply}
          >
            Apply changes
          </button>
          <button className="rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50" disabled={!preview} onClick={handleReset}>Reset preview</button>
          {preview && preview.residual !== 0 && (
            <span className="text-xs text-slate-500 ml-2">Residual to target: {preview.residual > 0 ? "+" : ""}{preview.residual}</span>
          )}
        </div>

        <p className="text-xs text-slate-500">Notes: Caps include hard/endurance/recovery and the long‑ride cap. Rest days remain untouched when locked. Min step: {config.min_step}.</p>
      </div>
    </div>
  );
}

function SummaryCard({ title, planned, baseline, ramp, sev }: { title: string; planned: number; baseline: number; ramp: number; sev: string }) {
  const sevStyles: Record<string, string> = {
    none: "bg-gray-100 text-gray-800 border-gray-200",
    info: "bg-blue-100 text-blue-800 border-blue-200",
    warn: "bg-amber-100 text-amber-800 border-amber-200",
    stop: "bg-rose-100 text-rose-800 border-rose-200",
  };
  const rampFmt = `${ramp > 0 ? "+" : ""}${ramp.toFixed(1)}%`;
  const label: Record<string, string> = { none: "OK", info: "Slight ↑", warn: "High ↑", stop: "Too High ↑" };
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-sm font-medium text-slate-700 mb-2">{title}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge label="Planned" value={planned} />
        <Badge label="Baseline" value={baseline} />
        <Badge label="Ramp" value={rampFmt} />
        <span className={`inline-flex items-center gap-2 rounded-xl border px-2 py-1 text-xs font-medium ${sevStyles[sev]}`}>
          <span className="inline-block h-2 w-2 rounded-full bg-current opacity-70" />
          {label[sev]}
        </span>
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
