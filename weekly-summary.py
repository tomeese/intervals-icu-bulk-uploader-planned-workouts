from __future__ import annotations
import argparse
import csv
import datetime as dt
import json
import os
from collections import defaultdict
from typing import Any, Dict, List

import requests
from requests.auth import HTTPBasicAuth
try:
    from zoneinfo import ZoneInfo  # py>=3.9
except Exception:
    ZoneInfo = None  # type: ignore

INTERVALS_DEFAULT_BASE = "https://intervals.icu"


def _date_str(d: dt.date) -> str:
    return d.strftime("%Y-%m-%d")


def _week_range_ending_sunday(today: dt.date) -> tuple[dt.date, dt.date]:
    """Return (monday, sunday) for the week ending on the most recent Sunday (inclusive)."""
    offset_to_sunday = (today.weekday() - 6) % 7  # Mon=0..Sun=6
    sunday = today - dt.timedelta(days=offset_to_sunday)
    monday = sunday - dt.timedelta(days=6)
    return monday, sunday


def _get_seconds(activity: Dict[str, Any]) -> int:
    for key in ("moving_time", "elapsed_time", "duration"):
        v = activity.get(key)
        if isinstance(v, (int, float)):
            return int(v)
    return 0


def _get_load(activity: Dict[str, Any]) -> float:
    # Intervals uses "load" (TSS-like). Try a few common aliases just in case.
    for key in ("load", "icu_training_load", "training_load", "tss"):
        v = activity.get(key)
        if isinstance(v, (int, float)):
            return float(v)
    return 0.0


def _get_type(activity: Dict[str, Any]) -> str:
    return str(activity.get("type") or "Workout")


def fetch_activities(
    api_key: str,
    athlete_id: int,
    base_url: str,
    start: dt.date,
    end: dt.date,
    timeout: int = 30,
) -> List[Dict[str, Any]]:
    url = f"{base_url}/api/v1/athlete/{athlete_id}/activities"
    params = {"oldest": _date_str(start), "newest": _date_str(end)}
    resp = requests.get(url, params=params, auth=HTTPBasicAuth("API_KEY", api_key), timeout=timeout)
    resp.raise_for_status()
    return resp.json()  # list of activities


def fetch_wellness(
    api_key: str,
    athlete_id: int,
    base_url: str,
    day: dt.date,
    timeout: int = 30,
) -> Dict[str, Any]:
    # Get CTL, ATL, RampRate for the day. We'll compute Form (TSB) as CTL - ATL.
    url = f"{base_url}/api/v1/athlete/{athlete_id}/wellness"
    params = {
        "oldest": _date_str(day),
        "newest": _date_str(day),
        "cols": "ctl,atl,rampRate",
    }
    resp = requests.get(url, params=params, auth=HTTPBasicAuth("API_KEY", api_key), timeout=timeout)
    resp.raise_for_status()
    data = resp.json()  # list (0..n)
    if isinstance(data, list) and data:
        rec = data[-1]
        return {
            "ctl": float(rec.get("ctl", 0.0) or 0.0),
            "atl": float(rec.get("atl", 0.0) or 0.0),
            "rampRate": float(rec.get("rampRate", 0.0) or 0.0),
        }
    return {"ctl": 0.0, "atl": 0.0, "rampRate": 0.0}


def format_hms(seconds: int) -> str:
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    return f"{h:d}h {m:02d}m" if s == 0 else f"{h:d}h {m:02d}m {s:02d}s"


def build_summary(activities: List[Dict[str, Any]], ctl: float, atl: float, ramp: float) -> Dict[str, Any]:
    total_seconds = 0
    total_load = 0.0
    by_type: Dict[str, Dict[str, float]] = defaultdict(lambda: {"seconds": 0.0, "load": 0.0})

    for a in activities:
        secs = _get_seconds(a)
        ld = _get_load(a)
        t = _get_type(a)

        total_seconds += secs
        total_load += ld
        by_type[t]["seconds"] += secs
        by_type[t]["load"] += ld

    form = ctl - atl  # TSB approximation

    return {
        "tss": round(total_load, 1),
        "total_time_sec": int(total_seconds),
        "total_time_hms": format_hms(int(total_seconds)),
        "load": round(total_load, 1),
        "fatigue_atl": round(atl, 1),
        "fitness_ctl": round(ctl, 1),
        "form_tsb": round(form, 1),
        "ramp_rate": round(ramp, 1),
        "by_type": {
            k: {
                "time_sec": int(v["seconds"]),
                "time_hms": format_hms(int(v["seconds"])),
                "load": round(v["load"], 1),
            }
            for k, v in sorted(by_type.items(), key=lambda kv: -kv[1]["seconds"])
        },
    }


def write_markdown(path: str, week_start: dt.date, week_end: dt.date, summary: Dict[str, Any]) -> None:
    lines = []
    lines.append(f"# Weekly Summary ({week_start} → {week_end})\n")
    lines.append("## Totals\n")
    lines.append("| Metric | Value |")
    lines.append("|---|---:|")
    lines.append(f"| TSS | **{summary['tss']}** |")
    lines.append(f"| Total Time | **{summary['total_time_hms']}** |")
    lines.append(f"| Load | **{summary['load']}** |")
    lines.append(f"| Fitness (CTL) | **{summary['fitness_ctl']}** |")
    lines.append(f"| Fatigue (ATL) | **{summary['fatigue_atl']}** |")
    lines.append(f"| Form (TSB) | **{summary['form_tsb']}** |")
    lines.append(f"| Ramp Rate | **{summary['ramp_rate']}** |\n")

    lines.append("## Time & Load by Activity Type\n")
    lines.append("| Type | Time | Load |")
    lines.append("|---|---:|---:|")
    for t, v in summary["by_type"].items():
        lines.append(f"| {t} | {v['time_hms']} | {v['load']} |")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def write_csvs(base_path: str, week_start: dt.date, week_end: dt.date, summary: Dict[str, Any]) -> tuple[str, str]:
    summary_csv = f"{base_path}-summary.csv"
    bytype_csv = f"{base_path}-bytype.csv"

    with open(summary_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["week_start","week_end","tss","total_time_sec","total_time_hms","load","fitness_ctl","fatigue_atl","form_tsb","ramp_rate"])
        w.writerow([
            week_start.isoformat(),
            week_end.isoformat(),
            summary["tss"],
            summary["total_time_sec"],
            summary["total_time_hms"],
            summary["load"],
            summary["fitness_ctl"],
            summary["fatigue_atl"],
            summary["form_tsb"],
            summary["ramp_rate"],
        ])

    with open(bytype_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["type","time_sec","time_hms","load"])
        for t, v in summary["by_type"].items():
            w.writerow([t, v["time_sec"], v["time_hms"], v["load"]])

    return summary_csv, bytype_csv


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a weekly training summary from Intervals.icu")
    parser.add_argument("--api-key", help="Intervals API Key. If omitted, uses INTERVALS_API_KEY")
    parser.add_argument("--athlete-id", type=int, default=0, help="Defaults to 0 (self)")
    parser.add_argument("--base-url", default=INTERVALS_DEFAULT_BASE)
    parser.add_argument("--tz", default="America/Los_Angeles", help="Timezone for 'Sunday night' logic")
    parser.add_argument("--for-date", help="YYYY-MM-DD; choose the week ending on this date (optional)")
    parser.add_argument("--outdir", default="reports/weekly", help="Directory for outputs")
    parser.add_argument("--filename", default="", help="Optional fixed filename for the markdown")
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args(argv)

    api_key = args.api_key or os.environ.get("INTERVALS_API_KEY")
    if not api_key:
        raise SystemExit("ERROR: Provide --api-key or set INTERVALS_API_KEY")

    # Reference date in TZ
    if ZoneInfo:
        now = dt.datetime.now(ZoneInfo(args.tz))
    else:
        now = dt.datetime.now()

    ref = dt.date.fromisoformat(args.for_date) if args.for_date else now.date()
    week_start, week_end = _week_range_ending_sunday(ref)

    activities = fetch_activities(
        api_key=api_key,
        athlete_id=args.athlete_id,
        base_url=args.base_url,
        start=week_start,
        end=week_end,
        timeout=args.timeout,
    )
    wellness = fetch_wellness(
        api_key=api_key,
        athlete_id=args.athlete_id,
        base_url=args.base_url,
        day=week_end,
        timeout=args.timeout,
    )
    summary = build_summary(activities, ctl=wellness["ctl"], atl=wellness["atl"], ramp=wellness["rampRate"])

    outdir = os.path.abspath(args.outdir)
    os.makedirs(outdir, exist_ok=True)
    fname = args.filename or f"weekly-{week_end.isoformat()}.md"
    md_path = os.path.join(outdir, fname)
    write_markdown(md_path, week_start, week_end, summary)

    json_path = os.path.join(outdir, f"weekly-{week_end.isoformat()}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({"week_start": week_start.isoformat(), "week_end": week_end.isoformat(), "summary": summary}, f, indent=2)

    base = os.path.join(outdir, f"weekly-{week_end.isoformat()}")
    write_csvs(base, week_start, week_end, summary)

    print(f"Wrote {md_path}, {json_path}, {base}-summary.csv, {base}-bytype.csv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
