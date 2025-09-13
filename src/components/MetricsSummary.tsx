// src/components/MetricsSummary.tsx
import React, { useEffect, useMemo, useState } from "react";

type SeriesPoint = { date: string; atl: number; ctl: number; tsb: number; ramp: number };
type MetricsFile = { athlete_id: number; generated_at: string; series: SeriesPoint[] };

export default function MetricsSummary() {
  const [data, setData] = useState<MetricsFile | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const url = useMemo(() => {
    // Prefer explicit override in dev if you want to read the already-deployed file
    const override = import.meta.env.VITE_METRICS_URL as string | undefined;
    if (override) return `${override}?bust=${Date.now()}`;

    // Default: use the built-in Vite public path
    const base = import.meta.env.BASE_URL ?? "/";
    return `${base}data/metrics-latest.json?bust=${Date.now()}`;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
        const j: unknown = await r.json();

        // Minimal shape check
        const ok =
          typeof (j as any)?.athlete_id === "number" &&
          Array.isArray((j as any)?.series);

        if (!ok) throw new Error("Unexpected JSON shape for metrics file");

        setData(j as MetricsFile);
      } catch (e: any) {
        console.error("[metrics] fetch error:", e);
        setErr(e.message ?? String(e));
      }
    })();
  }, [url]);

  if (err) {
    return (
      <div className="text-sm rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800">
        Couldn’t load metrics: <span className="font-mono">{err}</span>
      </div>
    );
  }

  if (!data || !data.series?.length) {
    return (
      <div className="text-sm text-slate-500">
        No metrics yet. Run <b>Fetch training metrics</b> workflow.
      </div>
    );
  }

  const latest = data.series[data.series.length - 1];
  const last7 = data.series.slice(-7);
  const last14 = data.series.slice(-14);
  const last21 = data.series.slice(-21);

  const avg = (arr: SeriesPoint[], k: keyof SeriesPoint) =>
    Math.round((arr.reduce((s, p) => s + (p[k] as number), 0) / (arr.length || 1)) * 10) / 10;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold">Recent Training Metrics</h3>
        <div className="text-xs text-slate-500">as of {latest.date}</div>
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Metric label="CTL (latest)" value={latest.ctl} />
        <Metric label="ATL (latest)" value={latest.atl} />
        <Metric label="TSB (latest)" value={latest.tsb} />
        <Metric label="Ramp (latest %)" value={latest.ramp} />
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <Group heading="7-day avg">
          <Mini label="CTL" v={avg(last7, "ctl")} />
          <Mini label="ATL" v={avg(last7, "atl")} />
          <Mini label="TSB" v={avg(last7, "tsb")} />
          <Mini label="Ramp" v={avg(last7, "ramp")} suffix="%" />
        </Group>
        <Group heading="14-day avg">
          <Mini label="CTL" v={avg(last14, "ctl")} />
          <Mini label="ATL" v={avg(last14, "atl")} />
          <Mini label="TSB" v={avg(last14, "tsb")} />
          <Mini label="Ramp" v={avg(last14, "ramp")} suffix="%" />
        </Group>
        <Group heading="21-day avg">
          <Mini label="CTL" v={avg(last21, "ctl")} />
          <Mini label="ATL" v={avg(last21, "atl")} />
          <Mini label="TSB" v={avg(last21, "tsb")} />
          <Mini label="Ramp" v={avg(last21, "ramp")} suffix="%" />
        </Group>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
      <div className="text-slate-500 text-xs">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
      <div className="text-slate-500 text-xs mb-2">{heading}</div>
      <div className="grid grid-cols-4 gap-2">{children}</div>
    </div>
  );
}

function Mini({ label, v, suffix = "" }: { label: string; v: number; suffix?: string }) {
  return (
    <div className="text-center">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="font-semibold">{v}{suffix}</div>
    </div>
  );
}
