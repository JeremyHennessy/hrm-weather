#!/usr/bin/env python3
"""Real-time ECCC SWOB observation mesh for Weather Consensus.

Uses ECCC's dedicated Surface Weather Observations (SWOB) real-time OGC API
collection, then weights the freshest nearby stations by distance and recency.
"""
from __future__ import annotations

import math
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import Any

import accuracy_engine_v2 as core


def first_number(mapping: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        v = core.safe_float(mapping.get(key))
        if v is not None:
            return v
    return None


def station_coords(feature: dict[str, Any], fallback_lat: float, fallback_lon: float) -> tuple[float, float]:
    coords = (feature.get("geometry") or {}).get("coordinates") or []
    if len(coords) >= 2:
        lon = core.safe_float(coords[0])
        lat = core.safe_float(coords[1])
        if lat is not None and lon is not None:
            return lat, lon
    return fallback_lat, fallback_lon


def fetch_mesh(loc: dict[str, Any]) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc)
    b = loc["bbox"]
    start = now - timedelta(hours=7)
    end = now + timedelta(minutes=20)
    params = {
        "bbox": ",".join(map(str, b)),
        "datetime": f"{core.iso(start).replace('+00:00','Z')}/{core.iso(end).replace('+00:00','Z')}",
        "limit": "1000",
        "f": "json",
    }
    try:
        j = core.get_json(
            "https://api.weather.gc.ca/collections/swob-realtime/items?" + urllib.parse.urlencode(params),
            timeout=25,
        )
    except Exception:
        return None

    rows: list[dict[str, Any]] = []
    for feature in j.get("features", []):
        p = feature.get("properties") or {}
        temp = first_number(p, "air_temp", "avg_air_temp_pst1hr", "avg_air_temp_pst2mts")
        if temp is None:
            continue
        dt = core.parse_stamp(p.get("obs_date_tm") or p.get("date_tm-value") or p.get("processed_date_tm"))
        if not dt:
            continue
        age_h = (now - dt).total_seconds() / 3600
        if age_h < -0.5 or age_h > 7.5:
            continue
        slat, slon = station_coords(feature, loc["lat"], loc["lon"])
        dist = core.hav(loc["lat"], loc["lon"], slat, slon)
        spatial = 1 / (1 + (dist / 10.0) ** 1.45)
        temporal = math.exp(-max(0.0, age_h) / 2.2)
        w = spatial * temporal

        # SWOB is heterogeneous: not every station reports every field. Temperature
        # is required for the current anchor; the other variables are opportunistic.
        rh = first_number(p, "rel_hum", "avg_rel_hum_pst1hr")
        precip = first_number(p, "pcpn_amt_pst1hr", "rnfl_amt_pst1hr")
        wind = first_number(
            p,
            "avg_wnd_spd_pst10mts", "avg_wnd_spd_pst2mts", "avg_wind_spd_pst10mts",
            "wnd_spd", "wind_speed",
        )
        gust = first_number(
            p,
            "max_wnd_spd_pst10mts", "max_wnd_spd_pst1hr", "wnd_gust_spd", "wind_gust",
        )
        rows.append({
            "time": core.iso(dt),
            "station": p.get("stn_nam-value") or p.get("stn_id-value") or p.get("msc_id-value") or "ECCC SWOB",
            "lat": slat,
            "lon": slon,
            "distance_km": dist,
            "age_hours": max(0.0, age_h),
            "weight": w,
            "temperature_2m": temp,
            "relative_humidity_2m": rh,
            "wind_speed_10m": wind,
            "wind_gusts_10m": gust,
            "precipitation": precip,
        })

    if not rows:
        return None

    latest_dt = max(core.parse_stamp(r["time"]) for r in rows if core.parse_stamp(r["time"]))
    fresh = [r for r in rows if abs((latest_dt - core.parse_stamp(r["time"])).total_seconds()) <= 4500]
    fresh.sort(key=lambda r: (-r["weight"], r["distance_km"]))

    # Deduplicate multiple SWOB messages from the same station in the same observation
    # window so a high-frequency station cannot count as several independent sensors.
    seen = set()
    unique = []
    for r in fresh:
        key = r["station"]
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)
        if len(unique) >= 8:
            break
    fresh = unique
    if not fresh:
        return None

    values: dict[str, float | None] = {}
    for var in core.VERIFY_VARS:
        numerator = denominator = 0.0
        for r in fresh:
            v = r.get(var)
            if v is None:
                continue
            w = max(1e-6, float(r["weight"]))
            numerator += float(v) * w
            denominator += w
        values[var] = numerator / denominator if denominator else None

    return {
        "time": core.iso(latest_dt),
        "values": values,
        "stations": fresh,
        "station_count": len(fresh),
        "temp": values.get("temperature_2m"),
        "station": " / ".join(r["station"] for r in fresh[:3]),
        "method": "ECCC SWOB real-time mesh; distance + recency weighted",
        "collection": "swob-realtime",
    }


def install() -> None:
    # Do not silently fall back to climate-hourly: that collection is suitable for
    # verification/history but production proved it can be empty for current SWOBs.
    core.eccc_observation_mesh = fetch_mesh
