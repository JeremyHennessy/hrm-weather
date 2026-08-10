#!/usr/bin/env python3
"""Target-time truth archive for prospective Engine 3 verification.

Every collector cycle stores official observation values under the observation's
actual valid timestamp and stores radar/RDPA context under its collection/analysis
timestamp.  Verification queries the nearest valid-time value per variable rather
than reusing the latest observation for several past targets.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

import accuracy_engine_v2 as core

STATE = core.DATA / "target-truth-archive.json"
VERSION = "1.0"
MAX_AGE_DAYS = 75
DEFAULT_MAX_OFFSET_MINUTES = 45
OBS_VARS = ("temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_gusts_10m", "precipitation", "cloud_cover", "shortwave_radiation")
RADAR_VARS = ("radar_rain_rate", "radar_extrapolated_rain_rate", "rdpa_6h_precip")


def load_state() -> dict[str, Any]:
    return core.load(STATE, {"version": VERSION, "updated_at": None, "observations": {}, "radar": {}})


def _trim(rows: list[dict[str, Any]], now) -> list[dict[str, Any]]:
    cutoff = now - timedelta(days=MAX_AGE_DAYS)
    return [r for r in rows if (core.parse_stamp(r.get("valid_time")) or now) >= cutoff]


def _upsert(rows: list[dict[str, Any]], item: dict[str, Any]) -> None:
    stamp = item.get("valid_time")
    for i, old in enumerate(rows):
        if old.get("valid_time") == stamp:
            merged = dict(old)
            merged.update(item)
            rows[i] = merged
            return
    rows.append(item)
    rows.sort(key=lambda r: r.get("valid_time") or "")


def archive_current(observations: dict[str, Any], nowcasts: dict[str, Any]) -> dict[str, Any]:
    state = load_state(); now = core.utcnow()
    obs_store = state.setdefault("observations", {})
    for loc, obs in (observations or {}).items():
        valid = core.parse_stamp((obs or {}).get("time"))
        if not valid:
            continue
        values = (obs or {}).get("values") or {}
        clean = {k: core.safe_float(values.get(k)) for k in OBS_VARS}
        clean = {k: v for k, v in clean.items() if v is not None}
        if not clean:
            continue
        item = {
            "valid_time": core.iso(valid),
            "archived_at": core.iso(now),
            "provider": (obs or {}).get("provider") or ("NWS" if loc == "uws" else "ECCC"),
            "station": (obs or {}).get("station"),
            "station_count": (obs or {}).get("station_count"),
            "values": clean,
        }
        rows = obs_store.setdefault(str(loc), [])
        _upsert(rows, item)
        obs_store[str(loc)] = _trim(rows, now)

    radar_store = state.setdefault("radar", {})
    for loc, nc in (nowcasts or {}).items():
        nc = nc or {}
        valid = core.parse_stamp(nc.get("checked_at")) or now
        values = {
            "radar_rain_rate": core.safe_float(nc.get("radar_rain_rate")),
            "radar_extrapolated_rain_rate": core.safe_float(nc.get("radar_extrapolated_rain_rate")),
            "rdpa_6h_precip": core.safe_float(nc.get("rdpa_6h_precip")),
        }
        values = {k: v for k, v in values.items() if v is not None}
        if not values:
            continue
        item = {"valid_time": core.iso(valid), "archived_at": core.iso(now), "values": values}
        rows = radar_store.setdefault(str(loc), [])
        _upsert(rows, item)
        radar_store[str(loc)] = _trim(rows, now)

    state["version"] = VERSION; state["updated_at"] = core.iso(now)
    core.save(STATE, state)
    return state


def _nearest(rows: list[dict[str, Any]], target, variable: str, max_minutes: int) -> dict[str, Any] | None:
    if not target:
        return None
    best = None; best_s = None
    for row in rows or []:
        dt = core.parse_stamp(row.get("valid_time")); value = core.safe_float((row.get("values") or {}).get(variable))
        if not dt or value is None:
            continue
        offset_s = abs((dt - target).total_seconds())
        if offset_s > max_minutes * 60:
            continue
        if best_s is None or offset_s < best_s:
            best = dict(row); best["variable"] = variable; best["value"] = value; best["offset_minutes"] = offset_s / 60.0; best_s = offset_s
    return best


def nearest_observation(state: dict[str, Any], loc: str, target, variable: str, max_minutes: int = DEFAULT_MAX_OFFSET_MINUTES) -> dict[str, Any] | None:
    return _nearest(((state.get("observations") or {}).get(loc) or []), target, variable, max_minutes)


def nearest_radar(state: dict[str, Any], loc: str, target, variable: str, max_minutes: int = DEFAULT_MAX_OFFSET_MINUTES) -> dict[str, Any] | None:
    return _nearest(((state.get("radar") or {}).get(loc) or []), target, variable, max_minutes)
