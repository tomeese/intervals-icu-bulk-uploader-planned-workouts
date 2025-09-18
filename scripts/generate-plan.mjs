/**
 * File: scripts/generate-plan.mjs
 * Purpose: Generate a weekly Intervals.icu plan JSON via OpenAI with guardrails & post-rules.
 * Inputs (ENV):
 *   OPENAI_API_KEY   (required)
 *   START            (YYYY-MM-DD, required)
 *   END              (YYYY-MM-DD, optional; if blank/"auto" → computed as Sunday)
 *   INTENT           (build-week | recovery-week | race-week; default: recovery-week)
 *   NOTES            (freeform weekly notes; optional)
 *   DAILY_NOTES_JSON (JSON map: {"YYYY-MM-DD": "..."}; optional)
 *   MODEL            (OpenAI model id; default: gpt-4.1-mini)
 *   OUT              (output filepath; default: plans/<START>_<END>.json or drafts if path includes /drafts/)
 *   STATIC_CONTEXT   (path to static-context.md; default: ./static-context.md)
 *   PLAN_RULES       (path to JSON rule config; default: ./config/plan-rules.json if present)
 *
 * Behavior:
 *  - Reads static-context.md and optional rules JSON to seed system context.
 *  - Generates a plan covering ALL dates in START..END (inclusive, local), skipping days marked "Rest Day" in daily notes.
 *  - Enforces weekday duration caps (<= 90' hard cap 105') and weekend-only long rides.
 *  - Validates output against a strict JSON Schema (Ajv 2020). Auto-fixes common issues & re-validates.
 *  - Writes OUT path (creates dirs). Logs a compact summary.
 */

import fs from 'fs/promises';
import path from 'node:path';
import process from 'node:process';
import OpenAI from 'openai';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYMDLocal = (s) => { const [y,m,d] = String(s).split('-').map(Number); return new Date(y, (m||1)-1, d||1, 0,0,0,0); };
const mondayOfWeek = (d) => { const x = new Date(d); const wd = x.getDay(); const diff = wd === 0 ? -6 : 1 - wd; x.setDate(x.getDate() + diff); x.setHours(0,0,0,0); return x; };
const sundayOfWeek = (d) => { const m = mondayOfWeek(d); const s = new Date(m); s.setDate(m.getDate() + 6); return s; };
const inWeekend = (dateIso) => { const wd = fromYMDLocal(dateIso).getDay(); return wd === 0 || wd === 6; };
const toSeconds = (minutes) => Math.max(0, Math.round(Number(minutes) * 60));

async function readIfExists(file) {
  try { return await fs.readFile(file, 'utf-8'); } catch { return null; }
}
async function readJsonIfExists(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf-8')); } catch { return fallback; }
}
async function ensureDirFor(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
}

function listDatesInclusive(startISO, endISO) {
  const out = []; const s = fromYMDLocal(startISO); const e = fromYMDLocal(endISO);
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(iso(d));
  return out;
}

function clamp(n, lo, hi) { n = Number(n); return isNaN(n) ? lo : Math.max(lo, Math.min(hi, n)); }

function sanitizeName(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 100); }

function makeExternalId(ev) {
  const date = String(ev.start_date_local || '').slice(0,10) || '0000-00-00';
  const typ = String(ev.type || 'Ride').toLowerCase().replace(/\s+/g, '-');
  const load = Number(ev.icu_training_load || 0) | 0;
  const mov = Number(ev.moving_time || 0) | 0;
  return `${date}-${typ}-${load}-${mov}`;
}

function asHHMM(dtStr) {
  // Expect YYYY-MM-DDTHH:MM; if missing time, default to 06:30 (weekend 07:00)
  const m = String(dtStr || '').match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/);
  if (!m) return dtStr;
  const day = m[1];
  const hhmm = m[2] || '06:30';
  return `${day}T${hhmm}`;
}

// ---------- schema ----------
const IntervalsPlanSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.com/intervals-plan.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category','type','name','start_date_local','moving_time','icu_training_load','external_id','description'],
        properties: {
          category: { type: 'string', const: 'WORKOUT' },
          type: { type: 'string', enum: ['Ride','Gravel Ride','Virtual Ride','Run','Swim','Workout'] },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          start_date_local: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
          moving_time: { type: 'integer', minimum: 0 },
          icu_training_load: { type: 'integer', minimum: 0 },
          external_id: { type: 'string', minLength: 1 },
          description: { type: 'string' },
        }
      }
    }
  }
};

// ---------- main ----------
(async function main() {
  const {
    OPENAI_API_KEY,
    START,
    END,
    INTENT = 'recovery-week',
    NOTES = '',
    DAILY_NOTES_JSON = '',
    MODEL = 'gpt-4.1-mini',
    OUT,
    STATIC_CONTEXT = path.resolve('static-context.md'),
    PLAN_RULES = path.resolve('config/plan-rules.json'),
  } = process.env;

  if (!OPENAI_API_KEY) { console.error('Fatal: OPENAI_API_KEY not set'); process.exit(2); }
  if (!START) { console.error('Fatal: START (YYYY-MM-DD) required'); process.exit(2); }

  // Compute END (Sunday) if missing/auto
  let startISO = iso(mondayOfWeek(fromYMDLocal(START)));
  let endISO = END && END !== 'auto' ? iso(fromYMDLocal(END)) : iso(sundayOfWeek(fromYMDLocal(START)));
  const dates = listDatesInclusive(startISO, endISO);

  const outPath = OUT || (path.join('plans', `${startISO}_${endISO}.json`));
  const isDraft = /\bplans\/(draft|drafts)\//i.test(outPath);

  console.log(`Generating plan ${startISO}..${endISO} intent=${INTENT} model=${MODEL} -> ${outPath}${isDraft ? ' (draft)' : ''}`);

  // Load static & rules
  const staticContext = (await readIfExists(STATIC_CONTEXT)) || '';
  const planRules = (await readJsonIfExists(PLAN_RULES, null));

  // Notes
  let dailyNotes = {};
  try { dailyNotes = DAILY_NOTES_JSON ? JSON.parse(DAILY_NOTES_JSON) : {}; } catch {}

  // Compose prompt
  const weekdayCapMin = planRules?.weekday_cap_minutes ?? 90; // hard cap 90'
  const weekdaySoftCapMin = planRules?.weekday_soft_cap_minutes ?? 105; // allow 105' occasionally
  const indoorFTP = planRules?.ftp?.indoor ?? 314;
  const outdoorFTP = planRules?.ftp?.outdoor ?? 324;

  const dayRules = planRules?.weekly_template || {
    Monday: 'Rest Day (no workout) unless notes override',
    Tuesday: 'High-intensity day (sprints/anaerobic/VO2). Include warmup, work, Z2, cooldown. ~60–90 min (105 max).',
    Wednesday: 'Recovery (easy spin) 30–60 min or off.',
    Thursday: 'Intensity day with tempo/SS/threshold (often low cadence). ~60–90 min (105 max).',
    Friday: 'Recovery (easy spin) 30–60 min or off.',
    Saturday: 'Long Endurance (Z2). Build weeks: 4–6h dry outdoor / 3–4h wet indoor. Recovery weeks: 2–3h dry / 1.5–2h wet.',
    Sunday: 'Threshold/SS/Tempo focus, 90–120 min. If big Saturday, keep lower end of range.'
  };

  const sys = [
    'You are a meticulous endurance cycling coach generating a weekly plan for Tom.',
    'Always return STRICT JSON matching the schema named IntervalsPlan. No extra keys.',
    'Rules:',
    `- Weekdays must not exceed ${weekdayCapMin} minutes (with rare exceptions up to ${weekdaySoftCapMin} if notes demand).`,
    '- Long rides ONLY on Saturday or Sunday.',
    `- Use FTP 314 W for INDOOR workouts and 324 W for OUTDOOR. Reflect in names/descriptions.`,
    '- Use start times like 06:30 weekdays, 07:00 weekends, format YYYY-MM-DDTHH:MM.',
    '- If a day is marked "Rest Day (no workout)" in notes, SKIP that day entirely.',
    '- Include concise fueling/hydration guidance for rides ≥90 min.',
    '- Keep descriptions compact: main targets, cadences (e.g., low cadence), and one AMBER/RED fallback if relevant.',
  ].join('\n');

  const dayMap = { 1:'Monday',2:'Tuesday',3:'Wednesday',4:'Thursday',5:'Friday',6:'Saturday',0:'Sunday' };
  const dayRuleText = dates.map(d => `${d} (${dayMap[fromYMDLocal(d).getDay()]}): ${dayRules[dayMap[fromYMDLocal(d).getDay()]] || ''}`).join('\n');

  const dailyNotesText = Object.entries(dailyNotes)
    .filter(([k,v]) => dates.includes(k) && String(v).trim())
    .map(([k,v]) => `${k}: ${String(v).trim()}`)
    .join('\n');

  const weeklyNotes = String(NOTES || '').trim();

  const user = [
    `INTENT: ${INTENT}`,
    `DATES_TO_COVER (inclusive):\n${dates.join('\n')}`,
    '',
    'DAY_BOUNDS & TEMPLATES:',
    dayRuleText,
    '',
    weeklyNotes ? `WEEKLY_NOTES:\n${weeklyNotes}` : null,
    dailyNotesText ? `DAILY_NOTES (freeform, per date):\n${dailyNotesText}` : null,
    '',
    'OUTPUT CONTRACT:',
    '- Provide an event for EACH date unless that date has Rest Day in notes/template.',
    '- name must be present. Include (INDOOR) or (OUTDOOR) in the name when clear from notes/typical day.',
    '- category must be WORKOUT; type is one of Ride, Gravel Ride, Virtual Ride, Run, Swim, Workout.',
    '- start_date_local format YYYY-MM-DDTHH:MM (local), moving_time in seconds, icu_training_load integer.',
    '- external_id must be stable and slug-like (e.g. date-shortname).',
  ].filter(Boolean).join('\n');

  // OpenAI call with retries
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const schemaForAPI = { name: 'IntervalsPlan', schema: IntervalsPlanSchema, strict: true };

  let rawText = null, lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await client.responses.create({
        model: MODEL,
        input: [
          { role: 'system', content: staticContext ? `${sys}\n\nSTATIC CONTEXT:\n${staticContext}` : sys },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_output_tokens: 4000,
        response_format: { type: 'json_schema', json_schema: schemaForAPI },
      });
      // Prefer output_text if present; otherwise stitch content
      rawText = resp.output_text || '';
      if (!rawText) {
        const pieces = [];
        for (const block of resp.output || []) {
          for (const c of (block.content || [])) { if (c.type === 'output_text' && c.text) pieces.push(c.text); }
        }
        rawText = pieces.join('');
      }
      if (rawText) break;
      throw new Error('empty response');
    } catch (e) {
      lastErr = e;
      console.error(`Fetch error (attempt ${attempt}/3): ${e?.message || e}`);
      await sleep(500 * Math.pow(2, attempt - 1));
    }
  }
  if (!rawText) {
    console.error('Fatal: no response from model');
    if (lastErr) console.error(lastErr);
    process.exit(1);
  }

  // Parse JSON (defensive)
  function safeParseFirstJson(s) {
    try { return JSON.parse(s); } catch {}
    const m = s.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return null;
  }
  let plan = safeParseFirstJson(rawText);
  if (!plan) { console.error('Fatal: model output is not valid JSON'); process.exit(1); }

  // ---------- post processing & fixes ----------
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(IntervalsPlanSchema);

  // Ensure shape
  if (Array.isArray(plan)) plan = { events: plan };
  if (!plan.events) plan.events = [];

  // Fill/clean per event
  for (const ev of plan.events) {
    ev.category = 'WORKOUT';
    ev.type = ev.type && ['Ride','Gravel Ride','Virtual Ride','Run','Swim','Workout'].includes(ev.type) ? ev.type : 'Ride';
    ev.name = sanitizeName(ev.name || ev.type || 'Workout');
    ev.start_date_local = asHHMM(ev.start_date_local || ev.date || '');
    ev.moving_time = Number.isFinite(ev.moving_time) ? Math.max(0, Math.round(ev.moving_time)) : 0;
    ev.icu_training_load = Number.isFinite(ev.icu_training_load) ? Math.max(0, Math.round(ev.icu_training_load)) : 0;
    if (!ev.external_id) ev.external_id = makeExternalId(ev);

    // Weekday duration cap
    const dayIso = String(ev.start_date_local || '').slice(0,10);
    const isWknd = inWeekend(dayIso);
    if (!isWknd) {
      const cap = toSeconds(weekdaySoftCapMin);
      if (ev.moving_time > cap) {
        ev.moving_time = cap; // clamp
        ev.description = `${ev.description ? ev.description + '\n' : ''}(auto-adjusted: weekday cap ${weekdaySoftCapMin}min)`;
      }
    }

    // Long-ride weekday guard: if description suggests long, and weekday → annotate
    const looksLong = /\b(long ride|\b(3h|4h|5h|6h|180m|240m|300m)\b)/i.test(ev.name + ' ' + (ev.description||''));
    if (looksLong && !isWknd) {
      ev.description = `${ev.description ? ev.description + '\n' : ''}(auto-adjusted: long rides only on Sat/Sun)`;
      ev.moving_time = Math.min(ev.moving_time, toSeconds(weekdaySoftCapMin));
    }

    // Indoors/Outdoors FTP hint
    const isIndoor = /INDOOR/i.test(ev.name) || /indoor/i.test(ev.description||'');
    const isOutdoor = /OUTDOOR/i.test(ev.name) || /outdoor/i.test(ev.description||'');
    const ftp = isIndoor ? indoorFTP : isOutdoor ? outdoorFTP : indoorFTP;
    if (!/FTP/i.test(ev.description||'')) {
      ev.description = `${ev.description ? ev.description + '\n' : ''}(Ref: FTP ${ftp} W ${isIndoor? 'INDOOR':'OUTDOOR'})`;
    }
  }

  // Ensure coverage & skip rest days from DAILY_NOTES
  const wantDates = new Set(dates);
  const haveDates = new Set(plan.events.map(e => String(e.start_date_local||'').slice(0,10)));

  // Drop events that are on dates marked as explicit Rest Day
  const restDates = new Set(Object.entries(dailyNotes)
    .filter(([d,txt]) => /Rest Day/i.test(String(txt)))
    .map(([d]) => d));
  plan.events = plan.events.filter(e => !restDates.has(String(e.start_date_local||'').slice(0,10)));

  // Add placeholders for missing dates (simple 45' recovery), unless date is rest
  for (const d of wantDates) {
    if (restDates.has(d)) continue;
    if (!haveDates.has(d)) {
      const wknd = inWeekend(d);
      const defaultMin = wknd ? 90 : 45;
      const mt = toSeconds(defaultMin);
      plan.events.push({
        category: 'WORKOUT',
        type: 'Ride',
        name: wknd ? 'Endurance Z2 - 90 min (OUTDOOR)' : 'Recovery - 45 min (INDOOR)',
        start_date_local: `${d}T${wknd ? '07:00' : '06:30'}`,
        moving_time: mt,
        icu_training_load: wknd ? 50 : 20,
        external_id: `${d}-${wknd?'endurance-90':'recovery-45'}`,
        description: wknd ? 'Z2 62–71% FTP, fuel 80–100g carbs/hr, sodium 700–1000mg/hr, 600–900ml/hr.' : 'Very easy spin 45–55% FTP. Keep it chill.'
      });
    }
  }

  // Final sort by date/time
  plan.events.sort((a,b) => String(a.start_date_local).localeCompare(String(b.start_date_local)));

  // Validate
  const valid = validate(plan);
  if (!valid) {
    console.error('Schema validation errors:');
    console.error(validate.errors);
    // Attempt a final coercion for times without HH:MM
    for (const ev of plan.events) ev.start_date_local = asHHMM(ev.start_date_local);
    if (!validate(plan)) {
      console.error('Fatal: still invalid after fixes.');
      process.exit(1);
    }
  }

  // Write file
  await ensureDirFor(outPath);
  await fs.writeFile(outPath, JSON.stringify(plan, null, 2) + "\n", 'utf-8');

  // Summary
  const totalEvents = plan.events.length;
  const totalLoad = plan.events.reduce((s,e)=> s + (Number(e.icu_training_load)||0), 0);
  const totalHours = Math.round((plan.events.reduce((s,e)=> s + (Number(e.moving_time)||0), 0) / 3600 + Number.EPSILON) * 10) / 10;
  console.log(`[ok] wrote ${outPath}`);
  console.log(`[summary] events=${totalEvents} TSS=${totalLoad} hours=${totalHours}`);

  // Optionally update a latest pointer if writing a final plan
  try {
    if (!isDraft) {
      const latestPtr = path.join(path.dirname(outPath), 'latest.json');
      await fs.writeFile(latestPtr, JSON.stringify(plan, null, 2) + "\n", 'utf-8');
      console.log(`[pointer] updated ${latestPtr}`);
    }
  } catch (e) {
    console.warn('Could not update latest pointer:', e?.message || e);
  }
})();
