// scripts/generate-plan.mjs
// Node 20+. ESM (.mjs). For GitHub Actions or local use.
//
// Env vars (required):
//   OPENAI_API_KEY
//   START  (YYYY-MM-DD)
//   END    (YYYY-MM-DD)
//   INTENT ("build-week" | "recovery-week" | "race-week")
// Env vars (optional):
//   LONGRIDE_WEATHER  "dry" | "rain" | "mixed" | "auto"
//   SEASON_HINT       "summer" | "shoulder" | "winter"
//   MODEL             default: "gpt-4.1-mini"
//   MONDAY_REST       "true" (default) | "false"
//   NOTES             free-form notes (from Issue UI)
//
// Files expected (repo-relative):
//   schema/intervalsPlan.schema.json   // plan JSON Schema (Draft 2020-12)
//   state/static-context.md            // durable narrative rules
//   state/athlete.json                 // live athlete state
//   config/rules.json                  // tunable policy knobs (durations, caps, times)
//   schema/rules.schema.json           // (optional) schema for rules.json
//
// Output:
//   plans/<START>_<END>.json
//   plans/latest.json

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
// Ajv 2020 build has draft-2020-12 baked in
import Ajv from "ajv/dist/2020.js";

// ---------- helpers ----------
function env(name, { required = false, fallback = "" } = {}) {
  const v = process.env[name];
  if (required && (!v || !v.trim())) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return (v && v.trim()) || fallback;
}
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}
async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- date helpers (UTC-safe, day-only) ----
function listIsoDatesInclusive(startStr, endStr) {
  const out = [];
  const start = new Date(`${startStr}T00:00:00Z`);
  const end = new Date(`${endStr}T00:00:00Z`);
  if (isNaN(start) || isNaN(end)) throw new Error("Invalid START/END date.");
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD
  }
  return out;
}
function getUTCDay(isoDate) {
  // Sun=0 .. Sat=6
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}
function isWeekend(iso) {
  const dow = getUTCDay(iso);
  return dow === 0 || dow === 6;
}
function isWeekday(iso) {
  const dow = getUTCDay(iso);
  return dow >= 1 && dow <= 5;
}
function findDay(dates, dow) {
  return dates.find((d) => getUTCDay(d) === dow) || "";
}
function datePart(localIso) {
  return localIso.slice(0, 10);
}
function timePart(localIso) {
  return localIso.slice(11);
}
function minutes(sec) {
  return Math.round((sec || 0) / 60);
}

// ---------- env/config ----------
const OPENAI_API_KEY = env("OPENAI_API_KEY", { required: true });
const START = env("START", { required: true });
const END = env("END", { required: true });
const INTENT = env("INTENT", { required: true });
const MODEL = env("MODEL", { fallback: "gpt-4.1-mini" });

const OVERRIDE_LRW = env("LONGRIDE_WEATHER", { fallback: "" }).toLowerCase();
const OVERRIDE_SEASON = env("SEASON_HINT", { fallback: "" }).toLowerCase();
const MONDAY_REST = (env("MONDAY_REST", { fallback: "true" }).toLowerCase() || "true") !== "false";
const NOTES = env("NOTES", { fallback: "" });

const validLRW = new Set(["dry", "rain", "mixed", "auto", ""]);
const validSeasons = new Set(["summer", "shoulder", "winter", ""]);

// ---------- file paths ----------
const planSchemaPath = "schema/intervalsPlan.schema.json";
const staticCtxPath = "state/static-context.md";
const athletePath = "state/athlete.json";
const rulesPath = "config/rules.json";
const rulesSchemaPath = "schema/rules.schema.json"; // optional

// ---------- existence checks ----------
for (const p of [planSchemaPath, staticCtxPath, athletePath, rulesPath]) {
  if (!fs.existsSync(p)) {
    console.error(`Required file missing: ${p}`);
    process.exit(1);
  }
}

// ---------- load resources ----------
const planSchema = JSON.parse(fs.readFileSync(planSchemaPath, "utf8"));
const staticContext = fs.readFileSync(staticCtxPath, "utf8");
const athlete = JSON.parse(fs.readFileSync(athletePath, "utf8"));
const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

// ---------- AJV setup ----------
const ajv = new Ajv({ allErrors: true, strict: false });
const validatePlan = ajv.compile(planSchema);

// Optional: validate rules.json if a schema is present
if (fs.existsSync(rulesSchemaPath)) {
  const rulesSchema = JSON.parse(fs.readFileSync(rulesSchemaPath, "utf8"));
  const validateRules = ajv.compile(rulesSchema);
  if (!validateRules(rules)) {
    console.error("rules.json failed validation:", pretty(validateRules.errors));
    process.exit(1);
  }
}

// ---------- derive weather/season ----------
const lrw = validLRW.has(OVERRIDE_LRW) ? OVERRIDE_LRW : "auto";
const season = validSeasons.has(OVERRIDE_SEASON) ? OVERRIDE_SEASON : "";
const longride_weather = (lrw && lrw !== "" ? lrw : athlete.longride_weather) || "auto";
const season_hint = (season && season !== "" ? season : athlete.season_hint) || "summer";

// ---------- DATES_TO_COVER ----------
const allDates = listIsoDatesInclusive(START, END);
const datesToCover = allDates.filter((d) => (MONDAY_REST ? !isMondayUTC(d) : true));
function isMondayUTC(isoDate) { return getUTCDay(isoDate) === 1; }

// ---------- weekend dates & long-ride target ----------
const saturday = findDay(allDates, 6);
const sunday = findDay(allDates, 0);
const longRidePrimary =
  (rules.long_ride.primary_day === "SAT" ? saturday : sunday) || "";
const longRideBackup =
  (rules.long_ride.backup_day === "SAT" ? saturday : sunday) || "";

// ---------- build prompts ----------
const systemPrompt = [
  "You are a cycling coach that outputs ONLY JSON matching the provided schema.",
  "Honor split FTPs: use ftp_indoor for INDOOR sessions, ftp_outdoor for OUTDOOR sessions.",
  "Use local ISO datetimes (YYYY-MM-DDThh:mm:ss) with NO timezone suffix (no 'Z').",
  "Durations are in seconds via moving_time.",
  `Start times MUST match config: weekdays ${rules.times.weekday_start}, weekends ${rules.times.weekend_start}.`,
  "Never emit prose or markdown; JSON only."
].join("\n");

const datesRuleText = [
  `DATES_TO_COVER: ${datesToCover.join(", ")}`,
  `RULE: Create exactly one event on each listed date.`,
  `NOTE: If a Monday falls within the range, treat Monday as a rest day (no event) unless MONDAY_REST=false is supplied.`
].join("\n");

const sc = rules.weekday_caps;
const lr = rules.long_ride;
const timesCfg = rules.times;

const schedulingConstraintsText = [
  "SCHEDULING_CONSTRAINTS:",
  `- START_TIMES: Weekdays ${timesCfg.weekday_start}, Weekends ${timesCfg.weekend_start}; use exactly these unless explicitly overridden.`,
  `- WEEKDAY_MAX_MINUTES: ${sc.max_minutes} (hard cap ${sc.hard_max_minutes}); allow_single_105=${sc.allow_single_105}`,
  `- RULE: Mon–Fri sessions must be ≤ ${sc.max_minutes}'; a single ${sc.hard_max_minutes}' day is allowed only if allow_single_105=true; never ≥ ${lr.min_minutes_for_weekend}' on weekdays.`,
  `- RULE: Any session ≥ ${lr.min_minutes_for_weekend} minutes MUST be on Saturday or Sunday (long ride).`,
  `- LONG_RIDE_PRIMARY_DATE: ${longRidePrimary || "(none in range)"}`,
  `- LONG_RIDE_BACKUP_DATE: ${longRideBackup || "(none)"}`,
  `- RULE: Place long ride on primary; if constraints force a swap, use backup; if neither exists in range and require_weekend_for_long=${lr.require_weekend_for_long}, omit the long ride rather than violating weekday caps.`
].join("\n");

const liveState = `
ATHLETE_STATE:
ftp_indoor: ${athlete.ftp_indoor}
ftp_outdoor: ${athlete.ftp_outdoor}
timezone: ${athlete.timezone}
week_goal: ${athlete.week_goal}
recent_summary: ${athlete.recent_summary}
constraints: ${athlete.constraints}
longride_weather: ${longride_weather}
season_hint: ${season_hint}

REQUEST:
- date_range: ${START}..${END}
- intent: ${INTENT}
- output: Intervals.icu events (Ride only)

${datesRuleText}

${schedulingConstraintsText}

${NOTES ? `NOTES:\n${NOTES}\n` : ""}
`;

// ---------- OpenAI call (native fetch with retries) ----------
async function callOpenAI({ prompt, errorListJson = "", ruleErrorsText = "" }) {
  const messages = [
    { role: "system", content: systemPrompt + "\n\n" + staticContext },
    {
      role: "user",
      content:
        prompt +
        (ruleErrorsText ? `\n\nVALIDATION_ERRORS:\n${ruleErrorsText}\n` : "") +
        (errorListJson
          ? `\n\nFIX_TO_SCHEMA_ERRORS:\n${errorListJson}\nReturn ONLY valid JSON that conforms to the schema.`
          : "")
    }
  ];

  const body = {
    model: MODEL,
    messages,
    temperature: 0.2,
    response_format: { type: "json_schema", json_schema: { name: "IntervalsPlan", schema: planSchema, strict: true } }
  };

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        const text = await resp.text();
        if (resp.status === 429 || (resp.status >= 500 && resp.status <= 599)) {
          lastErr = new Error(`OpenAI HTTP ${resp.status}: ${text}`);
          const backoff = 500 * Math.pow(2, attempt - 1);
          console.warn(`OpenAI transient error (attempt ${attempt}/3). Backoff ${backoff}ms...`);
          await sleep(backoff);
          continue;
        }
        throw new Error(`OpenAI HTTP ${resp.status}: ${text}`);
      }

      const json = await resp.json();
      return json.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      lastErr = e;
      const backoff = 500 * Math.pow(2, attempt - 1);
      console.warn(`Fetch error (attempt ${attempt}/3): ${e?.message || e}. Backoff ${backoff}ms...`);
      await sleep(backoff);
    }
  }
  throw lastErr || new Error("OpenAI request failed after retries.");
}

// ---------- rule checker ----------
function checkAgainstRules(plan, datesToCover, rules) {
  const errs = [];
  const sc = rules.weekday_caps;
  const lr = rules.long_ride;
  const timesCfg = rules.times;

  // One event per date, and no duplicate dates
  const byDate = new Map();
  for (const ev of plan.events || []) {
    const d = datePart(ev.start_date_local || "");
    if (!d) { errs.push(`Missing or invalid start_date_local on an event.`); continue; }
    byDate.set(d, (byDate.get(d) || 0) + 1);
  }
  for (const d of datesToCover) {
    if (!byDate.has(d)) errs.push(`Missing event for ${d}.`);
    if ((byDate.get(d) || 0) > 1) errs.push(`Multiple events scheduled on ${d}; exactly one required.`);
  }

  // Weekday caps & long-ride on weekends only
  let used105 = 0;
  for (const ev of plan.events || []) {
    const d = datePart(ev.start_date_local);
    const t = timePart(ev.start_date_local);
    const mins = minutes(ev.moving_time);
    // Start time must match config
    const expectedStart = isWeekend(d) ? timesCfg.weekend_start : timesCfg.weekday_start;
    if (t !== expectedStart) {
      errs.push(`${d} uses start time ${t}, expected ${expectedStart} per config.`);
    }
    if (isWeekday(d)) {
      if (mins > sc.hard_max_minutes) {
        errs.push(`${d} exceeds hard weekday cap (${mins}' > ${sc.hard_max_minutes}').`);
      } else if (mins > sc.max_minutes) {
        if (sc.allow_single_105 && mins === sc.hard_max_minutes && used105 === 0) {
          used105++;
        } else {
          errs.push(`${d} exceeds weekday cap (${mins}' > ${sc.max_minutes}').`);
        }
      }
      if (mins >= lr.min_minutes_for_weekend) {
        errs.push(`${d} has a ≥${lr.min_minutes_for_weekend}' session on a weekday (long rides are weekend-only).`);
      }
    } else {
      // Weekend: ok to be long. No additional checks here.
    }
  }

  // If require_weekend_for_long and there is no weekend in range, ensure no long ride is scheduled
  if (rules.long_ride.require_weekend_for_long) {
    const hasWeekend = datesToCover.some(isWeekend);
    if (!hasWeekend) {
      for (const ev of plan.events || []) {
        const mins = minutes(ev.moving_time);
        if (mins >= lr.min_minutes_for_weekend) {
          errs.push(`Long ride scheduled (${mins}') but range has no weekend; omit the long ride.`);
        }
      }
    }
  }

  return errs;
}

// ---------- write outputs ----------
function writeOutputs(obj) {
  ensureDir("plans");
  const outPath = path.join("plans", `${START}_${END}.json`);
  fs.writeFileSync(outPath, pretty(obj));
  fs.writeFileSync(path.join("plans", "latest.json"), pretty(obj));
  console.log(`✓ Wrote ${outPath} and plans/latest.json`);
}

// ---------- main ----------
(async () => {
  try {
    console.log(
      `Generating plan ${START}..${END} intent=${INTENT} weather=${longride_weather} season=${season_hint} model=${MODEL} monday_rest=${MONDAY_REST}`
    );

    // First attempt
    const first = await callOpenAI({ prompt: liveState });
    let data;
    try {
      data = JSON.parse(first);
    } catch {
      console.warn("First response was not valid JSON; attempting repair pass.");
      data = {};
    }

    // Validate against schema and rules
    let ruleViolations = [];
    if (validatePlan(data)) {
      ruleViolations = checkAgainstRules(data, datesToCover, rules);
    }

    if (!validatePlan(data) || ruleViolations.length) {
      const ajvErrs = validatePlan.errors ? JSON.stringify(validatePlan.errors, null, 2) : "[]";
      const ruleErrsText = ruleViolations.length ? ruleViolations.map(e => `- ${e}`).join("\n") : "";
      console.warn("Schema or rule violations; attempting repair pass...");
      const second = await callOpenAI({
        prompt: liveState,
        errorListJson: ajvErrs,
        ruleErrorsText: ruleErrsText
      });
      try {
        data = JSON.parse(second);
      } catch {
        console.error("Repair pass still not JSON. Aborting.");
        process.exit(1);
      }
      // Re-validate after repair
      const ruleViolations2 = validatePlan(data) ? checkAgainstRules(data, datesToCover, rules) : ["(schema invalid)"];
      if (!validatePlan(data) || ruleViolations2.length) {
        console.error(
          "Model failed after repair pass.\nSchema errors:",
          pretty(validatePlan.errors || []),
          "\nRule violations:",
          pretty(ruleViolations2)
        );
        process.exit(1);
      }
    }

    writeOutputs(data);
  } catch (err) {
    console.error("Fatal:", err?.message || err);
    process.exit(1);
  }
})();
