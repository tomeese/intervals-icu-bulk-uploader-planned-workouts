/* src/components/ExportUploadPanel.tsx */

import React, { useMemo, useState } from "react";
import { zWeekPlan } from "../lib/schema";
import type { PlannerState } from "../lib/planner-state";
import { buildWeekPlan } from "../lib/planner-state";

export default function ExportUploadPanel({ state }: { state?: PlannerState }) {
  const [copied, setCopied] = useState<null | "ok" | "err">(null);

  const { plan, json, filename, error } = useMemo(() => {
    try {
      if (!state) throw new Error("No planner state");
      const plan = buildWeekPlan(state);
      const parsed = zWeekPlan.parse(plan); // throws if invalid
      const json = JSON.stringify(parsed, null, 2);
      const filename = `snapshots/week-${parsed.week_start}.json`;
      return { plan: parsed, json, filename, error: null as any };
    } catch (e: any) {
      return { plan: null, json: "", filename: "", error: e };
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

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-white dark:bg-slate-900">
      <h2 className="text-lg font-semibold">Export & Upload</h2>

      {!error && plan ? (
        <>
          <div className="text-sm text-slate-600">
            Week start: <span className="font-mono">{plan.week_start}</span>
          </div>

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

          <details className="text-sm text-slate-600">
            <summary className="cursor-pointer select-none">What next?</summary>
            <ol className="list-decimal ml-5 mt-2 space-y-1">
              <li>
                Place the file under <code>snapshots/</code> in your repo (keep the filename).
              </li>
              <li>Commit & push (GitHub Desktop is perfect).</li>
              <li>
                Run the <b>Weekly Intervals Upload</b> workflow and set
                <code> plan </code> to{" "}
                <code>{`snapshots/week-${plan.week_start}.json`}</code>.
              </li>
            </ol>
          </details>

          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer select-none">Preview JSON</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-50 p-2 border">
              {json}
            </pre>
          </details>
        </>
      ) : (
        <div className="text-sm text-amber-600">
          {state
            ? `Invalid plan: ${error?.message ?? String(error)}`
            : "Planner not initialized yet on this view."}
        </div>
      )}
    </div>
  );
}
