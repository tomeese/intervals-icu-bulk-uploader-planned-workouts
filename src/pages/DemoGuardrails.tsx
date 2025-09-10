import React, { useMemo, useState } from "react";
import TotalsPanel from "../components/TotalsPanel";
import type { WeekPlan, WorkoutEvent, HistoryInputs } from "../lib/guardrails";
import { computeGuardrails } from "../lib/guardrails";
import ExportButton from "../components/ExportButton";

function labelFrom(desc?: string, type?: WorkoutEvent["type"], load?: number, secs?: number) {
  if (desc && desc.trim()) return desc.split("\n")[0].slice(0, 80);
  if (type === "Workout" && load) return `Workout – ${load} TSS`;
  if (secs) return `Endurance Ride – ${(secs/3600).toFixed(1)}h`;
  return type || "Workout";
}

function makeEvent(
  date: string,
  load: number,
  secs: number = 3600,
  desc?: string,
  type: WorkoutEvent["type"] = "Ride"
): WorkoutEvent {
  return {
    external_id: `${date}-${load}-${secs}`,
    start_date_local: `${date}T08:00`,
    type,
    category: "WORKOUT",
    moving_time: secs,
    icu_training_load: load,
    name: labelFrom(desc, type, load, secs),   // ⬅️ set name
    description: desc,
  };
}

function weekSafe(): WeekPlan {
  // Week starting Monday 2025-07-21
  const w: WeekPlan = { week_start: "2025-07-21", events: [] };
  // Tue VO2 (hard)
  w.events.push(makeEvent("2025-07-22", 120, 3600, "VO2 5x3' @120%", "Workout"));
  // Wed recovery
  w.events.push(makeEvent("2025-07-23", 35, 1800, "Recovery spin z1"));
  // Thu endurance
  w.events.push(makeEvent("2025-07-24", 80, 5400, "Endurance z2"));
  // Sat long endurance (hits long-ride cap path, but load modest)
  w.events.push(makeEvent("2025-07-26", 170, 4 * 3600, "Endurance long ride"));
  // Sun endurance
  w.events.push(makeEvent("2025-07-27", 110, 5400, "Endurance tempo"));
  return w;
}

function weekSpicy(): WeekPlan {
  const w: WeekPlan = { week_start: "2025-07-21", events: [] };
  // Tue hard threshold
  w.events.push(makeEvent("2025-07-22", 150, 4200, "Threshold 4x10' @100%", "Workout"));
  // Wed endurance but still decent
  w.events.push(makeEvent("2025-07-23", 70, 4800, "Endurance z2"));
  // Thu hard sweet spot
  w.events.push(makeEvent("2025-07-24", 130, 5400, "Sweet spot 3x20' @ 90%", "Workout"));
  // Sat big long ride
  w.events.push(makeEvent("2025-07-26", 200, 4 * 3600, "Endurance long ride"));
  // Sun endurance
  w.events.push(makeEvent("2025-07-27", 120, 5400, "Endurance tempo"));
  return w;
}

function historyActualsBaseline560(): HistoryInputs {
  // 28 days of 80 -> baseline weekly 560
  const start = new Date("2025-06-24T00:00");
  const actualDailyLoads = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { date: d.toISOString().slice(0, 10), load: 80 };
  });
  return { actualDailyLoads };
}

export default function DemoGuardrails() {
  const [mode, setMode] = useState<"safe" | "spicy">("safe");
  const week = useMemo(() => (mode === "safe" ? weekSafe() : weekSpicy()), [mode]);
  const history = useMemo(() => historyActualsBaseline560(), []);

  const summary = useMemo(() => computeGuardrails(week, history), [week, history]);

  return (
    <div className="min-h-screen bg-slate-50">
      <TotalsPanel week={week} history={history} />

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-slate-600 text-sm">Scenario:</span>
          <button
            className={`px-3 py-1 rounded-lg border text-sm ${
              mode === "safe" ? "bg-white border-slate-300" : "bg-slate-100 border-transparent"
            }`}
            onClick={() => setMode("safe")}
          >
            Safe (≈ at baseline)
          </button>
          <button
            className={`px-3 py-1 rounded-lg border text-sm ${
              mode === "spicy" ? "bg-white border-slate-300" : "bg-slate-100 border-transparent"
            }`}
            onClick={() => setMode("spicy")}
          >
            Spicy (above baseline)
          </button>
        </div>
        <div className="ml-auto">
            <ExportButton week={week} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="Week Inputs">
            <pre className="text-xs overflow-auto p-3 bg-white rounded-xl border border-slate-200">{JSON.stringify(week, null, 2)}</pre>
          </Card>
          <Card title="Computed Summary">
            <pre className="text-xs overflow-auto p-3 bg-white rounded-xl border border-slate-200">{JSON.stringify(summary, null, 2)}</pre>
          </Card>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Tip: Baseline is derived from the last 28 days of actuals (80/day → 560/week). Switch scenarios to see ramp severity and cap breaches change.
        </p>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/50">
      <div className="px-3 py-2 border-b border-slate-200 text-sm text-slate-600">{title}</div>
      <div className="p-2">{children}</div>
    </div>
  );
}
