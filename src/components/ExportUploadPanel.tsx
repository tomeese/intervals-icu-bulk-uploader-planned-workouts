/* src/components/ExportUploadPanel.tsx */

import React, { useMemo, useState } from "react";
import { zWeekPlan } from "../lib/schema";
import type { WeekPlan } from "../lib/guardrails";

function makeFilename(week: WeekPlan) {
  return `week-${week.week_start}.json`;
}

export default function ExportUploadPanel({ week }: { week: WeekPlan }) {
  const [branch, setBranch] = useState("main");
  const filename = makeFilename(week);

  // Validate before enabling export
  const { ok, errors } = useMemo(() => {
    const res = zWeekPlan.safeParse(week);
    if (res.success) return { ok: true, errors: [] as string[] };
    const errs = res.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
    return { ok: false, errors: errs };
  }, [week]);

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify({ events: week.events }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const ghCmd = `gh workflow run "Upload to Intervals" --ref ${branch} -f payload_path="snapshots/${filename}"`;

  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(ghCmd);
      alert("Command copied. After you commit the file under snapshots/, run it in a terminal.");
    } catch {
      prompt("Copy command:", ghCmd);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 p-3 bg-white/70">
      <div className="text-sm font-semibold text-slate-800 mb-2">Export → Upload</div>

      {!ok && (
        <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">
          <div className="font-medium">Fix before export:</div>
          <ul className="list-disc pl-5">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="text-sm text-slate-700">File:</div>
        <code className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1">{filename}</code>
        <button
          className="ml-auto rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
          onClick={downloadJson}
          disabled={!ok}
        >
          Download JSON
        </button>
      </div>

      <div className="mt-3 text-sm text-slate-700">
        <div className="flex items-center gap-2">
          <label className="text-sm">
            Branch:
            <input
              className="ml-2 rounded-lg border px-2 py-1 text-sm w-40"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
            />
          </label>
          <button className="ml-auto rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50" onClick={copyCmd}>
            Copy gh command
          </button>
        </div>
        <pre className="mt-2 text-xs bg-slate-50 border border-slate-200 rounded p-2 overflow-auto">{ghCmd}</pre>

        <ol className="mt-2 text-xs text-slate-500 list-decimal pl-5">
          <li>Move the downloaded file into <code>snapshots/</code> in your repo.</li>
          <li>Commit & push on <code>{branch || "main"}</code> (GitHub Desktop is perfect).</li>
          <li>Run the copied command to trigger the upload workflow, or merge to <code>main</code> to auto-upload.</li>
        </ol>
      </div>
    </div>
  );
}
