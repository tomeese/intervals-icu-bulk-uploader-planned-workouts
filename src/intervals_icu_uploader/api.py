from __future__ import annotations
import json
import os
from typing import Any, Dict, List, Tuple
from urllib.parse import urlencode

import requests
from requests.auth import HTTPBasicAuth


INTERVALS_DEFAULT_BASE = "https://intervals.icu"


def _coerce_seconds(value: Any) -> int | None:
    """
    Accept either an int, a string in H:M:S, or a string of seconds.
    Return None if it cannot be parsed.
    """
    if value is None:
        return None
    if isinstance(value, int):
        return value
    s = str(value).strip()
    if s.isdigit():
        return int(s)
    if ":" in s:
        # H:M:S or M:S
        parts = [int(p) for p in s.split(":")]
        if len(parts) == 3:
            h, m, sec = parts
            return h * 3600 + m * 60 + sec
        if len(parts) == 2:
            m, sec = parts
            return m * 60 + sec
    return None


def _normalize_type(value: Any) -> str:
    """
    Map common aliases into Intervals' safe set.
    """
    if not value:
        return "Workout"
    s = str(value).strip().lower()
    mapping = {
        "ride": "Ride",
        "cycling": "Ride",
        "bike": "Ride",
        "mtb": "Ride",
        "gravel": "Ride",
        "run": "Run",
        "running": "Run",
        "swim": "Swim",
        "swimming": "Swim",
        "workout": "Workout",
        "strength": "Workout",
        "weights": "Workout",
        "weight training": "Workout",
        "gym": "Workout",
    }
    return mapping.get(s, value if isinstance(value, str) else "Workout")


def _strip_trailing_z(dt: str | None) -> str | None:
    if not dt:
        return dt
    s = str(dt)
    return s[:-1] if s.endswith("Z") else s


def normalize_event(evt: Dict[str, Any]) -> Dict[str, Any]:
    """
    Ensure minimal fields for a planned workout.
    - category: WORKOUT
    - start_date_local: ISO without Z
    - type: mapped to safe set
    - moving_time: seconds
    - icu_training_load: int if possible
    Drop unsupported fields if present.
    """
    out = dict(evt)
    out["category"] = out.get("category", "WORKOUT")

    if "start_date_local" in out:
        out["start_date_local"] = _strip_trailing_z(out["start_date_local"])

    if "type" in out:
        out["type"] = _normalize_type(out["type"])
    else:
        out["type"] = "Workout"

    if "moving_time" in out:
        mt = _coerce_seconds(out["moving_time"])
        if mt is not None:
            out["moving_time"] = mt

    # make training load an int if possible
    if "icu_training_load" in out:
        try:
            out["icu_training_load"] = int(out["icu_training_load"])
        except Exception:
            pass

    # strip unsupported fields commonly seen
    for k in ("start_time", "duration"):
        if k in out:
            out.pop(k, None)

    return out


def load_events_from_file(path: str) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "events" in data:
        events = data["events"]
    elif isinstance(data, list):
        events = data
    else:
        raise ValueError("Payload must be a list of events or an object with an 'events' array")
    return [normalize_event(e) for e in events]


def post_bulk_events(
    events: List[Dict[str, Any]],
    api_key: str,
    athlete_id: int = 0,
    base_url: str = INTERVALS_DEFAULT_BASE,
    upsert: bool = True,
    timeout: int = 30,
) -> Tuple[int, Dict[str, Any]]:
    """
    POST events to Intervals in bulk.
    Returns (status_code, response_json_or_text)
    """
    if not api_key:
        raise ValueError("API key is required")

    query = urlencode({"upsert": str(upsert).lower()})
    url = f"{base_url}/api/v1/athlete/{athlete_id}/events/bulk?{query}"

    auth = HTTPBasicAuth("API_KEY", api_key)
    headers = {"Content-Type": "application/json"}

    resp = requests.post(url, auth=auth, headers=headers, data=json.dumps(events), timeout=timeout)
    try:
        js = resp.json()
    except Exception:
        js = {"text": resp.text}
    return resp.status_code, js
