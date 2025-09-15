// src/lib/intervals.ts
import type { WeekPlan } from "./schema";

type UploadOpts = {
  apiKey: string;
  athleteId?: number;      // 0 or undefined => use "me"
  defaultStart: string;    // "HH:MM"
  tz: string;              // IANA TZ
};

const API_BASE = "https://intervals.icu";

export async function uploadPlannedWeek(plan: WeekPlan, opts: UploadOpts) {
  const { apiKey, athleteId, defaultStart, tz } = opts;

  // 0 or undefined -> use the API-key’s athlete
  const idSeg = (athleteId === 0 || athleteId == null) ? "me" : String(athleteId);
  const url = `${API_BASE}/api/v1/athlete/${idSeg}/planned`;

  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const e of plan.events) {
    // Ensure start_date_local has a time (use defaultStart if missing)
    const hasTime = e.start_date_local.length > 10;
    const startLocal = hasTime
      ? e.start_date_local
      : `${e.start_date_local}T${defaultStart}`;

    const payload = {
      start_date_local: startLocal,
      type: e.type,
      category: e.category,
      moving_time: e.moving_time,
      icu_training_load: e.icu_training_load,
      description: e.description ?? "",
      timezone: tz,
    };

    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
      if (res.ok) {
        created += 1;
      } else {
        // treat 409/422 as skipped; collect others as errors
        if (res.status === 409 || res.status === 422) {
          skipped += 1;
        } else {
          const txt = await res.text().catch(() => "");
          errors.push(`POST ${res.status} ${url} :: ${txt || "unknown error"}`);
        }
      }
    } catch (err: any) {
      errors.push(`POST error :: ${err?.message || String(err)}`);
    }
  }

  return { created, skipped, errors };
}
