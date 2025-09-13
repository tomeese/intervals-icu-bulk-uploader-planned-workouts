// src/components/HistoryPanel.tsx
import React, { useEffect, useMemo, useState } from "react";

type Point = { date: string; atl: number; ctl: number; tsb: number; ramp: number };
type Metrics = { athlete_id: number; generated_at: string; series: Point[] };

export default function HistoryPanel() {
  const [data, setData] = useState<Metrics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}data/metrics-latest.json`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(`${r.status}`)))
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  const last3w = useMemo(() => {
    if (!data) return null;
    const series = data.series.slice(-21); // last 3 weeks
    if (series.length === 0) return { ctl: 0, atl: 0, tsb: 0, ramp: 0 };
    const avg = (k: keyof Point) =>
      Math.round(
        (series.reduce((s, p) => s + (p[k] as number), 0) / series.length) * 10,
      ) / 10;
    return { ctl: avg("ctl"), atl: avg("atl"), tsb: avg("tsb"), ramp: avg("ramp") };
  }, [data]);

  if (err) {
    return (
      <div className="text-sm text-amber-700">
        No metrics yet. Run <b>Fetch training metrics</b> workflow.
      </div>
    );
  }
  if (!data || !last3w) return <div className="text-sm text-slate-500">Loading history…</div>;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card label="Avg CTL (3w)" value={last3w.ctl} />
      <Card label="Avg ATL (3w)" value={last3w.atl} />
      <Card label="Avg TSB (3w)" value={last3w.tsb} />
      <Card label="Avg Ramp (3w)" value={`${last3w.ramp}%`} />
    </div>
  );
}

function Card({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
