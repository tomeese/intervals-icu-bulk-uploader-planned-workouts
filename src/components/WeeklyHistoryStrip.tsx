import React, { useMemo } from "react";

type SeriesPoint = { date: string; atl: number; ctl: number; tsb: number; ramp: number };
type Weekly = {
  key: string;        // e.g. "2025-W37"
  weekNum: number;    // 37
  startISO: string;   // 2025-08-18 (Mon)
  endISO: string;     // 2025-08-24 (Sun)
  fitness: number;    // CTL on Sun
  fatigue: number;    // ATL on Sun
  form: number;       // TSB on Sun
  load?: number | null; // optional (needs fetcher to provide)
  ramp: number;       // fitness delta vs prev week
};

export default function WeeklyHistoryStrip({
  series,
  maxWeeks = 4,
}: {
  series: SeriesPoint[];
  maxWeeks?: number;
}) {
  const weeks = useMemo(() => buildWeekly(series, maxWeeks), [series, maxWeeks]);
  if (!weeks.length) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-500 bg-white dark:bg-slate-900">
        No weekly metrics yet.
      </div>
    );
  }

  // For the tiny relative bar, normalize load among available values (if provided)
  const loads = weeks.map(w => w.load ?? 0);
  const maxLoad = Math.max(1, ...loads);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-base font-semibold">Recent Weeks</h3>
        <div className="text-xs text-slate-500">Mon–Sun (ISO weeks)</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {weeks.map(w => (
          <div key={w.key} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <div className="text-xs text-slate-500 mb-1">
              <span className="font-medium">W{w.weekNum}</span> • {fmtRange(w.startISO, w.endISO)}
            </div>

            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-slate-500">Load</div>
              <div className="text-lg font-semibold tabular-nums">
                {w.load ?? "—"}
              </div>
            </div>
            <div className="h-1.5 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden mb-2">
              <div
                className="h-full rounded bg-slate-400 dark:bg-slate-500"
                style={{ width: `${Math.min(100, Math.round(((w.load ?? 0) / maxLoad) * 100))}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <KV label="Fitness" value={w.fitness} />
              <KV label="Fatigue" value={w.fatigue} />
              <Chip label="Form" value={w.form} tone={formTone(w.form)} />
              <Chip label="Ramp" value={w.ramp} tone={rampTone(w.ramp)} prefix={w.ramp > 0 ? "▲ " : w.ramp < 0 ? "▼ " : ""} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function buildWeekly(series: SeriesPoint[], n: number): Weekly[] {
  if (!series?.length) return [];
  // Sort by date asc
  const pts = [...series].sort((a, b) => a.date.localeCompare(b.date));

  // Group by ISO week (Mon–Sun)
  const map = new Map<string, { dates: string[]; end: SeriesPoint }>();
  for (const p of pts) {
    const d = toDate(p.date);
    const { year, week, startISO, endISO } = isoWeekInfo(d);
    const key = `${year}-W${String(week).padStart(2, "0")}`;
    const bucket = map.get(key) || { dates: [], end: p };
    bucket.dates.push(p.date);
    // choose the last point in the week as "end"
    if (p.date > bucket.end.date) bucket.end = p;
    map.set(key, bucket);
    // stash start/end on the object for later (hack via symbol) — or recompute
    (bucket as any)._startISO = startISO;
    (bucket as any)._endISO = endISO;
    (bucket as any)._weekNum = week;
    (bucket as any)._year = year;
  }

  // Turn into array, sorted by week end
  const weeks = Array.from(map.entries())
    .map(([key, b]) => {
      const end = b.end;
      return {
        key,
        weekNum: (b as any)._weekNum as number,
        startISO: (b as any)._startISO as string,
        endISO: (b as any)._endISO as string,
        fitness: end.ctl,
        fatigue: end.atl,
        form: end.tsb,
        load: null as number | null, // TODO: wire when fetcher includes weekly_load
        ramp: 0, // temp; fill below
      } as Weekly;
    })
    .sort((a, b) => a.endISO.localeCompare(b.endISO));

  // Compute ramp = delta Fitness vs previous week
  for (let i = 0; i < weeks.length; i++) {
    weeks[i].ramp = i === 0 ? 0 : round1(weeks[i].fitness - weeks[i - 1].fitness);
  }

  // last n complete weeks (exclude current partial if the last endISO is in the future—rare in static data)
  const lastN = weeks.slice(-n);
  return lastN;
}

function toDate(iso: string) {
  // Treat as local date to keep week grouping stable with your UI
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function isoWeekInfo(d: Date) {
  // Clone
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // ISO: Thu is in week
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date as any) - (yearStart as any)) / 86400000 + 1) / 7);
  const year = date.getUTCFullYear();

  // Get Monday of that week
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const startISO = fmtISO(monday);
  const endISO = fmtISO(sunday);
  return { year, week, startISO, endISO };
}

function fmtISO(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function fmtRange(a: string, b: string) {
  const A = toDate(a), B = toDate(b);
  const mA = A.toLocaleString(undefined, { month: "short" });
  const mB = B.toLocaleString(undefined, { month: "short" });
  return `${mA} ${A.getDate()}–${mB} ${B.getDate()}`;
}

function KV({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-200 dark:border-slate-800 px-2 py-1.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Chip({
  label,
  value,
  tone,
  prefix = "",
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "bad";
  prefix?: string;
}) {
  const toneCls =
    tone === "ok"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "warn"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-rose-50 text-rose-700 border-rose-200";
  return (
    <div className={`rounded border px-2 py-1.5 ${toneCls}`}>
      <div className="text-[11px]">{label}</div>
      <div className="font-semibold tabular-nums">{prefix}{value}</div>
    </div>
  );
}

function formTone(tsb: number): "ok" | "warn" | "bad" {
  if (tsb <= -20 || tsb >= 16) return "bad";
  if (tsb <= -10 || tsb >= 6) return "warn";
  return "ok";
}
function rampTone(delta: number): "ok" | "warn" | "bad" {
  const a = Math.abs(delta);
  if (a > 10) return "bad";
  if (a > 5) return "warn";
  return "ok";
}
function round1(x: number) {
  return Math.round(x * 10) / 10;
}
