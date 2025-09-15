import React from "react";
import Chip from "./Chip";
import FormChip from "./FormChip";
import { f1, f0 } from "../lib/format";

export type WeekRow = {
  week: number;
  fitness: number;  // CTL
  fatigue: number;  // ATL
  form: number;     // TSB
  ramp: number;     // Δ fitness vs prior week (or intervals’ ramp)
  load?: number | null;
};

export default function WeeklyHistoryStrip({
  rows,
}: {
  rows: WeekRow[];
}) {
  if (!rows?.length) return null;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900">
      <h3 className="text-sm font-semibold mb-2">Last 4 Weeks</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {rows.map((w) => (
          <div
            key={w.week}
            className="rounded-lg border border-slate-200 dark:border-slate-800 p-2"
          >
            <div className="text-xs text-slate-500 mb-1">Week {w.week}</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <KV label="Fitness" value={f1(w.fitness)} />
              <KV label="Fatigue" value={f1(w.fatigue)} />
              <FormChip value={w.form} />
              <Chip
                label="Ramp"
                value={f1(w.ramp)}
                tone={rampTone(w.ramp)}
                prefix={w.ramp > 0 ? "▲ " : w.ramp < 0 ? "▼ " : ""}
              />
            </div>
            <div className="mt-2 text-xs">
              Load:&nbsp;
              <span className="font-semibold tabular-nums">
                {w.load == null ? "–" : f0(w.load)}
              </span>
            </div>
          </div>
        ))}
      </div>
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

function rampTone(v: number): "ok" | "warn" | "bad" {
  // Simple example: |ramp| > 10 is warn, > 20 is bad
  const a = Math.abs(v);
  if (a > 20) return "bad";
  if (a > 10) return "warn";
  return "ok";
}
