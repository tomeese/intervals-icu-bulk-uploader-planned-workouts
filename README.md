# Intervals.icu Bulk Uploader

A tiny CLI that uploads planned workouts to your Intervals.icu calendar using the official REST API. 
It uses Basic auth with `username="API_KEY"` and your Intervals personal API key as the password.

## Features
- Reads events from a JSON file (list or `{"events": [...]}`).
- Normalizes common fields for planned workouts.
- Uses `upsert=true` so re-running updates existing items based on `external_id`.
- Defaults `athlete_id` to `0` which means "me".
- No secrets in files. Use the `INTERVALS_API_KEY` environment variable or `--api-key`.

## Install
```bash
# Optional: create a venv
python3 -m venv .venv && source .venv/bin/activate

# Install from source
pip install -e .
```

This exposes a command named **`icu-upload`**.

## Quick start
1) Put your Intervals API key in an env var:
```bash
export INTERVALS_API_KEY="YOUR_KEY"
```

2) Edit `examples/payload.json` for your plan.

3) Dry run to inspect the payload:
```bash
icu-upload examples/payload.json --dry-run --verbose
```

4) Send to Intervals.icu:
```bash
icu-upload examples/payload.json
```

## JSON format
Minimum useful fields for planned workouts:
- `category`: `"WORKOUT"`
- `start_date_local`: ISO local datetime **without Z**. Example: `2025-09-08T06:30:00`
- `type`: one of `Ride`, `Run`, `Swim`, `Workout`
- `moving_time`: seconds for planned duration
- `icu_training_load`: integer planned load (TSS-equivalent)
- `external_id`: stable ID so upserts work

You can keep a `description` with a `TSS X` line if you like. The tool will quietly drop unsupported fields like `start_time` or `duration` if they show up.

## CLI
```bash
icu-upload PAYLOAD.json [--api-key KEY] [--athlete-id 0] [--base-url https://intervals.icu] [--no-upsert] [--dry-run] [--verbose]
```

- `--api-key` overrides `INTERVALS_API_KEY`
- `--athlete-id` defaults to `0` which targets your own athlete profile
- `--no-upsert` sends `upsert=false`
- `--dry-run` prints the outgoing JSON and exits
- `--verbose` prints extra info

## Example payload
See `examples/payload.json` for a 2‑event sample including field normalization.

## Notes
- This project sticks to the official endpoint `/api/v1/athlete/0/events/bulk?upsert=true`.
- Intervals sometimes accepts multiple alias values for `type`. The CLI maps common aliases to the safe set above.
- If your `start_date_local` ends with `Z`, the CLI strips it. Keep it local time. No timezone suffix.

## Development
```bash
# lint
python -m compileall src

# run from source without install
python -m intervals_icu_uploader.cli examples/payload.json --dry-run --verbose
```
---

## Weekly Summary (auto-run, planned vs actual)

Every Sunday night (Pacific), a workflow pulls **Mon→Sun** data from Intervals.icu and writes:

- `reports/weekly/weekly-YYYY-MM-DD.md` — human summary
- `reports/weekly/weekly-YYYY-MM-DD.json` — raw totals & breakdowns
- `reports/weekly/weekly-YYYY-MM-DD-summary.csv` — one-row totals (actual vs planned)
- `reports/weekly/weekly-YYYY-MM-DD-bytype.csv` — per-activity-type (actual vs planned)

**Metrics**
- **Actual vs Planned**: Time, TSS (Load), and deltas (Actual − Planned)
- Fitness: **CTL**, **ATL**, **Form (TSB = CTL − ATL)**, **Ramp Rate**
- Breakdowns by activity type (Ride/Run/Swim/Workout/etc.)

**Run locally**
```bash
export INTERVALS_API_KEY="YOUR_KEY"
icu-weekly-summary --athlete-id 0 --tz America/Los_Angeles --outdir reports/weekly


## License
MIT
