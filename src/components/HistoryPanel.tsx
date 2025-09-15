/* src/components/HistoryPanel.tsx */

import React, { useEffect, useMemo, useState } from "react";


type DayRow = {
  date: string;        // YYYY-MM-DD
  ctl: number | null;  // Fitness
  atl: number | null;  // Fatigue
  tsb: number | null;  // Form (ctl - atl)
  ramp: number | null; // daily rampRate (not used for weekly calc)
  load: number | null; // sum of icu_training_load for that day
};

type MetricsFile = {
  athlete_id: number;
  generated_at: string;
  series: DayRow[];
};

type WeekSummary = {
  weekStart: string;    // Monday
  weekEnd: string;      // Sunday
  week: number;         // ISO week number
  fitness: number | null;  // CTL on Sunday
  fatigue: number | null;  // ATL on Sunday
  form: number | null;     // fitness - fatigue (Sunday)
  ramp: number | null;     // ΔCTL vs prior week (Sunday CTL)
  load: number;            // Σ daily loads in the week
};

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(d.getDate() + n);
  return x;
}
function mondayOnOrBefore(d: Date): Date {
  // JS: Sun=0..Sat=6. We want Monday=0 offset.
  const day = d.getDay();          // 0..6
  const offset = (day + 6) % 7;    // Sun->6, Mon->0, Tue->1, ...
  const m = new Date(d);
  m.setDate(d.getDate() - offset);
  return m;
}
function isoWeekNumber(d: Date): number {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp as any) - (yearStart as any)) / 86400000 + 1) / 7);
}

export default function HistoryPanel() {
  const [data, setData] = useState<MetricsFile | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(import.meta.env.BASE_URL + "data/metrics-latest.json", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : Promise.reject(`${r.status} ${r.statusText}`)))
      .then((j: MetricsFile) => setData(j))
      .catch(e => setErr(String(e)));
  }, []);

  const weeks: WeekSummary[] | null = useMemo(() => {
    if (!data?.series?.length) return null;

    // Index daily data by date
    const byDate = new Map<string, DayRow>();
    for (const row of data.series) byDate.set(row.date, row);

    // Last completed week is the Monday..Sunday block *ending last Sunday*
    const today = new Date();
    const thisMonday = mondayOnOrBefore(today);
    const lastSunday = addDays(thisMonday, -1);
    const lastMonday = addDays(lastSunday, -6);

    // Build ranges for the last 4 completed weeks (oldest -> newest)
    const ranges: Array<{ start: Date; end: Date }> = [];
    let end = lastSunday;
    for (let i = 0; i < 4; i++) {
      const start = addDays(end, -6);
      ranges.push({ start, end });
      end = addDays(start, -1);
    }
    ranges.reverse();

    const out: WeekSummary[] = ranges.map(({ start, end }) => {
      // Sum daily load across the week
      let load = 0;
      for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
        const k = fmt(d);
        const r = byDate.get(k);
        if (r?.load) load += r.load;
      }

      // Fitness/Fatigue/Form taken from Sunday (end of week)
      const sunKey = fmt(end);
      const rSun = byDate.get(sunKey);
      const fitness = rSun?.ctl ?? null;
      const fatigue = rSun?.atl ?? null;
      const form =
        fitness != null && fatigue != null ? Number((fitness - fatigue).toFixed(1)) : null;

      return {
        weekStart: fmt(start),
        weekEnd: fmt(end),
        week: isoWeekNumber(end),
        fitness,
        fatigue,
        form,
        ramp: null, // fill below
        load: Math.round(load),
      };
    });

    // Weekly ramp = ΔCTL (Sunday CTL) vs previous week
    for (let i = 1; i < out.length; i++) {
      const prev = out[i - 1].fitness;
      const cur = out[i].fitness;
      out[i].ramp =
        prev != null && cur != null ? Number((cur - prev).toFixed(1)) : null;
    }
    out[0].ramp = null;

    return out;
  }, [data]);

  if (err) {
    return <div className="text-sm text-red-600">Metrics error: {err}</div>;
  }
  if (!weeks) {
    return (
      <div className="text-sm text-slate-500">
        No metrics yet. Run <b>Fetch training metrics</b> workflow.
      </div>
    );
  }

  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Training metrics (last 4 weeks)</h3>
        <a
          className="text-xs underline text-slate-500 hover:text-slate-700"
          href={`${import.meta.env.BASE_URL}data/metrics-latest.json`}
          target="_blank"
          rel="noreferrer"
        >
          raw JSON
        </a>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-[640px] w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-3">Week</th>
              <th className="py-1 pr-3">Dates</th>
              <th className="py-1 pr-3">Fitness</th>
              <th className="py-1 pr-3">Form</th>
              <th className="py-1 pr-3">Fatigue</th>
              <th className="py-1 pr-3">Ramp</th>
              <th className="py-1 pr-3">Load</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w, i) => (
              <tr key={i} className="border-t border-slate-200 dark:border-slate-800">
                <td className="py-1 pr-3 font-medium">#{w.week}</td>
                <td className="py-1 pr-3">{w.weekStart} → {w.weekEnd}</td>
                <td className="py-1 pr-3">{w.fitness ?? "—"}</td>
                <td className="py-1 pr-3">{w.form ?? "—"}</td>
                <td className="py-1 pr-3">{w.fatigue ?? "—"}</td>
                <td className="py-1 pr-3">{w.ramp ?? "—"}</td>
                <td className="py-1 pr-3">{Number.isFinite(w.load) ? w.load : "—"}</td>
              </tr>
            )).reverse() /* show most recent last; remove .reverse() if you want newest first */}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        Fitness/Fatigue/Form are CTL/ATL/CTL−ATL on Sunday. Ramp is the change
        in Fitness from the previous week’s Sunday. Load is the sum of activity
        <code className="mx-1">icu_training_load</code> for the week.
      </p>
    </section>
  );
}
