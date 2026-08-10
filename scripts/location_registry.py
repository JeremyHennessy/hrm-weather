#!/usr/bin/env python3
"""Canonical location registry shared with the browser-generated registry.

locations.json is the source of truth.  Python consumers receive the historical
shape expected by Accuracy Engine 2/3 (point tuples, bbox, etc.) so existing
forecast/model code does not need to know about the JSON representation.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_FILE = ROOT / "locations.json"


def load_registry() -> dict[str, dict[str, Any]]:
    payload = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
    out: dict[str, dict[str, Any]] = {}
    for key, src in (payload.get("locations") or {}).items():
        loc = dict(src)
        loc["points"] = [
            (str(p["name"]), float(p["lat"]), float(p["lon"]), str(p.get("kind") or ""))
            for p in src.get("points") or []
        ]
        out[str(key)] = loc
    return out


REGISTRY = load_registry()


def install_core_locations(core: Any) -> dict[str, dict[str, Any]]:
    """Replace legacy in-module location literals with the canonical registry."""
    canonical = load_registry()
    core.LOCATIONS.clear()
    core.LOCATIONS.update(canonical)
    return canonical


def browser_payload() -> dict[str, Any]:
    """Normalized structure used to verify the generated browser registry."""
    locations: dict[str, Any] = {}
    raw = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
    for key, loc in (raw.get("locations") or {}).items():
        locations[key] = {
            "label": loc.get("label"),
            "place": loc.get("place"),
            "timezone": loc.get("timezone"),
            "country": loc.get("country"),
            "points": [[p.get("name"), p.get("lat"), p.get("lon")] for p in loc.get("points") or []],
        }
    return {"version": raw.get("version", 1), "locations": locations}
