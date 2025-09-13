#!/usr/bin/env python3
import os, sys, json, argparse, datetime as dt
from dateutil.relativedelta import relativedelta
import requests

# Fetch ATL/CTL/TSB/Ramp time series for the last N days and print JSON to stdout.
# NOTE: Replace the stubbed section with the real Intervals.icu endpoint you use.

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--athlete-id", type=int, required=True)
    ap.add_argument("--days", type=int, default=30)
    args = ap.parse_args()

    api_key = os.environ.get("INTERVALS_API_KEY")
    if not api_key:
        print("Missing INTERVALS_API_KEY", file=sys.stderr)
        sys.exit(2)

    today = dt.date.today()
    start = today - dt.timedelta(days=args.days)

    out = {
        "athlete_id": args.athlete_id,
        "generated_at": dt.datetime.utcnow().isoformat() + "Z",
        "series": [],
    }

    headers = {"Authorization": f"Bearer {api_key}"}

    # -------------------------------------------------------------------------
    # TODO: Wire the real call here.
    # Example sketch (you must confirm the actual endpoint/fields you have access to):
    #
    # url = f"https://intervals.icu/api/v1/athlete/{args.athlete_id}/metrics?from={start}&to={today}"
    # r = requests.get(url, headers=headers, timeout=30)
    # r.raise_for_status()
    # raw = r.json()
    # for row in raw:
    #     out["series"].append({
    #         "date": row["date"][:10],
    #         "atl": row["atl"],
    #         "ctl": row["ctl"],
    #         "tsb": row["tsb"],
    #         "ramp": row.get("ramp", 0.0),
    #     })
    #
    # Remove the stub once you connect the real API.
    # -------------------------------------------------------------------------

    # Stub: generate plausible numbers so the UI works before wiring API
    for i in range(args.days):
        d = (start + dt.timedelta(days=i)).isoformat()
        out["series"].append({
            "date": d,
            "atl": 45 + (i % 7),
            "ctl": 48 + (i % 5),
            "tsb": -3 + (i % 4),
            "ramp": float((i % 9) - 4),
        })

    json.dump(out, sys.stdout, indent=2)

if __name__ == "__main__":
    main()

