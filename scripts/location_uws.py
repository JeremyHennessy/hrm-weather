#!/usr/bin/env python3
"""Upper West Side / Manhattan location and U.S. official observation adapter.

Canadian locations keep the existing ECCC SWOB observation path.  The Upper
West Side is a first-class U.S. location whose official current observation
mesh is built from NWS stations, led by Central Park (KNYC).  HRRR is exposed
only for U.S. locations so it cannot alter the established Canadian model set.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

import accuracy_engine_v2 as core

LOCATION_KEY = "uws"
HRRR_MODEL = ("ncep_hrrr_conus", "HRRR", "NOAA", "hrrr", 1.14)
NWS_STATIONS = ("KNYC", "KJRB", "KLGA")

UWS_LOCATION = {
    "lat": 40.7870,
    "lon": -73.9754,
    "points": [
        ("UWS South", 40.7745, -73.9840, "urban-south"),
        ("UWS Central", 40.7870, -73.9754, "urban-core"),
        ("UWS North", 40.7950, -73.9705, "urban-north"),
    ],
    "bbox": [-74.03, 40.73, -73.93, 40.83],
    "coastal": True,
    "country": "US",
    "timezone": "America/New_York",
    "official_source": "NWS",
    "official_station": "KNYC",
    "official_stations": list(NWS_STATIONS),
}


def _quantity(value: Any, *, wind: bool = False, precip: bool = False) -> float | None:
    if not isinstance(value, dict):
        return core.safe_float(value)
    x = core.safe_float(value.get("value"))
    if x is None:
        return None
    unit = str(value.get("unitCode") or "").lower()
    if wind:
        if "m_s-1" in unit or "m/s" in unit:
            return x * 3.6
        if "kt" in unit or "knot" in unit:
            return x * 1.852
    if precip:
        if unit.endswith(":m") or "unit:m" in unit:
            return x * 1000.0
        if "cm" in unit:
            return x * 10.0
    return x


def _cloud_cover(layers: Any) -> float | None:
    if not isinstance(layers, list) or not layers:
        return None
    amount = {"CLR": 0.0, "SKC": 0.0, "FEW": 20.0, "SCT": 50.0, "BKN": 75.0, "OVC": 100.0, "VV": 100.0}
    vals = []
    for layer in layers:
        if not isinstance(layer, dict):
            continue
        key = str(layer.get("amount") or "").upper()
        if key in amount:
            vals.append(amount[key])
    return max(vals) if vals else None


def _station_latest(station: str) -> dict[str, Any] | None:
    headers = {
        "User-Agent": "weather-consensus/3.0 (github.com/JeremyHennessy/hrm-weather)",
        "Accept": "application/geo+json, application/json",
    }
    try:
        j = core.get_json(f"https://api.weather.gov/stations/{station}/observations/latest", timeout=20, headers=headers)
    except Exception:
        return None
    p = j.get("properties") or {}
    dt = core.parse_stamp(p.get("timestamp"))
    if not dt:
        return None
    geom = (j.get("geometry") or {}).get("coordinates") or []
    slon = core.safe_float(geom[0]) if len(geom) >= 2 else None
    slat = core.safe_float(geom[1]) if len(geom) >= 2 else None
    return {
        "time": core.iso(dt),
        "station": station,
        "lat": slat,
        "lon": slon,
        "temperature_2m": _quantity(p.get("temperature")),
        "relative_humidity_2m": _quantity(p.get("relativeHumidity")),
        "wind_speed_10m": _quantity(p.get("windSpeed"), wind=True),
        "wind_gusts_10m": _quantity(p.get("windGust"), wind=True),
        "wind_direction_10m": _quantity(p.get("windDirection")),
        "precipitation": _quantity(p.get("precipitationLastHour"), precip=True),
        "cloud_cover": _cloud_cover(p.get("cloudLayers")),
        "text_description": p.get("textDescription"),
        "raw_id": j.get("id"),
    }


def nws_observation_mesh(loc: dict[str, Any]) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc)
    rows = []
    for station in loc.get("official_stations") or NWS_STATIONS:
        r = _station_latest(str(station))
        if not r:
            continue
        dt = core.parse_stamp(r.get("time"))
        if not dt:
            continue
        age_h = max(0.0, (now - dt).total_seconds() / 3600.0)
        if age_h > 4.0:
            continue
        slat = core.safe_float(r.get("lat"))
        slon = core.safe_float(r.get("lon"))
        dist = core.hav(loc["lat"], loc["lon"], slat, slon) if slat is not None and slon is not None else 15.0
        spatial = 1.0 / (1.0 + (dist / 10.0) ** 1.45)
        temporal = math.exp(-age_h / 2.0)
        # Central Park is the urban climate anchor for the UWS, without making
        # nearby backup stations irrelevant when KNYC has a missing field.
        anchor = 1.20 if r.get("station") == "KNYC" else 1.0
        r.update({"distance_km": dist, "age_hours": age_h, "weight": spatial * temporal * anchor})
        rows.append(r)
    if not rows:
        return None
    latest = max(core.parse_stamp(r["time"]) for r in rows if core.parse_stamp(r.get("time")))

    def weighted(var: str) -> float | None:
        num = den = 0.0
        for r in rows:
            v = core.safe_float(r.get(var))
            if v is None:
                continue
            w = max(1e-6, float(r.get("weight") or 0.0))
            num += v * w
            den += w
        return num / den if den else None

    values = {var: weighted(var) for var in core.VERIFY_VARS}
    values["cloud_cover"] = weighted("cloud_cover")
    # Circular mean for wind direction.
    sin_sum = cos_sum = den = 0.0
    for r in rows:
        d = core.safe_float(r.get("wind_direction_10m"))
        if d is None:
            continue
        w = max(1e-6, float(r.get("weight") or 0.0))
        rad = math.radians(d % 360.0)
        sin_sum += math.sin(rad) * w
        cos_sum += math.cos(rad) * w
        den += w
    values["wind_direction_10m"] = math.degrees(math.atan2(sin_sum, cos_sum)) % 360.0 if den else None
    rows.sort(key=lambda r: (0 if r.get("station") == "KNYC" else 1, r.get("distance_km", 999)))
    return {
        "time": core.iso(latest),
        "values": values,
        "stations": rows,
        "station_count": len(rows),
        "wind_station_count": sum(1 for r in rows if core.safe_float(r.get("wind_speed_10m")) is not None),
        "gust_station_count": sum(1 for r in rows if core.safe_float(r.get("wind_gusts_10m")) is not None),
        "cloud_station_count": sum(1 for r in rows if core.safe_float(r.get("cloud_cover")) is not None),
        "temp": values.get("temperature_2m"),
        "station": " / ".join(str(r.get("station")) for r in rows[:3]),
        "provider": "NWS",
        "official_station": "KNYC",
        "method": "NWS latest-observation urban mesh; Central Park KNYC anchored; distance + recency weighted",
        "collection": "api.weather.gov/stations/{station}/observations/latest",
    }


def models_for_location(loc: dict[str, Any] | str) -> list[tuple]:
    payload = core.LOCATIONS.get(loc, {}) if isinstance(loc, str) else loc
    is_us = str((payload or {}).get("country") or "CA").upper() == "US"
    return [m for m in core.MODELS if m[0] != HRRR_MODEL[0] or is_us]


def install() -> None:
    core.LOCATIONS[LOCATION_KEY] = dict(UWS_LOCATION)
    if HRRR_MODEL[0] not in core.MODEL_META:
        core.MODELS.append(HRRR_MODEL)
        core.MODEL_META[HRRR_MODEL[0]] = {
            "label": HRRR_MODEL[1],
            "provider": HRRR_MODEL[2],
            "family": HRRR_MODEL[3],
            "base_weight": HRRR_MODEL[4],
        }
    canadian_observation = core.eccc_observation_mesh

    def observation_dispatch(loc: dict[str, Any]) -> dict[str, Any] | None:
        if str(loc.get("country") or "CA").upper() == "US":
            return nws_observation_mesh(loc)
        return canadian_observation(loc)

    core.eccc_observation_mesh = observation_dispatch
    core.official_observation_mesh = observation_dispatch
    core.models_for_location = models_for_location
