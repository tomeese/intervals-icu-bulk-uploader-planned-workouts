from __future__ import annotations
import argparse
import datetime as dt
import json
import math
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import requests
from requests.auth import HTTPBasicAuth

try:
    from zoneinfo import ZoneInfo
except Exception:
    ZoneInfo = None  # type: ignore

from .zwo import write_zwo

# ---- shared-ish helpers (kept local so this script is standalone) ----

INTERVALS_DEFAULT_BASE = "https://intervals.icu"

def _date_str(d: dt.date) -> str:
    return d.strftime("%Y-%m-%d")

def _get_seconds(obj: Dict[str, Any]) -> int:
    for k in ("moving_time", "elapsed_time", "duration", "duration_s"):
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

def _local_start_iso(obj: Dict[str, Any]) -> Optional[str]:
    for k in ("start_date_local", "start_date"):
        v = obj.get(k)
        if isinstance(v, str) and len(v) >= 16:
            return v
    return None

def _local_date(obj: Dict[str, Any]) -> Optional[str]:
    s = _local_start_iso(obj)
    return s[:10] if s else None

def canonical_type(v: str | None) -> str:
    s = str(v or "").strip().lower()
    if "gravel" in s:
        return "gravel ride"
    if s in {"ride", "bike ride", "cycling", "bike"}:
        return "ride"
    s_compact = s.replace(" ", "")
    if s_compact == "virtualride" or ("virtual" in s and "ride" in s):
        return "virtual ride"
    if any(k in s for k in ["zwift", "trainer", "indoor", "smarttrainer"]):
        return "virtual ride"
    return s

def canonicalize_obj_type(obj: dict) -> str:
    raw = (
        obj.get("type")
        or obj.get("sport")
        or obj.get("activityType")
        or obj.get("sub_type")
        or obj.get("subType")
        or ""
    )
    ct = canonical_type(raw)
    if ct in {"", "workout"}:
        name = str(obj.get("name") or "").strip().lower()
        if any(k in name for k in ["zwift", "trainer", "indoor", "virtual"]):
            return "virtual ride"
        if "gravel" in name:
            return "gravel ride"
        if any(k in name for k in ["ride", "bike", "cycling", "spin"]):
            return "ride"
    return ct

# ---- API ----

def fetch_events(api_key: str, athlete_id: int, base_url: str, oldest: dt.date, newest: dt.date, timeout: int = 30) -> List[Dict[str, Any]]:
    url = f"{base_url}/api/v1/athlete/{athlete_id}/events"
    params = {"oldest": _date_str(oldest), "newest": _date_str(newest)}
    r = requests.get(url, params=params, auth=HTTPBasicAuth("API_KEY", api_key), timeout=timeout)
    r.raise_for_status()
    return r.json()

# ---- ZWO inference ----

def _infer_if_from_tss_and_duration(tss: float, dur_s: int) -> float:
    """IF ~ sqrt(TSS / (100 * hours)). Clamp to [0.5, 1.15]."""
    if dur_s <= 0 or tss <= 0:
        return 0.7
    hours = dur_s / 3600.0
    if hours <= 0:
        return 0.7
    if_val = math.sqrt(max(1e-6, tss / (100.0 * hours)))
    return float(min(1.15, max(0.5, if_val)))

def _build_basic_steps(name: str, tss: float, dur_s: int) -> List[Dict[str, Any]]:
    """Fallback: WU 10', steady, CD 10' (shorter workouts scale down)."""
    dur_s = max(0, int(dur_s))
    if dur_s <= 0:
        return []
    if_target = _infer_if_from_tss_and_duration(tss, dur_s)
    if dur_s < 1800:
        # short: 5' WU, steady, 5' CD
        wu = min(300, max(0, dur_s // 6))
        cd = wu
        steady = max(0, dur_s - (wu + cd))
        steps = []
        if wu > 0:
            steps.append({"kind": "Warmup", "duration_s": wu, "power_low": 0.5, "power_high": 0.75})
        if steady > 0:
            steps.append({"kind": "SteadyState", "duration_s": steady, "power": round(if_target, 3)})
        if cd > 0:
            steps.append({"kind": "Cooldown", "duration_s": cd, "power_low": 0.75, "power_high": 0.5})
        return steps
    else:
        # 10' WU, steady, 10' CD
        wu = min(600, dur_s // 6)
        cd = wu
        steady = max(0, dur_s - (wu + cd))
        steps = []
        if wu > 0:
            steps.append({"kind": "Warmup", "duration_s": wu, "power_low": 0.5, "power_high": 0.75})
        if steady > 0:
            steps.append({"kind": "SteadyState", "duration_s": steady, "power": round(if_target, 3)})
        if cd > 0:
            steps.append({"kind": "Cooldown", "duration_s": cd, "power_low": 0.75, "power_high": 0.5})
        return steps

# If Intervals ever returns structured steps in the event payload (not guaranteed),
# you can parse and map them here. For now we stick to the robust fallback above.

# ---- CLI ----

def main(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Generate Zwift .zwo files for indoor planned workouts (skips Endurance Z2).")
    ap.add_argument("--api-key", help="Intervals API Key. If omitted, uses INTERVALS_API_KEY")
    ap.add_argument("--athlete-id", type=int, default=0)
    ap.add_argument("--base-url", default=INTERVALS_DEFAULT_BASE)
    ap.add_argument("--tz", default="America/Los_Angeles")
    ap.add_argument("--for-date", help="YYYY-MM-DD (single day)")
    ap.add_argument("--oldest", help="YYYY-MM-DD (range start)")
    ap.add_argument("--newest", help="YYYY-MM-DD (range end)")
    ap.add_argument("--outdir", default="zwift")
    ap.add_argument("--timeout", type=int, default=30)
    ap.add_argument("--types", default="Ride,Gravel Ride,Virtual Ride", help="Allowed activity types (canonicalized)")
    ap.add_argument("--skip-pattern", default="endurance.*z2", help="Regex (case-insensitive) to skip (default: Endurance Z2)")
    args = ap.parse_args(argv)

    api_key = args.api_key or os.environ.get("INTERVALS_API_KEY")
    if not api_key:
        raise SystemExit("ERROR: Provide --api-key or set INTERVALS_API_KEY")

    tz = ZoneInfo(args.tz) if ZoneInfo else None
    today = dt.datetime.now(tz).date() if tz else dt.date.today()

    if args.for_date:
        oldest = newest = dt.date.fromisoformat(args.for_date)
    else:
        oldest = dt.date.fromisoformat(args.oldest) if args.oldest else today
        newest = dt.date.fromisoformat(args.newest) if args.newest else oldest

    # Pull events for window
    events = fetch_events(api_key, args.athlete_id, args.base_url, oldest, newest, args.timeout)

    # Filter: workouts only, indoor only, not Endurance Z2
    allowed = {canonical_type(t) for t in (args.types or "").split(",") if t.strip()}
    skip_rx = re.compile(args.skip_pattern, re.I)

    planned = []
    for e in events:
        if str(e.get("category") or "").upper() != "WORKOUT":
            continue
        typ = canonicalize_obj_type(e)
        if typ not in allowed:
            continue
        # "Indoor" test — treat virtual/zwift/trainer/indoor as indoor
        is_indoor = (typ == "virtual ride") or any(k in str(e.get("name") or "").lower() for k in ["indoor", "zwift", "trainer"])
        if not is_indoor:
            continue
        name = str(e.get("name") or "")
        if skip_rx.search(name.lower()):
            # Endurance Z2 etc → skip (non-ERG)
            continue
        planned.append(e)

    if not planned:
        print("No eligible indoor workouts found.")
        return 0

    os.makedirs(args.outdir, exist_ok=True)
    for e in planned:
        name = str(e.get("name") or "Indoor Workout").strip()
        date = (_local_date(e) or oldest.isoformat())
        dur_s = _get_seconds(e)
        tss = _get_load(e)

        # Build steps (fallback to IF from TSS + duration)
        steps = _build_basic_steps(name, tss, dur_s)
        if not steps:
            print(f"Skipping {date} {name}: insufficient duration/TSS")
            continue

        zwo_name = f"{date} - {name}"
        desc = f"Generated from Intervals.icu plan. Dur={dur_s}s TSS≈{tss}"
        safe = re.sub(r"[^\w\-.]+", "_", name)
        fname = os.path.join(args.outdir, f"{date} - {safe}.zwo")
        write_zwo(fname, zwo_name, desc, sport="bike", steps=steps)
        print(f"Wrote {fname}")

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
