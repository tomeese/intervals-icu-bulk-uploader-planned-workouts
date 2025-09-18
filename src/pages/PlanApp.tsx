/* ./src/pages/PlanApp.tsx */

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Calendar, Clock, Settings, ExternalLink, Clipboard, ClipboardCheck, ChevronRight } from "lucide-react";

// ——— Config ———
const GH_OWNER = (import.meta as any).env?.VITE_GH_OWNER ?? "your-owner";
const GH_REPO = (import.meta as any).env?.VITE_GH_REPO ?? "your-repo";
const ISSUE_LABEL = "generate-plan"; // Your generator workflow watches this

// ——— Types ———
type Intent = "build-week" | "recovery-week" | "race-week";
type Weather = "dry" | "rain" | "mixed" | "auto";
type Season = "summer" | "shoulder" | "winter";

// ——— Utils ———
const pad = (n: number) => String(n).padStart(2, "0");
function iso(d: Date) {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
}
function mondayOfWeek(d: Date) {
  const dd = new Date(d);
  const day = dd.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  dd.setDate(dd.getDate() + diff);
  dd.setHours(0, 0, 0, 0);
  return dd;
}
function sundayOfWeek(d: Date) {
  const mon = mondayOfWeek(d);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return sun;
}

export default function PlanApp() {
  // ——— State ———
  const [intent, setIntent] = useState<Intent>("recovery-week");
  const [weather, setWeather] = useState<Weather>("auto");
  const [season, setSeason] = useState<Season>("summer");
  const [mondayRest, setMondayRest] = useState<boolean>(true);
  const [notes, setNotes] = useState<string>("");

  const [start, setStart] = useState<string>(iso(mondayOfWeek(new Date())));
  const [end, setEnd] = useState<string>(iso(sundayOfWeek(new Date())));

  const valid = useMemo(() => {
    if (!start || !end) return false;
    const s = new Date(start);
    const e = new Date(end);
    return !isNaN(s.getTime()) && !isNaN(e.getTime()) && s <= e;
  }, [start, end]);

  const bodyPreview = useMemo(() => {
    return `start: ${start}\nend: ${end}\nintent: ${intent}\nlongride_weather: ${weather}\nseason_hint: ${season}\nmonday_rest: ${mondayRest}\nnotes:\n\`\`\`\n${(notes || "(none)").trim()}\n\`\`\``;
  }, [start, end, intent, weather, season, mondayRest, notes]);

  const issueUrl = useMemo(() => {
    if (!valid) return "#";
    const title = `Plan: ${start}..${end} (${intent})`;
    const params = new URLSearchParams({
      labels: ISSUE_LABEL,
      title,
      body: bodyPreview
    });
    return `https://github.com/${GH_OWNER}/${GH_REPO}/issues/new?${params.toString()}`;
  }, [valid, start, end, intent, bodyPreview]);

  const [copied, setCopied] = useState(false);
  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(issueUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  function prefillThisWeek() {
    setStart(iso(mondayOfWeek(new Date())));
    setEnd(iso(sundayOfWeek(new Date())));
  }
  function prefillNextWeek() {
    const mon = mondayOfWeek(new Date());
    mon.setDate(mon.getDate() + 7);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    setStart(iso(mon));
    setEnd(iso(sun));
  }

  // ——— UI ———
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-zinc-900 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 dark:bg-zinc-900/60 border-b border-zinc-200/60 dark:border-zinc-800">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-900 font-semibold">P</div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold leading-tight">Plan Generator</h1>
            <p className="text-xs text-zinc-500">Create a weekly plan, open a pre-filled GitHub Issue, let Actions do the rest.</p>
          </div>
          <a
            href={`https://github.com/${GH_OWNER}/${GH_REPO}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition"
          >
            Repo <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </header>

      {/* Content grid */}
      <main className="mx-auto max-w-6xl px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Form (2 cols) */}
        <section className="lg:col-span-2 space-y-6">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="h-5 w-5" />
              <h2 className="text-base font-semibold">Week</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-1">Start</label>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400" />
              </div>
              <div>
                <label className="block text-sm mb-1">End</label>
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400" />
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={prefillThisWeek} className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">This week</button>
              <button onClick={prefillNextWeek} className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700">Next week</button>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.05 }}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Settings className="h-5 w-5" />
              <h2 className="text-base font-semibold">Plan Options</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-1">Intent</label>
                <select value={intent} onChange={(e) => setIntent(e.target.value as Intent)}
                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2">
                  <option value="recovery-week">recovery-week</option>
                  <option value="build-week">build-week</option>
                  <option value="race-week">race-week</option>
                </select>
              </div>

              <div>
                <label className="block text-sm mb-1">Long-ride weather</label>
                <select value={weather} onChange={(e) => setWeather(e.target.value as Weather)}
                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2">
                  <option value="auto">auto</option>
                  <option value="dry">dry</option>
                  <option value="rain">rain</option>
                  <option value="mixed">mixed</option>
                </select>
              </div>

              <div>
                <label className="block text-sm mb-1">Season hint</label>
                <select value={season} onChange={(e) => setSeason(e.target.value as Season)}
                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2">
                  <option value="summer">summer</option>
                  <option value="shoulder">shoulder</option>
                  <option value="winter">winter</option>
                </select>
              </div>

              <div className="flex items-center gap-2 mt-1">
                <input id="mondayRest" type="checkbox" checked={mondayRest} onChange={(e) => setMondayRest(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-400 dark:border-zinc-600" />
                <label htmlFor="mondayRest" className="text-sm">Monday is rest day</label>
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm mb-1">Notes (optional)</label>
              <textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything the generator should consider this week (HRV, travel, swap long ride, etc.)"
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2" />
              <p className="text-xs text-zinc-500 mt-1">Notes are passed verbatim into the generator in a fenced block.</p>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.1 }}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-5 w-5" />
              <h2 className="text-base font-semibold">Preview payload</h2>
            </div>
            <pre className="text-sm whitespace-pre-wrap bg-zinc-100 dark:bg-zinc-800 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-x-auto max-h-72">{bodyPreview}</pre>
          </motion.div>
        </section>

        {/* Right: Actions & Summary */}
        <aside className="space-y-6">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.15 }}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm sticky top-20">
            <h2 className="text-base font-semibold mb-3">Create plan issue</h2>

            <ul className="text-sm text-zinc-600 dark:text-zinc-300 space-y-1 mb-4">
              <li>• Opens a prefilled GitHub Issue</li>
              <li>• Generator workflow runs</li>
              <li>• Plan JSON is committed</li>
              <li>• Issue is closed with a permalink</li>
            </ul>

            {!valid && (
              <p className="text-sm text-red-600 dark:text-red-400 mb-3">Choose a valid date range (start ≤ end).</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => window.open(issueUrl, "_blank", "noopener,noreferrer")}
                disabled={!valid}
                className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-white ${valid ? "bg-blue-600 hover:bg-blue-700" : "bg-blue-300 cursor-not-allowed"}`}
                title={valid ? "Open prefilled Issue in GitHub" : "Select a valid date range"}
              >
                Open Issue <ChevronRight className="h-4 w-4" />
              </button>
              <button onClick={copyUrl} disabled={!valid}
                className={`px-3 py-2 rounded-xl border ${valid ? "border-zinc-300 dark:border-zinc-700" : "border-zinc-200 dark:border-zinc-800 text-zinc-400 cursor-not-allowed"}`}
                title="Copy Issue URL to clipboard"
              >
                {copied ? <ClipboardCheck className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
              </button>
            </div>

            <div className="mt-4 text-xs text-zinc-500">
              <p><strong>Heads up:</strong> The Issue must carry the <code>{ISSUE_LABEL}</code> label or pass <em>start/end/intent</em> in the body (the workflow accepts both).</p>
            </div>
          </motion.div>
        </aside>
      </main>

      <footer className="mx-auto max-w-6xl px-4 py-10 text-xs text-zinc-500">
        <p>Using repo: <code>{GH_OWNER}/{GH_REPO}</code>. Start times & rules enforced downstream by the generator.</p>
      </footer>
    </div>
  );
}
