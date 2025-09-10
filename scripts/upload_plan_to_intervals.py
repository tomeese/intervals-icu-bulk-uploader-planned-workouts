#!/usr/bin/env python3
"""
Upload planned workouts to Intervals.icu via bulk upsert.

Usage (args match your workflow):
  python scripts/upload_plan_to_intervals.py \
    --plan snapshots/week-2025-07-21.json \
    --athlete-id 0 \
    --tz America/Los_Angeles \
    --default-start 06:00

Env:
  INTERVALS_API_KEY  (required)

Notes:
- Accepts either { "events": [...] } or a bare [ ... ].
- Leaves start_date_local as-is if it's already "YYYY-MM-DDTHH:MM".
  If it's only "YYYY-MM-DD", fills time with --default-start.
  Removes any trailing 'Z' (Intervals expects *local* time, no timezone suffix).
- Ensures category=WORKOUT, integer numeric fields, and a safe type whitelist.
- If external_id is missing, generates a deterministic one from date, type, load, and moving_time.
- Prints the Intervals response JSON (created/updated counts).
"""

import argparse
import os
import sys
import json
import re
from typing import List, Dict, Any

import requests
from requests.auth import HTTPBasicAuth


WHITELIST_TYPES = {"Ride", "Gravel Ride", "Virtual Ride", "Run", "Swim", "Workout"}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--plan", required=True, help="Path to JSON file")
    p.add_argument("--athlete-id", type=int, default=0, help="Intervals athlete id (0 = me)")
    p.add_argument("--tz", default="America/Los_Angeles", help="Timezone label (used only for filling times)")
    p.add_argument("--default-start", default="06:00", help="Default HH:MM for events missing a time")
    p.add_argument("--dry-run", action="store_true", help="Do not POST; just show normalized payload")
    return p.parse_args()


def load_events_any_shape(path: str) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "events" in data:
        return data["events"]
    if isinstance(data, list):
        return data
    raise ValueError("Payload must be a list of events or an object with an 'events' array")


def ensure_time(date_or_dt: str, default_hhmm: str) -> str:
    """
    Accepts 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM' (optionally with trailing Z).
    Returns 'YYYY-MM-DDTHH:MM' with no trailing Z.
    """
    s = str(date_or_dt).strip()
    s = re.sub(r"Z$", "", s)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}$", s):
        return f"{s}T{default_hhmm}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$", s):
        return s
    # Be forgiving: try to trim seconds or Z if present
    m = re.match(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?Z?$", s)
    if m:
        return m.group(1)
    # Last resort: extract date and bolt on default time
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", s)
    if m:
        return f"{m.group(1)}T{default_hhmm}"
    return s  # give up; let API complain rather than guessing


def to_int(n: Any) -> int:
    try:
        x = int(round(float(n)))
        return x if x >= 0 else 0
    except Exception:
        return 0


def gen_external_id(ev: Dict[str, Any]) -> str:
    date = str(ev.get("start_date_local", ""))[:10] or "0000-00-00"
    typ = str(ev.get("type") or "Ride").lower().replace(" ", "-")
    load = to_int(ev.get("icu_training_load"))
    mov = to_int(ev.get("moving_time"))
    # stable but readable
    return f"{date}-{typ}-{load}-{mov}"


def sanitize_event(ev: Dict[str, Any], default_hhmm: str) -> Dict[str, Any]:
    out = dict(ev)

    # start_date_local: local time without timezone suffix
    if out.get("start_date_local"):
        out["start_date_local"] = ensure_time(out["start_date_local"], default_hhmm)
    elif out.get("date"):
        out["start_date_local"] = ensure_time(out["date"], default_hhmm)
    else:
        raise ValueError("Event missing 'start_date_local' or 'date'")

    # type whitelist
    if out.get("type") not in WHITELIST_TYPES:
        out["type"] = "Ride"

    # category must be WORKOUT for planned events
    out["category"] = "WORKOUT"

    # numeric fields
    if "moving_time" in out:
        out["moving_time"] = to_int(out["moving_time"])
    if "icu_training_load" in out:
        out["icu_training_load"] = to_int(out["icu_training_load"])

    # external_id
    if not out.get("external_id"):
        out["external_id"] = gen_external_id(out)

    return out


def main() -> int:
    args = parse_args()
    api_key = os.environ.get("INTERVALS_API_KEY")
    if not api_key:
        print("ERROR: INTERVALS_API_KEY not set", file=sys.stderr)
        return 2

    try:
        events_raw = load_events_any_shape(args.plan)
    except Exception as e:
        print(f"ERROR: failed to read {args.plan}: {e}", file=sys.stderr)
        return 2

    events = []
    for ev in events_raw:
        try:
            events.append(sanitize_event(ev, args.default_start))
        except Exception as e:
            print(f"[skip] invalid event: {e} -> {json.dumps(ev, ensure_ascii=False)}", file=sys.stderr)

    print(f"[preflight] loaded={len(events)} from {args.plan}")
    if events:
        print("[preflight] first_event:", json.dumps(events[0], indent=2, ensure_ascii=False))

    if args.dry_run:
        print("[dry-run] not posting to Intervals")
        return 0

    url = f"https://intervals.icu/api/v1/athlete/{args.athlete_id}/events/bulk?upsert=true"

    try:
        resp = requests.post(url, auth=HTTPBasicAuth("API_KEY", api_key), json=events, timeout=60)
    except Exception as e:
        print(f"ERROR: POST failed: {e}", file=sys.stderr)
        return 2

    try:
        body = resp.json()
    except Exception:
        body = {"text": resp.text}

    print(f"[response] status={resp.status_code}")
    print(json.dumps(body, indent=2))

    if not resp.ok:
        return 1

    # Some responses include { created: N, updated: M }. Print a friendly summary if present.
    created = body.get("created") if isinstance(body, dict) else None
    updated = body.get("updated") if isinstance(body, dict) else None
    if created is not None or updated is not None:
        print(f"[summary] created={created or 0}, updated={updated or 0}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
