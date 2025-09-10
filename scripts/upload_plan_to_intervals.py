#!/usr/bin/env python3
import argparse, json, os, sys, time, re
from datetime import datetime, timezone
from dateutil import tz
import requests
from requests.auth import HTTPBasicAuth

API_BASE = "https://intervals.icu"

def iso_local(date_str, hhmm, tz_name):
    # date_str = "YYYY-MM-DD", hhmm = "HH:MM"
    tzinfo = tz.gettz(tz_name)
    dt = datetime.strptime(f"{date_str} {hhmm}", "%Y-%m-%d %H:%M").replace(tzinfo=tzinfo)
    # Intervals accepts local time with offset or Z? Send offset (e.g., 2025-09-01T06:00:00-07:00)
    return dt.isoformat()

def map_event_type(wtype):
    # Intervals Events commonly use "Ride","Run","Swim" etc.
    # Your data uses "Ride","Gravel Ride","Virtual Ride".
    # Map Gravel/Virtual to "Ride" with hints in description.
    if wtype in ("Ride","Run","Swim"):
        return wtype
    return "Ride"

def build_description(w):
    tags = []
    if w.get("type") == "Gravel Ride":
        tags.append("[Gravel]")
    if w.get("type") == "Virtual Ride" or w.get("indoor"):
        tags.append("[Indoor]")
    notes = (w.get("notes") or "").strip()
    if w.get("tss"):
        tags.append(f"[TSS {int(w['tss'])}]")
    return (" ".join(tags) + (" " if tags and notes else "") + notes).strip()

def post_event(aid, payload, key, dry_run=False):
    url = f"{API_BASE}/api/v1/athlete/{aid}/events"
    if dry_run:
        print("DRY-RUN POST", url)
        print(json.dumps(payload, indent=2))
        return {"status":"dry_run"}
    auth = HTTPBasicAuth("API_KEY", key)
    r = requests.post(url, json=payload, auth=auth, timeout=30)
    if r.status_code >= 300:
        print("ERROR", r.status_code, r.text)
        r.raise_for_status()
    return r.json() if r.text else {"status":"ok"}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--athlete-id", required=True, type=str)
    ap.add_argument("--tz", required=True, help="IANA timezone, e.g., America/Los_Angeles")
    ap.add_argument("--default-start", default="06:00", help="HH:MM local start time")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    key = os.environ.get("INTERVALS_API_KEY")
    if not key:
        print("ERROR: INTERVALS_API_KEY not set", file=sys.stderr); sys.exit(2)

    with open(args.plan, "r", encoding="utf-8") as f:
        plan = json.load(f)

    count = 0
    for w in plan.get("workouts", []):
        name = w.get("name") or "Workout"
        if re.search(r"^rest\b|recovery spin", name, flags=re.I):
            # optional: skip pure rest
            continue
        date = w.get("date")
        if not date: 
            continue
        # Planned events only — skip if duration is 0
        dur = int(w.get("duration_sec") or 0)
        if dur <= 0:
            continue

        payload = {
            "name": name,
            "type": map_event_type(w.get("type") or "Ride"),
            "start_date_local": iso_local(date, args.default_start, args.tz),
            "duration": dur,
            # Some Intervals fields vary by API version; include what is generally accepted:
            "description": build_description(w),
        }
        # Useful extras if your account supports them (harmless if ignored):
        if w.get("tss") is not None:
            payload["target_tss"] = float(w["tss"])

        resp = post_event(args.athlete-id if False else args.athlete_id, payload, key, dry_run=args.dry_run)
        print("Created", name, "→", resp if args.dry_run else "OK")
        count += 1
        time.sleep(0.2)

    print(f"Done. Created {count} planned events.")

if __name__ == "__main__":
    main()
