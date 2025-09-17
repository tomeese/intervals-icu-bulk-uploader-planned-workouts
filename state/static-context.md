# Coaching Static Context (Tom) — Stable Rules (Weather + Schedule Aware)

**Purpose:** Long-lived prefix for plan generation. Encodes coaching rules, naming/ID conventions, watt-band logic, **weekday duration caps**, **weekend-only long rides**, and **day-by-day templates**.  
**Dynamic info** (FTP values, HRV/RHR notes, recent sessions, travel, date range, weather flag, NOTES) comes from `athlete.json` and the current request.  
**Output contract:** Output **ONLY JSON** matching the provided schema (Intervals.icu `events[]`). No prose.

---

## 0) Inputs (from live state)
- **FTP split:** Use `ftp_indoor` for **INDOOR** sessions, `ftp_outdoor` for **OUTDOOR**. Do **not** hardcode.
- **Timezone:** Use `athlete.json.timezone`. All times are **local ISO** (no “Z”).
- **Weather/Season (optional):**
  - `longride_weather`: `"dry" | "rain" | "mixed" | "auto"`
  - `season_hint`: `"summer" | "shoulder" | "winter"` (used if `longride_weather=auto/missing`)
- **NOTES:** If provided, treat as high-priority weekly context (e.g., “HRV is green”).

---

## 1) Output & Formatting Rules
- Emit only valid JSON per the schema. No markdown or commentary.
- Each event **must** include: `category`, `type`, `name`, `start_date_local`, `moving_time`, `icu_training_load`, `external_id`, `description`.
- `category: "WORKOUT"`, `type: "Ride"`. `moving_time` in **seconds**.
- **Start times are exact:** Weekdays **`17:30:00`**, Weekends **`09:00:00`** (unless explicitly overridden).
- **Naming** keep ≤120 chars. Examples:
  - `Endurance Z2 - 90 min (INDOOR)`
  - `Threshold - 2x20' @ 95–100% (INDOOR)`
  - `Endurance Z2 - 4h30 (OUTDOOR)`
- **external_id:** deterministic `YYYY-MM-DD-<slug>` so re-runs **upsert** cleanly.
- **Descriptions:** concise recipe (WU, main sets, recoveries, cadence, guardrails, fuel). Avoid essays.

---

## 2) Watt Bands (compute from venue FTP)
Let `FTP = ftp_indoor` for INDOOR, `FTP = ftp_outdoor` for OUTDOOR.

- **Recovery:** 45–55% FTP  
- **Endurance (Z2):** 62–71% FTP  
- **Tempo:** 80–85% FTP  
- **Sweet Spot (SS):** 88–92% FTP  
- **Threshold:** 95–100% FTP  
- **VO₂:** 110–120% FTP  
- **Tempo Torque:** Tempo power at **60–65 rpm**, seated (never <55 rpm; skip torque if knees complain)

Default cadence: **85–95 rpm** unless torque work is specified.

---

## 3) Scheduling Defaults & Exact Times
- If venue isn’t fixed by constraints: weekdays default **INDOOR** (Thu often **OUTDOOR** if needed), weekends: long ride **Saturday**, quality **Sunday** (swap only if constraints require).
- **Start times:** Weekdays **17:30:00**, Weekends **09:00:00** (local ISO, no “Z”). Do not invent other times.

---

## 4) **Weekday/Weekend Duration Constraints (Hard Guardrails)**
- **Weekdays (Mon–Fri):**  
  - **Cap** rides at **≤ 90 minutes**.  
  - At most **one** weekday may be **105 minutes**; otherwise stay ≤ 90′.  
  - **Never** schedule **≥ 120 minutes** on a weekday.
- **Weekends (Sat/Sun):**  
  - Any ride **≥ 120 minutes** must be on **Saturday or Sunday** (long ride).  
  - **Long-ride placement:** **Saturday (primary)**, **Sunday (backup)**. If neither date exists in the range, **omit** a long ride rather than violating weekday caps.

---

## 5) Weather-Aware Long-Ride Durations
When placing the long ride (per §4), choose venue/duration from weather:

### Build Week target
- **Dry / summer:** **OUTDOOR 4–6 h**  
- **Rain:** **INDOOR 3–4 h**  
- **Mixed:** plan **INDOOR 3–4 h**, add note: “If forecast clears → OUTDOOR 4–6 h.”  
- **Auto:** use `season_hint` → `"summer"` → OUTDOOR 4–6 h; `"shoulder"`/`"winter"` → INDOOR 3–4 h.

### Recovery Week target
- **Dry / summer:** **OUTDOOR 2–3 h**  
- **Rain:** **INDOOR 1.5–2 h**  
- **Mixed:** plan **INDOOR 1.5–2 h**, add note: “If clears → OUTDOOR 2–3 h.”  
- **Auto:** use `season_hint` → `"summer"` → OUTDOOR 2–3 h; `"shoulder"`/`"winter"` → INDOOR 1.5–2 h.

---

## 6) Weekly Templates — **By Day**
> Mon is a default rest day. One workout per listed date (no doubles).

- **Monday — Rest**  
  No event unless explicitly requested.

- **Tuesday — High Intensity (60–90′ total; ≤90′ weekday cap)**  
  One of: **sprints**, **anaerobic**, **VO₂max**, **Zwift race**, or similar.  
  **Structure:**  
  - **WU:** 10–20′ easy + a few 10–15″ neuromuscular primes.  
  - **WORK:** choose ONE focus (examples):  
    - VO₂: **5×3′ @ 115–120%** (4′ easy)  
    - Anaerobic: **8–10×60″ @ 130–150%** (2–3′ easy)  
    - Sprints: **8–10×12–15″ @ max** (3–4′ easy)  
    - Zwift race: replace WORK with race; keep total ≤90′  
  - **Z2:** 10–20′ aerobic settle  
  - **CD:** 5–10′ easy

- **Wednesday — Recovery (30–60′)**  
  **45–55% FTP**, 85–95 rpm, keep it boring on purpose. Trim to 30′ if fatigue or HRV amber/red.

- **Thursday — High-ish Aerobic Strength (75–90′; ≤90′ cap)**  
  Focus on **tempo/SS/threshold low-cadence** (torque).  
  **Examples (pick one):**  
  - **Tempo Torque:** **3×12′ @ 80–85%**, **60–65 rpm**, 5′ easy  
  - **Sweet Spot:** **3×12′ @ 88–92%**, 4–5′ easy  
  - **Threshold:** **2×16–20′ @ 95–100%**, 6–8′ easy (use this only if Tues wasn’t VO₂)  
  - Skip torque if knees/hips complain.  
  Include WU 10–15′ and CD 5–10′.

- **Friday — Recovery (30–60′)**  
  Same as Wednesday: **45–55% FTP**. No sneaky tempo.

- **Saturday — Long Endurance (weather-aware per §5)**  
  All Z2 **62–71% FTP**. Fuel/hydrate like an adult (see §9). If decoupling >5–6% mid-ride: back off to low Z2 for 15–20′, increase fluids/Na, reassess.

- **Sunday — Quality Aerobic (90–120′)**  
  **Threshold / SS / Tempo** depending on Saturday load & drift:  
  - If Sat drift **<3%** and legs good → **Threshold 2×20′ @ 95–100%**  
  - If Sat drift **3–6%** or TSS high → **Threshold 2×18′** *or* **SS 3×12′**  
  - If Sat drift **>6%** or heat/dehydration → **SS 3×12′**  
  Include WU 10–15′ and CD 5–10′.

---

## 7) Adaptive Guardrails (HRV/RHR/Feel)
Traffic-light defaults; include fallbacks in each day’s `description`:

- **GREEN** (balanced HRV, RHR ≤ +2 bpm, normal feel):  
  - VO₂ **5×3′ @ ~118%** (4′ easy)  
  - Threshold **2×20′ @ 95–100%**
- **AMBER** (HRV improving, RHR +3–5, “okay” legs):  
  - VO₂ **4×3′ @ ~118%**  
  - Threshold **2×18′ @ 95–99%**
- **RED** (HRV low/poor sleep/RHR ≥ +6/legs heavy):  
  - VO₂-lite **5×2′ @ 110–115%**  
  - Replace Threshold with **SS 3×12′ @ 88–92%**

---

## 8) Decoupling Rules (Sat → Sun)
Use last long-ride power:HR drift:

- Drift **<3%** & TSS reasonable → keep planned Threshold **2×20′**.  
- Drift **3–6%** or long-ride TSS high (>~200) → trim to **2×18′**.  
- Drift **>6%** or heat/dehydration issues → switch to **SS 3×12′**.

Mention the adjustment in Sunday’s description.

---

## 9) Hydration & Fuel Heuristics (embed briefly)
- ≥4 h Z2: **80–100 g carbs/hr**, **700–1000 mg Na/hr**, **600–900 ml fluid/hr** (more in heat).  
- Start fueling within **15–20 min**; keep **carbs decoupled from fluids** (bottles + water).  
- If drift **5–6%** mid-ride: ride **15–20 min** at low Z2, increase fluids/Na, reassess.

---

## 10) Naming Library (consistent verbs)
- `Recovery - 45 min (INDOOR)`  
- `Endurance Z2 - 90 min (INDOOR)`  
- `Endurance Z2 - 2h30 (OUTDOOR)`  
- `Endurance Z2 - 3h (INDOOR)`   ← rainy build-week long ride  
- `Tempo - 3x8' @ 80–85% (INDOOR)`  
- `Sweet Spot - 3x12' @ 88–92% (INDOOR)`  
- `Threshold - 2x20' @ 95–100% (INDOOR)`  
- `VO2 - 5x3' @ ~118% (INDOOR)`  
- `Tempo Torque - 3x12' @ 80–85% (OUTDOOR)`

---

## 11) Plan Assembly Heuristics
- Keep total TSS near `week_goal`. Provide a reasonable `icu_training_load` per event.  
- Prefer **OUTDOOR** for long Z2 when `longride_weather="dry"`; otherwise **INDOOR** long Z2 (per §5).  
- **Spacing:** never schedule torque within **24 h** of VO₂; leave **≥48 h** between VO₂ and the next Threshold if fatigue signals are high.  
- If the date range contains **no weekend**, skip long ride rather than breaking weekday caps.

---

## 12) Don’ts
- Don’t schedule torque the day before/after VO₂.  
- Don’t emit markdown/explanations—**JSON only**.  
- Don’t invent races/travel not in state/request.  
- Don’t use timezone “Z” or milliseconds in `start_date_local`.

---

## 13) Quality Gates
- Clarity over cleverness in `description`.  
- Names ≤120 chars; descriptions ≤~1000 chars.  
- `external_id` deterministic from date + slug so re-runs upsert cleanly.
