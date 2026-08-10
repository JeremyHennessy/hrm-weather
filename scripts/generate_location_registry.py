#!/usr/bin/env python3
"""Generate/check location-registry.js from canonical locations.json."""
from __future__ import annotations
import argparse
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/"locations.json"
OUTPUT=ROOT/"location-registry.js"


def render()->str:
    raw=json.loads(SOURCE.read_text(encoding="utf-8"));locations={}
    for key,loc in (raw.get("locations") or {}).items():
        locations[key]={
            "label":loc.get("label"),"place":loc.get("place"),"timezone":loc.get("timezone"),"country":loc.get("country"),
            "points":[[p.get("name"),p.get("lat"),p.get("lon")] for p in loc.get("points") or []],
        }
    payload=json.dumps({"version":raw.get("version",1),"locations":locations},ensure_ascii=False,separators=(",",":"))
    return "/* Generated from locations.json. Do not hand-edit. */\n(()=>{const registry="+payload+";window.WX_LOCATION_REGISTRY=Object.freeze(registry);window.WXLocation=key=>registry.locations[key]||registry.locations.hrm})();\n"


def main()->int:
    p=argparse.ArgumentParser();p.add_argument("--check",action="store_true");args=p.parse_args();expected=render()
    if args.check:
        actual=OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if actual!=expected:raise SystemExit("location-registry.js is stale; run scripts/generate_location_registry.py")
        print("location registry generated artifact matches locations.json");return 0
    OUTPUT.write_text(expected,encoding="utf-8");return 0

if __name__=="__main__":raise SystemExit(main())
