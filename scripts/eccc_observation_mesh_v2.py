#!/usr/bin/env python3
"""Reliable current ECCC observation mesh for Weather Consensus.

Uses the same LOCAL_YEAR / LOCAL_MONTH / LOCAL_DAY filter pattern already proven
in the PWA, then spatially and temporally weights the freshest climate-hourly
station reports inside each location bounding box.
"""
from __future__ import annotations

import math
import urllib.parse
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import accuracy_engine_v2 as core

ATLANTIC = ZoneInfo("America/Halifax")


def first_number(mapping: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        v = core.safe_float(mapping.get(key))
        if v is not None:
            return v
    return None


def station_coords(feature: dict[str, Any], props: dict[str, Any], fallback_lat: float, fallback_lon: float) -> tuple[float, float]:
    coords = (feature.get("geometry") or {}).get("coordinates") or []
    if len(coords) >= 2:
        lon = core.safe_float(coords[0])
        lat = core.safe_float(coords[1])
        if lat is not None and lon is not None:
            return lat, lon
    lat = first_number(props, "LATITUDE", "LAT", "Y")
    lon = first_number(props, "LONGITUDE", "LON", "LONG", "X")
    return (lat if lat is not None else fallback_lat, lon if lon is not None else fallback_lon)


def local_stamp(props: dict[str, Any], now_local: datetime) -> datetime | None:
    # Prefer explicit timestamp fields if the collection supplies them.
    for key in ("UTC_DATE", "DATE", "LOCAL_DATE"):
        dt = core.parse_stamp(props.get(key))
        if dt:
            return dt
    year = int(first_number(props, "LOCAL_YEAR") or now_local.year)
    month = int(first_number(props, "LOCAL_MONTH") or now_local.month)
    day = int(first_number(props, "LOCAL_DAY") or now_local.day)
    hour = first_number(props, "LOCAL_HOUR")
    if hour is None:
        return None
    try:
        return datetime(year, month, day, int(hour), tzinfo=ATLANTIC).astimezone(timezone.utc)
    except Exception:
        return None


def fetch_mesh(loc: dict[str, Any]) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc)
    now_local = now.astimezone(ATLANTIC)
    b = loc["bbox"]
    filter_expr = (
        f"properties.LOCAL_YEAR={now_local.year} AND "
        f"properties.LOCAL_MONTH={now_local.month} AND "
        f"properties.LOCAL_DAY={now_local.day}"
    )
    params = {
        "bbox": ",".join(map(str, b)),
        "limit": "1000",
        "filter": filter_expr,
        "f": "json",
    }
    try:
        j = core.get_json(
            "https://api.weather.gc.ca/collections/climate-hourly/items?" + urllib.parse.urlencode(params),
            timeout=25,
        )
    except Exception:
        return None

    rows: list[dict[str, Any]] = []
    for f in j.get("features", []):
        p = f.get("properties") or {}
        temp = first_number(p, "TEMP", "TEMPERATURE")
        if temp is None:
            continue
        dt = local_stamp(p, now_local)
        if not dt:
            continue
        age_h = (now - dt).total_seconds() / 3600
        if age_h < -1.5 or age_h > 7:
            continue
        slat, slon = station_coords(f, p, loc["lat"], loc["lon"])
        dist = core.hav(loc["lat"], loc["lon"], slat, slon)
        # Keep very distant stations from swamping local coastal conditions while
        # still allowing sparse areas to produce a usable observation anchor.
        spatial = 1 / (1 + (dist / 10.0) ** 1.45)
        temporal = math.exp(-max(0.0, age_h) / 2.5)
        w = spatial * temporal
        rows.append({
            "time": core.iso(dt),
            "station": p.get("STATION_NAME") or p.get("CLIMATE_IDENTIFIER") or "ECCC",
            "lat": slat,
            "lon": slon,
            "distance_km": dist,
            "age_hours": max(0.0, age_h),
            "weight": w,
            "temperature_2m": temp,
            "relative_humidity_2m": first_number(p, "REL_HUM", "REL_HUMIDITY", "HUMIDITY"),
            "wind_speed_10m": first_number(p, "WIND_SPD", "WIND_SPEED"),
            "wind_gusts_10m": first_number(p, "WIND_GUST", "GUST"),
            "precipitation": first_number(p, "PRECIP_AMOUNT", "TOTAL_PRECIPITATION", "TOTAL_PRECIP"),
        })

    if not rows:
        return None

    latest_dt = max(core.parse_stamp(r["time"]) for r in rows if core.parse_stamp(r["time"]))
    # Current truth should be coherent in time. Use latest station reports and allow
    # one-hour lag for stations that publish a few minutes later than neighbours.
    fresh = [
        r for r in rows
        if abs((latest_dt - core.parse_stamp(r["time"])).total_seconds()) <= 5400
    ]
    fresh.sort(key=lambda r: (-r["weight"], r["distance_km"]))
    fresh = fresh[:8]

    values: dict[str, float | None] = {}
    for var in core.VERIFY_VARS:
        num = den = 0.0
        for r in fresh:
            v = r.get(var)
            if v is None:
                continue
            w = max(1e-6, float(r["weight"]))
            num += float(v) * w
            den += w
        values[var] = num / den if den else None

    return {
        "time": core.iso(latest_dt),
        "values": values,
        "stations": fresh,
        "station_count": len(fresh),
        "temp": values.get("temperature_2m"),
        "station": " / ".join(r["station"] for r in fresh[:3]),
        "method": "ECCC climate-hourly local-date mesh; distance + recency weighted",
    }


def install() -> None:
    original = core.eccc_observation_mesh

    def robust(loc: dict[str, Any]):
        result = fetch_mesh(loc)
        return result if result else original(loc)

    core.eccc_observation_mesh = robust
