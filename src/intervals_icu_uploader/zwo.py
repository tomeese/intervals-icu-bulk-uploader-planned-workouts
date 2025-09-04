from __future__ import annotations
import os
import re
import xml.etree.ElementTree as ET
from typing import List, Dict, Any

def _safe_filename(name: str) -> str:
    s = re.sub(r"[^\w\-.]+", "_", name.strip())
    return s.strip("_.") or "workout"

def write_zwo(path: str, name: str, description: str, sport: str, steps: List[Dict[str, Any]]) -> None:
    """
    steps: list of dicts with one of:
      - {"kind":"Warmup", "duration_s":600, "power_low":0.5, "power_high":0.75}
      - {"kind":"SteadyState", "duration_s":1200, "power":0.9}
      - {"kind":"IntervalsT", "repeat":4, "on_s":480, "on_power":1.05, "off_s":180, "off_power":0.6}
      - {"kind":"Cooldown", "duration_s":600, "power_low":0.75, "power_high":0.5}
      - {"kind":"FreeRide", "duration_s":3600, "flat_road":1}
    Power values are fractions of FTP (e.g., 0.9 = 90%).
    """
    wf = ET.Element("workout_file")
    ET.SubElement(wf, "name").text = name
    ET.SubElement(wf, "description").text = description
    ET.SubElement(wf, "sportType").text = sport  # "bike"
    ET.SubElement(wf, "author").text = "intervals-icu-uploader"

    tags = ET.SubElement(wf, "tags")  # optional
    workout = ET.SubElement(wf, "workout")

    def add_step(tag: str, attrs: dict):
        e = ET.SubElement(workout, tag)
        for k, v in attrs.items():
            e.set(k, str(v))

    for st in steps:
        k = st.get("kind")
        if k == "Warmup":
            add_step("Warmup", {
                "Duration": int(st["duration_s"]),
                "PowerLow": round(float(st["power_low"]), 3),
                "PowerHigh": round(float(st["power_high"]), 3),
            })
        elif k == "SteadyState":
            add_step("SteadyState", {
                "Duration": int(st["duration_s"]),
                "Power": round(float(st["power"]), 3),
            })
        elif k == "IntervalsT":
            add_step("IntervalsT", {
                "Repeat": int(st["repeat"]),
                "OnDuration": int(st["on_s"]),
                "OnPower": round(float(st["on_power"]), 3),
                "OffDuration": int(st["off_s"]),
                "OffPower": round(float(st["off_power"]), 3),
            })
        elif k == "Cooldown":
            add_step("Cooldown", {
                "Duration": int(st["duration_s"]),
                "PowerLow": round(float(st["power_low"]), 3),
                "PowerHigh": round(float(st["power_high"]), 3),
            })
        elif k == "FreeRide":
            add_step("FreeRide", {
                "Duration": int(st["duration_s"]),
                "FlatRoad": int(st.get("flat_road", 1)),
            })

    os.makedirs(os.path.dirname(path), exist_ok=True)
    ET.ElementTree(wf).write(path, encoding="utf-8", xml_declaration=True)
