/* src/lib/planner-state.ts */

import type { WeekPlan, PlanEvent } from "./schema";

export type PlannerState = {
  weekStart: string | null;
  selectedDay: number; // 0..6
  tz: string;
  days: Record<string, PlanEvent[]>; // key: YYYY-MM-DD
};

type Action =
  | { type: "setWeekStart"; weekStart: string }
  | { type: "selectDay"; index: number }
  | { type: "addEvent"; date: string; event: PlanEvent }
  | { type: "removeEvent"; date: string; index: number }
  | { type: "replaceDay"; date: string; events: PlanEvent[] }
  | { type: "loadWeek"; plan: WeekPlan };

export function reducer(s: PlannerState, a: Action): PlannerState {
  switch (a.type) {
    case "setWeekStart":
      return { ...s, weekStart: a.weekStart };
    case "selectDay":
      return { ...s, selectedDay: a.index };
    case "addEvent":
      return {
        ...s,
        days: { ...s.days, [a.date]: [...(s.days[a.date] || []), a.event] },
      };
    case "removeEvent": {
      const copy = [...(s.days[a.date] || [])];
      copy.splice(a.index, 1);
      return { ...s, days: { ...s.days, [a.date]: copy } };
    }
    case "replaceDay":
      return { ...s, days: { ...s.days, [a.date]: a.events } };
    case "loadWeek": {
      const days: PlannerState["days"] = {};
      for (const e of a.plan.events) {
        const date = e.start_date_local.slice(0, 10);
        (days[date] ||= []).push(e);
      }
      return { ...s, weekStart: a.plan.week_start, days };
    }
  }
}

/** Safe initial state for planner screens. */
export function initialPlannerState(
  opts?: Partial<PlannerState>
): PlannerState {
  const tz =
    opts?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const weekStart = opts?.weekStart ?? inferSunday(tz);
  return {
    weekStart,
    selectedDay: 0,
    tz,
    days: opts?.days ?? {},
  };
}

export function buildWeekPlan(state?: PlannerState): WeekPlan {
  const s = state ?? initialPlannerState();
  const events: PlanEvent[] = [];
  for (const [, arr] of Object.entries(s.days || {})) {
    for (const e of arr) events.push(e);
  }
  return {
    week_start: s.weekStart || inferSunday(s.tz),
    events: sortByDateTime(events),
  };
}

// ---- helpers ----
export function inferSunday(tz: string = "UTC"): string {
  const now = new Date();
  // normalize to tz without importing a tz lib: use local date math (good enough for UI defaults)
  const dow = now.getDay(); // 0=Sun..6=Sat
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - dow);
  return toIsoDate(sunday);
}

export function dayIso(weekStart: string, idx: number): string {
  const d = new Date(`${weekStart}T00:00:00`);
  d.setDate(d.getDate() + idx);
  return toIsoDate(d);
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function sortByDateTime<T extends { start_date_local: string }>(
  arr: T[]
): T[] {
  return [...arr].sort((a, b) =>
    a.start_date_local.localeCompare(b.start_date_local)
  );
}
