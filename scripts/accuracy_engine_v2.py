#!/usr/bin/env python3
"""
Weather Consensus Accuracy Engine 2.0

Produces backwards-compatible temperature skill data plus a richer engine-v2.json:
- deterministic multi-variable verification by lead, regime, and model family
- learned bias correction and residual skill
- run-to-run stability
- independent model-family accounting
- ECMWF IFS/AIFS, GEFS and GEPS ensemble mean/spread
- ECCC observation mesh
- ECCC GeoMet radar/RDPA point probes when available
- optional benchmark adapters (Pirate Weather, Tomorrow.io, Meteoblue)
- lead-dependent Raw Ensemble / Learned Local / Nowcast blend weights

All network integrations are fail-soft: one unavailable source never prevents the
hourly collector from preserving and updating the sources that did respond.
"""
from __future__ import annotations

import json
import math
import os
import statistics
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
SKILL = DATA / "skill.json"
LEDGER = DATA / "ledger.json"
ENGINE = DATA / "engine-v2.json"
RUN_HISTORY = DATA / "run-history-v2.json"

LOCATIONS = {
    "hrm": {
        "lat": 44.6488, "lon": -63.5752,
        "points": [
            ("Halifax Peninsula", 44.6488, -63.5752, "coastal"),
            ("Bedford", 44.7318, -63.6619, "basin"),
            ("Dartmouth", 44.6661, -63.5676, "harbour"),
        ],
        "bbox": [-63.80, 44.48, -63.42, 44.84],
        "coastal": True,
    },
    "moncton": {
        "lat": 46.0878, "lon": -64.7782,
        "points": [("Moncton", 46.0878, -64.7782, "inland")],
        "bbox": [-64.95, 45.98, -64.62, 46.20],
        "coastal": False,
    },
    "shediac": {
        "lat": 46.2198, "lon": -64.5411,
        "points": [("Shediac", 46.2198, -64.5411, "coastal")],
        "bbox": [-64.68, 46.10, -64.40, 46.34],
        "coastal": True,
    },
    "lunenburg": {
        "lat": 44.377896, "lon": -64.309529,
        "points": [("Lunenburg", 44.377896, -64.309529, "coastal")],
        "bbox": [-64.46, 44.25, -64.15, 44.50],
        "coastal": True,
    },
    "wolfville": {
        "lat": 45.0791, "lon": -64.4383,
        "points": [
            ("Wolfville", 45.091713, -64.359242, "valley-east"),
            ("Wolfville Core", 45.067858, -64.460234, "valley"),
            ("Wolfville West", 45.077707, -64.495306, "valley-west"),
        ],
        "bbox": [-64.62, 44.98, -64.22, 45.20],
        "coastal": False,
    },
}

# Deterministic model families. Multiple products from one family are deliberately
# collapsed later so provider duplication cannot masquerade as independent agreement.
MODELS = [
    ("gem_hrdps_continental", "HRDPS", "ECCC", "canada", 1.22),
    ("gem_regional", "GEM Regional", "ECCC", "canada", 1.12),
    ("gem_seamless", "GEM Seamless", "ECCC", "canada", 1.08),
    ("ecmwf_ifs025", "ECMWF IFS", "ECMWF", "ecmwf", 1.08),
    ("ecmwf_aifs025_single", "ECMWF AIFS Single", "ECMWF", "ecmwf", 1.06),
    ("gfs_seamless", "GFS", "NOAA", "noaa", 1.00),
    ("icon_seamless", "ICON", "DWD", "dwd", 0.99),
    ("ukmo_seamless", "UKMO", "UK Met", "ukmo", 1.01),
    ("meteofrance_seamless", "Météo-France", "Météo-France", "meteofrance", 0.94),
    ("jma_seamless", "JMA", "JMA", "jma", 0.90),
    ("kma_seamless", "KMA", "KMA", "kma", 0.90),
    ("bom_access_global", "ACCESS-G", "BOM", "bom", 0.86),
    ("cma_grapes_global", "GRAPES", "CMA", "cma", 0.84),
]
MODEL_META = {m[0]: {"label": m[1], "provider": m[2], "family": m[3], "base_weight": m[4]} for m in MODELS}

# Candidate model IDs are intentionally probed because Open-Meteo has changed
# human-facing ensemble labels independently of API identifiers in the past.
ENSEMBLE_CANDIDATES = {
    "ifs_ens": ["ecmwf_ifs025", "ecmwf_ifs025_ensemble", "ecmwf_ifs025_ensemble_mean"],
    "aifs_ens": ["ecmwf_aifs025", "ecmwf_aifs025_ensemble", "ecmwf_aifs025_ensemble_mean"],
    "gefs": ["gfs025", "gfs_seamless", "gfs025_ensemble"],
    "geps": ["gem_global", "gem_seamless", "gem_global_ensemble"],
}
ENSEMBLE_META = {
    "ifs_ens": {"label": "ECMWF IFS ENS", "family": "ecmwf", "members": 51},
    "aifs_ens": {"label": "ECMWF AIFS ENS", "family": "ecmwf", "members": 51},
    "gefs": {"label": "GEFS", "family": "noaa", "members": 31},
    "geps": {"label": "GEPS", "family": "canada", "members": 21},
}

LEADS = [1, 3, 6, 12, 24, 48, 72]
VARS = [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "precipitation",
    "wind_speed_10m",
    "wind_gusts_10m",
    "wind_direction_10m",
    "pressure_msl",
    "precipitation_probability",
]
VERIFY_VARS = ["temperature_2m", "relative_humidity_2m", "precipitation", "wind_speed_10m", "wind_gusts_10m"]
PRECIP_THRESHOLD = 0.1


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def get_json(url: str, timeout: int = 20, headers: dict[str, str] | None = None) -> Any:
    h = {"User-Agent": "weather-consensus/2.0 (+github.com/JeremyHennessy/hrm-weather)"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def get_text(url: str, timeout: int = 15) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "weather-consensus/2.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def load(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def save(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, indent=2, sort_keys=True, allow_nan=False) + "\n")


def safe_float(v: Any) -> float | None:
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def avg(values: list[float]) -> float | None:
    vals = [x for x in values if isinstance(x, (int, float)) and math.isfinite(x)]
    return sum(vals) / len(vals) if vals else None


def stdev(values: list[float]) -> float | None:
    vals = [x for x in values if isinstance(x, (int, float)) and math.isfinite(x)]
    if len(vals) < 2:
        return 0.0 if vals else None
    return statistics.pstdev(vals)


def hav(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(max(1e-12, 1 - a)))


def parse_stamp(value: Any) -> datetime | None:
    if not value:
        return None
    s = str(value).replace(" ", "T").replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    except Exception:
        return None


def nearest_hour_key(target: datetime, mapping: dict[str, Any]) -> str | None:
    best = None
    best_delta = 10**12
    for k in mapping:
        dt = parse_stamp(k)
        if not dt:
            continue
        d = abs((dt - target).total_seconds())
        if d < best_delta:
            best, best_delta = k, d
    return best if best_delta <= 3 * 3600 else None


def build_hourly_map(j: dict[str, Any], variable: str) -> dict[str, float]:
    h = j.get("hourly") or {}
    times = h.get("time") or []
    vals = h.get(variable) or []
    out: dict[str, float] = {}
    for t, v in zip(times, vals):
        f = safe_float(v)
        if f is not None:
            out[t] = f
    return out


def forecast_point(lat: float, lon: float, model: str) -> dict[str, dict[str, float]] | None:
    q = {
        "latitude": lat,
        "longitude": lon,
        "timezone": "UTC",
        "forecast_days": "4",
        "temperature_unit": "celsius",
        "wind_speed_unit": "kmh",
        "hourly": ",".join(VARS),
        "models": model,
    }
    try:
        j = get_json("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(q), timeout=25)
    except Exception:
        return None
    if not j.get("hourly"):
        return None
    return {v: build_hourly_map(j, v) for v in VARS}


def forecast_location(loc: dict[str, Any], model: str) -> dict[str, dict[str, float]] | None:
    rows = []
    for _, lat, lon, _ in loc["points"]:
        r = forecast_point(lat, lon, model)
        if r:
            rows.append(r)
    if not rows:
        return None
    out: dict[str, dict[str, float]] = {v: {} for v in VARS}
    for var in VARS:
        keys = set().union(*(r.get(var, {}).keys() for r in rows))
        for k in keys:
            vals = [r.get(var, {}).get(k) for r in rows]
            a = avg([x for x in vals if x is not None])
            if a is not None:
                out[var][k] = a
    return out


def ensemble_mean_point(lat: float, lon: float, model_id: str) -> dict[str, Any] | None:
    # Open-Meteo's Ensemble Mean API returns mean + spread fields directly. The
    # parser accepts both suffix conventions used by the API/UI.
    hourly = ",".join(["temperature_2m", "apparent_temperature", "precipitation", "wind_speed_10m", "wind_gusts_10m"])
    q = {
        "latitude": lat, "longitude": lon, "timezone": "UTC",
        "forecast_days": "4", "models": model_id, "hourly": hourly,
        "temperature_unit": "celsius", "wind_speed_unit": "kmh",
    }
    try:
        j = get_json("https://ensemble-api.open-meteo.com/v1/ensemble?" + urllib.parse.urlencode(q), timeout=25)
    except Exception:
        # Some deployments expose the mean endpoint on the generic Open-Meteo host.
        try:
            j = get_json("https://ensemble-api.open-meteo.com/v1/ensemble-mean?" + urllib.parse.urlencode(q), timeout=25)
        except Exception:
            return None
    h = j.get("hourly") or {}
    times = h.get("time") or []
    if not times:
        return None
    result = {"time": times, "model_id": model_id, "variables": {}}
    for var in ["temperature_2m", "apparent_temperature", "precipitation", "wind_speed_10m", "wind_gusts_10m"]:
        mean_keys = [var, f"{var}_mean"]
        spread_keys = [f"{var}_spread", f"{var}_standard_deviation", f"{var}_stddev"]
        mean_arr = next((h.get(k) for k in mean_keys if isinstance(h.get(k), list)), None)
        spread_arr = next((h.get(k) for k in spread_keys if isinstance(h.get(k), list)), None)
        # Raw Ensemble API fallback: calculate mean/spread across member arrays.
        if mean_arr is None:
            member_arrays = [v for k, v in h.items() if k.startswith(var + "_member") and isinstance(v, list)]
            if member_arrays:
                mean_arr, spread_arr = [], []
                for i in range(len(times)):
                    vals = [safe_float(a[i]) for a in member_arrays if i < len(a)]
                    vals = [x for x in vals if x is not None]
                    mean_arr.append(avg(vals))
                    spread_arr.append(stdev(vals))
        if mean_arr is not None:
            result["variables"][var] = {
                "mean": {t: safe_float(v) for t, v in zip(times, mean_arr) if safe_float(v) is not None},
                "spread": {t: safe_float(v) for t, v in zip(times, spread_arr or []) if safe_float(v) is not None},
            }
    return result if result["variables"] else None


def ensemble_summary(loc: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    lat, lon = loc["lat"], loc["lon"]
    for key, candidates in ENSEMBLE_CANDIDATES.items():
        found = None
        for candidate in candidates:
            found = ensemble_mean_point(lat, lon, candidate)
            if found:
                break
        if found:
            found.update(ENSEMBLE_META[key])
            out[key] = found
        else:
            out[key] = {**ENSEMBLE_META[key], "available": False}
    return out


def eccc_observation_mesh(loc: dict[str, Any]) -> dict[str, Any] | None:
    now = utcnow()
    b = loc["bbox"]
    params = {
        "bbox": ",".join(map(str, b)),
        "datetime": f"{iso(now-timedelta(hours=6)).replace('+00:00','Z')}/{iso(now+timedelta(hours=1)).replace('+00:00','Z')}",
        "limit": "1000", "f": "json",
    }
    try:
        j = get_json("https://api.weather.gc.ca/collections/climate-hourly/items?" + urllib.parse.urlencode(params), timeout=25)
    except Exception:
        return None

    rows = []
    for f in j.get("features", []):
        p = f.get("properties") or {}
        stamp = p.get("UTC_DATE") or p.get("DATE") or p.get("LOCAL_DATE")
        dt = parse_stamp(stamp)
        if not dt or abs((now - dt).total_seconds()) > 6 * 3600:
            continue
        coords = (f.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        try:
            slat, slon = float(coords[1]), float(coords[0])
        except Exception:
            continue
        temp = safe_float(p.get("TEMP"))
        rh = safe_float(p.get("REL_HUMIDITY") or p.get("HUMIDITY"))
        wind = safe_float(p.get("WIND_SPEED"))
        gust = safe_float(p.get("WIND_GUST"))
        precip = safe_float(p.get("PRECIP_AMOUNT") or p.get("TOTAL_PRECIPITATION"))
        station = p.get("STATION_NAME") or p.get("CLIMATE_IDENTIFIER") or "ECCC"
        dist = hav(loc["lat"], loc["lon"], slat, slon)
        age_h = max(0.0, (now - dt).total_seconds() / 3600)
        # Distance and recency weights; cap the closest station's dominance.
        w = (1 / (1 + (dist / 12) ** 1.35)) * math.exp(-age_h / 3.0)
        rows.append({
            "time": iso(dt), "station": station, "lat": slat, "lon": slon,
            "distance_km": dist, "weight": w, "temperature_2m": temp,
            "relative_humidity_2m": rh, "wind_speed_10m": wind,
            "wind_gusts_10m": gust, "precipitation": precip,
        })
    if not rows:
        return None

    latest = max(parse_stamp(r["time"]) for r in rows if parse_stamp(r["time"]))
    candidates = [r for r in rows if abs((latest - parse_stamp(r["time"])).total_seconds()) <= 5400]
    candidates.sort(key=lambda r: (r["distance_km"], -r["weight"]))
    candidates = candidates[:8]

    values: dict[str, float | None] = {}
    for var in VERIFY_VARS:
        num = den = 0.0
        for r in candidates:
            v = r.get(var)
            if v is None:
                continue
            w = r["weight"]
            num += v * w
            den += w
        values[var] = num / den if den else None

    return {
        "time": iso(latest), "values": values,
        "stations": candidates,
        "station_count": len(candidates),
        # Compatibility fields consumed by the existing front end.
        "temp": values["temperature_2m"],
        "station": " / ".join(r["station"] for r in candidates[:3]),
    }


def wms_point_feature(layer: str, lat: float, lon: float) -> dict[str, Any] | None:
    # GeoMet WMS point probe. Unsupported layers/formats fail soft.
    delta = 0.04
    q = {
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetFeatureInfo",
        "LAYERS": layer, "QUERY_LAYERS": layer, "CRS": "EPSG:4326",
        "BBOX": f"{lat-delta},{lon-delta},{lat+delta},{lon+delta}",
        "WIDTH": "101", "HEIGHT": "101", "I": "50", "J": "50",
        "INFO_FORMAT": "application/json", "FEATURE_COUNT": "5",
        "FORMAT": "image/png", "TRANSPARENT": "true",
    }
    try:
        return get_json("https://geo.weather.gc.ca/geomet?" + urllib.parse.urlencode(q), timeout=18)
    except Exception:
        return None


def feature_numeric(j: dict[str, Any] | None) -> float | None:
    if not j:
        return None
    for f in j.get("features", []):
        p = f.get("properties") or {}
        preferred = ["value", "VALUE", "precipitation_rate", "PR", "Band1"]
        for k in preferred:
            v = safe_float(p.get(k))
            if v is not None:
                return v
        for v in p.values():
            x = safe_float(v)
            if x is not None:
                return x
    return None


def geomet_nowcast(loc: dict[str, Any]) -> dict[str, Any]:
    lat, lon = loc["lat"], loc["lon"]
    radar = wms_point_feature("RADAR_1KM_RRAI", lat, lon)
    radar_extrap = wms_point_feature("Radar_1km_RainPrecipRate-Extrapolation", lat, lon)
    rdpa6 = wms_point_feature("RDPA.6F_PR", lat, lon)
    return {
        "radar_rain_rate": feature_numeric(radar),
        "radar_extrapolated_rain_rate": feature_numeric(radar_extrap),
        "rdpa_6h_precip": feature_numeric(rdpa6),
        "radar_available": bool(radar),
        "radar_extrapolation_available": bool(radar_extrap),
        "rdpa_available": bool(rdpa6),
        "checked_at": iso(utcnow()),
    }


def classify_regime(obs: dict[str, Any] | None, fc: dict[str, dict[str, float]] | None, loc: dict[str, Any]) -> dict[str, Any]:
    now = utcnow().replace(minute=0, second=0, microsecond=0)
    vals = (obs or {}).get("values") or {}
    wind = vals.get("wind_speed_10m")
    rh = vals.get("relative_humidity_2m")
    precip = vals.get("precipitation")
    wind_dir = None
    pressure_now = pressure_prev = None
    if fc:
        for var, target in [("wind_direction_10m", "wind_dir"), ("pressure_msl", "pressure")]:
            mp = fc.get(var, {})
            k = nearest_hour_key(now, mp)
            if k:
                if target == "wind_dir":
                    wind_dir = mp.get(k)
                else:
                    pressure_now = mp.get(k)
        kp = nearest_hour_key(now - timedelta(hours=3), fc.get("pressure_msl", {}))
        if kp:
            pressure_prev = fc["pressure_msl"].get(kp)
        if wind is None:
            k = nearest_hour_key(now, fc.get("wind_speed_10m", {}))
            wind = fc.get("wind_speed_10m", {}).get(k) if k else None
        if rh is None:
            k = nearest_hour_key(now, fc.get("relative_humidity_2m", {}))
            rh = fc.get("relative_humidity_2m", {}).get(k) if k else None
        if precip is None:
            k = nearest_hour_key(now, fc.get("precipitation", {}))
            precip = fc.get("precipitation", {}).get(k) if k else None

    pressure_tendency = None
    if pressure_now is not None and pressure_prev is not None:
        pressure_tendency = pressure_now - pressure_prev

    coastal = bool(loc.get("coastal"))
    onshore = coastal and wind_dir is not None and 60 <= wind_dir <= 200 and (wind or 0) >= 6
    offshore = coastal and wind_dir is not None and (wind_dir >= 240 or wind_dir <= 30) and (wind or 0) >= 6
    frontal = (precip or 0) >= 0.2 or (pressure_tendency is not None and abs(pressure_tendency) >= 2.0)
    convective = frontal and (rh or 0) >= 70 and (wind or 0) >= 20
    stable = (wind or 0) < 8 and (precip or 0) < 0.1 and (pressure_tendency is None or abs(pressure_tendency) < 1)

    if convective:
        name = "convective"
    elif frontal:
        name = "frontal"
    elif onshore:
        name = "marine_onshore"
    elif offshore:
        name = "offshore"
    elif stable:
        name = "stable"
    elif coastal:
        name = "marine_mixed"
    else:
        name = "mixed"

    return {
        "name": name, "wind_direction": wind_dir, "wind_speed": wind,
        "relative_humidity": rh, "precipitation": precip,
        "pressure_tendency_3h": pressure_tendency,
    }


def stat_update(s: dict[str, Any], error: float, *, brier: float | None = None, crps: float | None = None) -> dict[str, Any]:
    n = int(s.get("n", 0))
    s["mae"] = (float(s.get("mae", 0)) * n + abs(error)) / (n + 1)
    s["bias"] = (float(s.get("bias", 0)) * n + error) / (n + 1)
    s["mse"] = (float(s.get("mse", 0)) * n + error * error) / (n + 1)
    s["rmse"] = math.sqrt(max(0.0, s["mse"]))
    if brier is not None:
        bn = int(s.get("brier_n", 0))
        s["brier"] = (float(s.get("brier", 0)) * bn + brier) / (bn + 1)
        s["brier_n"] = bn + 1
    if crps is not None:
        cn = int(s.get("crps_n", 0))
        s["crps"] = (float(s.get("crps", 0)) * cn + crps) / (cn + 1)
        s["crps_n"] = cn + 1
    s["n"] = n + 1
    s["updated"] = iso(utcnow())
    return s


def normal_crps(mu: float, sigma: float, x: float) -> float:
    if sigma <= 1e-6:
        return abs(mu - x)
    z = (x - mu) / sigma
    phi = math.exp(-0.5 * z * z) / math.sqrt(2 * math.pi)
    Phi = 0.5 * (1 + math.erf(z / math.sqrt(2)))
    return sigma * (z * (2 * Phi - 1) + 2 * phi - 1 / math.sqrt(math.pi))


def observation_actual(obs: dict[str, Any] | None, var: str, nowcast: dict[str, Any] | None = None) -> float | None:
    if var == "precipitation" and nowcast and nowcast.get("rdpa_6h_precip") is not None:
        # RDPA is a 6h accumulation; it is retained as a separate truth signal and
        # not directly substituted for one-hour gauge precipitation.
        pass
    return ((obs or {}).get("values") or {}).get(var)


def score_ledger(ledger: list[dict[str, Any]], skill: dict[str, Any], observations: dict[str, Any], nowcasts: dict[str, Any]) -> int:
    now = utcnow()
    scored = 0
    for e in ledger:
        if e.get("scored"):
            continue
        target = parse_stamp(e.get("target"))
        if not target or target > now + timedelta(minutes=20) or now - target > timedelta(hours=3):
            continue
        obs = observations.get(e.get("loc"))
        odt = parse_stamp((obs or {}).get("time"))
        if not odt or abs((odt - target).total_seconds()) > 5400:
            continue
        var = e.get("variable", "temperature_2m")
        actual = observation_actual(obs, var, nowcasts.get(e.get("loc")))
        if actual is None:
            continue
        pred = safe_float(e.get("pred"))
        if pred is None:
            continue
        err = pred - actual
        loc = e["loc"]
        model = e["model"]
        lead = int(e["lead"])
        regime = e.get("regime") or "unknown"
        family = e.get("family") or MODEL_META.get(model, {}).get("family") or "unknown"

        keys = [
            f"{loc}:{model}:{var}:{lead}",
            f"{loc}:{model}:{var}:all",
            f"{loc}:{model}:{var}:{lead}:{regime}",
            f"{loc}:family:{family}:{var}:{lead}",
        ]
        brier = None
        if var == "precipitation":
            pop = safe_float(e.get("probability"))
            if pop is not None:
                p = max(0.0, min(1.0, pop / 100 if pop > 1 else pop))
                y = 1.0 if actual >= PRECIP_THRESHOLD else 0.0
                brier = (p - y) ** 2
        crps = None
        spread = safe_float(e.get("spread"))
        if e.get("ensemble") and spread is not None:
            crps = normal_crps(pred, max(0.0, spread), actual)
        for k in keys:
            skill[k] = stat_update(skill.get(k, {}), err, brier=brier, crps=crps)
            skill[k]["source"] = "github-actions-eccc-v2"

        # Backwards compatibility for the existing UI/local learner.
        if var == "temperature_2m":
            for legacy in [f"{loc}:{model}:{lead}", f"{loc}:{model}:all"]:
                skill[legacy] = stat_update(skill.get(legacy, {}), err)
                skill[legacy]["source"] = "github-actions-eccc-v2"

        e.update({"scored": True, "actual": actual, "error": err, "observation_time": obs.get("time")})
        scored += 1
    return scored


def create_ensemble_targets(
    ledger: list[dict[str, Any]],
    ensembles: dict[str, dict[str, Any]],
    regimes: dict[str, dict[str, Any]],
) -> int:
    now = utcnow()
    issued = now.replace(minute=0, second=0, microsecond=0)
    existing = {(e.get("loc"), e.get("model"), e.get("variable"), e.get("lead"), e.get("issued")) for e in ledger}
    added = 0
    for lname, products in ensembles.items():
        regime = regimes.get(lname, {}).get("name", "unknown")
        for product, e in products.items():
            if not e.get("variables"):
                continue
            model = "ensemble:" + product
            family = e.get("family", product)
            for lead in LEADS:
                target = issued + timedelta(hours=lead)
                for var in ["temperature_2m", "precipitation", "wind_speed_10m", "wind_gusts_10m"]:
                    v = (e.get("variables") or {}).get(var) or {}
                    means = v.get("mean") or {}
                    k = nearest_hour_key(target, means)
                    mu = means.get(k) if k else None
                    if mu is None:
                        continue
                    sd = (v.get("spread") or {}).get(k)
                    ident = (lname, model, var, lead, iso(issued))
                    if ident in existing:
                        continue
                    ledger.append({
                        "loc": lname, "model": model, "family": family, "variable": var,
                        "lead": lead, "issued": iso(issued), "target": iso(target),
                        "pred": mu, "spread": sd, "regime": regime, "ensemble": True, "scored": False,
                    })
                    existing.add(ident)
                    added += 1
    return added


def stability_from_history(history: list[dict[str, Any]]) -> dict[str, Any]:
    groups: dict[tuple[str, str, str, int], list[tuple[datetime, float]]] = defaultdict(list)
    for r in history:
        dt = parse_stamp(r.get("issued"))
        p = safe_float(r.get("pred"))
        if dt and p is not None:
            groups[(r["loc"], r["model"], r["variable"], int(r["lead"]))].append((dt, p))
    out = {}
    for key, rows in groups.items():
        rows.sort(key=lambda x: x[0])
        vals = [v for _, v in rows[-8:]]
        changes = [abs(vals[i] - vals[i - 1]) for i in range(1, len(vals))]
        loc, model, var, lead = key
        out[f"{loc}:{model}:{var}:{lead}"] = {
            "samples": len(vals),
            "run_change_mae": avg(changes) if changes else None,
            "run_spread": stdev(vals),
        }
    return out


def create_targets(
    ledger: list[dict[str, Any]],
    history: list[dict[str, Any]],
    forecasts: dict[str, dict[str, dict[str, dict[str, float]]]],
    regimes: dict[str, dict[str, Any]],
) -> int:
    now = utcnow()
    issued = now.replace(minute=0, second=0, microsecond=0)
    existing = {(e.get("loc"), e.get("model"), e.get("variable", "temperature_2m"), e.get("lead"), e.get("issued")) for e in ledger}
    added = 0
    for lname, model_rows in forecasts.items():
        regime = regimes.get(lname, {}).get("name", "unknown")
        for model, fc in model_rows.items():
            family = MODEL_META.get(model, {}).get("family", "unknown")
            for lead in LEADS:
                target = issued + timedelta(hours=lead)
                for var in VERIFY_VARS:
                    mp = fc.get(var, {})
                    k = nearest_hour_key(target, mp)
                    pred = mp.get(k) if k else None
                    if pred is None:
                        continue
                    ident = (lname, model, var, lead, iso(issued))
                    if ident in existing:
                        continue
                    row = {
                        "loc": lname, "model": model, "family": family, "variable": var,
                        "lead": lead, "issued": iso(issued), "target": iso(target),
                        "pred": pred, "regime": regime, "scored": False,
                    }
                    if var == "precipitation":
                        pk = nearest_hour_key(target, fc.get("precipitation_probability", {}))
                        pop = fc.get("precipitation_probability", {}).get(pk) if pk else None
                        if pop is not None:
                            row["probability"] = pop
                    ledger.append(row)
                    history.append({k: row[k] for k in ["loc", "model", "family", "variable", "lead", "issued", "target", "pred", "regime"]})
                    existing.add(ident)
                    added += 1
    return added


def learned_bias(skill: dict[str, Any], loc: str, model: str, var: str, lead: int, regime: str) -> float:
    candidates = [
        skill.get(f"{loc}:{model}:{var}:{lead}:{regime}"),
        skill.get(f"{loc}:{model}:{var}:{lead}"),
        skill.get(f"{loc}:{model}:{var}:all"),
    ]
    for s in candidates:
        if s and s.get("n", 0) >= 4 and safe_float(s.get("bias")) is not None:
            return float(s["bias"])
    return 0.0


def learned_weight(skill: dict[str, Any], stability: dict[str, Any], loc: str, model: str, var: str, lead: int, regime: str) -> float:
    meta = MODEL_META.get(model, {})
    base = float(meta.get("base_weight", 1.0))
    s = skill.get(f"{loc}:{model}:{var}:{lead}:{regime}") or skill.get(f"{loc}:{model}:{var}:{lead}") or skill.get(f"{loc}:{model}:{var}:all")
    mae = safe_float((s or {}).get("mae"))
    n = int((s or {}).get("n", 0))
    skill_factor = 1.0 if n < 4 or mae is None else max(0.55, min(1.35, 1.35 / (0.70 + mae)))
    stab = stability.get(f"{loc}:{model}:{var}:{lead}") or {}
    run_change = safe_float(stab.get("run_change_mae"))
    stability_factor = 1.0 if run_change is None else max(0.70, min(1.08, 1.08 / (1 + run_change / 3)))

    regime_factor = 1.0
    if model == "gem_hrdps_continental" and lead <= 12:
        regime_factor *= 1.10
    if model == "ecmwf_ifs025" and lead >= 24:
        regime_factor *= 1.06
    if regime == "marine_onshore" and model == "gem_hrdps_continental":
        regime_factor *= 1.08
    if regime == "frontal" and meta.get("family") in {"ecmwf", "canada"}:
        regime_factor *= 1.03

    return base * skill_factor * stability_factor * regime_factor


def family_aware_consensus(
    skill: dict[str, Any],
    stability: dict[str, Any],
    loc: str,
    fc_by_model: dict[str, dict[str, dict[str, float]]],
    var: str,
    target: datetime,
    lead: int,
    regime: str,
) -> dict[str, Any]:
    families: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for model, fc in fc_by_model.items():
        k = nearest_hour_key(target, fc.get(var, {}))
        raw = fc.get(var, {}).get(k) if k else None
        if raw is None:
            continue
        bias = learned_bias(skill, loc, model, var, lead, regime)
        corrected = raw - bias
        weight = learned_weight(skill, stability, loc, model, var, lead, regime)
        fam = MODEL_META.get(model, {}).get("family", "unknown")
        families[fam].append({"model": model, "raw": raw, "corrected": corrected, "bias": bias, "weight": weight})

    family_values = []
    for fam, rows in families.items():
        den = sum(r["weight"] for r in rows)
        val = sum(r["corrected"] * r["weight"] for r in rows) / den if den else avg([r["corrected"] for r in rows])
        # Family vote is capped to one vote so three Canadian products don't count
        # as three fully independent forecasts.
        family_values.append({"family": fam, "value": val, "models": rows})
    vals = [r["value"] for r in family_values if r["value"] is not None]
    return {
        "value": avg(vals),
        "spread": stdev(vals),
        "families": family_values,
        "effective_independent_sources": len(vals),
    }


def blend_weights(lead: int) -> dict[str, float]:
    if lead <= 1:
        return {"nowcast": 0.80, "learned": 0.15, "raw_ensemble": 0.05}
    if lead <= 3:
        return {"nowcast": 0.65, "learned": 0.25, "raw_ensemble": 0.10}
    if lead <= 6:
        return {"nowcast": 0.35, "learned": 0.50, "raw_ensemble": 0.15}
    if lead <= 24:
        return {"nowcast": 0.10, "learned": 0.65, "raw_ensemble": 0.25}
    if lead <= 72:
        return {"nowcast": 0.03, "learned": 0.57, "raw_ensemble": 0.40}
    return {"nowcast": 0.0, "learned": 0.35, "raw_ensemble": 0.65}


def ensemble_at(ensembles: dict[str, Any], var: str, target: datetime) -> dict[str, Any]:
    family_means: dict[str, list[float]] = defaultdict(list)
    family_spreads: dict[str, list[float]] = defaultdict(list)
    used = []
    for key, e in ensembles.items():
        v = (e.get("variables") or {}).get(var) or {}
        means = v.get("mean") or {}
        k = nearest_hour_key(target, means)
        if not k:
            continue
        mu = means.get(k)
        if mu is None:
            continue
        sd = (v.get("spread") or {}).get(k)
        fam = e.get("family", key)
        family_means[fam].append(mu)
        if sd is not None:
            family_spreads[fam].append(sd)
        used.append(key)
    fam_vals = [avg(v) for v in family_means.values()]
    fam_vals = [x for x in fam_vals if x is not None]
    spread_components = [avg(v) for v in family_spreads.values() if v]
    between = stdev(fam_vals) or 0.0
    within = avg([x for x in spread_components if x is not None]) or 0.0
    return {
        "mean": avg(fam_vals),
        "spread": math.sqrt(between * between + within * within) if fam_vals else None,
        "families": len(fam_vals), "products": used,
    }


def build_consensus(
    skill: dict[str, Any],
    stability: dict[str, Any],
    forecasts: dict[str, Any],
    ensembles: dict[str, Any],
    observations: dict[str, Any],
    nowcasts: dict[str, Any],
    regimes: dict[str, Any],
) -> dict[str, Any]:
    now = utcnow().replace(minute=0, second=0, microsecond=0)
    output = {}
    for lname in LOCATIONS:
        loc_out = {"hours": {}, "regime": regimes.get(lname), "source_independence": {}}
        regime = regimes.get(lname, {}).get("name", "unknown")
        for lead in LEADS:
            target = now + timedelta(hours=lead)
            learned = family_aware_consensus(skill, stability, lname, forecasts.get(lname, {}), "temperature_2m", target, lead, regime)
            ens = ensemble_at(ensembles.get(lname, {}), "temperature_2m", target)
            obs_temp = ((observations.get(lname) or {}).get("values") or {}).get("temperature_2m")
            # Nowcast temperature anchors to the fresh observation and trends gently
            # toward the learned forecast with lead. Radar independently controls the
            # precipitation-side nowcast diagnostics.
            now_temp = None
            if obs_temp is not None and learned.get("value") is not None:
                alpha = min(1.0, lead / 4)
                now_temp = obs_temp * (1 - alpha) + learned["value"] * alpha
            elif obs_temp is not None:
                now_temp = obs_temp

            w = blend_weights(lead)
            components = {
                "nowcast": now_temp,
                "learned": learned.get("value"),
                "raw_ensemble": ens.get("mean"),
            }
            den = sum(w[k] for k, v in components.items() if v is not None)
            final = sum(w[k] * v for k, v in components.items() if v is not None) / den if den else None
            confidence_inputs = [
                learned.get("spread"),
                ens.get("spread"),
                safe_float((stability.get(f"{lname}:ecmwf_ifs025:temperature_2m:{lead}") or {}).get("run_change_mae")),
            ]
            uncertainty = math.sqrt(sum(x * x for x in confidence_inputs if x is not None)) if any(x is not None for x in confidence_inputs) else None

            loc_out["hours"][str(lead)] = {
                "target": iso(target), "temperature_2m": final,
                "components": components, "weights": w,
                "learned_spread": learned.get("spread"),
                "ensemble_spread": ens.get("spread"),
                "uncertainty": uncertainty,
                "effective_independent_sources": learned.get("effective_independent_sources", 0),
                "ensemble_families": ens.get("families", 0),
            }
        output[lname] = loc_out
    return output


def optional_benchmarks(loc: dict[str, Any]) -> dict[str, Any]:
    # Credentials are intentionally optional. These are benchmark/challenger feeds,
    # never counted as independent model-family votes unless their provenance is
    # explicitly mapped later.
    lat, lon = loc["lat"], loc["lon"]
    out = {
        "pirate_weather": {"configured": bool(os.getenv("PIRATE_WEATHER_API_KEY")), "status": "not-configured"},
        "tomorrow_io": {"configured": bool(os.getenv("TOMORROW_API_KEY")), "status": "not-configured"},
        "meteoblue": {"configured": bool(os.getenv("METEOBLUE_API_KEY")), "status": "not-configured"},
    }
    key = os.getenv("PIRATE_WEATHER_API_KEY")
    if key:
        try:
            j = get_json(f"https://api.pirateweather.net/forecast/{urllib.parse.quote(key)}/{lat},{lon}?units=si&extend=hourly", timeout=15)
            out["pirate_weather"] = {
                "configured": True, "status": "ok",
                "temperature": safe_float((j.get("currently") or {}).get("temperature")),
                "apparent_temperature": safe_float((j.get("currently") or {}).get("apparentTemperature")),
            }
        except Exception as e:
            out["pirate_weather"] = {"configured": True, "status": "error", "error": type(e).__name__}
    # Tomorrow.io and Meteoblue adapter slots are surfaced in diagnostics but left
    # uncalled until credentials are supplied; this avoids embedding plan-specific
    # endpoint/package assumptions in the public client.
    return out


def aggregate_best_models(skill: dict[str, Any], loc: str) -> dict[str, Any]:
    by_var = {}
    for var in VERIFY_VARS:
        rows = []
        for model in MODEL_META:
            s = skill.get(f"{loc}:{model}:{var}:all")
            if s and s.get("n", 0) >= 4:
                rows.append({"model": model, "label": MODEL_META[model]["label"], **s})
        rows.sort(key=lambda x: (x.get("mae", 9999), -x.get("n", 0)))
        if rows:
            by_var[var] = rows[:5]
    return by_var


def main() -> None:
    now = utcnow()
    state = load(SKILL, {"updated_at": None, "skills": {}})
    skill = state.get("skills", {})
    ledger: list[dict[str, Any]] = load(LEDGER, [])
    history: list[dict[str, Any]] = load(RUN_HISTORY, [])

    observations = {k: eccc_observation_mesh(v) for k, v in LOCATIONS.items()}
    nowcasts = {k: geomet_nowcast(v) for k, v in LOCATIONS.items()}

    forecasts: dict[str, dict[str, Any]] = {}
    ensembles: dict[str, dict[str, Any]] = {}
    regimes: dict[str, dict[str, Any]] = {}
    source_health: dict[str, Any] = {}

    for lname, loc in LOCATIONS.items():
        forecasts[lname] = {}
        for model, *_ in MODELS:
            fc = forecast_location(loc, model)
            if fc:
                forecasts[lname][model] = fc
        source_health[lname] = {
            "deterministic_models": len(forecasts[lname]),
            "deterministic_expected": len(MODELS),
        }
        # Use the highest-resolution Canadian forecast as the local regime proxy,
        # then fallback to ECMWF/GFS.
        regime_fc = (
            forecasts[lname].get("gem_hrdps_continental")
            or forecasts[lname].get("gem_regional")
            or forecasts[lname].get("ecmwf_ifs025")
            or forecasts[lname].get("gfs_seamless")
        )
        regimes[lname] = classify_regime(observations.get(lname), regime_fc, loc)
        ensembles[lname] = ensemble_summary(loc)
        source_health[lname]["ensemble_products"] = sum(1 for e in ensembles[lname].values() if e.get("variables"))
        source_health[lname]["radar"] = nowcasts[lname].get("radar_available", False)
        source_health[lname]["rdpa"] = nowcasts[lname].get("rdpa_available", False)

    scored = score_ledger(ledger, skill, observations, nowcasts)
    added = create_targets(ledger, history, forecasts, regimes)
    ensemble_added = create_ensemble_targets(ledger, ensembles, regimes)
    added += ensemble_added
    stability = stability_from_history(history)
    consensus = build_consensus(skill, stability, forecasts, ensembles, observations, nowcasts, regimes)

    # Preserve a bounded horizon. Multi-variable rows are larger than v1, so retain
    # 45 days for verification and 14 days for run stability.
    ledger = [e for e in ledger if (parse_stamp(e.get("issued")) or now) > now - timedelta(days=45)]
    history = [e for e in history if (parse_stamp(e.get("issued")) or now) > now - timedelta(days=14)]

    state = {
        "version": 2,
        "updated_at": iso(now),
        "observations": observations,
        "skills": skill,
    }
    engine = {
        "version": "2.0",
        "updated_at": iso(now),
        "architecture": {
            "engines": ["nowcast", "learned_local", "raw_ensemble"],
            "blend_weights": {str(h): blend_weights(h) for h in LEADS},
            "family_aware_weighting": True,
            "bias_correction": True,
            "run_stability": True,
            "regime_conditioning": True,
            "metrics": ["MAE", "bias", "RMSE", "Brier", "CRPS", "run-change MAE"],
        },
        "model_families": {m: MODEL_META[m]["family"] for m in MODEL_META},
        "ensemble_products": ENSEMBLE_META,
        "observations": observations,
        "nowcast": nowcasts,
        "regimes": regimes,
        "stability": stability,
        "consensus": consensus,
        "best_models": {loc: aggregate_best_models(skill, loc) for loc in LOCATIONS},
        "source_health": source_health,
        "benchmarks": {loc: optional_benchmarks(v) for loc, v in LOCATIONS.items()},
        "collector": {"scored_this_run": scored, "targets_added": added, "ledger_rows": len(ledger), "history_rows": len(history)},
    }
    save(SKILL, state)
    save(LEDGER, ledger)
    save(RUN_HISTORY, history)
    save(ENGINE, engine)

    print(
        f"accuracy-v2 scored={scored} added={added} skills={len(skill)} "
        f"ledger={len(ledger)} history={len(history)} "
        f"obs={sum(1 for x in observations.values() if x)} "
        f"models={sum(v['deterministic_models'] for v in source_health.values())}"
    )


if __name__ == "__main__":
    main()
