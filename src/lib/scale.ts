// What‑If Auto‑Scale module
// Pure functions to scale a WeekPlan's planned loads toward a target while respecting guardrails

import type {
  WeekPlan,
  WorkoutEvent,
  GuardrailConfig,
  DayType,
} from "./guardrails";
import { inferDayType } from "./guardrails";

export interface ScaleOptions {
  targetWeeklyLoad?: number; // absolute weekly target
  scalePct?: number; // percentage, e.g., 110 for +10%
  lockRestDays?: boolean; // default true
  respectCaps?: boolean; // default true
}

export interface DayChange {
  date: string;
  before: number; // total day load before
  after: number; // total day load after
  appliedDelta: number; // after - before
  capApplied: number | null; // cap used for clamping decision
}

export interface ScaleResult {
  beforeLoad: number;
  afterLoad: number;
  requestedTarget: number;
  residual: number; // requestedTarget - afterLoad
  changes: DayChange[];
  week: WeekPlan; // updated week
}

const LONG_RIDE_TIME_THRESHOLD_SEC = 3 * 3600; // keep consistent with guardrails

// =========================
// Public API
// =========================

export function scaleWeekToTarget(
  week: WeekPlan,
  config: GuardrailConfig,
  opts: ScaleOptions
): ScaleResult {
  const options = withDefaults(opts);
  const buckets = groupByDate(week);

  const dayInfos = buckets.map((b) => analyzeDay(b, config, options));
  const beforeLoad = dayInfos.reduce((s, d) => s + d.totalLoad, 0);

  const requestedTarget = resolveTarget(beforeLoad, options);
  const delta = requestedTarget - beforeLoad;

  if (Math.abs(delta) < config.min_step) {
    return finalize(week, dayInfos, beforeLoad, beforeLoad, requestedTarget);
  }

  // Compute weights and distribute delta
  const weighted = dayInfos.map((d) => ({ ...d, weight: dayWeight(d.dayType, options) }));
  const sumW = weighted.reduce((s, d) => s + d.weight, 0);

  if (sumW <= 0) {
    // nothing to scale (all rest days locked)
    return finalize(week, dayInfos, beforeLoad, beforeLoad, requestedTarget);
  }

  // First pass: propose allocations by weight
  const proposed = weighted.map((d) => ({
    ...d,
    desiredDelta: roundStep((delta * (d.weight / sumW)) || 0, config.min_step),
  }));

  // Second pass: clamp by caps if needed and compute per-event deltas
  const applied = proposed.map((d) => applyDayDelta(d, config, options));

  // Build updated events and compute afterLoad
  const updatedEvents: WorkoutEvent[] = [];
  const changes: DayChange[] = [];

  for (const d of applied) {
    updatedEvents.push(...d.updatedEvents);
    changes.push({
      date: d.date,
      before: d.totalLoad,
      after: d.newTotal,
      appliedDelta: d.newTotal - d.totalLoad,
      capApplied: d.capApplied,
    });
  }

  const afterLoad = changes.reduce((s, c) => s + c.after, 0);
  const residual = requestedTarget - afterLoad;

  const updatedWeek: WeekPlan = { week_start: week.week_start, events: updatedEvents };
  return {
    beforeLoad,
    afterLoad,
    requestedTarget,
    residual,
    changes,
    week: updatedWeek,
  };
}

// =========================
// Internals
// =========================

function withDefaults(opts: ScaleOptions): Required<ScaleOptions> {
  return {
    targetWeeklyLoad: opts.targetWeeklyLoad ?? 0,
    scalePct: opts.scalePct ?? 0,
    lockRestDays: opts.lockRestDays ?? true,
    respectCaps: opts.respectCaps ?? true,
  };
}

function resolveTarget(beforeLoad: number, opts: Required<ScaleOptions>): number {
  if (opts.targetWeeklyLoad && opts.targetWeeklyLoad > 0) return round0(opts.targetWeeklyLoad);
  if (opts.scalePct && opts.scalePct > 0) return round0(beforeLoad * (opts.scalePct / 100));
  return beforeLoad; // no-op
}

interface DayBucket { date: string; events: WorkoutEvent[] }

function groupByDate(week: WeekPlan): DayBucket[] {
  const map = new Map<string, WorkoutEvent[]>();
  for (const e of week.events) {
    const d = e.start_date_local.slice(0, 10);
    map.set(d, [...(map.get(d) || []), e]);
  }
  // keep only days present in the plan; scaling does not add new days
  return [...map.entries()].map(([date, events]) => ({ date, events })).sort((a, b) => a.date.localeCompare(b.date));
}

interface DayInfo {
  date: string;
  events: WorkoutEvent[];
  totalLoad: number;
  totalMovingTime: number;
  dayType: DayType;
  capApplied: number | null;
  weight: number; // set later
}

function analyzeDay(bucket: DayBucket, config: GuardrailConfig, opts: Required<ScaleOptions>): DayInfo {
  const totalLoad = bucket.events.reduce((s, e) => s + toInt(e.icu_training_load), 0);
  const totalMovingTime = bucket.events.reduce((s, e) => s + (e.moving_time || 0), 0);
  const dayType = inferDayType(bucket.events);

  let capApplied: number | null = null;
  if (opts.respectCaps) {
    // primary cap by day type
    if (dayType === "hard") capApplied = config.daily_caps.hard;
    else if (dayType === "endurance") capApplied = config.daily_caps.endurance;
    else if (dayType === "recovery") capApplied = Math.min(config.daily_caps.endurance, 50);

    // long ride cap
    const isLongRide = totalMovingTime >= LONG_RIDE_TIME_THRESHOLD_SEC || hasLongRideHint(bucket.events);
    if (isLongRide) capApplied = capApplied === null ? config.daily_caps.long_ride : Math.min(capApplied, config.daily_caps.long_ride);
  }

  return { date: bucket.date, events: bucket.events, totalLoad, totalMovingTime, dayType, capApplied, weight: 0 };
}

function dayWeight(type: DayType, opts: Required<ScaleOptions>): number {
  if (type === "rest" && opts.lockRestDays) return 0;
  switch (type) {
    case "hard": return 1.0;
    case "endurance": return 0.6;
    case "recovery": return 0.2;
    case "rest": return 0.0;
  }
}

function applyDayDelta(d: DayInfo & { desiredDelta: number }, config: GuardrailConfig, opts: Required<ScaleOptions>) {
  let targetTotal = d.totalLoad + d.desiredDelta;
  if (opts.respectCaps && d.capApplied != null) {
    // clamp within [0, cap]
    targetTotal = Math.min(Math.max(0, targetTotal), d.capApplied);
  }
  targetTotal = roundStep(targetTotal, config.min_step);
  const appliedDelta = targetTotal - d.totalLoad;

  const updatedEvents = distributeDeltaAcrossEvents(d.events, appliedDelta, config.min_step);
  const newTotal = updatedEvents.reduce((s, e) => s + toInt(e.icu_training_load), 0);

  return { ...d, updatedEvents, newTotal };
}

function distributeDeltaAcrossEvents(events: WorkoutEvent[], totalDelta: number, step: number): WorkoutEvent[] {
  if (events.length === 0 || totalDelta === 0) return events.map(cloneEvent);
  if (events.length === 1) {
    const e = cloneEvent(events[0]);
    e.icu_training_load = toInt(e.icu_training_load + totalDelta);
    if (e.icu_training_load < 0) e.icu_training_load = 0;
    return [e];
  }

  const loads = events.map((e) => Math.max(0, toInt(e.icu_training_load)));
  const sum = loads.reduce((s, x) => s + x, 0);

  // If sum is 0 (edge case), spread evenly
  const weights = sum > 0 ? loads.map((x) => x / sum) : events.map(() => 1 / events.length);

  const raw = weights.map((w) => totalDelta * w);
  const stepped = raw.map((r) => roundStep(r, step));

  // Adjust rounding drift
  let drift = totalDelta - stepped.reduce((s, x) => s + x, 0);
  const updated = events.map(cloneEvent);

  // Apply stepped deltas
  for (let i = 0; i < updated.length; i++) {
    updated[i].icu_training_load = toInt(updated[i].icu_training_load + stepped[i]);
    if (updated[i].icu_training_load < 0) updated[i].icu_training_load = 0;
  }

  // Nudge the largest-load event(s) to absorb any remaining drift by 1-step increments
  while (drift !== 0) {
    const idx = indexOfMaxLoad(updated);
    const inc = Math.sign(drift) * Math.min(Math.abs(drift), step);
    updated[idx].icu_training_load = toInt(updated[idx].icu_training_load + inc);
    if (updated[idx].icu_training_load < 0) updated[idx].icu_training_load = 0;
    drift -= inc;
  }

  return updated;
}

function indexOfMaxLoad(events: WorkoutEvent[]): number {
  let max = -Infinity;
  let idx = 0;
  for (let i = 0; i < events.length; i++) {
    const v = toInt(events[i].icu_training_load);
    if (v > max) { max = v; idx = i; }
  }
  return idx;
}

function hasLongRideHint(events: WorkoutEvent[]): boolean {
  const desc = events.map((e) => e.description || "").join(" ").toLowerCase();
  return desc.includes("long ride") || desc.includes(" lr ") || desc.includes(" lr:") || desc.includes("endurance long ride");
}

function cloneEvent(e: WorkoutEvent): WorkoutEvent {
  return { ...e, icu_training_load: toInt(e.icu_training_load) };
}

function roundStep(n: number, step: number): number {
  if (step <= 1) return Math.round(n);
  return Math.round(n / step) * step;
}

function round0(n: number): number { return Math.round(n); }
function toInt(n: any): number { const x = Number(n); return Number.isFinite(x) ? Math.round(x) : 0; }
