/** @file src/pages/PlanApp.tsx --- A simple React app to generate a prefilled GitHub Issue URL that triggers the plan workflow via label. */
import React, { useMemo, useState } from "react";

const GH_OWNER = import.meta.env.VITE_GH_OWNER!;
const GH_REPO  = import.meta.env.VITE_GH_REPO!;
const ISSUE_LABEL = "generate-plan";

type Intent = "build-week" | "recovery-week" | "race-week";
type Weather = "dry" | "rain" | "mixed" | "auto";
type Season = "summer" | "shoulder" | "winter";

function iso(d: Date) {
  // yyyy-mm-dd in local time
  const pad = (n: number) => String(n).padStart(2, "0");
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
  const [intent, setIntent] = useState<Intent>("recovery-week");
  const [weather, setWeather] = useState<Weather>("auto");
  const [season, setSeason] = useState<Season>("summer");
  const [mondayRest, setMondayRest] = useState<boolean>(true);
  const [notes, setNotes] = useState<string>("");

  // default dates = current week (Mon..Sun)
  const [start, setStart] = useState<string>(iso(mondayOfWeek(new Date())));
  const [end, setEnd] = useState<string>(iso(sundayOfWeek(new Date())));

  const valid = useMemo(() => {
    if (!start || !end) return false;
    return new Date(start) <= new Date(end);
  }, [start, end]);

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

  // Build a prefilled Issue URL that triggers the workflow via label
  const issueUrl = useMemo(() => {
    if (!valid) return "#";
    const title = `Plan: ${start}..${end} (${intent})`;
    // Notes go in a fenced block so the workflow can parse multi-line safely
    const bodyLines = [
      `start: ${start}`,
      `end: ${end}`,
      `intent: ${intent}`,
      `longride_weather: ${weather}`,
      `season_hint: ${season}`,
      `monday_rest: ${mondayRest}`,
      `notes:`,
      "```",
      notes.trim() || "(none)",
      "```",
      "",
      "_created via PlanApp UI_"
    ];
    const params = new URLSearchParams({
      labels: ISSUE_LABEL,
      title,
      body: bodyLines.join("\n")
    });
    return `https://github.com/${GH_OWNER}/${GH_REPO}/issues/new?${params.toString()}`;
  }, [valid, start, end, intent, weather, season, mondayRest, notes]);

  function openIssue() {
    if (!valid) return;
    window.open(issueUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div style={{ maxWidth: 780, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: 8 }}>Plan App</h2>
      <p style={{ color: "#666", marginBottom: 16 }}>
        Generate a weekly plan via <em>workflow_dispatch</em> using a prefilled GitHub Issue.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 16
        }}
      >
        <div>
          <label>Date range (start)</label>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label>Date range (end)</label>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>

        <div>
          <label>Intent</label>
          <select
            value={intent}
            onChange={(e) => setIntent(e.target.value as Intent)}
            style={{ width: "100%" }}
          >
            <option value="recovery-week">recovery-week</option>
            <option value="build-week">build-week</option>
            <option value="race-week">race-week</option>
          </select>
        </div>

        <div>
          <label>Long-ride weather</label>
          <select
            value={weather}
            onChange={(e) => setWeather(e.target.value as Weather)}
            style={{ width: "100%" }}
          >
            <option value="auto">auto</option>
            <option value="dry">dry</option>
            <option value="rain">rain</option>
            <option value="mixed">mixed</option>
          </select>
        </div>

        <div>
          <label>Season hint</label>
          <select
            value={season}
            onChange={(e) => setSeason(e.target.value as Season)}
            style={{ width: "100%" }}
          >
            <option value="summer">summer</option>
            <option value="shoulder">shoulder</option>
            <option value="winter">winter</option>
          </select>
        </div>

        <div>
          <label>
            <input
              type="checkbox"
              checked={mondayRest}
              onChange={(e) => setMondayRest(e.target.checked)}
              style={{ marginRight: 8 }}
            />
            Monday is rest day (exclude Monday from plan)
          </label>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label>Notes (optional)</label>
        <textarea
          rows={6}
          placeholder="Anything the generator should consider this week (travel, HRV trend, move long ride to Sunday, etc.)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ width: "100%", fontFamily: "inherit" }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={prefillThisWeek}>This week</button>
        <button onClick={prefillNextWeek}>Next week</button>
        <button
          onClick={openIssue}
          disabled={!valid}
          style={{
            marginLeft: "auto",
            background: valid ? "#0d6efd" : "#999",
            color: "white",
            padding: "0.5rem 1rem",
            border: "none",
            borderRadius: 6,
            cursor: valid ? "pointer" : "not-allowed"
          }}
          title={valid ? "Open GitHub to create plan issue" : "Select a valid date range"}
        >
          Create Plan Issue
        </button>
      </div>

      <details>
        <summary>Preview issue payload</summary>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "#f6f8fa",
            padding: 12,
            borderRadius: 6,
            border: "1px solid #e1e4e8"
          }}
        >{`start: ${start}
end: ${end}
intent: ${intent}
longride_weather: ${weather}
season_hint: ${season}
monday_rest: ${mondayRest}
notes:
\`\`\`
${(notes || "(none)").trim()}
\`\`\``}</pre>
        <div style={{ marginTop: 8 }}>
          <a href={issueUrl} target="_blank" rel="noreferrer">
            Open prefilled issue ↗
          </a>
        </div>
      </details>
    </div>
  );
}
