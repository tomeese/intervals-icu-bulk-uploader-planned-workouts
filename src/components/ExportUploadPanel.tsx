// src/components/ExportUploadPanel.tsx

import React, { useMemo, useState } from "react";
import { zWeekPlan } from "../lib/schema";
import type { PlannerState } from "../lib/planner-state";
import { buildWeekPlan } from "../lib/planner-state";
import { uploadPlannedWeek } from "../lib/intervals";

function suggestFilename(weekStart?: string) {
  return weekStart ? `snapshots/week-${weekStart}.json` : "snapshots/week-XXXX-XX-XX.json";
}

export default function ExportUploadPanel({ state }: { state: PlannerState }) {
  const [copied, setCopied] = useState<null | "ok" | "err">(null);

  // Local upload creds persisted in the browser only
  const [apiKey, setApiKey] = useState(localStorage.getItem("icu_api_key") ?? "");
  const [athleteId, setAthleteId] = useState<number>(
    Number(localStorage.getItem("icu_athlete_id") ?? "0"),
  );

  const [tz, setTz] = useState(
    localStorage.getItem("icu_tz") ??
      (Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles"),
  );
    
  const [defaultStart, setDefaultStart] = useState(
    localStorage.getItem("icu_default_start") ?? "06:00",
  );
  const [uploadState, setUploadState] =
    useState<null | { created: number; skipped: number; errors: string[] }>(null);
  const [uploadBusy, setUploadBusy] = useState(false);

  const { plan, json, filename, error } = useMemo(() => {
    try {
      const plan = buildWeekPlan(state);
      const parsed = zWeekPlan.parse(plan); // throws if invalid
      const json = JSON.stringify(parsed, null, 2);
      const filename = suggestFilename(parsed.week_start);
      return { plan: parsed, json, filename, error: null as any };
    } catch (e: any) {
      return { plan: null, json: "", filename: suggestFilename(), error: e };
    }
  }, [state]);

  const download = () => {
    if (!json || !filename) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied("ok");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied("err");
      setTimeout(() => setCopied(null), 2000);
    }
  };

  function persistCreds() {
    localStorage.setItem("icu_api_key", apiKey);
    localStorage.setItem("icu_athlete_id", String(athleteId));
    localStorage.setItem("icu_tz", tz);
    localStorage.setItem("icu_default_start", defaultStart);
  }

  async function doUpload() {
    if (!plan || !apiKey || !athleteId) return;
    setUploadBusy(true);
    setUploadState(null);
    try {
      const res = await uploadPlannedWeek(plan, {
        apiKey,
        athleteId,
        defaultStart,
        tz,
      });
      setUploadState(res);
    } finally {
      setUploadBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4 bg-white dark:bg-slate-900">
      <h2 className="text-lg font-semibold">Export & Upload</h2>

      {!error ? (
        <>
          <div className="text-sm text-slate-600">
            Week start:&nbsp;
            <span className="font-mono">{plan!.week_start}</span>
          </div>

          {/* Local Upload (stays on device via localStorage) */}
          <div className="space-y-2 border rounded-lg p-3">
            <h3 className="font-medium text-sm">Upload to Intervals (local key)</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex flex-col">API key
                <input
                  className="border rounded px-2 py-1"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </label>
              <label className="flex flex-col">Athlete ID
                <input
                  className="border rounded px-2 py-1"
                  type="number"
                  value={athleteId}
                  onChange={(e) => setAthleteId(Number(e.target.value || 0))}
                />
              </label>
              <label className="flex flex-col">Time zone
                <input
                  className="border rounded px-2 py-1"
                  value={tz}
                  onChange={(e) => setTz(e.target.value)}
                />
              </label>
              <label className="flex flex-col">Default start (HH:MM)
                <input
                  className="border rounded px-2 py-1"
                  value={defaultStart}
                  onChange={(e) => setDefaultStart(e.target.value)}
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={doUpload}
                disabled={uploadBusy || !apiKey || !athleteId}
                className="px-3 py-1.5 rounded-md border bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
              >
                {uploadBusy ? "Uploading…" : "Upload now"}
              </button>
              <button
                onClick={persistCreds}
                className="px-3 py-1.5 rounded-md border"
              >
                Save defaults
              </button>
            </div>
            {uploadState && (
              <div className="text-sm">
                <div>Created: {uploadState.created}, Skipped: {uploadState.skipped}</div>
                {uploadState.errors.length > 0 && (
                  <details className="text-red-600">
                    <summary>{uploadState.errors.length} errors</summary>
                    <ul className="list-disc ml-5">
                      {uploadState.errors.map((e, i) => (
                        <li key={i} className="break-all">{e}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>

          {/* Download / Copy */}
          <div className="flex gap-2">
            <button
              onClick={download}
              className="px-3 py-1.5 rounded-md border bg-slate-50 hover:bg-slate-100"
            >
              Download JSON
            </button>
            <button
              onClick={copyJson}
              className="px-3 py-1.5 rounded-md border bg-slate-50 hover:bg-slate-100"
            >
              {copied === "ok" ? "Copied ✓" : copied === "err" ? "Copy failed" : "Copy JSON"}
            </button>
          </div>

          {/* Helper text */}
          <details className="text-sm text-slate-600">
            <summary className="cursor-pointer select-none">What next?</summary>
            <ol className="list-decimal ml-5 mt-2 space-y-1">
              <li>Place the file under <code>snapshots/</code> in your repo:
                <code className="ml-1">{filename}</code>
              </li>
              <li>Commit & push (GitHub Desktop works great).</li>
              <li>Run <b>Weekly Intervals Upload</b> workflow and set <code>plan</code> to that path.</li>
            </ol>
          </details>

          {/* Preview */}
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer select-none">Preview JSON</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-50 p-2 border whitespace-pre-wrap break-words">
              {json}
            </pre>
          </details>
        </>
      ) : (
        <div className="text-sm text-red-600">
          Invalid plan: {error?.message ?? String(error)}
        </div>
      )}
    </div>
  );
}
