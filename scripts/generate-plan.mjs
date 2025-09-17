// scripts/generate-plan.mjs
// Node 20+. ESM (.mjs). Designed for GitHub Actions or local use.
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
//
// Files expected:
//   schema/intervalsPlan.schema.json
//   state/static-context.md
//   state/athlete.json
//
// Output:
//   plans/<START>_<END>.json
//   plans/latest.json

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Ajv from "ajv/dist/2020.js"

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

// ---------- env/config ----------
const OPENAI_API_KEY = env("OPENAI_API_KEY", { required: true });
const START = env("START", { required: true });
const END = env("END", { required: true });
const INTENT = env("INTENT", { required: true });
const MODEL = env("MODEL", { fallback: "gpt-4.1-mini" });

const OVERRIDE_LRW = env("LONGRIDE_WEATHER", { fallback: "" }).toLowerCase();
const OVERRIDE_SEASON = env("SEASON_HINT", { fallback: "" }).toLowerCase();
const validLRW = new Set(["dry", "rain", "mixed", "auto", ""]);
const validSeasons = new Set(["summer", "shoulder", "winter", ""]);

// ---------- file paths ----------
const schemaPath = "schema/intervalsPlan.schema.json";
const staticCtxPath = "state/static-context.md";
const athletePath = "state/athlete.json";

// ---------- existence checks ----------
for (const p of [schemaPath, staticCtxPath, athletePath]) {
  if (!fs.existsSync(p)) {
    console.error(`Required file missing: ${p}`);
    process.exit(1);
  }
}

// ---------- load resources ----------
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const staticContext = fs.readFileSync(staticCtxPath, "utf8");
const athlete = JSON.parse(fs.readFileSync(athletePath, "utf8"));

const lrw = validLRW.has(OVERRIDE_LRW) ? OVERRIDE_LRW : "auto";
const season = validSeasons.has(OVERRIDE_SEASON) ? OVERRIDE_SEASON : "";

const longride_weather =
  (lrw && lrw !== "" ? lrw : athlete.longride_weather) || "auto";
const season_hint =
  (season && season !== "" ? season : athlete.season_hint) || "summer";

// ---------- AJV setup (draft-2020-12 via Ajv 2020 build) ----------
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

// ---------- prompts ----------
const systemPrompt = [
  "You are a cycling coach that outputs ONLY JSON matching the provided schema.",
  "Honor split FTPs: use ftp_indoor for INDOOR sessions, ftp_outdoor for OUTDOOR sessions.",
  "Use local ISO datetimes (YYYY-MM-DDThh:mm:ss) with NO timezone suffix (no 'Z').",
  "Durations are in seconds via moving_time.",
  "Never emit prose or markdown; JSON only."
].join("\n");

// Keep the changing state small and last (prompt caching friendly).
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

// ---------- OpenAI call (native fetch with retries) ----------
async function callOpenAI({ prompt, errorListJson = "" }) {
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

  const body = {
    model: MODEL,
    messages,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "IntervalsPlan",
        schema,
        strict: true
      }
    }
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
          console.warn(
            `OpenAI transient error (attempt ${attempt}/3). Backoff ${backoff}ms...`
          );
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
      console.warn(
        `Fetch error (attempt ${attempt}/3): ${e?.message || e}. Backoff ${backoff}ms...`
      );
      await sleep(backoff);
    }
  }
  throw lastErr || new Error("OpenAI request failed after retries.");
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
      `Generating plan ${START}..${END} intent=${INTENT} weather=${longride_weather} season=${season_hint} model=${MODEL}`
    );

    // First pass
    const first = await callOpenAI({ prompt: liveState });
    let data;
    try {
      data = JSON.parse(first);
    } catch {
      console.warn("First response was not valid JSON; attempting repair pass.");
      data = {};
    }

    // Validate; if invalid, send AJV errors for a repair pass
    if (!validate(data)) {
      const errs = JSON.stringify(validate.errors, null, 2);
      console.warn("Schema validation failed; attempting repair pass...");
      const second = await callOpenAI({
        prompt: liveState,
        errorListJson: errs
      });
      try {
        data = JSON.parse(second);
      } catch {
        console.error("Repair pass still not JSON. Aborting.");
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

    writeOutputs(data);
  } catch (err) {
    console.error("Fatal:", err?.message || err);
    process.exit(1);
  }
})();
