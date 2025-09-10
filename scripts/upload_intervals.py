#!/usr/bin/env python3
import os, sys, json, re
import requests
from requests.auth import HTTPBasicAuth

API_KEY = os.environ.get("INTERVALS_API_KEY")
if not API_KEY:
    print("ERROR: INTERVALS_API_KEY not set", file=sys.stderr)
    sys.exit(2)

URL = "https://intervals.icu/api/v1/athlete/0/events/bulk?upsert=true"

def load_events(path: str):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Accept either {"events":[...]} or just [...]
    if isinstance(data, dict) and "events" in data:
        return data["events"]
    if isinstance(data, list):
        return data
    raise ValueError("Payload must be a list of events or an object with an 'events' array")

def sanitize_event(ev: dict) -> dict:
    # Minimal guardrails: correct types and required fields
    out = dict(ev)
    out["category"] = "WORKOUT"
    # Ensure start_date_local has no trailing Z
    if isinstance(out.get("start_date_local"), str):
        out["start_date_local"] = re.sub(r"Z$", "", out["start_date_local"])
    # Integer fields
    for k in ("moving_time", "icu_training_load"):
        if k in out and out[k] is not None:
            out[k] = int(round(float(out[k])))
    # Type whitelist (Intervals accepts these)
    whitelist = {"Ride","Gravel Ride","Virtual Ride","Run","Swim","Workout"}
    if out.get("type") not in whitelist:
        out["type"] = "Ride"
    return out

def main():
    if len(sys.argv) < 2:
        print("Usage: upload_intervals.py <path-to-json>", file=sys.stderr)
        sys.exit(2)

    path = sys.argv[1]
    events = [sanitize_event(e) for e in load_events(path)]
    if not events:
        print("No events to upload; exiting.")
        return

    auth = HTTPBasicAuth("API_KEY", API_KEY)
    resp = requests.post(URL, auth=auth, json=events, timeout=60)
    try:
        payload = resp.json()
    except Exception:
        payload = {"text": resp.text}

    if not resp.ok:
        print(f"ERROR {resp.status_code}: {payload}", file=sys.stderr)
        resp.raise_for_status()

    # Intervals typically returns objects like {"created": N, "updated": M} or similar
    print("200 OK")
    print(json.dumps(payload, indent=2))

if __name__ == "__main__":
    main()
