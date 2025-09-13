// src/lib/intervals.ts
// Browser-side uploader for Intervals.icu planned workouts

import type { WeekPlan, PlanEvent } from "./schema";

export type UploadOpts = {
  apiKey: string;
  athleteId: number;
  defaultStart: string; // "HH:MM"
  tz: string;           // e.g., "America/Los_Angeles"
};

function nameFor(e: PlanEvent) {
  const desc = (e.description || "").trim();
  if (desc) return desc.slice(0, 120);
  if (e.type === "Workout") return "Workout";
  const mins = Math.round(e.moving_time / 60);
  return `Ride ${e.icu_training_load} / ${mins}m`;
}

/**
 * Uploads each event in a week as a planned workout.
 * Returns counts and any error strings (non-fatal 409s are counted as "skipped").
 */
export async function uploadPlannedWeek(plan: WeekPlan, opts: UploadOpts) {
  const endpoint = `https://intervals.icu/api/v1/athlete/${opts.athleteId}/planned`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${opts.apiKey}`,
  };

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const e of plan.events) {
    const startLocal =
      e.start_date_local ||
      `${e.external_id.slice(0, 10)}T${opts.defaultStart}`;

    const body = {
      name: nameFor(e),
      start_date_local: startLocal,
      type: e.type,
      category: e.category,
      moving_time: e.moving_time,
      icu_training_load: e.icu_training_load,
      description: e.description ?? "",
      external_id: e.external_id,
      tz: opts.tz,
    };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (res.ok) {
        created++;
        continue;
      }

      const text = await res.text().catch(() => "");
      if (res.status === 409 || /already exists/i.test(text)) {
        skipped++;
        continue;
      }
      errors.push(`POST ${res.status}: ${text.slice(0, 200)}`);
    } catch (err: any) {
      errors.push(String(err));
    }
  }

  return { created, skipped, errors };
}
