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


def _get_seconds(obj: Dict[str, Any]) -> int:
    for k in ("moving_time", "elapsed_time", "duration"):
        v = obj.get(k)
        if isinstance(v, (int, float)):
            return int(v)
        if isinstance(v, str) and v.isdigit():
            return int(v)
    return 0


def _get_load(obj: Dict[str, Any]) -> float:
    for k in ("load", "icu_training_load", "training_load", "tss"):
        v = obj.get(k)
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            try:
                return float(v)
            except Exception:
                pass
    return 0.0


def fetch_activities(api_key: str, athlete_id: int, base_url: str, day: dt.date, timeout: int = 30) -> List[Dict[str, Any]]:
    url = f"{base_url}/api/v1/athlete/{athlete_id}/activities"
    params = {"oldest": _date_str(day), "newest": _date_str(day)}
    r = requests.get(url, params=params, auth=HTTPBasicAuth("API_KEY", api_key), timeout=timeout)
    r.raise_for_status()
    return r.json()


def fetch_events(api_key: str, athlete_id: int, base_url: str, day: dt.date, timeout: int = 30) -> List[Dict[str, Any]]:
    # Planned workouts are "events" (category usually WORKOUT)
    url = f"{base_url}/api/v1/athlete/{athlete_id}/events"
    params = {"oldest": _date_str(day), "newest": _date_str(day)}
    r = requests.get(url, params=params, auth=HTTPBasicAuth("API_KEY", api_key), timeout=timeout)
    r.raise_for_status()
    return r.json()


def fetch_wellness(api_key: str, athlete_id: int, base_url: str, day: dt.date, timeout: int = 30) -> Dict[str, float]:
    url = f"{base_url}/api/v1/athlete/{athlete_id}/wellness"
    params = {"oldest": _date_str(day), "newest": _date_str(day), "cols": "ctl,atl,rampRate"}
    r = requests.get(url, params=params, auth=HTTPBasicAuth("API_KEY", api_key), timeout=timeout)
    r.raise_for_status()
    data = r.json()
    rec = (data or [{}])[-1]
    return {
        "ctl": float(rec.get("ctl", 0.0) or 0.0),
        "atl": float(rec.get("atl", 0.0) or 0.0),
        "ramp": float(rec.get("rampRate", 0.0) or 0.0),
    }


def format_hms(seconds: int) -> str:
    h = seconds // 3600
    m = (seconds % 3600) // 60
    return f"{h:d}h {m:02d}m"


def summarize_day(activities: List[Dict[str, Any]], events: List[Dict[str, Any]]) -> Dict[str, Any]:
    # Actuals from activities
    actual_secs = sum(_get_seconds(a) for a in activities)
    actual_tss = sum(_get_load(a) for a in activities)
    by_type_actual = defaultdict(lambda: {"sec": 0, "tss": 0.0})
    for a in activities:
        t = str(a.get("type") or "Workout")
        by_type_actual[t]["sec"] += _get_seconds(a)
        by_type_actual[t]["tss"] += _get_load(a)

    # Planned from events (category WORKOUT)
    planned = [e for e in events if str(e.get("category") or "").upper() == "WORKOUT"]
    planned_secs = sum(_get_seconds(e) for e in planned)
    planned_tss = sum(_get_load(e) for e in planned)
    by_type_planned = defaultdict(lambda: {"sec": 0, "tss": 0.0})
    for e in planned:
        t = str(e.get("type") or "Workout")
        by_type_planned[t]["sec"] += _get_seconds(e)
        by_type_planned[t]["tss"] += _get_load(e)

    return {
        "actual_time_sec": int(actual_secs),
        "actual_time_hms": format_hms(int(actual_secs)),
        "actual_tss": round(actual_tss, 1),
        "planned_time_sec": int(planned_secs),
        "planned_time_hms": format_hms(int(planned_secs)),
        "planned_tss": round(planned_tss, 1),
        "delta_time_sec": int(actual_secs - planned_secs),
        "delta_time_hms": format_hms(abs(int(actual_secs - planned_secs))),
        "delta_tss": round(actual_tss - planned_tss, 1),
        "by_type_actual": {k: {"time_sec": v["sec"], "time_hms": format_hms(v["sec"]), "tss": round(v["tss"], 1)} for k, v in by_type_actual.items()},
        "by_type_planned": {k: {"time_sec": v["sec"], "time_hms": format_hms(v["sec"]), "tss": round(v["tss"], 1)} for k, v in by_type_planned.items()},
    }


def coach_advice(today: Dict[str, Any], wellness_today: Dict[str, float], tomorrow_planned_tss: float) -> Dict[str, Any]:
    ctl = wellness_today["ctl"]
    atl = wellness_today["atl"]
    tsb = ctl - atl
    actual = today["actual_tss"]
    planned = max(today["planned_tss"], 1e-6)  # avoid /0
    overshoot = (actual - planned) / planned
    undershoot = (planned - actual) / planned

    rec = "Stick to plan."
    adjust_pct = 0.0

    # Heuristics (simple, conservative)
    if tsb <= -15:
        rec = "High fatigue. Reduce tomorrow's load ~30%."
        adjust_pct = -0.30
    elif tsb <= -5 and overshoot > 0.20:
        rec = "Slightly deep in the red + overshot today. Reduce tomorrow ~15–20%."
        adjust_pct = -0.18
    elif tsb >= 10 and undershoot > 0.30:
        rec = "Fresh and undershot today. Optional +10–15% endurance time tomorrow."
        adjust_pct = +0.12

    suggested_tss = max(0.0, round(tomorrow_planned_tss * (1.0 + adjust_pct), 1))
    return {
        "tsb": round(tsb, 1),
        "ctl": round(ctl, 1),
        "atl": round(atl, 1),
        "ramp": round(wellness_today["ramp"], 1),
        "recommendation": rec,
        "tomorrow_planned_tss": round(tomorrow_planned_tss, 1),
        "tomorrow_suggested_tss": suggested_tss,
        "adjust_pct": round(adjust_pct * 100, 0),
    }


def write_outputs(outdir: str, day: dt.date, summary: Dict[str, Any], advice: Dict[str, Any]) -> str:
    os.makedirs(outdir, exist_ok=True)
    base = os.path.join(outdir, f"daily-{day.isoformat()}")
    # JSON
    with open(base + ".json", "w", encoding="utf-8") as f:
        json.dump({"date": day.isoformat(), "summary": summary, "advice": advice}, f, indent=2)
    # CSV (one row)
    with open(base + "-summary.csv", "w", newline="", encoding="utf-8") as f:
        import csv
        w = csv.writer(f)
        w.writerow(["date","planned_tss","actual_tss","delta_tss","planned_time_sec","actual_time_sec","delta_time_sec","ctl","atl","tsb","ramp","tomorrow_planned_tss","tomorrow_suggested_tss","adjust_pct"])
        w.writerow([day.isoformat(), summary["planned_tss"], summary["actual_tss"], summary["delta_tss"], summary["planned_time_sec"], summary["actual_time_sec"], summary["delta_time_sec"], advice["ctl"], advice["atl"], advice["tsb"], advice["ramp"], advice["tomorrow_planned_tss"], advice["tomorrow_suggested_tss"], advice["adjust_pct"]])
    # Markdown
    md = []
    md.append(f"# Daily Summary ({day})\n")
    md.append("## Totals\n")
    md.append("| Metric | Planned | Actual | Δ |")
    md.append("|---|---:|---:|---:|")
    md.append(f"| TSS | {summary['planned_tss']} | {summary['actual_tss']} | {summary['delta_tss']} |")
    md.append(f"| Time | {summary['planned_time_hms']} | {summary['actual_time_hms']} | {summary['delta_time_hms']} |")
    md.append("\n## Fitness\n")
    md.append("| CTL | ATL | TSB | Ramp |")
    md.append("|---:|---:|---:|---:|")
    md.append(f"| {advice['ctl']} | {advice['atl']} | {advice['tsb']} | {advice['ramp']} |")
    md.append("\n## Coach’s note\n")
    md.append(f"{advice['recommendation']}")
    md.append(f"\n\nTomorrow planned TSS: {advice['tomorrow_planned_tss']} → Suggested: {advice['tomorrow_suggested_tss']} ({advice['adjust_pct']}%)\n")
    with open(base + ".md", "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    return base  # path without extension


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Daily planned vs actual summary with coach-style advice")
    p.add_argument("--api-key", help="Intervals API Key. If omitted, uses INTERVALS_API_KEY")
    p.add_argument("--athlete-id", type=int, default=0)
    p.add_argument("--base-url", default=INTERVALS_DEFAULT_BASE)
    p.add_argument("--tz", default="America/Los_Angeles")
    p.add_argument("--for-date", help="YYYY-MM-DD; default today in tz")
    p.add_argument("--outdir", default="reports/daily")
    p.add_argument("--timeout", type=int, default=30)
    args = p.parse_args(argv)

    api_key = args.api_key or os.environ.get("INTERVALS_API_KEY")
    if not api_key:
        raise SystemExit("ERROR: Provide --api-key or set INTERVALS_API_KEY")

    now = dt.datetime.now(ZoneInfo(args.tz)) if ZoneInfo else dt.datetime.now()
    day = dt.date.fromisoformat(args.for_date) if args.for_date else now.date()
    tomorrow = day + dt.timedelta(days=1)

    acts = fetch_activities(api_key, args.athlete_id, args.base_url, day, args.timeout)
    evts_today = fetch_events(api_key, args.athlete_id, args.base_url, day, args.timeout)
    evts_tom = fetch_events(api_key, args.athlete_id, args.base_url, tomorrow, args.timeout)
    wellness = fetch_wellness(api_key, args.athlete_id, args.base_url, day, args.timeout)

    summary = summarize_day(acts, evts_today)
    tomorrow_planned_tss = sum(_get_load(e) for e in evts_tom if str(e.get("category") or "").upper() == "WORKOUT")
    advice = coach_advice(summary, wellness, tomorrow_planned_tss)

    base = write_outputs(args.outdir, day, summary, advice)
    print(f"Wrote {base}.md, {base}.json, {base}-summary.csv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
