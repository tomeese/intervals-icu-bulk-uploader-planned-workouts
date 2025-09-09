// Guardrails module
// Purpose: compute weekly ramp severity and daily cap breaches for a WeekPlan
// Style: pure functions, UI-agnostic, unit-test friendly

// =========================
// Types
// =========================

export type ActivityType =
  | "Ride"
  | "Gravel Ride"
  | "Virtual Ride"
  | "Run"
  | "Swim"
  | "Workout";

export interface WorkoutEvent {
  external_id: string; // stable for upserts
  start_date_local: string; // YYYY-MM-DDTHH:mm (no Z)
  type: ActivityType; // safe whitelist
  category: "WORKOUT"; // constant for planned
  moving_time: number; // planned duration in seconds
  icu_training_load: number; // planned load (int)
  description?: string; // may include "TSS N" line
}

export interface WeekPlan {
  week_start: string; // Monday ISO date (YYYY-MM-DD)
  events: WorkoutEvent[];
}

export interface GuardrailConfig {
  ramp_warn_pct: number; // warn threshold, e.g., 8
  ramp_stop_pct: number; // stop threshold, e.g., 12
  daily_caps: {
    hard: number; // e.g., 140
    endurance: number; // e.g., 90
    long_ride: number; // e.g., 180
  };
  min_step: number; // 2
  baseline_window_days: number; // 28
}

export type DayType = "hard" | "endurance" | "recovery" | "rest";
export type Severity = "none" | "info" | "warn" | "stop";

export interface DailyCheck {
  date: string; // YYYY-MM-DD
  totalLoad: number;
  totalMovingTime: number; // seconds
  dayType: DayType;
  capApplied: number | null; // cap used for overBy calculation (may be min of multiple caps)
  overBy: number; // 0 if within caps
  breaches: Array<"hard_cap" | "endurance_cap" | "long_ride_cap">;
}

export interface GuardrailSummary {
  plannedWeekLoad: number;
  baselineWeeklyLoad: number; // comparable weekly number
  rampPct: number; // (planned - baseline) / baseline * 100
  rampSeverity: Severity;
  daily: DailyCheck[];
}

export interface HistoryInputs {
  // Actual daily loads (e.g., from Intervals.icu). If provided, we compute a weekly-equivalent baseline from the last N days.
  actualDailyLoads?: Array<{ date: string; load: number }>; // date = YYYY-MM-DD, load is numeric
  // Fallback: previous planned weeks used to estimate baseline when actuals are unavailable.
  previousPlannedWeeks?: WeekPlan[]; // older first or last, any order is accepted
}

export const DEFAULT_GUARDRAILS: GuardrailConfig = {
  ramp_warn_pct: 8,
  ramp_stop_pct: 12,
  daily_caps: {
    hard: 140,
    endurance: 90,
    long_ride: 180,
  },
  min_step: 2,
  baseline_window_days: 28,
};

// Internal: used to detect long-ride days from total moving time if not explicitly tagged.
const LONG_RIDE_TIME_THRESHOLD_SEC = 3 * 3600; // 3 hours

// =========================
// Public API
// =========================

/** Compute guardrail summary for a week. */
export function computeGuardrails(
  week: WeekPlan,
  history: HistoryInputs = {},
  config: GuardrailConfig = DEFAULT_GUARDRAILS
): GuardrailSummary {
  const days = groupEventsByDate(week);
  const dailyChecks: DailyCheck[] = days.map((d) => checkDay(d, config));

  const plannedWeekLoad = dailyChecks.reduce((s, d) => s + d.totalLoad, 0);
  const baselineWeeklyLoad = calcBaselineWeekly(history, config, plannedWeekLoad);
  const rampPct = calcRampPct(plannedWeekLoad, baselineWeeklyLoad);
  const rampSeverity = mapSeverity(rampPct, config);

  return {
    plannedWeekLoad,
    baselineWeeklyLoad,
    rampPct,
    rampSeverity,
    daily: dailyChecks,
  };
}

// =========================
// Baseline and ramp math
// =========================

/** Weekly-equivalent baseline from history. */
export function calcBaselineWeekly(
  history: HistoryInputs,
  config: GuardrailConfig,
  fallbackWeekLoad: number
): number {
  const window = Math.max(7, Math.floor(config.baseline_window_days));

  if (history.actualDailyLoads && history.actualDailyLoads.length > 0) {
    const sorted = [...history.actualDailyLoads].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    // Use the last N days; pad missing days as zero is not necessary if data already includes zeros for rest.
    const lastN = sorted.slice(-window);
    const sum = lastN.reduce((s, x) => s + (Number.isFinite(x.load) ? x.load : 0), 0);
    const dailyAvg = sum / Math.max(1, lastN.length);
    const weeklyEquiv = dailyAvg * 7;
    return round1(weeklyEquiv);
  }

  if (history.previousPlannedWeeks && history.previousPlannedWeeks.length > 0) {
    const lastTwo = history.previousPlannedWeeks.slice(-2);
    const loads = lastTwo.map((w) => sumPlannedLoad(w));
    const avg = loads.reduce((s, x) => s + x, 0) / lastTwo.length;
    return round1(avg);
  }

  // No history at all; fall back to current planned load to avoid divide-by-zero and false alarms.
  return round1(fallbackWeekLoad);
}

export function calcRampPct(planned: number, baseline: number): number {
  if (!Number.isFinite(baseline) || baseline <= 0) return 0;
  const pct = ((planned - baseline) / baseline) * 100;
  return Math.round(pct * 10) / 10; // one decimal place
}

export function mapSeverity(pct: number, config: GuardrailConfig): Severity {
  if (pct < 0.0001) return "none"; // at or below baseline
  if (pct < config.ramp_warn_pct) return "info";
  if (pct < config.ramp_stop_pct) return "warn";
  return "stop";
}

// =========================
// Daily caps and day typing
// =========================

interface DayBucket {
  date: string; // YYYY-MM-DD
  events: WorkoutEvent[];
}

function groupEventsByDate(week: WeekPlan): DayBucket[] {
  const buckets = new Map<string, WorkoutEvent[]>();
  for (const ev of week.events) {
    const d = ev.start_date_local.slice(0, 10);
    buckets.set(d, [...(buckets.get(d) || []), ev]);
  }
  // Ensure all 7 days exist for the week window starting at week.week_start
  const start = new Date(week.week_start + "T00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = toISODate(d);
    if (!buckets.has(iso)) buckets.set(iso, []);
  }
  return [...buckets.entries()]
    .map(([date, events]) => ({ date, events }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function checkDay(bucket: DayBucket, config: GuardrailConfig): DailyCheck {
  const totalLoad = bucket.events.reduce((s, e) => s + safeInt(e.icu_training_load), 0);
  const totalMovingTime = bucket.events.reduce((s, e) => s + (e.moving_time || 0), 0);
  const dayType = inferDayType(bucket.events);

  const breaches: DailyCheck["breaches"] = [];
  let capApplied: number | null = null;

  // Primary cap by day type
  if (dayType === "hard") {
    capApplied = config.daily_caps.hard;
    if (totalLoad > config.daily_caps.hard) breaches.push("hard_cap");
  } else if (dayType === "endurance") {
    capApplied = config.daily_caps.endurance;
    if (totalLoad > config.daily_caps.endurance) breaches.push("endurance_cap");
  } else if (dayType === "recovery") {
    // Use a conservative cap for recovery: the lower of endurance cap and 50
    const recoveryCap = Math.min(config.daily_caps.endurance, 50);
    capApplied = recoveryCap;
    if (totalLoad > recoveryCap) breaches.push("endurance_cap");
  } else {
    capApplied = null; // rest day has no primary cap
  }

  // Long ride cap applies when duration is high regardless of day type
  const isLongRide = totalMovingTime >= LONG_RIDE_TIME_THRESHOLD_SEC || hasLongRideHint(bucket.events);
  if (isLongRide) {
    if (totalLoad > config.daily_caps.long_ride) breaches.push("long_ride_cap");
    capApplied = capApplied === null ? config.daily_caps.long_ride : Math.min(capApplied, config.daily_caps.long_ride);
  }

  const overBy = capApplied === null ? 0 : Math.max(0, totalLoad - capApplied);

  return {
    date: bucket.date,
    totalLoad: round0(totalLoad),
    totalMovingTime,
    dayType,
    capApplied,
    overBy: round0(overBy),
    breaches,
  };
}

export function inferDayType(events: WorkoutEvent[]): DayType {
  if (!events || events.length === 0) return "rest";

  let maxScore = -1;
  let chosen: DayType = "endurance";

  for (const e of events) {
    const s = scoreEventHardness(e);
    if (s > maxScore) {
      maxScore = s;
      chosen = hardnessToDayType(s);
    }
  }

  return chosen;
}

function scoreEventHardness(e: WorkoutEvent): number {
  const desc = (e.description || "").toLowerCase();
  const type = e.type;
  const load = safeInt(e.icu_training_load);

  // Strong hard signals
  const hardHints = [
    "vo2", "vo₂", "anaerobic", "race", "crit", "over-under", "over under", "o/u",
    "threshold", "sweet spot", "ss", "climb repeats", "sprint", "attacks",
    "@ 1.0", "@1.0", "% of ftp", "120%", "110%", "105%",
  ];
  if (hardHints.some((h) => desc.includes(h))) return 3;

  // Moderate hard via load or workout type
  if (type === "Workout" && load >= 70) return 3;
  if (load >= 100) return 3; // heavy day by load alone

  // Endurance signals
  const enduHints = ["endurance", "z2", "zone 2", "aerobic", "base", "tempo", "grp ride", "group ride"];
  if (enduHints.some((h) => desc.includes(h))) return 2;

  // Recovery signals
  const recHints = ["recovery", "z1", "easy", "spin"];
  if (recHints.some((h) => desc.includes(h))) return 1;

  // Fallback by activity type
  if (type === "Ride" || type === "Gravel Ride" || type === "Virtual Ride") return 2; // endurance default
  if (type === "Workout") return 3; // workouts skew hard

  return 2; // general default to endurance
}

function hardnessToDayType(score: number): DayType {
  if (score >= 3) return "hard";
  if (score === 2) return "endurance";
  if (score === 1) return "recovery";
  return "endurance";
}

function hasLongRideHint(events: WorkoutEvent[]): boolean {
  const desc = events.map((e) => e.description || "").join(" ").toLowerCase();
  return desc.includes("long ride") || desc.includes("lr");
}

// =========================
// Helpers
// =========================

export function sumPlannedLoad(week: WeekPlan): number {
  return week.events.reduce((s, e) => s + safeInt(e.icu_training_load), 0);
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round0(n: number): number {
  return Math.round(n);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function safeInt(n: any): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x);
}

// =========================
// Example usage (pseudo)
// =========================
/*
import { computeGuardrails, DEFAULT_GUARDRAILS } from "./guardrails";

const summary = computeGuardrails(weekPlan, {
  actualDailyLoads: [
    { date: "2025-08-12", load: 75 },
    // ... 27 more items
  ],
  previousPlannedWeeks: [lastWeek, twoWeeksAgo],
}, DEFAULT_GUARDRAILS);

// summary.rampSeverity -> "info"|"warn"|"stop"
// summary.daily -> per-day cap breaches
*/
