import { describe, it, expect } from "vitest";
import { DEFAULT_GUARDRAILS, type WeekPlan, type WorkoutEvent } from "./guardrails";
import { scaleWeekToTarget } from "./scale";

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

function makeWeek(start: string, dailyLoads: Array<{ d: number; load: number; secs?: number; desc?: string; type?: WorkoutEvent["type"] }>): WeekPlan {
  const events: WorkoutEvent[] = [];
  const startDate = new Date(`${start}T00:00`);
  for (const item of dailyLoads) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + item.d);
    const iso = d.toISOString().slice(0, 10);
    events.push(makeEvent(iso, item.load, item.secs ?? 3600, item.desc, item.type));
  }
  return { week_start: start, events };
}

const cfg = { ...DEFAULT_GUARDRAILS };

describe("scaleWeekToTarget", () => {
  it("scales up by target while respecting daily weights and caps", () => {
    // Tue hard 120 (Workout), Thu endurance 80, Sat long endurance 170 (4h)
    const week = makeWeek("2025-07-21", [
      { d: 1, load: 120, secs: 3600, desc: "VO2 5x3' @120%", type: "Workout" },
      { d: 3, load: 80, secs: 5400, desc: "Endurance z2", type: "Ride" },
      { d: 5, load: 170, secs: 4 * 3600, desc: "Endurance long ride", type: "Ride" },
    ]);

    const before = 370;
    const target = 430; // +60
    const res = scaleWeekToTarget(week, cfg, { targetWeeklyLoad: target });

    expect(res.beforeLoad).toBe(before);
    expect(res.requestedTarget).toBe(target);
    expect(res.afterLoad <= target).toBe(true);
    expect(Math.abs(res.afterLoad - target) <= cfg.min_step).toBe(true);
    // long ride endurance cap = 90, so Saturday should not exceed that after scaling
    const sat = res.changes.find((c) => c.date.endsWith("-27"));
    expect(sat!.after <= 90).toBe(true);
  });

  it("does not touch rest days when lockRestDays is true", () => {
    // Only one event on Tue; others are rest
    const week = makeWeek("2025-07-21", [ { d: 1, load: 100, type: "Workout" } ]);
    const res = scaleWeekToTarget(week, cfg, { scalePct: 150, lockRestDays: true });

    // Still only one day in changes
    expect(res.changes.length).toBe(1);
    expect(res.changes[0].before).toBe(100);
    expect(res.changes[0].after >= 100).toBe(true);
  });

  it("produces residual when caps prevent hitting target", () => {
    // One endurance day at 85 with cap 90; target asks for +50 but only +5 is possible
    const week = makeWeek("2025-07-21", [ { d: 2, load: 85, type: "Ride", desc: "Endurance z2" } ]);
    const res = scaleWeekToTarget(week, cfg, { targetWeeklyLoad: 135 });

    expect(res.beforeLoad).toBe(85);
    expect(res.afterLoad).toBeLessThan(135);
    expect(res.residual).toBeGreaterThan(0);
    const day = res.changes[0];
    expect(day.after).toBeLessThanOrEqual(90); // endurance cap
  });
});
