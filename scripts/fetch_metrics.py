#!/usr/bin/env python3
# scripts/fetch_metrics.py
import os, sys, json, datetime as dt
from urllib.request import Request, urlopen
from urllib.parse import urlencode

BASE = os.environ.get("INTERVALS_API_BASE", "https://intervals.icu/api/v1")
API = os.environ.get("INTERVALS_API_KEY") or ""
HEADERS = {"Authorization": f"Bearer {API}", "Accept": "application/json"}

def get(path, params=None):
    url = f"{BASE}{path}"
    if params: url += "?" + urlencode(params)
    req = Request(url, headers=HEADERS)
    with urlopen(req) as r:
        return json.load(r)

def date_range(days):
    tz = dt.timezone.utc
    end = dt.datetime.now(tz).date()
    start = end - dt.timedelta(days=days-1)
    return start.isoformat(), end.isoformat()

def fetch_ctl_atl_tsb(athlete_id, start, end):
    # Try daily rows
    try:
        data = get(f"/athlete/{athlete_id}/metrics/daily",
                   {"start": start, "end": end, "metrics": "ctl,atl,tsb"})
        out = []
        for row in data:
            out.append({
                "date": row["date"],
                "ctl":  row.get("ctl"),
                "atl":  row.get("atl"),
                "tsb":  row.get("tsb"),
            })
        if out: return out
    except Exception as e:
        print(f"[info] daily metrics endpoint fallback ({e})", file=sys.stderr)

    # Fallback shape: {"ctl":[{date,value}], ...}
    data = get(f"/athlete/{athlete_id}/metrics/daily",
               {"start": start, "end": end, "metrics": "ctl,atl,tsb"})
    by_date = {}
    for m in ("ctl", "atl", "tsb"):
        for row in data.get(m, []):
            d = row.get("date")
            if not d: continue
            by_date.setdefault(d, {"date": d})
            by_date[d][m] = row.get("value")
    return sorted(by_date.values(), key=lambda r: r["date"])

def fetch_daily_load(athlete_id, start, end):
    # Build per-day load by summing icu_training_load from activities
    try:
        acts = get(f"/athlete/{athlete_id}/activities",
                   {"start": start, "end": end})
    except Exception as e:
        print(f"[warn] activities endpoint failed ({e}); no load will be included", file=sys.stderr)
        return {}

    per_day = {}
    for a in acts:
        d = a.get("start_date_local", a.get("start_date", ""))[:10]
        load = (a.get("icu_training_load")
                or a.get("training_load")
                or a.get("tss")
                or 0)
        if not d: continue
        per_day[d] = per_day.get(d, 0) + (load or 0)
    return per_day

def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--athlete-id", type=int, required=True)
    ap.add_argument("--days", type=int, default=35)
    args = ap.parse_args()

    if not API:
        print("ERROR: INTERVALS_API_KEY is not set", file=sys.stderr)
        sys.exit(2)
    # Accept 0 (use the athlete tied to the API key)
    if args.athlete_id is None or args.athlete_id < 0:
        print("ERROR: --athlete-id must be >= 0 (0 means 'current athlete')", file=sys.stderr)
        sys.exit(2)

    start, end = date_range(args.days)
    print(f"[info] window {start}..{end} for athlete {args.athlete_id}", file=sys.stderr)

    series = fetch_ctl_atl_tsb(args.athlete_id, start, end)
    load_by_day = fetch_daily_load(args.athlete_id, start, end)

    for row in series:
        row["load"] = load_by_day.get(row["date"], None)

    out = {
        "athlete_id": args.athlete_id,
        "generated_at": dt.datetime.utcnow().isoformat()+"Z",
        "series": series,
    }
    json.dump(out, sys.stdout, indent=2)
    print(file=sys.stderr)
    print(f"[ok] wrote {len(series)} days", file=sys.stderr)

if __name__ == "__main__":
    main()
