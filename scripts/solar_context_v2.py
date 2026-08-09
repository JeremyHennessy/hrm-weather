#!/usr/bin/env python3
"""Fail-soft solar/cloud context for the server forecast collector.

Keeps Accuracy Engine 2's stable deterministic request untouched. A second small
request asks each model for cloud cover and shortwave radiation; GFS is also
asked for hourly UV index. Unsupported model/variable combinations simply leave
that context empty instead of dropping the model's normal forecast.
"""
from __future__ import annotations

import urllib.parse
from typing import Any

import accuracy_engine_v2 as core

BASE_VARS = tuple(core.VARS)
CONTEXT_VARS = ("cloud_cover", "shortwave_radiation", "uv_index")


def _maps(j: dict[str, Any], variables: tuple[str, ...]) -> dict[str, dict[str, float]]:
    return {v: core.build_hourly_map(j, v) for v in variables}


def forecast_point_with_context(lat: float, lon: float, model: str) -> dict[str, dict[str, float]] | None:
    base_q = {
        "latitude": lat,
        "longitude": lon,
        "timezone": "UTC",
        "forecast_days": "4",
        "temperature_unit": "celsius",
        "wind_speed_unit": "kmh",
        "hourly": ",".join(BASE_VARS),
        "models": model,
    }
    try:
        base_j = core.get_json("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(base_q), timeout=25)
    except Exception:
        return None
    if not base_j.get("hourly"):
        return None
    out = _maps(base_j, BASE_VARS)

    requested = ["cloud_cover", "shortwave_radiation"]
    # Open-Meteo documents hourly UV-B/UV index as a GFS field. Do not ask
    # unsupported global models for it because context must remain fail-soft.
    if model in {"gfs_seamless", "gfs025"}:
        requested.append("uv_index")
    context_q = {
        "latitude": lat,
        "longitude": lon,
        "timezone": "UTC",
        "forecast_days": "4",
        "hourly": ",".join(requested),
        "models": model,
    }
    try:
        context_j = core.get_json("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(context_q), timeout=18)
        out.update(_maps(context_j, tuple(requested)))
    except Exception:
        pass

    for var in CONTEXT_VARS:
        out.setdefault(var, {})
    return out


def install() -> None:
    # forecast_location iterates core.VARS, so expose the supplemental fields only
    # after the stable base variable list has been captured above.
    for var in CONTEXT_VARS:
        if var not in core.VARS:
            core.VARS.append(var)
    core.forecast_point = forecast_point_with_context
