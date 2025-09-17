// scripts/generate-plan.mjs
// Node 20+. ESM file (.mjs). Run from GitHub Actions or locally with env vars set.
//
// Env vars (required):
//   OPENAI_API_KEY
//   START (YYYY-MM-DD)    e.g., 2025-09-15
//   END   (YYYY-MM-DD)    e.g., 2025-09-21
//   INTENT                e.g., "recovery-week" | "build-week" | "race-week"
// Env vars (optional):
//   LONGRIDE_WEATHER      "dry" | "rain" | "mixed" | "auto"
//   SEASON_HINT           "summer" | "shoulder" | "winter"
//   MODEL                 default: "gpt-4.1-mini"
// Files expected (repo-relative):
//   schema/intervalsPlan.schema.json
//   state/static-context.md
//   state/athlete.json
//
// Output:
//   plans/<START>_<END>.json  (pretty-printed)
//   plans/latest.json         (overwritten alias)

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import OpenAI from "openai";
import Ajv from "ajv";

function env(name, { required = false, fallback = "" } = {}) {
  const v = process.env[name];
  if (required && (!v || !v.trim())) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return (v && v.trim()) || fallback;
}

// ----------- Read inputs / config -----------
const OPENAI_API_KEY = env("OPENAI_API_KEY", { required: true });
const START = env("START", { required: true });
const END = env("END", { required: true });
const INTENT = env("INTENT", { required: true });
const MODEL = env("MODEL", { fallback: "gpt-4.1-mini" });

// Weather/season overrides (optional)
const OVERRIDE_LRW = env("LONGRIDE_WEATHER", { fallback: "" }).toLowerCase();
const OVERRIDE_SEASON = env("SEASON_HINT", { fallback: "" }).toLowerCase();
const validLRW = new Set(["dry", "rain", "mixed", "auto", ""]);
const validSeasons = new Set(["summer", "shoulder", "winter", ""]);

// Files
const schemaPath = "schema/intervalsPlan.schema.json";
const staticCtxPath = "state/static-context.md";
const athletePath = "state/athlete.json";

// ----------- Load schema / state -----------
if (!fs.existsSync(schemaPath)) {
  console.error(`Schema not found at ${schemaPath}`);
  process.exit(1);
}
if (!fs.existsSync(staticCtxPath)) {
  console.error(`Static context not found at ${staticCtxPath}`);
  process.exit(1);
}
if (!fs.existsSync(athletePath)) {
  console.error(`Athlete state not found at ${athletePath}`);
  process.exit(1);
}

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const staticContext = fs.readFileSync(staticCtxPath, "utf8");

// Small “live” athlete state you curate (keep this short)
const athlete = JSON.parse(fs.readFileSync(athletePath, "utf8"));
const lrw = validLRW.has(OVERRIDE_LRW) ? OVERRIDE_LRW : "auto";
const season = validSeasons.has(OVERRIDE_SEASON) ? OVERRIDE_SEASON : "";

const longride_weather =
  (lrw && lrw !== "" ? lrw : athlete.longride_weather) || "auto";
const season_hint =
  (season && season !== "" ? season : athlete.season_hint) || "summer";

// ----------- OpenAI client -----------
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ----------- AJV validator -----------
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

// ----------- Prompt assembly -----------
// Put long, stable stuff FIRST to benefit from prompt caching.
// Then append the tiny, frequently-changing state LAST. :contentReference[oaicite:1]{index=1}
const systemPrompt = [
  "You are a cycling coach that outputs ONLY JSON matching the provided schema.",
  "Honor split FTPs: use ftp_indoor for INDOOR sessions, ftp_outdoor for OUTDOOR sessions.",
  "Use local ISO datetimes (YYYY-MM-DDThh:mm:ss) with NO timezone suffix (no 'Z').",
  "Durations are in seconds (moving_time).",
  "Never emit prose or markdown; JSON only."
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
`;

// Helper to call model with Structured Outputs (JSON Schema strict)
// Structured Outputs details: platform docs. :contentReference[oaicite:2]{index=2}
async function callModel({ prompt, errorListJson = "" }) {
  const messages = [
    { role: "system", content: systemPrompt + "\n\n" + staticContext },
    {
      role: "user",
      content:
        prompt +
        (errorListJson
          ? `\n\nFIX_TO_SCHEMA_ERRORS:\n${errorListJson}\nReturn ONLY valid JSON that conforms to the schema.`
          : "")
    }
  ];

  const resp = await openai.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.2,
    // Structured Outputs via json_schema + strict true
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "IntervalsPlan",
        schema,
        strict: true
      }
    }
  });

  const content = resp.choices?.[0]?.message?.content ?? "";
  return content;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeOutputs(obj) {
  ensureDir("plans");
  const outPath = path.join("plans", `${START}_${END}.json`);
  fs.writeFileSync(outPath, JSON.stringify(obj, null, 2));
  // Also update an alias for your SPA
  const latest = path.join("plans", "latest.json");
  fs.writeFileSync(latest, JSON.stringify(obj, null, 2));
  console.log(`Wrote ${outPath} and updated plans/latest.json`);
}

(async () => {
  try {
    console.log(
      `Generating plan ${START}..${END} intent=${INTENT} weather=${longride_weather} season=${season_hint} model=${MODEL}`
    );

    // First attempt
    const first = await callModel({ prompt: liveState });
    let data;
    try {
      data = JSON.parse(first);
    } catch (e) {
      console.warn("First response was not valid JSON. Will attempt repair.");
      data = {};
    }

    // Validate
    if (!validate(data)) {
      const errs = JSON.stringify(validate.errors, null, 2);
      console.warn("Schema validation failed. Attempting one repair pass...");
      const second = await callModel({
        prompt: liveState,
        errorListJson: errs
      });
      try {
        data = JSON.parse(second);
      } catch (e) {
        console.error("Second response still not JSON. Aborting.");
        process.exit(1);
      }
      if (!validate(data)) {
        console.error(
          "Model failed schema after repair pass:\n",
          JSON.stringify(validate.errors, null, 2)
        );
        process.exit(1);
      }
    }

    // Success -> write files
    writeOutputs(data);
  } catch (err) {
    console.error("Fatal:", err?.message || err);
    process.exit(1);
  }
})();
