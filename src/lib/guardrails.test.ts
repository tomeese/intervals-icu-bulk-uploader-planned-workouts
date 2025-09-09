import { describe, it, expect } from "vitest";
import {
  DEFAULT_GUARDRAILS,
  computeGuardrails,
  calcBaselineWeekly,
  calcRampPct,
  mapSeverity,
  checkDay,
  inferDayType,
  sumPlannedLoad,
  type WeekPlan,
  type WorkoutEvent,
  type GuardrailConfig,
} from "./guardrails";

// ---------- Helpers ----------
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
    description: desc,
  };
}

function makeWeek(start: string, dailyLoads: number[]): WeekPlan {
  const events: WorkoutEvent[] = [];
  const startDate = new Date(`${start}T00:00`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const load = dailyLoads[i] ?? 0;
    if (load > 0) events.push(makeEvent(iso, load));
  }
  return { week_start: start, events };
}

const cfg: GuardrailConfig = { ...DEFAULT_GUARDRAILS };

// ---------- Tests ----------

describe("calcBaselineWeekly", () => {
  it("uses last N actual daily loads and scales to weekly", () => {
    // 28 days of 80 load => daily avg 80 => weekly equiv 560
    const actualDailyLoads = Array.from({ length: 28 }, (_, i) => ({
      date: new Date(2025, 6, 1 + i).toISOString().slice(0, 10),
      load: 80,
    }));
    const baseline = calcBaselineWeekly({ actualDailyLoads }, cfg, 123);
    expect(baseline).toBe(560);
  });

  it("falls back to avg of last two planned weeks when no actuals", () => {
    const w1 = makeWeek("2025-07-07", [50, 80, 0, 100, 120, 150, 0]); // sum 500
    const w2 = makeWeek("2025-07-14", [60, 90, 0, 110, 130, 180, 30]); // sum 600
    const baseline = calcBaselineWeekly({ previousPlannedWeeks: [w1, w2] }, cfg, 999);
    expect(baseline).toBe(550);
  });

  it("falls back to current planned load if no history at all", () => {
    const fallback = 432;
    const baseline = calcBaselineWeekly({}, cfg, fallback);
    expect(baseline).toBe(fallback);
  });
});

describe("calcRampPct + mapSeverity", () => {
  it("returns 0 when baseline <= 0", () => {
    expect(calcRampPct(500, 0)).toBe(0);
    expect(calcRampPct(500, -1)).toBe(0);
  });

  it("rounds to one decimal", () => {
    const pct = calcRampPct(112, 100); // 12%
    expect(pct).toBe(12);
  });

  it("maps to severities using defaults", () => {
    expect(mapSeverity(0.0, cfg)).toBe("none");
    expect(mapSeverity(3, cfg)).toBe("info");
    expect(mapSeverity(9, cfg)).toBe("warn");
    expect(mapSeverity(20, cfg)).toBe("stop");
  });
});

describe("checkDay caps and typing", () => {
  it("flags hard day cap breach at 150 vs hard cap 140", () => {
    const date = "2025-07-21";
    const bucket = { date, events: [makeEvent(date, 150, 3600, "VO2 5x3' @120%", "Workout")] } as any;
    const day = checkDay(bucket, cfg);
    expect(day.dayType).toBe("hard");
    expect(day.capApplied).toBe(cfg.daily_caps.hard);
    expect(day.overBy).toBe(10);
    expect(day.breaches).toContain("hard_cap");
  });

  it("applies endurance cap and long-ride cap (min wins) and reports both breaches", () => {
    const date = "2025-07-22";
    // 4h ride with load 200; endurance type by default; long ride threshold 3h crossed
    const bucket = { date, events: [makeEvent(date, 200, 4 * 3600, "Endurance long ride")] } as any;
    const day = checkDay(bucket, cfg);
    expect(day.dayType).toBe("endurance");
    // primary endurance cap = 90, long-ride cap = 180 => capApplied = min(90, 180) = 90
    expect(day.capApplied).toBe(90);
    expect(day.breaches).toContain("endurance_cap");
    expect(day.breaches).toContain("long_ride_cap");
    expect(day.overBy).toBe(110);
  });

  it("uses conservative recovery cap (<=50)", () => {
    const date = "2025-07-23";
    const bucket = { date, events: [makeEvent(date, 60, 1800, "Recovery spin z1")]} as any;
    const day = checkDay(bucket, cfg);
    expect(day.dayType).toBe("recovery");
    expect(day.capApplied).toBeLessThanOrEqual(50);
    expect(day.overBy).toBeGreaterThan(0);
  });
});

describe("inferDayType", () => {
  it("returns rest when no events", () => {
    expect(inferDayType([])).toBe("rest");
  });
  it("classifies workout with threshold hint as hard", () => {
    const e = makeEvent("2025-07-24", 85, 2700, "Threshold 3x10' @ 100%", "Workout");
    expect(inferDayType([e])).toBe("hard");
  });
  it("defaults ride to endurance", () => {
    const e = makeEvent("2025-07-25", 60, 5400, "Endurance" , "Ride");
    expect(inferDayType([e])).toBe("endurance");
  });
});

describe("sumPlannedLoad + computeGuardrails integration", () => {
  it("computes week totals, baseline, ramp, and daily checks", () => {
    const week = makeWeek("2025-07-21", [0, 150, 60, 0, 100, 120, 0]); // sum 430
    const prev1 = makeWeek("2025-07-07", [50, 80, 0, 100, 120, 150, 0]); // 500
    const prev2 = makeWeek("2025-07-14", [60, 90, 0, 110, 130, 180, 30]); // 600

    const summary = computeGuardrails(week, { previousPlannedWeeks: [prev1, prev2] }, cfg);
    expect(sumPlannedLoad(week)).toBe(430);
    expect(summary.plannedWeekLoad).toBe(430);
    expect(summary.baselineWeeklyLoad).toBe(550);
    expect(summary.rampPct).toBeCloseTo(-21.8, 1);
    expect(summary.rampSeverity).toBe("none"); // at/below baseline
    expect(summary.daily).toHaveLength(7);
  });
});
