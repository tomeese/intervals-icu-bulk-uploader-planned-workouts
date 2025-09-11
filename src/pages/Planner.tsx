// src/pages/Planner.tsx
import React, { useMemo, useReducer, useState } from "react";
import { reducer, type PlannerState, dayIso, inferSunday } from "../lib/planner-state";
import type { PlanEvent } from "../lib/schema";
import ExportUploadPanel from "../components/ExportUploadPanel";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---- small helpers ----
function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + "T00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function prevSunday(isoDate: string): string {
  // ensure weekStart is the Sunday of the week
  const d = new Date(isoDate + "T00:00");
  const dow = d.getDay(); // 0..6 (Sun..Sat)
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}

// ---- main component ----
export default function Planner() {
  const [state, dispatch] = useReducer(reducer, {
    weekStart: inferSunday(), // default to this coming/last Sunday
    selectedDay: 0,
    tz: "America/Los_Angeles",
    days: {},
  } satisfies PlannerState);

  // local inputs for adding a custom event
  const [custom, setCustom] = useState({
    name: "Endurance z2",
    type: "Ride" as PlanEvent["type"],
    time: "06:00",
    minutes: 90,
    load: 70,
    desc: "",
  });

  const selectedDate = useMemo(
    () => dayIso(state.weekStart || inferSunday(), state.selectedDay),
    [state.weekStart, state.selectedDay]
  );

  const selectedEvents: PlanEvent[] = state.days[selectedDate] || [];

  const setWeek = (iso: string) => dispatch({ type: "setWeekStart", weekStart: prevSunday(iso) });
  const shiftWeek = (deltaWeeks: number) =>
    setWeek(addDays(state.weekStart || inferSunday(), deltaWeeks * 7));

  const addQuick = (name: string, type: PlanEvent["type"], mins: number, load: number, time = "06:00") => {
    addEventInternal(selectedDate, { name, type, minutes: mins, load, time, desc: name });
  };

  const addEventInternal = (
    date: string,
    { name, type, minutes, load, time, desc }: { name: string; type: PlanEvent["type"]; minutes: number; load: number; time: string; desc?: string }
  ) => {
    const secs = Math.max(0, Math.round(minutes * 60));
    const ev: PlanEvent = {
      external_id: `${date}-${load}-${secs}`,
      start_date_local: `${date}T${time}`,
      type,
      category: "WORKOUT",
      moving_time: secs,
      icu_training_load: load,
      name,
      description: desc || name,
    };
    dispatch({ type: "addEvent", date, event: ev });
  };

  const removeEvent = (idx: number) => dispatch({ type: "removeEvent", date: selectedDate, index: idx });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Weekly Planner</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftWeek(-1)} className="px-2 py-1 rounded border">← Prev</button>
          <input
            type="date"
            className="px-2 py-1 rounded border"
            value={state.weekStart || ""}
            onChange={(e) => setWeek(e.target.value)}
          />
          <button onClick={() => shiftWeek(+1)} className="px-2 py-1 rounded border">Next →</button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: planning canvas */}
        <section className="lg:col-span-2 space-y-4">
          {/* Day picker */}
          <nav className="grid grid-cols-7 gap-2">
            {DAY_LABELS.map((lab, i) => {
              const dIso = dayIso(state.weekStart || inferSunday(), i);
              const active = i === state.selectedDay;
              return (
                <button
                  key={i}
                  onClick={() => dispatch({ type: "selectDay", index: i })}
                  className={[
                    "rounded-md border px-2 py-2 text-sm",
                    active ? "bg-slate-900 text-white border-slate-900" : "bg-white"
                  ].join(" ")}
                  title={dIso}
                >
                  <div className="font-medium">{lab}</div>
                  <div className="text-xs opacity-70">{dIso.slice(5)}</div>
                </button>
              );
            })}
          </nav>

          {/* Selected day editor */}
          <div className="rounded-xl border p-3 bg-white">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-lg font-semibold">
                {DAY_LABELS[state.selectedDay]} <span className="font-mono text-slate-500">{selectedDate}</span>
              </div>
              <div className="text-sm text-slate-600">TZ: <span className="font-mono">{state.tz}</span></div>
            </div>

            {/* Existing events */}
            <ul className="space-y-2">
              {selectedEvents.length === 0 && (
                <li className="text-sm text-slate-500">No events yet.</li>
              )}
              {selectedEvents.map((e, idx) => (
                <li key={idx} className="border rounded-md px-3 py-2 flex items-center justify-between">
                  <div className="text-sm">
                    <div className="font-medium">{e.name}</div>
                    <div className="text-xs text-slate-600">
                      {e.type} · {Math.round(e.moving_time / 60)} min · TL {e.icu_training_load} · {e.start_date_local.slice(11,16)}
                    </div>
                    {e.description && <div className="text-xs text-slate-500 mt-0.5">{e.description}</div>}
                  </div>
                  <button onClick={() => removeEvent(idx)} className="text-red-600 text-sm">Remove</button>
                </li>
              ))}
            </ul>

            {/* Quick add */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => addQuick("Endurance z2", "Ride", 90, 70)} className="px-2 py-1 rounded border text-sm">
                + Endurance 90' (TL 70)
              </button>
              <button onClick={() => addQuick("VO2 5×3' @120%", "Workout", 60, 120)} className="px-2 py-1 rounded border text-sm">
                + VO2 60' (TL 120)
              </button>
              <button onClick={() => addQuick("Recovery spin z1", "Ride", 30, 35)} className="px-2 py-1 rounded border text-sm">
                + Recovery 30' (TL 35)
              </button>
              <button onClick={() => addQuick("Endurance long ride", "Ride", 240, 170)} className="px-2 py-1 rounded border text-sm">
                + Long ride 4h (TL 170)
              </button>
            </div>

            {/* Custom add */}
            <div className="mt-4 border-t pt-3">
              <div className="text-sm font-medium mb-2">Add custom</div>
              <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
                <div className="sm:col-span-2">
                  <label className="block text-xs mb-1">Name</label>
                  <input
                    className="w-full rounded border px-2 py-1"
                    value={custom.name}
                    onChange={(e) => setCustom({ ...custom, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1">Type</label>
                  <select
                    className="w-full rounded border px-2 py-1"
                    value={custom.type}
                    onChange={(e) => setCustom({ ...custom, type: e.target.value as PlanEvent["type"] })}
                  >
                    <option>Ride</option>
                    <option>Workout</option>
                    <option>Run</option>
                    <option>Virtual Ride</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1">Start</label>
                  <input
                    type="time"
                    className="w-full rounded border px-2 py-1"
                    value={custom.time}
                    onChange={(e) => setCustom({ ...custom, time: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1">Minutes</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded border px-2 py-1"
                    value={custom.minutes}
                    onChange={(e) => setCustom({ ...custom, minutes: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1">TL</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded border px-2 py-1"
                    value={custom.load}
                    onChange={(e) => setCustom({ ...custom, load: Number(e.target.value) })}
                  />
                </div>
                <div className="sm:col-span-6">
                  <label className="block text-xs mb-1">Notes</label>
                  <input
                    className="w-full rounded border px-2 py-1"
                    value={custom.desc}
                    onChange={(e) => setCustom({ ...custom, desc: e.target.value })}
                  />
                </div>
                <div>
                  <button
                    className="px-3 py-1.5 rounded border bg-slate-50 hover:bg-slate-100"
                    onClick={() =>
                      addEventInternal(selectedDate, {
                        name: custom.name.trim() || "Planned workout",
                        type: custom.type,
                        minutes: Math.max(0, custom.minutes),
                        load: Math.max(0, custom.load),
                        time: custom.time || "06:00",
                        desc: custom.desc,
                      })
                    }
                  >
                    Add event
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right: export/upload */}
        <aside>
          <ExportUploadPanel state={state} />
        </aside>
      </div>
    </div>
  );
}