from __future__ import annotations
import argparse
import csv
import datetime as dt
import json
import os
from collections import defaultdict
from typing import Any, Dict, List, Tuple, Optional

import requests
from requests.auth import HTTPBasicAuth
try:
    from zoneinfo import ZoneInfo  # py>=3.9
except Exception:
    ZoneInfo = None  # type: ignore

try:
    import yaml  # add this
except Exception:
    yaml = None

INTERVALS_DEFAULT_BASE = "https://intervals.icu"


# ---------------------------
# Helpers
# ---------------------------
def load_config(path: str = ".icu.yaml") -> dict:
    if not os.path.exists(path) or yaml is None:
        # defaults if no file or PyYAML missing
        return {
            "daily": {"min_tsb": -20, "warn_tsb": -10, "max_daily_ramp": 8.0, "max_delta_tss": 75},
            "weekly": {"min_tsb": -20, "max_weekly_ramp": 8.0, "max_delta_tss": 150},
        }
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    # fill defaults if keys missing
    d = data.get("daily", {})
    w = data.get("weekly", {})
    return {
        "daily": {
            "min_tsb": float(d.get("min_tsb", -20)),
            "warn_tsb": float(d.get("warn_tsb", -10)),
            "max_daily_ramp": float(d.get("max_daily_ramp", 8.0)),
            "max_delta_tss": float(d.get("max_delta_tss", 75)),
        },
        "weekly": {
            "min_tsb": float(w.get("min_tsb", -20)),
            "max_weekly_ramp": float(w.get("max_weekly_ramp", 8.0)),
            "max_delta_tss": float(w.get("max_delta_tss", 150)),
        },
    }

def build_daily_alerts(summary: dict, advice: dict, cfg: dict) -> dict:
    flags = []
    tsb = advice["tsb"]
    ramp = advice["ramp"]
    delta_tss = summary["delta_tss"]
    min_tsb = cfg["daily"]["min_tsb"]
    warn_tsb = cfg["daily"]["warn_tsb"]
    max_ramp = cfg["daily"]["max_daily_ramp"]
    max_delta = cfg["daily"]["max_delta_tss"]

    if tsb <= min_tsb:
        flags.append(f"TSB {tsb} (deep red)")
    elif tsb <= warn_tsb:
        flags.append(f"TSB {tsb} (red-ish)")

    if abs(delta_tss) >= max_delta:
        flags.append(f"ΔTSS {delta_tss:+}")

    if ramp >= max_ramp:
        flags.append(f"Ramp {ramp} CTL/wk high")

    # subject tag = short, comma-separated
    subject_tag = ", ".join(flags)
    return {"flags": flags, "subject_tag": subject_tag}


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


def _get_type(obj: Dict[str, Any]) -> str:
    return str(obj.get("type") or "Workout")


def canonical_type(v: str | None) -> str:
    s = str(v or "").strip().lower()
    if "gravel" in s:
        return "gravel ride"
    if s == "ride":
        return "ride"
    return s


def format_hms(seconds: int) -> str:
    h = seconds // 3600
    m = (seconds % 3600) // 60
    return f"{h:d}h {m:02d}m"


def _local_start_iso(obj: Dict[str, Any]) -> Optional[str]:
    for k in ("start_date_local", "start_date"):
        v = obj.get(k)
        if isinstance(v, str) and len(v) >= 16:
            return v
    return None


def _parse_dt(s: Optional[str]) -> Optional[dt.datetime]:
    if not s:
        return None
    s2 = s.replace("Z", "")
    try:
        return dt.datetime.fromisoformat(s2)
    except Exception:
        try:
            return dt.datetime.strptime(s2[:16], "%Y-%m-%dT%H:%M")
        except Exception:
            return None


def _local_date(obj: Dict[str, Any]) -> Optional[str]:
    s = _local_start_iso(obj)
    return s[:10] if s else None


# ---------------------------
# API
# ---------------------------

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


# ---------------------------
# Matching (per-workout)
# ---------------------------

def match_sessions(activities: List[Dict[str, Any]], events: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Return (pairs, unmatched_planned, unmatched_actual).
    A pair has keys: planned_*, actual_*, delta_* and match_method.
    """
    # Index activities
    by_ext: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    by_type: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    def act_key(a: Dict[str, Any]) -> tuple:
        dt0 = _parse_dt(_local_start_iso(a))
        return (dt0 or dt.datetime.min, _get_seconds(a))

    for a in activities:
        ext = str(a.get("external_id") or "")
        if ext:
            by_ext[ext].append(a)
        t = canonical_type(_get_type(a))
        by_type[t].append(a)

    for k in by_ext:
        by_ext[k].sort(key=act_key)
    for k in by_type:
        by_type[k].sort(key=act_key)

    used_ids = set()
    pairs: List[Dict[str, Any]] = []
    planned_list = [e for e in events if str(e.get("category") or "").upper() == "WORKOUT"]

    for e in planned_list:
        p_ext = str(e.get("external_id") or "")
        p_name = str(e.get("name") or "").strip() or "Planned"
        p_type = canonical_type(_get_type(e))
        p_secs = _get_seconds(e)
        p_tss = _get_load(e)
        p_start = _parse_dt(_local_start_iso(e))

        chosen = None
        method = ""

        # Strategy 1: external_id exact match
        if p_ext and p_ext in by_ext:
            for cand in by_ext[p_ext]:
                if id(cand) in used_ids:
                    continue
                chosen = cand
                method = "external_id"
                break

        # Strategy 2: same type, closest start time (same day by definition)
        if chosen is None:
            cands = by_type.get(p_type, [])
            best = None
            best_dt = None
            if p_start:
                for cand in cands:
                    if id(cand) in used_ids:
                        continue
                    a_start = _parse_dt(_local_start_iso(cand))
                    if a_start is None:
                        continue
                    diff = abs((a_start - p_start).total_seconds())
                    if best is None or diff < best_dt:
                        best = cand
                        best_dt = diff
                if best is not None:
                    chosen = best
                    method = "time"
            else:
                for cand in cands:
                    if id(cand) in used_ids:
                        continue
                    chosen = cand
                    method = "type"
                    break

        if chosen is not None:
            used_ids.add(id(chosen))
            a_name = str(chosen.get("name") or "").strip() or "Activity"
            a_secs = _get_seconds(chosen)
            a_tss = _get_load(chosen)
            a_start = _parse_dt(_local_start_iso(chosen))
            pairs.append({
                "planned_name": p_name,
                "planned_type": p_type,
                "planned_start": p_start.isoformat() if p_start else "",
                "planned_time_sec": int(p_secs),
                "planned_time_hms": format_hms(int(p_secs)),
                "planned_tss": round(p_tss, 1),
                "actual_name": a_name,
                "actual_type": canonical_type(_get_type(chosen)),
                "actual_start": a_start.isoformat() if a_start else "",
                "actual_time_sec": int(a_secs),
                "actual_time_hms": format_hms(int(a_secs)),
                "actual_tss": round(a_tss, 1),
                "delta_time_sec": int(a_secs - p_secs),
                "delta_tss": round(a_tss - p_tss, 1),
                "match_method": method,
            })

    unmatched_actual = [a for a in activities if id(a) not in used_ids]
    matched_planned_keys = {(p["planned_name"], p["planned_start"]) for p in pairs}
    unmatched_planned = []
    for e in planned_list:
        key = (str(e.get("name") or "").strip() or "Planned", (_parse_dt(_local_start_iso(e)) or dt.datetime.min).isoformat())
        if key not in matched_planned_keys:
            unmatched_planned.append(e)

    return pairs, unmatched_planned, unmatched_actual


# ---------------------------
# Summaries & advice
# ---------------------------

def summarize_day(activities: List[Dict[str, Any]], events: List[Dict[str, Any]]) -> Dict[str, Any]:
    # Actuals
    actual_secs = sum(_get_seconds(a) for a in activities)
    actual_tss = sum(_get_load(a) for a in activities)

    # Planned
    planned = [e for e in events if str(e.get("category") or "").upper() == "WORKOUT"]
    planned_secs = sum(_get_seconds(e) for e in planned)
    planned_tss = sum(_get_load(e) for e in planned)

    # By-type (actual + planned)
    by_type_actual = defaultdict(lambda: {"sec": 0, "tss": 0.0})
    for a in activities:
        t = canonical_type(_get_type(a))
        by_type_actual[t]["sec"] += _get_seconds(a)
        by_type_actual[t]["tss"] += _get_load(a)
    by_type_planned = defaultdict(lambda: {"sec": 0, "tss": 0.0})
    for e in planned:
        t = canonical_type(_get_type(e))
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

    # conservative heuristics
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


# ---------------------------
# Outputs
# ---------------------------

def write_outputs(outdir: str, day: dt.date, summary: Dict[str, Any], advice: Dict[str, Any], sessions: List[Dict[str, Any]], alerts: Dict[str, Any]) -> str:

    os.makedirs(outdir, exist_ok=True)
    base = os.path.join(outdir, f"daily-{day.isoformat()}")

    # JSON
    with open(base + ".json", "w", encoding="utf-8") as f:
        json.dump({"date": day.isoformat(), "summary": summary, "advice": advice, "sessions": sessions, "alerts": alerts}, f, indent=2)

    # CSV (one row)
    with open(base + "-summary.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["date","planned_tss","actual_tss","delta_tss","planned_time_sec","actual_time_sec","delta_time_sec","ctl","atl","tsb","ramp","tomorrow_planned_tss","tomorrow_suggested_tss","adjust_pct"])
        w.writerow([day.isoformat(), summary["planned_tss"], summary["actual_tss"], summary["delta_tss"], summary["planned_time_sec"], summary["actual_time_sec"], summary["delta_time_sec"], advice["ctl"], advice["atl"], advice["tsb"], advice["ramp"], advice["tomorrow_planned_tss"], advice["tomorrow_suggested_tss"], advice["adjust_pct"]])

    # CSV (per-workout sessions)
    with open(base + "-sessions.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "planned_name","planned_type","planned_start","planned_time_sec","planned_time_hms","planned_tss",
            "actual_name","actual_type","actual_start","actual_time_sec","actual_time_hms","actual_tss",
            "delta_time_sec","delta_tss","match_method"
        ])
        for row in sessions:
            w.writerow([
                row["planned_name"], row["planned_type"], row["planned_start"], row["planned_time_sec"], row["planned_time_hms"], row["planned_tss"],
                row["actual_name"], row["actual_type"], row["actual_start"], row["actual_time_sec"], row["actual_time_hms"], row["actual_tss"],
                row["delta_time_sec"], row["delta_tss"], row["match_method"]
            ])

    # Markdown (email-friendly)
    md = []
    md.append(f"# Daily Summary ({day})\n")
    md.append("## Totals\n")
    md.append("| Metric | Planned | Actual | Δ |")
    md.append("|---|---:|---:|---:|")
    md.append(f"| TSS | {summary['planned_tss']} | {summary['actual_tss']} | {summary['delta_tss']} |")
    md.append(f"| Time | {summary['planned_time_hms']} | {summary['actual_time_hms']} | {summary['delta_time_hms']} |")
    md.append("\n## Per-Workout Planned vs Actual (top 20)\n")
    md.append("| Planned | Type | Actual | ΔTime | ΔTSS | Match |")
    md.append("|---|---|---|---:|---:|---|")
    for row in sessions[:20]:
        md.append(f"| {row['planned_name']} | {row['planned_type']} | {row['actual_name']} | {row['delta_time_sec']}s | {row['delta_tss']} | {row['match_method']} |")
    if len(sessions) > 20:
        md.append(f"\n… {len(sessions) - 20} more; see sessions CSV.\n")
    if alerts["flags"]:
        md.append("\n## Red flags\n")
        for fl in alerts["flags"]:
            md.append(f"- ⚠️ {fl}")
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


# ---------------------------
# CLI
# ---------------------------

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Daily planned vs actual summary with per-workout matching and coach-style advice")
    p.add_argument("--api-key", help="Intervals API Key. If omitted, uses INTERVALS_API_KEY")
    p.add_argument("--athlete-id", type=int, default=0)
    p.add_argument("--base-url", default=INTERVALS_DEFAULT_BASE)
    p.add_argument("--tz", default="America/Los_Angeles")
    p.add_argument("--for-date", help="YYYY-MM-DD; default today in tz")
    p.add_argument("--outdir", default="reports/daily")
    p.add_argument("--timeout", type=int, default=30)
    p.add_argument(
        "--types",
        default="Ride,Gravel Ride",
        help="Comma-separated activity types to include (default: Ride,Gravel Ride)",
    )
    args = p.parse_args(argv)

    api_key = args.api_key or os.environ.get("INTERVALS_API_KEY")
    if not api_key:
        raise SystemExit("ERROR: Provide --api-key or set INTERVALS_API_KEY")

    cfg = load_config() 

    now = dt.datetime.now(ZoneInfo(args.tz)) if ZoneInfo else dt.datetime.now()
    day = dt.date.fromisoformat(args.for_date) if args.for_date else now.date()
    tomorrow = day + dt.timedelta(days=1)

    # Fetch
    acts = fetch_activities(api_key, args.athlete_id, args.base_url, day, args.timeout)
    evts_today = fetch_events(api_key, args.athlete_id, args.base_url, day, args.timeout)
    evts_tom = fetch_events(api_key, args.athlete_id, args.base_url, tomorrow, args.timeout)
    wellness = fetch_wellness(api_key, args.athlete_id, args.base_url, day, args.timeout)

    # Filter types
    allowed = {t.strip().lower() for t in (args.types or "").split(",") if t.strip()}
    def _allowed(obj) -> bool:
        return canonical_type(_get_type(obj)) in allowed
    acts = [a for a in acts if _allowed(a)]
    evts_today = [e for e in evts_today if _allowed(e)]
    evts_tom = [e for e in evts_tom if _allowed(e)]

    # Build summaries + matches
    summary = summarize_day(acts, evts_today)
    sessions, un_planned, un_actual = match_sessions(acts, evts_today)

    # Tomorrow planning & advice
    tomorrow_planned_tss = sum(_get_load(e) for e in evts_tom if str(e.get("category") or "").upper() == "WORKOUT")
    advice = coach_advice(summary, wellness, tomorrow_planned_tss)
    
    alerts = build_daily_alerts(summary, advice, cfg)

    base = write_outputs(args.outdir, day, summary, advice, sessions, alerts)

    print(f"Wrote {base}.md, {base}.json, {base}-summary.csv, {base}-sessions.csv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
