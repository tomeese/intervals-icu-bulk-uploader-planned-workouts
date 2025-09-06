#!/usr/bin/env python3
"""
Generate Zwift .zwo files from a plan JSON using OpenAI (with a safe fallback).
Usage:
  python scripts/gen_zwo_from_plan.py --plan plans/plan-YYYY-MM-DD.json --outdir zwo
"""
import argparse, json, os, re, sys, pathlib
from jsonschema import validate, ValidationError

try:
    from openai import OpenAI  # pip install openai
except Exception as e:
    OpenAI = None

SCHEMA = {
  "type":"object","required":["name","segments"],
  "properties":{
    "name":{"type":"string"},
    "segments":{"type":"array","items":{
      "oneOf":[
        {"type":"object","required":["type","seconds","from_pct","to_pct"],
         "properties":{"type":{"const":"warmup"},"seconds":{"type":"integer","minimum":60},"from_pct":{"type":"number"},"to_pct":{"type":"number"}}},
        {"type":"object","required":["type","repeat","work","rest"],
         "properties":{
            "type":{"const":"repeat"},"repeat":{"type":"integer","minimum":1},
            "work":{"type":"object","required":["type","seconds","pct"],
                    "properties":{"type":{"const":"steady"},"seconds":{"type":"integer","minimum":30},"pct":{"type":"number"}}},
            "rest":{"type":"object","required":["type","seconds","pct"],
                    "properties":{"type":{"const":"steady"},"seconds":{"type":"integer","minimum":15},"pct":{"type":"number"}}}
         }},
        {"type":"object","required":["type","seconds","from_pct","to_pct"],
         "properties":{"type":{"const":"cooldown"},"seconds":{"type":"integer","minimum":60},"from_pct":{"type":"number"},"to_pct":{"type":"number"}}}
      ]
    }}
  }
}

def slug(s: str) -> str:
    return re.sub(r'[^A-Za-z0-9_.-]+','_', s).strip('_')[:120] or "workout"

def clamp_spec(data: dict) -> dict:
    """Clamp values to sane ranges."""
    for seg in data.get("segments", []):
        if seg.get("type") in ("warmup","cooldown"):
            seg["seconds"] = int(min(max(int(seg["seconds"]), 60), 3600))
            seg["from_pct"] = float(max(min(float(seg["from_pct"]), 1.5), 0.3))
            seg["to_pct"]   = float(max(min(float(seg["to_pct"]),   1.5), 0.3))
        elif seg.get("type") == "repeat":
            seg["repeat"] = int(min(max(int(seg["repeat"]), 1), 20))
            for k in ("work","rest"):
                seg[k]["seconds"] = int(min(max(int(seg[k]["seconds"]), 15), 3600))
                seg[k]["pct"] = float(max(min(float(seg[k]["pct"]), 1.8), 0.3))
    return data

def to_zwo(spec: dict, title: str) -> str:
    esc = lambda s: (s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
                     .replace('"',"&quot;").replace("'","&apos;"))
    steps = []
    for seg in spec["segments"]:
        if seg["type"] == "warmup":
            steps.append(f'<Warmup Duration="{seg["seconds"]}" PowerLow="{seg["from_pct"]}" PowerHigh="{seg["to_pct"]}"/>')
        elif seg["type"] == "repeat":
            steps.append(
                f'<IntervalsT Repeat="{seg["repeat"]}" OnDuration="{seg["work"]["seconds"]}" OffDuration="{seg["rest"]["seconds"]}" '
                f'OnPower="{seg["work"]["pct"]}" OffPower="{seg["rest"]["pct"]}" Cadence="0"/>'
            )
        elif seg["type"] == "cooldown":
            steps.append(f'<Cooldown Duration="{seg["seconds"]}" PowerLow="{seg["to_pct"]}" PowerHigh="{seg["from_pct"]}"/>')

    body = "\n    ".join(steps)  # ← precompute; no backslashes inside f-string braces
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>planner</author>
  <name>{esc(title)}</name>
  <description>Auto-generated from plan</description>
  <sportType>bike</sportType>
  <tags></tags>
  <workout>
    {body}
  </workout>
</workout_file>
'''

def fallback_spec(d: dict, name: str) -> dict:
    """Deterministic workout if the model/secret is unavailable."""
    warm = {"type":"warmup","seconds":int(d.get("warmup_sec",600)),"from_pct":0.5,"to_pct":0.75}
    rep  = {"type":"repeat","repeat":max(1,int(d.get("sets",3))),
            "work":{"type":"steady","seconds":int(d.get("work_sec",720)),"pct":float(d.get("target_pct",0.95))},
            "rest":{"type":"steady","seconds":int(d.get("rec_sec",300)),"pct":0.55}}
    cool = {"type":"cooldown","seconds":int(d.get("cooldown_sec",600)),"from_pct":0.75,"to_pct":0.5}
    return {"name": name, "segments":[warm, rep, cool]}

def call_model(design: dict, name: str) -> dict:
    """Ask OpenAI for a JSON segment spec matching SCHEMA, else raise."""
    if OpenAI is None:
        raise RuntimeError("openai sdk missing")
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    client = OpenAI(api_key=api_key)
    sys_prompt = (
      "You generate structured cycling workouts as JSON segments only. "
      "Return STRICT JSON that matches the provided schema. No XML, no prose."
    )
    user_content = (
      "Design a workout from these inputs. Use steady ERG steps for work/rest. "
      "Include a ramp warmup 50%→75% and cooldown 75%→50%.\n\n"
      f"Inputs:\n{json.dumps(design, indent=2)}"
    )
    resp = client.chat.completions.create(
      model="gpt-4o-mini",
      temperature=0.2,
      response_format={"type":"json_object"},
      messages=[{"role":"system","content":sys_prompt},
                {"role":"user","content":user_content}]
    )
    data = json.loads(resp.choices[0].message.content)
    validate(instance=data, schema=SCHEMA)
    return clamp_spec(data)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True, help="Path to plans/plan-YYYY-MM-DD.json")
    ap.add_argument("--outdir", default="zwo", help="Directory to write .zwo files")
    args = ap.parse_args()

    path = pathlib.Path(args.plan)
    if not path.is_file():
        print(f"ERROR: plan file not found: {path}", file=sys.stderr)
        sys.exit(2)
    outdir = pathlib.Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    plan = json.loads(path.read_text(encoding="utf-8"))
    made = 0

    for w in plan.get("workouts", []):
        d = w.get("design")
        if not (w.get("indoor") and d and (w.get("type") in ("Virtual Ride","Ride"))):
            continue
        name = w.get("name") or "Workout"
        # Skip endurance/free-ride style
        if re.search(r"endurance\s*z?2", name, flags=re.I):
            continue

        try:
            spec = call_model(d, name)
        except Exception as e:
            # Fallback: deterministic builder
            spec = fallback_spec(d, name)

        date = w.get("date") or "0000-00-00"
        fname = f'{date}-{slug(name)}.zwo'
        (outdir / fname).write_text(to_zwo(spec, name), encoding="utf-8")
        print(f"Wrote {fname}")
        made += 1

    if made == 0:
        print("No ZWOs generated (no designed indoor workouts).")

if __name__ == "__main__":
    main()
