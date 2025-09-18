import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Calendar, Clock, ExternalLink, Clipboard, ClipboardCheck, ChevronRight, StickyNote, AlertTriangle, RefreshCw, FileDown, Eye } from "lucide-react";

// ——— Repo / workflow config ———
const GH_OWNER = (import.meta as any).env?.VITE_GH_OWNER ?? "your-owner";
const GH_REPO = (import.meta as any).env?.VITE_GH_REPO ?? "your-repo";
const ISSUE_LABEL = "generate-plan"; // generator workflow watches this
const PUBLISH_LABEL = "publish-plan"; // publish workflow watches this
const DEFAULT_BRANCH = (import.meta as any).env?.VITE_DEFAULT_BRANCH ?? "main";

// ——— Plan UI config (remote, overridable) ———
const PLAN_CONFIG_URL = (import.meta as any).env?.VITE_PLAN_CONFIG_URL ?? "/plan-config.json";
const DEFAULT_CHIPS = [
  "Rest Day (no workout)",
  "Outdoor",
  "Indoor",
  "High cadence",
  "Low cadence",
  "Pedaling drills",
  "Shorten Z2",
  "Extend Z2",
  "Sprint",
  "Anaerobic",
  "VO2",
  "Threshold",
  "SS",
  "Sweet Spot",
  "Tempo",
  "Endurance",
  "Recovery",
];
const DEFAULT_HI = ["Sprint", "VO2", "Anaerobic", "Threshold", "SS", "Sweet Spot"];
const DEFAULT_LONGRIDE_REGEX = "(long ride|\\b(3h|4h|5h|6h|180m|240m|300m)\\b)";

// ——— Types ———
type Intent = "build-week" | "recovery-week" | "race-week";

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
// Parse a YYYY-MM-DD as a LOCAL midnight date (avoids UTC shifting issues)
function fromYMDLocal(isoStr: string) {
  const [y, m, d] = isoStr.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}
function listDatesInclusive(startISO: string, endISO: string): string[] {
  if (!startISO || !endISO) return [];
  const out: string[] = [];
  const s = fromYMDLocal(startISO);
  const e = fromYMDLocal(endISO);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return out;
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    out.push(iso(d)); // iso() uses LOCAL getters
  }
  return out;
}
function dayLabel(isoStr: string) {
  const d = fromYMDLocal(isoStr);
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d); // Mon, Tue…
}
function isWeekend(isoStr: string) {
  const dow = fromYMDLocal(isoStr).getDay();
  return dow === 0 || dow === 6; // Sun or Sat
}
function escapeRegex(s: string) { return s.replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&"); }

export default function PlanApp() {
  // ——— Remote UI config state ———
  const [chipList, setChipList] = useState<string[]>(DEFAULT_CHIPS);
  const [hiKeywords, setHiKeywords] = useState<string[]>(DEFAULT_HI);
  const [weekdayLongrideRe, setWeekdayLongrideRe] = useState<RegExp>(new RegExp(DEFAULT_LONGRIDE_REGEX, "i"));

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(PLAN_CONFIG_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const cfg = await res.json();
        if (!live) return;
        if (Array.isArray(cfg?.chips) && cfg.chips.length) setChipList(cfg.chips);
        if (Array.isArray(cfg?.hi_intensity_keywords) && cfg.hi_intensity_keywords.length) setHiKeywords(cfg.hi_intensity_keywords);
        if (typeof cfg?.weekday_longride_regex === "string" && cfg.weekday_longride_regex) {
          setWeekdayLongrideRe(new RegExp(cfg.weekday_longride_regex, "i"));
        }
      } catch (e) {
        console.warn("plan-config.json not loaded; using defaults", e);
      }
    })();
    return () => { live = false; };
  }, []);

  // ——— Core UI state ———
  const [intent, setIntent] = useState<Intent>("recovery-week");
  const [notes, setNotes] = useState<string>("");
  const [draftMode, setDraftMode] = useState<boolean>(true);

  // Single input: week start (we snap to Monday of that week)
  const [start, setStart] = useState<string>(iso(mondayOfWeek(new Date())));

  // Derived week range: Monday..Sunday containing `start`
  const weekStartISO = useMemo(() => iso(mondayOfWeek(fromYMDLocal(start))), [start]);
  const weekEndISO = useMemo(() => iso(sundayOfWeek(fromYMDLocal(start))), [start]);

  // Per-day notes map (YYYY-MM-DD -> text)
  const [dailyNotes, setDailyNotes] = useState<Record<string, string>>({});

  // Keep keys for the visible week so controlled textareas don't warn
  useEffect(() => {
    const dates = listDatesInclusive(weekStartISO, weekEndISO);
    setDailyNotes((prev) => {
      const next = { ...prev } as Record<string, string>;
      for (const d of dates) if (!(d in next)) next[d] = "";
      for (const k of Object.keys(next)) if (!dates.includes(k)) delete next[k];
      return next;
    });
  }, [weekStartISO, weekEndISO]);

  // Dates, sorted Monday → Sunday
  const dates = useMemo(() => {
    const _dates = listDatesInclusive(weekStartISO, weekEndISO);
    const order = (iso: string) => {
      const dow = fromYMDLocal(iso).getDay(); // 0=Sun..6=Sat (LOCAL)
      return dow === 0 ? 7 : dow; // Monday=1..Saturday=6, Sunday=7 (last)
    };
    return _dates.slice().sort((a, b) => order(a) - order(b));
  }, [weekStartISO, weekEndISO]);

  // Only include non-empty per-day notes
  const dailyNotesFiltered = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of Object.entries(dailyNotes)) {
      const vv = (v || "").trim();
      if (vv) obj[k] = vv;
    }
    return obj;
  }, [dailyNotes]);

  const dailyNotesJson = useMemo(() => JSON.stringify(dailyNotesFiltered, null, 2), [dailyNotesFiltered]);

  // Draft path helpers
  const draftPath = `plans/drafts/${weekStartISO}_${weekEndISO}.json`;
  const weeklyPath = `plans/${weekStartISO}_${weekEndISO}.json`;

  const bodyPreview = useMemo(() => {
    const title = `${draftMode ? "Draft: " : ""}Plan: ${weekStartISO}..${weekEndISO} (${intent})`;
    const core = `start: ${weekStartISO}\nend: ${weekEndISO}\nintent: ${intent}\nmode: ${draftMode ? "draft" : "final"}\n${draftMode ? `draft_path: ${draftPath}\n` : ""}notes:\n\`\`\`\n${(notes || "(none)").trim()}\n\`\`\``;
    const dn = Object.keys(dailyNotesFiltered).length
      ? `\n\ndaily_notes_json:\n\`\`\`json\n${dailyNotesJson}\n\`\`\``
      : "";
    return { title, body: core + dn + "\n\n_created via PlanApp UI_" };
  }, [draftMode, weekStartISO, weekEndISO, intent, notes, dailyNotesFiltered, dailyNotesJson, draftPath]);

  const issueUrl = useMemo(() => {
    const labels = draftMode ? `${ISSUE_LABEL},draft` : ISSUE_LABEL;
    const params = new URLSearchParams({
      labels,
      title: bodyPreview.title,
      body: bodyPreview.body
    });
    return `https://github.com/${GH_OWNER}/${GH_REPO}/issues/new?${params.toString()}`;
  }, [draftMode, bodyPreview]);

  // ——— Fetch existing files (final + draft) for summaries ———
  type PlanEvent = { start_date_local?: string; moving_time?: number; icu_training_load?: number; name?: string; type?: string; description?: string };
  const [existingWeekPlan, setExistingWeekPlan] = useState<PlanEvent[] | null>(null);
  const [existingDraft, setExistingDraft] = useState<PlanEvent[] | null>(null);
  const [latestPlan, setLatestPlan] = useState<PlanEvent[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [overwriteOK, setOverwriteOK] = useState(false);

  async function fetchJson(url: string) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      if (Array.isArray(data)) return data as any[];
      if (data && Array.isArray((data as any).events)) return (data as any).events as any[];
      return null;
    } catch {
      return null;
    }
  }
  function summarize(events: PlanEvent[] | null) {
    if (!events || !events.length) return { totalEvents: 0, totalLoad: 0, totalHours: 0, rows: [] as any[] };
    const rows = events.map((e) => ({
      date: (e.start_date_local || "").slice(0,10),
      name: e.name || e.type || "Workout",
      load: Number(e.icu_training_load || 0),
      hrs: Math.round(((Number(e.moving_time || 0) / 3600) + Number.EPSILON) * 10) / 10,
    })).sort((a, b) => a.date.localeCompare(b.date));
    const totalLoad = rows.reduce((s, r) => s + (r.load || 0), 0);
    const totalHours = Math.round((rows.reduce((s, r) => s + (r.hrs || 0), 0) + Number.EPSILON) * 10) / 10;
    return { totalEvents: rows.length, totalLoad, totalHours, rows };
  }

  useEffect(() => {
    let live = true;
    (async () => {
      setFetching(true);
      const weekUrl = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${DEFAULT_BRANCH}/${weeklyPath}`;
      const draftUrl = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${DEFAULT_BRANCH}/${draftPath}`;
      const latestUrl = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${DEFAULT_BRANCH}/plans/latest.json`;
      const [week, draft, last] = await Promise.all([fetchJson(weekUrl), fetchJson(draftUrl), fetchJson(latestUrl)]);
      if (!live) return;
      setExistingWeekPlan(week);
      setExistingDraft(draft);
      setLatestPlan(last);
      setFetching(false);
      setOverwriteOK(false);
    })();
    return () => { live = false; };
  }, [weeklyPath, draftPath]);

  const latestSummary = summarize(latestPlan);
  const existingSummary = summarize(existingWeekPlan);
  const draftSummary = summarize(existingDraft);

  // ——— Bulk apply ———
  function applyNote(scope: "all" | "weekdays" | "weekend", text: string) {
    if (!text.trim()) return;
    setDailyNotes(prev => {
      const next = { ...prev };
      dates.forEach(d => {
        const dow = fromYMDLocal(d).getDay();
        const isWknd = dow === 0 || dow === 6;
        if (
          scope === "all" ||
          (scope === "weekdays" && !isWknd) ||
          (scope === "weekend" && isWknd)
        ) {
          const cur = (next[d] || "").trim();
          const sep = cur && !cur.endsWith(".") ? ". " : cur ? " " : "";
          next[d] = (cur + sep + text).trim();
        }
      });
      return next;
    });
  }

  // ——— Pre-flight validator ———
  function includesLongRide(t: string) {
    return weekdayLongrideRe.test(t);
  }
  function isHighIntensity(t: string) {
    return hiKeywords.some(k => new RegExp(`\\b${escapeRegex(k)}\\b`, "i").test(t));
  }
  const validation = useMemo(() => {
    const errs: string[] = [];
    const warns: string[] = [];
    let hi = 0, rest = 0, wkndLong = false;

    dates.forEach(d => {
      const n = dailyNotes[d] || "";
      if (/Rest Day/i.test(n)) rest++;
      if (isHighIntensity(n)) hi++;
      if (includesLongRide(n)) {
        if (isWeekend(d)) wkndLong = true; else errs.push(`${d}: long-ride hint on a weekday`);
      }
    });

    if (!wkndLong) warns.push("No weekend long-ride hint detected (ok for recovery weeks)");
    if (hi > 3) warns.push(`High-intensity days > 3 (${hi})`);
    if (rest === 0) warns.push("No explicit Rest Day marked; generator may still assign one");

    return { errors: errs, warnings: warns };
  }, [dates, dailyNotes, hiKeywords, weekdayLongrideRe]);

  const [copied, setCopied] = useState(false);
  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(issueUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  function prefillThisWeek() {
    const m = mondayOfWeek(new Date());
    setStart(iso(m));
  }
  function prefillNextWeek() {
    const mon = mondayOfWeek(new Date());
    mon.setDate(mon.getDate() + 7);
    setStart(iso(mon));
  }

  function handleStartChange(v: string) {
    if (!v) return;
    const snapped = iso(mondayOfWeek(fromYMDLocal(v)));
    setStart(snapped);
  }

  function setNote(date: string, text: string) {
    setDailyNotes((prev) => ({ ...prev, [date]: text }));
  }
  function appendChip(date: string, chip: string) {
    setDailyNotes((prev) => {
      const cur = (prev[date] || "").trim();
      const sep = cur && !cur.endsWith(".") ? ". " : cur ? " " : "";
      return { ...prev, [date]: (cur + sep + chip).trim() };
    });
  }
  function clearAllDailyNotes() {
    setDailyNotes((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, ""])));
  }

  // Draft preview
  const draftRawUrl = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${DEFAULT_BRANCH}/${draftPath}`;
  const [previewJson, setPreviewJson] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string>("");

  async function loadDraftPreview() {
    setPreviewErr("");
    setPreviewLoading(true);
    try {
      const res = await fetch(draftRawUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const txt = await res.text();
      setPreviewJson(txt);
    } catch (e: any) {
      setPreviewErr(`No draft file found yet at ${draftPath}. Open a Draft Issue first.`);
      setPreviewJson("");
    } finally {
      setPreviewLoading(false);
    }
  }

  function downloadPreview() {
    if (!previewJson) return;
    const blob = new Blob([previewJson], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${weekStartISO}_${weekEndISO}.draft.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const publishIssueUrl = useMemo(() => {
    const title = `Publish plan ${weekStartISO}..${weekEndISO}`;
    const body = `draft_path: ${draftPath}\n\n_created via PlanApp UI_`;
    const params = new URLSearchParams({
      labels: PUBLISH_LABEL,
      title,
      body
    });
    return `https://github.com/${GH_OWNER}/${GH_REPO}/issues/new?${params.toString()}`;
  }, [draftPath, weekStartISO, weekEndISO]);

  // ——— UI ———
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-zinc-900 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 dark:bg-zinc-900/60 border-b border-zinc-200/60 dark:border-zinc-800">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-900 font-semibold">P</div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold leading-tight">Plan Generator</h1>
            <p className="text-xs text-zinc-500">Pick a start date, add day tweaks, open a Draft or Final Issue. Actions handles the rest.</p>
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
          {/* Week picker */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="h-5 w-5" />
              <h2 className="text-base font-semibold">Week</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div>
                <label className="block text-sm mb-1">Start (we snap to Monday)</label>
                <input type="date" value={start} onChange={(e) => handleStartChange(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400" />
                <p className="text-xs text-zinc-500 mt-1">Range: <code>{weekStartISO}</code> → <code>{weekEndISO}</code></p>
              </div>
              <div className="flex gap-3 md:justify-end">
                <button onClick={prefillThisWeek} className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">This week</button>
                <button onClick={prefillNextWeek} className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700">Next week</button>
                <button onClick={clearAllDailyNotes} className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700">Clear notes</button>
              </div>
            </div>
          </motion.div>

          {/* Options */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.05 }}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm">
            <h2 className="text-base font-semibold mb-4">Plan Options</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <div>
                <label className="block text-sm mb-1">Intent</label>
                <select value={intent} onChange={(e) => setIntent(e.target.value as Intent)}
                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2">
                  <option value="recovery-week">recovery-week</option>
                  <option value="build-week">build-week</option>
                  <option value="race-week">race-week</option>
                </select>
              </div>
              <div className="md:col-span-2 flex items-center gap-3">
                <label className="text-sm">Mode</label>
                <button onClick={() => setDraftMode(v => !v)}
                  className={`px-3 py-1.5 rounded-lg border ${draftMode ? 'border-blue-600 text-blue-700' : 'border-zinc-300 dark:border-zinc-700'} `}>
                  {draftMode ? 'Draft' : 'Final'}
                </button>
                {draftMode && <span className="text-xs text-zinc-500">Drafts save to <code>plans/drafts/</code> and skip upload.</span>}
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm mb-1">Weekly Notes (optional)</label>
              <textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything the generator should consider this week (HRV, travel, swap long ride, etc.)"
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2" />
            </div>
          </motion.div>

          {/* Bulk apply row */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.08 }}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm">
            <h2 className="text-base font-semibold mb-3">Quick apply to multiple days</h2>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <select id="chipSelect" className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2">
                {chipList.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className="flex gap-2">
                <button onClick={() => {
                  const sel = (document.getElementById('chipSelect') as HTMLSelectElement).value;
                  applyNote('all', sel);
                }} className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700">Apply to all</button>
                <button onClick={() => {
                  const sel = (document.getElementById('chipSelect') as HTMLSelectElement).value;
                  applyNote('weekdays', sel);
                }} className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700">Weekdays</button>
                <button onClick={() => {
                  const sel = (document.getElementById('chipSelect') as HTMLSelectElement).value;
                  applyNote('weekend', sel);
                }} className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700">Weekend</button>
              </div>
            </div>
          </motion.div>

          {/* Per-day notes */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.1 }}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <StickyNote className="h-5 w-5" />
              <h2 className="text-base font-semibold">Per-day Notes</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {dates.map((d) => (
                <div key={d} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium">{dayLabel(d)} <span className="text-zinc-500">{d}</span></div>
                    <div className="text-[11px] text-zinc-500">optional</div>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {chipList.map((chip) => (
                      <button key={chip} type="button" onClick={() => appendChip(d, chip)}
                        className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                        {chip}
                      </button>
                    ))}
                  </div>
                  <textarea rows={3} value={dailyNotes[d] ?? ""} onChange={(e) => setNote(d, e.target.value)}
                    placeholder="e.g., Rest Day (no workout), Outdoor, include pedaling drills"
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm" />
                </div>
              ))}
            </div>
          </motion.div>

          {/* Preview body */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.12 }}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-5 w-5" />
              <h2 className="text-base font-semibold">Issue payload preview</h2>
            </div>
            <pre className="text-sm whitespace-pre-wrap bg-zinc-100 dark:bg-zinc-800 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-x-auto max-h-64">{bodyPreview.body}</pre>
          </motion.div>

          {/* Draft JSON preview panel */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.14 }}
            className="rounded-2xl border border-blue-200 dark:border-blue-900 bg-white dark:bg-zinc-900 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Eye className="h-5 w-5" />
              <h2 className="text-base font-semibold">Draft JSON (read-only preview)</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2 text-xs text-zinc-600 dark:text-zinc-400">
              <span>Path:</span>
              <code className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">{draftPath}</code>
              <a href={draftRawUrl} target="_blank" rel="noreferrer" className="underline">raw</a>
            </div>
            <div className="flex gap-2 mb-3">
              <button onClick={loadDraftPreview} className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 inline-flex items-center gap-2">
                <RefreshCw className={`h-4 w-4 ${previewLoading ? 'animate-spin' : ''}`} />
                Load/Refresh
              </button>
              <button onClick={downloadPreview} disabled={!previewJson} className={`px-3 py-1.5 rounded-lg border inline-flex items-center gap-2 ${previewJson ? 'border-zinc-200 dark:border-zinc-700' : 'border-zinc-200/50 text-zinc-400 cursor-not-allowed'}`}>
                <FileDown className="h-4 w-4" />
                Download JSON
              </button>
            </div>
            {previewErr && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{previewErr}</p>}
            <textarea readOnly rows={16} value={previewJson}
              placeholder="Open a Draft Issue first, then click Load/Refresh to preview the generated plan JSON here."
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 p-3 font-mono text-xs" />
          </motion.div>
        </section>

        {/* Right: Actions & Summary */}
        <aside className="space-y-6">
          {/* Validation & actions */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.15 }}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm sticky top-20">
            <h2 className="text-base font-semibold mb-3">Create plan issue</h2>

            {(validation.errors.length > 0 || validation.warnings.length > 0) && (
              <div className="mb-3 space-y-2">
                {validation.errors.length > 0 && (
                  <div className="flex items-start gap-2 text-red-600 dark:text-red-400 text-sm">
                    <AlertTriangle className="h-4 w-4 mt-0.5" />
                    <div>
                      <div className="font-medium">Fix these before proceeding:</div>
                      <ul className="list-disc ml-5">
                        {validation.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
                {validation.warnings.length > 0 && (
                  <div className="text-amber-600 dark:text-amber-400 text-sm">
                    <div className="font-medium mb-1">Heads up:</div>
                    <ul className="list-disc ml-5">
                      {validation.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {existingWeekPlan && !draftMode && (
              <DuplicateNotice existing overwriteOK={overwriteOK} setOverwriteOK={setOverwriteOK} />
            )}

            <div className="flex gap-2">
              <button
                onClick={() => window.open(issueUrl, "_blank", "noopener,noreferrer")}
                disabled={validation.errors.length > 0 || (existingWeekPlan && !draftMode && !overwriteOK)}
                className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-white ${validation.errors.length > 0 || (existingWeekPlan && !draftMode && !overwriteOK) ? "bg-blue-300 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"}`}
                title={draftMode ? "Open prefilled Draft Issue in GitHub" : "Open prefilled Final Issue in GitHub"}
              >
                {draftMode ? "Open Draft Issue" : "Open Final Issue"} <ChevronRight className="h-4 w-4" />
              </button>
              <button onClick={async () => { await navigator.clipboard.writeText(issueUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className={`px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700`}
                title="Copy Issue URL to clipboard"
              >
                {copied ? <ClipboardCheck className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
              </button>
            </div>

            {draftMode && (
              <div className="mt-4 text-xs text-zinc-600 dark:text-zinc-400">
                <p><strong>Draft flow:</strong> Open Draft Issue → generator commits to <code>{draftPath}</code> → click <em>Load/Refresh</em> above to preview → when ready, click <em>Promote Draft</em> below.</p>
                <div className="mt-2">
                  <a className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                     href={publishIssueUrl} target="_blank" rel="noreferrer">
                    Promote Draft (opens publish Issue)
                  </a>
                </div>
              </div>
            )}

            {!draftMode && (
              <div className="mt-4 text-xs text-zinc-500">
                <p><strong>Heads up:</strong> Final plans commit to <code>{weeklyPath}</code> and will trigger Intervals upload via Actions.</p>
              </div>
            )}
          </motion.div>

          {/* Summaries */}
          <PlanSummaryPanel title="Existing plan (final, selected week)" fetching={fetching} summary={summarize(existingWeekPlan)} />
          <PlanSummaryPanel title="Existing draft (selected week)" fetching={fetching} summary={draftSummary} />
          <PlanSummaryPanel title="Latest committed plan" summary={summarize(latestPlan)} />
        </aside>
      </main>

      <footer className="mx-auto max-w-6xl px-4 py-10 text-xs text-zinc-500">
        <p>Using repo: <code>{GH_OWNER}/{GH_REPO}</code> on <code>{DEFAULT_BRANCH}</code>. Week = Monday→Sunday; start date snaps to Monday automatically. Drafts live under <code>plans/drafts/</code>.</p>
      </footer>
    </div>
  );
}

// ——— Small presentational helpers ———
function DuplicateNotice({ existing, overwriteOK, setOverwriteOK }: { existing: boolean; overwriteOK: boolean; setOverwriteOK: (v: boolean) => void }) {
  if (!existing) return null;
  return (
    <div className="mb-3 text-sm text-amber-600 dark:text-amber-400">
      A plan file for this week already exists in <code>plans/</code>. Opening a Final Issue will overwrite it on commit.
      <div className="mt-1 flex items-center gap-2">
        <input id="ow" type="checkbox" checked={overwriteOK} onChange={(e) => setOverwriteOK(e.target.checked)} className="h-4 w-4" />
        <label htmlFor="ow">I understand—overwrite existing file</label>
      </div>
    </div>
  );
}

function PlanSummaryPanel({ title, summary, fetching }: { title: string; summary: { totalEvents: number; totalLoad: number; totalHours: number; rows: any[] }; fetching?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.2 }}
      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm">
      <h3 className="text-base font-semibold">{title}</h3>
      {fetching ? (
        <p className="text-sm text-zinc-500 mt-2">Checking…</p>
      ) : summary.totalEvents > 0 ? (
        <div className="mt-2">
          <ul className="text-sm mt-1 space-y-1">
            <li>Events: <strong>{summary.totalEvents}</strong></li>
            <li>TSS: <strong>{summary.totalLoad}</strong></li>
            <li>Hours: <strong>{summary.totalHours}</strong></li>
          </ul>
          <div className="mt-2 text-xs max-h-40 overflow-auto border border-zinc-200 dark:border-zinc-800 rounded-lg p-2">
            {summary.rows.map((r, i) => (
              <div key={i} className="flex justify-between gap-2">
                <div className="truncate">{r.date} — {r.name}</div>
                <div className="shrink-0">{r.load} / {r.hrs}h</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-zinc-500 mt-2">No data.</p>
      )}
    </motion.div>
  );
}