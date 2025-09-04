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

import os
try:
    import yaml
except Exception:
    yaml = None


INTERVALS_DEFAULT_BASE = "https://intervals.icu"


# ---------------------------
# Helpers
# ---------------------------

def load_config(path: str = ".icu.yaml") -> dict:
    if not os.path.exists(path) or yaml is None:
        return {
            "daily": {"min_tsb": -20, "warn_tsb": -10, "max_daily_ramp": 8.0, "max_delta_tss": 75},
            "weekly": {"min_tsb": -20, "max_weekly_ramp": 8.0, "max_delta_tss": 150},
        }
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
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

def build_weekly_alerts(summary: dict, cfg: dict) -> dict:
    flags = []
    tsb = summary["form_tsb"]
    ramp = summary["ramp_rate"]
    delta_tss = summary["delta_tss"]
    min_tsb = cfg["weekly"]["min_tsb"]
    max_ramp = cfg["weekly"]["max_weekly_ramp"]
    max_delta = cfg["weekly"]["max_delta_tss"]

    if tsb <= min_tsb:
        flags.append(f"TSB {tsb} (deep red)")
    if abs(delta_tss) >= max_delta:
        flags.append(f"ΔTSS {delta_tss:+}")
    if ramp >= max_ramp:
        flags.append(f"Ramp {ramp} CTL/wk high")

    subject_tag = ", ".join(flags)
    return {"flags": flags, "subject_tag": subject_tag}

def _date_str(d: dt.date) -> str:
    return d.strftime("%Y-%m-%d")


def _week_range_ending_sunday(today: dt.date) -> tuple[dt.date, dt.date]:
    """
    Return (monday, sunday) for the week ending on the most recent Sunday (inclusive).
    Mon=0..Sun=6; we find the latest Sunday <= today.
    """
    offset_to_sunday = (today.weekday() - 6) % 7
    sunday = today - dt.timedelta(days=offset_to_sunday)
    monday = sunday - dt.timedelta(days=6)
    return monday, sunday


def _get_seconds(obj: Dict[str, Any]) -> int:
    for k in ("moving_time", "elapsed_time", "duration"):
        v = obj.get(k)
        if isinstance(v, (int, float)):
            return int(v)
        if isinstance(v, str) and v.isdigit():
            return int(v)
    return 0


def _get_load(obj: Dict[str, Any]) -> float:
    # Intervals typically uses "load" (TSS-like). Try aliases defensively.
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
    # normalize common bike types / synonyms
    if "gravel" in s:
        return "gravel ride"
    if s in {"ride", "bike ride", "cycling", "bike"}:
        return "ride"
    if s.replace(" ", "") in {"virtualride"} or ("virtual" in s and "ride" in s):
        return "virtual ride"
    if "zwift" in s or "trainer" in s or "indoor" in s:
        return "virtual ride"
    return s

def canonicalize_obj_type(obj: dict) -> str:
    """Return the best-guess canonical type using both 'type' and 'name'."""
    t = str(obj.get("type") or "").strip()
    name = str(obj.get("name") or "").strip()
    ct = canonical_type(t)
    if ct and ct not in {"workout", ""}:
        return ct
    # Fallback from name when type is missing/generic
    n = name.lower()
    if any(k in n for k in ["zwift", "trainer", "indoor", "virtual"]):
        return "virtual ride"
    if "gravel" in n:
        return "gravel ride"
    if any(k in n for k in ["ride", "bike", "cycling", "spin"]):
        return "ride"
    # default: leave as-is so it can be filtered out if not allowed
    return ct or ""


def format_hms(seconds: int) -> str:
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    return f"{h:d}h {m:02d}m" if s == 0 else f"{h:d}h {m:02d}m {s:02d}s"


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
# API calls
# ---------------------------

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
    r = requests.get(url, params=params, auth=HTTPBasicAuth("API_KEY", api_key), timeout=timeout)
    r.raise_for_status()
    return r.json()


def fetch_events(
    api_key: str,
    athlete_id: int,
    base_url: str,
    start: dt.date,
    end: dt.date,
    timeout: int = 30,
) -> List[Dict[str, Any]]:
    # Planned workouts live in "events" (category often WORKOUT)
    url = f"{base_url}/api/v1/athlete/{athlete_id}/events"
    params = {"oldest": _date_str(start), "newest": _date_str(end)}
    r = requests.get(url, params=params, auth=HTTPBasicAuth("API_KEY", api_key), timeout=timeout)
    r.raise_for_status()
    return r.json()


def fetch_wellness(
    api_key: str,
    athlete_id: int,
    base_url: str,
    day: dt.date,
    timeout: int = 30,
) -> Dict[str, float]:
    url = f"{base_url}/api/v1/athlete/{athlete_id}/wellness"
    params = {"oldest": _date_str(day), "newest": _date_str(day), "cols": "ctl,atl,rampRate"}
    r = requests.get(url, params=params, auth=HTTPBasicAuth("API_KEY", api_key), timeout=timeout)
    r.raise_for_status()
    data = r.json()
    rec = (data or [{}])[-1]
    return {
        "ctl": float(rec.get("ctl", 0.0) or 0.0),
        "atl": float(rec.get("atl", 0.0) or 0.0),
        "rampRate": float(rec.get("rampRate", 0.0) or 0.0),
    }


# ---------------------------
# Matching logic (per-workout)
# ---------------------------

def match_sessions(activities: List[Dict[str, Any]], events: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Return (pairs, unmatched_planned, unmatched_actual).
    A pair has keys: planned_*, actual_*, delta_* and match_method.
    """
    # Index activities
    by_ext: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    by_date_type: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)

    def act_key(a: Dict[str, Any]) -> Tuple[Optional[dt.datetime], int]:
        dt0 = _parse_dt(_local_start_iso(a))
        return (dt0, _get_seconds(a))

    for a in activities:
        ext = str(a.get("external_id") or "")
        if ext:
            by_ext[ext].append(a)
        d = _local_date(a) or ""
        t = canonical_type(_get_type(a))
        by_date_type[(d, t)].append(a)

    # sort activity buckets by time
    for k in by_ext:
        by_ext[k].sort(key=act_key)
    for k in by_date_type:
        by_date_type[k].sort(key=act_key)

    used_ids = set()  # to avoid double-matching
    pairs: List[Dict[str, Any]] = []

    planned_list = [e for e in events if str(e.get("category") or "").upper() == "WORKOUT"]

    for e in planned_list:
        p_ext = str(e.get("external_id") or "")
        p_name = str(e.get("name") or "").strip() or "Planned"
        p_type = canonical_type(_get_type(e))
        p_secs = _get_seconds(e)
        p_tss = _get_load(e)
        p_start = _parse_dt(_local_start_iso(e))
        p_date = _local_date(e) or ""

        chosen = None
        method = ""

        # Strategy 1: external_id exact match
        if p_ext and p_ext in by_ext:
            for cand in by_ext[p_ext]:
                aid = id(cand)
                if aid in used_ids:
                    continue
                chosen = cand
                method = "external_id"
                break

        # Strategy 2: same date and type, closest start time
        if chosen is None:
            cands = by_date_type.get((p_date, p_type), [])
            best = None
            best_dt = None
            if p_start:
                for cand in cands:
                    aid = id(cand)
                    if aid in used_ids:
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
                # no planned start time? just take first unused in bucket
                for cand in cands:
                    aid = id(cand)
                    if aid in used_ids:
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
            pair = {
                "planned_name": p_name,
                "planned_type": p_type,
                "planned_time_sec": int(p_secs),
                "planned_time_hms": format_hms(int(p_secs)),
                "planned_tss": round(p_tss, 1),
                "planned_start": p_start.isoformat() if p_start else "",
                "actual_name": a_name,
                "actual_type": canonical_type(_get_type(chosen)),
                "actual_time_sec": int(a_secs),
                "actual_time_hms": format_hms(int(a_secs)),
                "actual_tss": round(a_tss, 1),
                "actual_start": a_start.isoformat() if a_start else "",
                "delta_time_sec": int(a_secs - p_secs),
                "delta_tss": round(a_tss - p_tss, 1),
                "match_method": method,
            }
            pairs.append(pair)

    # Unmatched
    matched_actuals = {id_entry for id_entry in used_ids}
    unmatched_actual = [a for a in activities if id(a) not in matched_actuals]
    matched_planned_names = {(p["planned_name"], p["planned_start"]) for p in pairs}
    unmatched_planned = []
    for e in planned_list:
        key = (str(e.get("name") or "").strip() or "Planned", (_parse_dt(_local_start_iso(e)) or dt.datetime.min).isoformat())
        if key not in matched_planned_names:
            unmatched_planned.append(e)

    return pairs, unmatched_planned, unmatched_actual


# ---------------------------
# Summary logic
# ---------------------------

def build_summary(
    activities: List[Dict[str, Any]],
    events: List[Dict[str, Any]],
    ctl: float,
    atl: float,
    ramp: float,
) -> Dict[str, Any]:
    # Actuals from activities
    actual_seconds = 0
    actual_load = 0.0
    by_type_actual: Dict[str, Dict[str, float]] = defaultdict(lambda: {"seconds": 0.0, "load": 0.0})

    for a in activities:
        secs = _get_seconds(a)
        ld = _get_load(a)
        t = canonicalize_obj_type(obj)
        actual_seconds += secs
        actual_load += ld
        by_type_actual[t]["seconds"] += secs
        by_type_actual[t]["load"] += ld

    # Planned from events (category WORKOUT)
    planned = [e for e in events if str(e.get("category") or "").upper() == "WORKOUT"]
    planned_seconds = 0
    planned_load = 0.0
    by_type_planned: Dict[str, Dict[str, float]] = defaultdict(lambda: {"seconds": 0.0, "load": 0.0})

    for e in planned:
        secs = _get_seconds(e)
        ld = _get_load(e)
        t = canonicalize_obj_type(obj)
        planned_seconds += secs
        planned_load += ld
        by_type_planned[t]["seconds"] += secs
        by_type_planned[t]["load"] += ld

    # Deltas
    delta_seconds = actual_seconds - planned_seconds
    delta_load = actual_load - planned_load

    # Form (TSB) = CTL - ATL (for Sunday)
    form = ctl - atl

    # Deltas by type
    all_types = sorted(set(by_type_actual) | set(by_type_planned))
    by_type_delta: Dict[str, Dict[str, float]] = {}
    for t in all_types:
        a_sec = by_type_actual.get(t, {}).get("seconds", 0.0)
        a_ld = by_type_actual.get(t, {}).get("load", 0.0)
        p_sec = by_type_planned.get(t, {}).get("seconds", 0.0)
        p_ld = by_type_planned.get(t, {}).get("load", 0.0)
        by_type_delta[t] = {
            "seconds": int(a_sec - p_sec),
            "load": round(a_ld - p_ld, 1),
        }

    # Per-workout pairs
    pairs, unmatched_planned, unmatched_actual = match_sessions(activities, events)

    return {
        # Actuals
        "tss": round(actual_load, 1),
        "load": round(actual_load, 1),
        "total_time_sec": int(actual_seconds),
        "total_time_hms": format_hms(int(actual_seconds)),
        # Planned
        "planned_tss": round(planned_load, 1),
        "planned_time_sec": int(planned_seconds),
        "planned_time_hms": format_hms(int(planned_seconds)),
        # Deltas
        "delta_tss": round(delta_load, 1),
        "delta_time_sec": int(delta_seconds),
        "delta_time_hms": format_hms(abs(int(delta_seconds))),
        # Fitness metrics
        "fitness_ctl": round(ctl, 1),
        "fatigue_atl": round(atl, 1),
        "form_tsb": round(form, 1),
        "ramp_rate": round(ramp, 1),
        # Breakdowns
        "by_type_actual": {
            k: {
                "time_sec": int(v["seconds"]),
                "time_hms": format_hms(int(v["seconds"])),
                "load": round(v["load"], 1),
            }
            for k, v in sorted(by_type_actual.items(), key=lambda kv: -kv[1]["seconds"])
        },
        "by_type_planned": {
            k: {
                "time_sec": int(v["seconds"]),
                "time_hms": format_hms(int(v["seconds"])),
                "load": round(v["load"], 1),
            }
            for k, v in sorted(by_type_planned.items(), key=lambda kv: -kv[1]["seconds"])
        },
        "by_type_delta": by_type_delta,
        # Sessions
        "sessions": pairs,
        "unmatched_planned": unmatched_planned,
        "unmatched_actual": unmatched_actual,
    }


# ---------------------------
# Outputs
# ---------------------------

def write_markdown(path: str, week_start: dt.date, week_end: dt.date, s: Dict[str, Any]) -> None:
    lines = []
    lines.append(f"# Weekly Summary ({week_start} → {week_end})\n")

    lines.append("## Totals\n")
    lines.append("| Metric | Value |")
    lines.append("|---|---:|")
    lines.append(f"| **Actual TSS** | **{s['tss']}** |")
    lines.append(f"| Planned TSS | {s['planned_tss']} |")
    lines.append(f"| Δ TSS (act−plan) | {s['delta_tss']} |")
    lines.append(f"| **Actual Time** | **{s['total_time_hms']}** |")
    lines.append(f"| Planned Time | {s['planned_time_hms']} |")
    lines.append(f"| Δ Time (act−plan) | {s['delta_time_hms']} |")
    lines.append(f"| Fitness (CTL) | {s['fitness_ctl']} |")
    lines.append(f"| Fatigue (ATL) | {s['fatigue_atl']} |")
    lines.append(f"| Form (TSB) | {s['form_tsb']} |")
    lines.append(f"| Ramp Rate | {s['ramp_rate']} |\n")

    lines.append("## Actual — Time & Load by Activity Type\n")
    lines.append("| Type | Time | Load |")
    lines.append("|---|---:|---:|")
    for t, v in s["by_type_actual"].items():
        lines.append(f"| {t} | {v['time_hms']} | {v['load']} |")

    lines.append("\n## Planned — Time & Load by Activity Type\n")
    lines.append("| Type | Time | Load |")
    lines.append("|---|---:|---:|")
    for t, v in s["by_type_planned"].items():
        lines.append(f"| {t} | {v['time_hms']} | {v['load']} |")

    # Sessions (limit to 20 in the email-friendly markdown)
    lines.append("\n## Per-Workout Planned vs Actual (top 20)\n")
    lines.append("| Planned | Type | Act | ΔTime | ΔTSS | Match |")
    lines.append("|---|---|---|---:|---:|---|")
    for row in s["sessions"][:20]:
        lines.append(
            f"| {row['planned_name']} | {row['planned_type']} | "
            f"{row['actual_name']} | {row['delta_time_sec']}s | {row['delta_tss']} | {row['match_method']} |"
        )
    if len(s["sessions"]) > 20:
        lines.append(f"\n… {len(s['sessions']) - 20} more; see sessions CSV.\n")

    # Optional: deltas by type (omit empty deltas)
    if any(abs(d["seconds"]) > 0 or abs(d["load"]) > 0.05 for d in s["by_type_delta"].values()):
        lines.append("\n## Δ by Type (Actual − Planned)\n")
        lines.append("| Type | Δ Time (sec) | Δ Load |")
        lines.append("|---|---:|---:|")
        for t in sorted(s["by_type_delta"].keys()):
            d = s["by_type_delta"][t]
            lines.append(f"| {t} | {d['seconds']} | {d['load']} |")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def write_csvs(base_path: str, week_start: dt.date, week_end: dt.date, s: Dict[str, Any]) -> tuple[str, str, str]:
    """
    Writes three CSVs:
      - {base}-summary.csv    (one row: actual + planned + deltas + CTL/ATL/TSB/Ramp)
      - {base}-bytype.csv     (rows by type: actual, planned, deltas)
      - {base}-sessions.csv   (per-workout planned vs actual pairs)
    Returns the three paths.
    """
    summary_csv = f"{base_path}-summary.csv"
    bytype_csv = f"{base_path}-bytype.csv"
    sessions_csv = f"{base_path}-sessions.csv"

    # One-row summary
    with open(summary_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "week_start","week_end",
            "tss_actual","tss_planned","delta_tss",
            "time_actual_sec","time_actual_hms",
            "time_planned_sec","time_planned_hms",
            "delta_time_sec",
            "fitness_ctl","fatigue_atl","form_tsb","ramp_rate"
        ])
        w.writerow([
            week_start.isoformat(), week_end.isoformat(),
            s["tss"], s["planned_tss"], s["delta_tss"],
            s["total_time_sec"], s["total_time_hms"],
            s["planned_time_sec"], s["planned_time_hms"],
            s["delta_time_sec"],
            s["fitness_ctl"], s["fatigue_atl"], s["form_tsb"], s["ramp_rate"],
        ])

    # By-type: actual + planned + deltas
    with open(bytype_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "type",
            "actual_time_sec","actual_time_hms","actual_load",
            "planned_time_sec","planned_time_hms","planned_load",
            "delta_time_sec","delta_load"
        ])
        all_types = sorted(set(s["by_type_actual"].keys()) | set(s["by_type_planned"].keys()))
        for t in all_types:
            a = s["by_type_actual"].get(t, {"time_sec": 0, "time_hms": "0h 00m", "load": 0.0})
            p = s["by_type_planned"].get(t, {"time_sec": 0, "time_hms": "0h 00m", "load": 0.0})
            d = s["by_type_delta"].get(t, {"seconds": 0, "load": 0.0})
            w.writerow([
                t,
                a["time_sec"], a["time_hms"], a["load"],
                p["time_sec"], p["time_hms"], p["load"],
                d["seconds"], d["load"],
            ])

    # Sessions pairs
    with open(sessions_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "planned_name","planned_type","planned_start","planned_time_sec","planned_time_hms","planned_tss",
            "actual_name","actual_type","actual_start","actual_time_sec","actual_time_hms","actual_tss",
            "delta_time_sec","delta_tss","match_method"
        ])
        for row in s["sessions"]:
            w.writerow([
                row["planned_name"], row["planned_type"], row["planned_start"], row["planned_time_sec"], row["planned_time_hms"], row["planned_tss"],
                row["actual_name"], row["actual_type"], row["actual_start"], row["actual_time_sec"], row["actual_time_hms"], row["actual_tss"],
                row["delta_time_sec"], row["delta_tss"], row["match_method"]
            ])

    return summary_csv, bytype_csv, sessions_csv


# ---------------------------
# CLI
# ---------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a weekly training summary (actual vs planned) from Intervals.icu")
    parser.add_argument("--api-key", help="Intervals API Key. If omitted, uses INTERVALS_API_KEY")
    parser.add_argument("--athlete-id", type=int, default=0, help="Defaults to 0 (self)")
    parser.add_argument("--base-url", default=INTERVALS_DEFAULT_BASE)
    parser.add_argument("--tz", default="America/Los_Angeles", help="Timezone for week ending Sunday")
    parser.add_argument("--for-date", help="YYYY-MM-DD; choose the week ending on this date (optional)")
    parser.add_argument("--outdir", default="reports/weekly", help="Directory for outputs")
    parser.add_argument("--filename", default="", help="Optional fixed filename for the markdown")
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--types", default="Ride,Gravel Ride,Virtual Ride", help="Comma-separated activity types to include (default: Ride,Gravel Ride)",)
    args = parser.parse_args(argv)

    api_key = args.api_key or os.environ.get("INTERVALS_API_KEY")
    if not api_key:
        raise SystemExit("ERROR: Provide --api-key or set INTERVALS_API_KEY")

    # Reference date in TZ (for "which Sunday")
    if ZoneInfo:
        now = dt.datetime.now(ZoneInfo(args.tz))
    else:
        now = dt.datetime.now()
    ref = dt.date.fromisoformat(args.for_date) if args.for_date else now.date()

    week_start, week_end = _week_range_ending_sunday(ref)

    activities = fetch_activities(api_key, args.athlete_id, args.base_url, week_start, week_end, args.timeout)
    events = fetch_events(api_key, args.athlete_id, args.base_url, week_start, week_end, args.timeout)
    wellness = fetch_wellness(api_key, args.athlete_id, args.base_url, week_end, args.timeout)

    # Filter types
    allowed = {canonical_type(t) for t in (args.types or "").split(",") if t.strip()}

    def _allowed(obj) -> bool:
        return canonicalize_obj_type(obj) in allowed

    activities = [a for a in activities if _allowed(a)]
    events = [e for e in events if _allowed(e)]

    summary = build_summary(
        activities=activities,
        events=events,
        ctl=wellness["ctl"],
        atl=wellness["atl"],
        ramp=wellness["rampRate"],
    )

    cfg = load_config()
    alerts = build_weekly_alerts(summary, cfg)


    # Ensure output directory
    outdir = os.path.abspath(args.outdir)
    os.makedirs(outdir, exist_ok=True)

    # Markdown
    fname = args.filename or f"weekly-{week_end.isoformat()}.md"
    md_path = os.path.join(outdir, fname)
    write_markdown(md_path, week_start, week_end, summary)

    # JSON
    json_path = os.path.join(outdir, f"weekly-{week_end.isoformat()}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({"week_start": week_start.isoformat(), "week_end": week_end.isoformat(), "summary": summary, "alerts": alerts}, f, indent=2)

    # CSVs
    base = os.path.join(outdir, f"weekly-{week_end.isoformat()}")
    summary_csv, bytype_csv, sessions_csv = write_csvs(base, week_start, week_end, summary)

    print(f"Wrote {md_path}, {json_path}, {summary_csv}, {bytype_csv}, {sessions_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
