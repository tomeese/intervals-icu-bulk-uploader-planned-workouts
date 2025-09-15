#!/usr/bin/env python3
"""
Fetch last N days of daily Fitness (CTL), Fatigue (ATL), Form (CTL-ATL) and Ramp
from Intervals.icu wellness; also compute per-day Load by summing activities'
icu_training_load. Writes public/data/metrics-latest.json.

Auth: Basic with username 'API_KEY' and password = your key.
ATHLETE_ID can be 0 to use the athlete associated with the key (recommended).
"""

from __future__ import annotations
import argparse, base64, json, os, sys
from datetime import date, timedelta
from collections import defaultdict
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import sys, logging
logging.basicConfig(stream=sys.stderr, level=logging.INFO, format='[%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

API_ROOT = "https://intervals.icu/api/v1"

def basic_auth_header(api_key: str) -> str:
    token = base64.b64encode(f"API_KEY:{api_key}".encode()).decode()
    return f"Basic {token}"

def http_get(url: str, headers: dict) -> dict | list:
    req = Request(url, headers=headers)
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())

def iso(d: date) -> str:
    return d.isoformat()

def monday_on_or_before(d: date) -> date:
    return d - timedelta(days=(d.weekday()))  # Monday=0

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--athlete-id", type=int, required=True, help="0 = use athlete bound to API key")
    p.add_argument("--days", type=int, default=35, help="how many days back to fetch")
    args = p.parse_args()

    api_key = os.environ.get("INTERVALS_API_KEY", "").strip()
    if not api_key:
        log.info("[error] INTERVALS_API_KEY env var is not set", file=sys.stderr)
        sys.exit(1)

    headers = {
        "Accept": "application/json",
        "Authorization": basic_auth_header(api_key),
    }

    newest = date.today()
    oldest = newest - timedelta(days=args.days)
    log.info(f"[info] window {iso(oldest)}..{iso(newest)} for athlete {args.athlete_id}")

    # 1) Daily CTL/ATL/Ramp via wellness
    # Docs + example call from Intervals.icu:
    # - “list wellness endpoint”: /athlete/0/wellness?oldest=YYYY-MM-DD&newest=YYYY-MM-DD
    # - You can request specific columns like ctl, atl, rampRate (and others) with `cols=...`
    #   Ref: forum posts & cookbook. 
    url_wellness = (
        f"{API_ROOT}/athlete/{args.athlete_id}/wellness"
        f"?oldest={iso(oldest)}&newest={iso(newest)}"
        f"&cols=ctl,atl,rampRate"
    )
    try:
        wellness = http_get(url_wellness, headers)  # list of {id: 'YYYY-MM-DD', ctl, atl, rampRate, ...}
    except HTTPError as e:
        log.info(f"[error] wellness fetch failed: {e}", file=sys.stderr)
        sys.exit(2)
    except URLError as e:
        log.info(f"[error] wellness fetch failed: {e}", file=sys.stderr)
        sys.exit(2)

    # Map date-> {ctl, atl, ramp}
    day_metrics: dict[str, dict] = {}
    for row in wellness:
        day = row.get("id")
        ctl = row.get("ctl")
        atl = row.get("atl")
        # rampRate is Intervals' CTL ramp (per week). We will still compute weekly ramp from CTL deltas.
        ramp_rate = row.get("rampRate")
        if not day:
            continue
        # form (aka TSB) = CTL - ATL
        form = None
        if ctl is not None and atl is not None:
            form = round(ctl - atl, 1)
        day_metrics[day] = {
            "date": day,
            "ctl": ctl,
            "atl": atl,
            "tsb": form,         # alias for Form
            "ramp": ramp_rate,   # daily “rampRate” from Intervals
            "load": 0.0,         # fill in below from activities
        }

    # 2) Daily Load via activities (sum icu_training_load per local day)
    # Cookbook “list activities endpoint”:
    #   GET /api/v1/athlete/0/activities?oldest=YYYY-MM-DD&newest=YYYY-MM-DD
    # Each item includes `icu_training_load`.
    url_acts = (
        f"{API_ROOT}/athlete/{args.athlete_id}/activities"
        f"?oldest={iso(oldest)}&newest={iso(newest)}"
    )
    try:
        acts = http_get(url_acts, headers)  # list of activities
    except HTTPError as e:
        log.info(f"[error] activities fetch failed: {e}", file=sys.stderr)
        sys.exit(3)
    except URLError as e:
        log.info(f"[error] activities fetch failed: {e}", file=sys.stderr)
        sys.exit(3)

    # Group loads by local date (YYYY-MM-DD from start_date_local)
    load_by_day: defaultdict[str, float] = defaultdict(float)
    for a in acts:
        sdl = a.get("start_date_local") or ""
        if len(sdl) < 10:
            continue
        day = sdl[:10]
        tl = a.get("icu_training_load")
        if isinstance(tl, (int, float)):
            load_by_day[day] += float(tl)

    for d, L in load_by_day.items():
        if d not in day_metrics:
            # No wellness row that day? create shell
            day_metrics[d] = {"date": d, "ctl": None, "atl": None, "tsb": None, "ramp": None, "load": 0.0}
        day_metrics[d]["load"] = round(L, 1)

    # Emit chronological series
    all_days = sorted(day_metrics.keys())
    series = [day_metrics[d] for d in all_days]

    out = {
        "athlete_id": args.athlete_id,
        "generated_at": date.today().isoformat(),
        "series": series,
    }
    print(json.dumps(out, indent=2))
    return

if __name__ == "__main__":
    main()
