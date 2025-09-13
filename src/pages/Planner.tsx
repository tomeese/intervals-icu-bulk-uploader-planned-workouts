import React, { useMemo, useReducer } from "react";
import ExportUploadPanel from "../components/ExportUploadPanel";
import GuardrailsPanel from "../components/GuardrailsPanel";
import { reducer, buildWeekPlan, type PlannerState } from "../lib/planner-state";
import type { PlanEvent } from "../lib/schema";
import { computeGuardrails, DEFAULT_GUARDRAILS } from "../lib/guardrails";

// ---------- date helpers (Mon → Sun) ----------
function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function startOfISOWeek(date = new Date()): string {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return toIso(d);
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00`);
  d.setDate(d.getDate() + n);
  return toIso(d);
}
function fmtDayHeader(iso: string) {
  const d = new Date(`${iso}T00:00`);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "2-digit",
  }).format(d);
}

// ---------- quick event factory ----------
function makeEvent(
  date: string,
  load: number,
  secs: number,
  description: string,
  type: PlanEvent["type"] = "Ride"
): PlanEvent {
  return {
    external_id: `${date}-${load}-${secs}`,
    start_date_local: `${date}T08:00`,
    type,
    category: "WORKOUT",
    moving_time: secs,
    icu_training_load: load,
    description,
  };
}

// ---------- UI color helpers ----------
type Kind = "endurance" | "workout" | "recovery";
const dotBtnBase =
  "h-8 w-8 inline-flex items-center justify-center rounded-full border font-semibold transition hover:opacity-90";
const dotEndurance = "bg-sky-50 text-sky-700 border-sky-200";
const dotWorkout = "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200";
const dotRecovery = "bg-emerald-50 text-emerald-700 border-emerald-200";

function kindOfEvent(e: PlanEvent): Kind {
  const desc = (e.description || "").toLowerCase();
  if (/recovery|z1/.test(desc)) return "recovery";
  if (e.type === "Workout" || /vo2|threshold|tempo|workout/.test(desc))
    return "workout";
  return "endurance";
}
function chipAccent(kind: Kind) {
  return (
    "border-l-4 " +
    (kind === "endurance"
      ? "border-l-sky-400"
      : kind === "workout"
      ? "border-l-fuchsia-400"
      : "border-l-emerald-400")
  );
}

// ---------- initial state ----------
const initialState: PlannerState = {
  weekStart: startOfISOWeek(),
  selectedDay: 0,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  days: {},
};

// ---------- severity badge ----------
function sevBadgeClasses(sev: "none" | "info" | "warn" | "stop") {
  switch (sev) {
    case "stop":
      return "bg-red-100 text-red-800 border-red-200";
    case "warn":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "info":
      return "bg-sky-100 text-sky-800 border-sky-200";
    default:
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
  }
}

export default function Planner() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(state.weekStart!, i)),
    [state.weekStart]
  );

  const weekPlan = useMemo(() => buildWeekPlan(state), [state]);

  // Guardrails summary
  const summary = useMemo(
    () => computeGuardrails(weekPlan, {}, DEFAULT_GUARDRAILS),
    [weekPlan]
  );
  const breachedDays = useMemo(
    () => summary.daily.filter((d) => (d.overBy ?? 0) > 0).length,
    [summary]
  );
  const totalBreaches = useMemo(
    () => summary.daily.reduce((acc, d) => acc + (d.breaches?.length || 0), 0),
    [summary]
  );

  // navigation
  const shiftWeek = (delta: number) => {
    const d = new Date(`${state.weekStart}T00:00`);
    d.setDate(d.getDate() + delta * 7);
    dispatch({ type: "setWeekStart", weekStart: toIso(d) });
  };

  // quick add buttons
  const addEndurance = (date: string) =>
    dispatch({
      type: "addEvent",
      date,
      event: makeEvent(date, 60, 90 * 60, "Endurance 60 / 90m", "Ride"),
    });
  const addWorkout = (date: string) =>
    dispatch({
      type: "addEvent",
      date,
      event: makeEvent(date, 120, 60 * 60, "Workout 120 / 60m", "Workout"),
    });
  const addRecovery = (date: string) =>
    dispatch({
      type: "addEvent",
      date,
      event: makeEvent(date, 35, 30 * 60, "Recovery 35 / 30m", "Ride"),
    });
  const removeLast = (date: string) => {
    const arr = state.days[date] || [];
    if (arr.length === 0) return;
    const copy = arr.slice(0, -1);
    dispatch({ type: "replaceDay", date, events: copy });
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Planner</h1>
          <p className="text-sm text-slate-600">
            Week starting <span className="font-mono">{state.weekStart}</span>{" "}
            (Mon → Sun)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => shiftWeek(-1)}
            className="px-3 py-1.5 rounded-md border bg-slate-50 hover:bg-slate-100"
          >
            ← Previous week
          </button>
          <button
            onClick={() => shiftWeek(1)}
            className="px-3 py-1.5 rounded-md border bg-slate-50 hover:bg-slate-100"
          >
            Next week →
          </button>
        </div>
      </div>

      {/* Guardrails Summary */}
      <section
        aria-label="Guardrails summary"
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Guardrails summary</h2>
          <a href="#guardrails" className="text-sm text-sky-700 hover:underline">
            View details ↓
          </a>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-slate-500">Planned TL</div>
            <div className="text-lg font-semibold">
              {summary.plannedWeekLoad ?? 0}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-slate-500">Baseline TL</div>
            <div className="text-lg font-semibold">
              {summary.baselineWeeklyLoad ?? 0}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-slate-500">Ramp</div>
            <div className="text-lg font-semibold">
              {(summary.rampPct ?? 0).toFixed(1)}%
            </div>
          </div>
          <div className="rounded-lg border p-3 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500">Severity</div>
              <div
                className={
                  "inline-block text-xs px-2 py-0.5 rounded border " +
                  sevBadgeClasses(summary.rampSeverity || "none")
                }
              >
                {summary.rampSeverity || "none"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-slate-500">Breaches</div>
              <div className="text-sm font-medium">
                {breachedDays} days / {totalBreaches} total
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-slate-600">
        <div className="flex items-center gap-1">
          <span className={`${dotBtnBase} ${dotEndurance} text-sm`}>+</span>
          <span>Endurance</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`${dotBtnBase} ${dotWorkout} text-sm`}>+</span>
          <span>Workout</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`${dotBtnBase} ${dotRecovery} text-sm`}>+</span>
          <span>Recovery</span>
        </div>
      </div>

      {/* Main two-column: week grid + export */}
      <div className="grid md:grid-cols-[1fr,320px] gap-6 items-start">
        {/* Left: week grid */}
        <section>
          <h2 className="text-base font-semibold mb-2">Plan this week</h2>

          {/* Responsive grid with compact columns */}
          <div
            className="
              grid gap-2
              auto-cols-[128px] grid-flow-col overflow-x-auto
              md:grid-flow-row md:grid-cols-7 md:auto-cols-auto md:overflow-visible
              pb-1
            "
          >
            {weekDays.map((date, idx) => {
              const events = state.days[date] || [];
              const isSelected = state.selectedDay === idx;
              return (
                <div key={date} className="min-w-[128px] md:min-w-0">
                  <div
                    className={`rounded-xl border p-2 space-y-2 ${
                      isSelected
                        ? "ring-2 ring-sky-400 border-sky-300"
                        : "border-slate-200 dark:border-slate-800"
                    }`}
                    onClick={() => dispatch({ type: "selectDay", index: idx })}
                  >
                    <header className="text-xs font-semibold leading-tight">
                      <div className="flex items-baseline justify-between">
                        <span>{fmtDayHeader(date)}</span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {date}
                        </span>
                      </div>
                    </header>

                    {/* icon-only quick-add row */}
                    <div className="flex items-center justify-between">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addEndurance(date);
                        }}
                        className={`${dotBtnBase} ${dotEndurance}`}
                        title="Add Endurance (60 TL / 90m)"
                        aria-label="Add Endurance"
                      >
                        +
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addWorkout(date);
                        }}
                        className={`${dotBtnBase} ${dotWorkout}`}
                        title="Add Workout (120 TL / 60m)"
                        aria-label="Add Workout"
                      >
                        +
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addRecovery(date);
                        }}
                        className={`${dotBtnBase} ${dotRecovery}`}
                        title="Add Recovery (35 TL / 30m)"
                        aria-label="Add Recovery"
                      >
                        +
                      </button>
                    </div>

                    {/* events */}
                    <div className="space-y-1.5">
                      {events.length === 0 ? (
                        <div className="text-[11px] text-slate-500">
                          No events
                        </div>
                      ) : (
                        events.map((e, i) => {
                          const k = kindOfEvent(e);
                          return (
                            <div
                              key={`${e.external_id}-${i}`}
                              className={
                                "rounded-lg border px-2 py-1.5 text-[11px] leading-tight bg-white dark:bg-slate-900 " +
                                chipAccent(k)
                              }
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="font-medium">
                                    {e.description || e.type}
                                  </div>
                                  <div className="text-[10px] text-slate-500 font-mono">
                                    TL {e.icu_training_load} ·{" "}
                                    {Math.round(e.moving_time / 60)}m
                                  </div>
                                </div>
                                <button
                                  onClick={(evt) => {
                                    evt.stopPropagation();
                                    dispatch({
                                      type: "removeEvent",
                                      date,
                                      index: i,
                                    });
                                  }}
                                  className="text-[11px] px-1.5 py-0.5 rounded border hover:bg-slate-50"
                                  title="Remove"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* remove last (compact) */}
                    <div className="flex justify-end">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeLast(date);
                        }}
                        className="text-[11px] px-2 py-1 rounded border hover:bg-slate-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right: export/upload */}
        <aside>
          <ExportUploadPanel state={state} />
        </aside>
      </div>

      {/* Guardrails details */}
      <section id="guardrails" className="mt-4">
        <GuardrailsPanel week={weekPlan} history={{}} />
      </section>
    </div>
  );
}
