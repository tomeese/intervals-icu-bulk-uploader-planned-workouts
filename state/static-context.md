# Coaching Static Context (T) — Stable Rules (Weather-Aware)

**Purpose:** Long-lived prefix for plan generation. Encodes coaching rules, naming/ID conventions, safety guardrails, watt-band logic, and **weather-aware long-ride selection**.  
**Dynamic info (FTP values, HRV/RHR notes, recent sessions, travel, weekday constraints, date range, weather flag) must come from `athlete.json` and the current request.**  
**Output contract:** Output **ONLY JSON** matching the provided schema (Intervals.icu “events” array). No prose.

---

## 0) Athlete + Equipment + Weather Inputs (read from live state)
- Use `ftp_indoor` for **INDOOR** sessions, `ftp_outdoor` for **OUTDOOR**.
- Timezone from `athlete.json.timezone`. Start times are **local** ISO (no “Z”).
- **Weather/Season fields (optional but preferred):**
  - `longride_weather`: `"dry" | "rain" | "mixed" | "auto"`
  - `season_hint`: `"summer" | "shoulder" | "winter"` (used only if `longride_weather` is missing)
- If venue isn’t fixed by constraints:
  - Weekdays default **INDOOR** except Thu (**OUTDOOR** preferred).
  - Weekends: long ride Sat, quality Sun (swap if constraints say so).

---

## 1) Output & Formatting Rules
- Emit only valid JSON per the schema. No markdown or commentary.
- Each event: `category`, `type`, `name`, `start_date_local`, `moving_time`, `external_id`, `description`. (`icu_training_load` recommended.)
- `category: "WORKOUT"`, `type: "Ride"`. `moving_time` in **seconds**.
- **Naming** must include venue tag, e.g.:
  - `Endurance Z2 - 4h30 (OUTDOOR)`
  - `Threshold - 2x20' @ 95–100% (INDOOR)`
- **external_id**: `YYYY-MM-DD-<slug>`; deterministic so re-runs upsert in place.
- Descriptions: concise recipe (WU, main sets, cadence, guardrails, fuel). No essays.

---

## 2) Watt Bands (computed from venue FTP)
Let `FTP = ftp_indoor` for INDOOR, `FTP = ftp_outdoor` for OUTDOOR.

- Recovery: **45–55% FTP**
- Endurance (Z2): **62–71% FTP**
- Tempo: **80–85% FTP**
- Sweet Spot (SS): **88–92% FTP**
- Threshold: **95–100% FTP**
- VO₂: **110–120% FTP**
- Tempo Torque: Tempo power at **60–65 rpm**, seated (never <55 rpm; skip torque if knees complain)

Cadence defaults: **85–95 rpm** unless torque work is specified.

---

## 3) Weekly Templates (weather-aware long ride)

### Recovery Week (~300 TSS)
- One light aerobic touch (Tempo 3×8’ **or** VO₂-lite 5×2’), otherwise Z2 + short recoveries.
- **Long ride duration & venue (weather-aware):**
  - If `longride_weather == "dry"` **(summer/dry)** → **OUTDOOR 2–3 h**
  - If `longride_weather == "rain"` → **INDOOR 1.5–2 h**
  - If `"mixed"` → plan **INDOOR 1.5–2 h**, include description note: “If forecast clears, OUTDOOR 2–3 h at same Z2.”
  - If `"auto"` or missing → use `season_hint`:
    - `"summer"` → OUTDOOR 2–3 h
    - `"shoulder"`/`"winter"` → INDOOR 1.5–2 h

### Build Week (~500 TSS target; adapt to recent fatigue)
- Tue intensity (alternate VO₂ and Threshold weeks).
- Thu aerobic Z2 (optionally one small tempo-torque insert if legs are good).
- **Long ride duration & venue (weather-aware):**
  - If `longride_weather == "dry"` **(summer/dry)** → **OUTDOOR 4–6 h**
  - If `longride_weather == "rain"` → **INDOOR 3–4 h**
  - If `"mixed"` → plan **INDOOR 3–4 h**, include description note: “If forecast clears, OUTDOOR 4–6 h at same Z2; adjust fuel/Na accordingly.”
  - If `"auto"` or missing → use `season_hint`:
    - `"summer"` → OUTDOOR 4–6 h
    - `"shoulder"`/`"winter"` → INDOOR 3–4 h
- Sun quality (Threshold **or** SS) depending on how Sat went.
- Never schedule torque within 24 h of VO₂; ≥48 h between VO₂ and next Threshold if fatigue signals are high.

---

## 4) Adaptive Guardrails (HRV/RHR/Feel → pick intensity)
Traffic-light logic based on live state:

- **GREEN** (HRV balanced, RHR within ≤2 bpm of 4-wk avg, legs normal):
  - VO₂ **5×3’ @ ~118% FTP** (4’ easy)
  - Threshold **2×20’ @ 95–100%**
- **AMBER** (HRV improving not normal, RHR +3–5 bpm, legs “okay”):
  - VO₂ **4×3’ @ ~118%**
  - Threshold **2×18’ @ 95–99%**
- **RED** (HRV low, poor sleep, RHR ≥+6 bpm, legs heavy):
  - VO₂-lite **5×2’ @ 110–115%**
  - Replace Threshold with **SS 3×12’ @ 88–92%**

When generating the week, schedule the GREEN default and include AMBER/RED fallbacks in each day’s `description`.

---

## 5) Decoupling Rules (adjust next quality)
Use last long-ride power:HR drift:

- Drift **<3%** & TSS reasonable → keep planned Threshold **2×20’**.
- Drift **3–6%** or long-ride TSS high (>~200) → trim to **2×18’**.
- Drift **>6%** or heat/dehydration issues → replace Threshold with **SS 3×12’**.

Include the chosen adjustment in the next quality day’s description.

---

## 6) Hydration & Fuel Heuristics
- Long Z2 ≥4 h: **80–100 g carbs/hr**, **700–1000 mg sodium/hr**, **600–900 ml fluid/hr** (more in heat).
- Start fueling within first **15–20 min**; keep **carbs decoupled from fluids** (water + separate carb mix).
- If drift hits **5–6%** mid-ride: ride **15–20 min** at low Z2 and increase fluids/Na; reassess.

---

## 7) Naming Library
- `Recovery - 45 min (INDOOR)`
- `Endurance Z2 - 90 min (INDOOR)`
- `Endurance Z2 - 2h30 (OUTDOOR)`
- `Endurance Z2 - 4h30 (OUTDOOR)`
- `Endurance Z2 - 3h (INDOOR)`   ← rainy build-week long ride
- `Tempo - 3x8' @ 80–85% (INDOOR)`
- `Sweet Spot - 3x12' @ 88–92% (INDOOR)`
- `Thresh
