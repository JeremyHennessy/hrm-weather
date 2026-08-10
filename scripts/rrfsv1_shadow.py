#!/usr/bin/env python3
"""NOAA RRFSv1 short-range challenger, shadow only.

Reads small GRIB2 message ranges using each RRFS file's wgrib2 index rather than
downloading full model grids.  It tries the pre-implementation/operational
`rrfs_public` structure first and the current prototype `rrfs_a` structure as a
transition fallback.  Nothing in this module changes the production forecast.

Paired prospective evidence is collected for temperature, precipitation,
10-m gust and total cloud at +1/+3/+6/+12/+24 h.  Evidence can mark a
location/lead/variable eligible for a future limited-weight review, but applied
production weight remains exactly zero until an explicit promotion change.
"""
from __future__ import annotations

import io
import json
import math
import tempfile
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any

import accuracy_engine_v2 as core

STATE = core.DATA / "rrfsv1-verification.json"
VERSION = "1.0"
LEADS = (1, 3, 6, 12, 24)
VARIABLES = ("temperature_2m", "precipitation", "wind_gusts_10m", "cloud_cover")
MIN_EVIDENCE = 30
MIN_WIN_RATE = 0.55
MIN_RELATIVE_IMPROVEMENT = 0.03
APPLIED_PRODUCTION_WEIGHT = 0.0
MAX_AGE_DAYS = 60
BASE = "https://noaa-rrfs-pds.s3.amazonaws.com"
NOMADS = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/rrfs/prod"

try:
    from eccodes import codes_get, codes_grib_find_nearest, codes_grib_new_from_file, codes_release
    ECCODES_AVAILABLE = True
except Exception:
    ECCODES_AVAILABLE = False

PATTERNS = {
    "temperature_2m": (":TMP:2 m above ground:",),
    "precipitation": (":PRATE:surface:",),
    "wind_gusts_10m": (":GUST:surface:",),
    "cloud_cover": (":TCDC:entire atmosphere:", ":TCDC:atmos col:"),
}


def _load() -> dict[str, Any]:
    return core.load(STATE, {"version": VERSION, "rows": [], "scores": {}, "updated_at": None})


def _save(state: dict[str, Any]) -> None:
    state["version"] = VERSION
    state["updated_at"] = core.iso(core.utcnow())
    cutoff = core.utcnow() - timedelta(days=MAX_AGE_DAYS)
    state["rows"] = [r for r in state.get("rows", []) if (core.parse_stamp(r.get("issued")) or core.utcnow()) >= cutoff]
    core.save(STATE, state)


def _stat_update(stat: dict[str, Any], rrfs_error: float, base_error: float) -> None:
    n = int(stat.get("n", 0))
    rrfs_abs, base_abs = abs(rrfs_error), abs(base_error)
    stat["rrfs_mae"] = (float(stat.get("rrfs_mae", 0.0)) * n + rrfs_abs) / (n + 1)
    stat["baseline_mae"] = (float(stat.get("baseline_mae", 0.0)) * n + base_abs) / (n + 1)
    stat["rrfs_bias"] = (float(stat.get("rrfs_bias", 0.0)) * n + rrfs_error) / (n + 1)
    stat["baseline_bias"] = (float(stat.get("baseline_bias", 0.0)) * n + base_error) / (n + 1)
    stat["wins"] = float(stat.get("wins", 0.0)) + (1.0 if rrfs_abs < base_abs else 0.5 if rrfs_abs == base_abs else 0.0)
    stat["n"] = n + 1
    stat["win_rate"] = stat["wins"] / stat["n"]
    stat["updated_at"] = core.iso(core.utcnow())


def _brier_update(stat: dict[str, Any], rrfs_probability: float, base_probability: float, wet: bool) -> None:
    y = 1.0 if wet else 0.0
    rp = max(0.0, min(1.0, rrfs_probability / 100.0)); bp = max(0.0, min(1.0, base_probability / 100.0))
    re = (rp - y) ** 2; be = (bp - y) ** 2
    n = int(stat.get("n", 0))
    stat["rrfs_brier"] = (float(stat.get("rrfs_brier", 0.0)) * n + re) / (n + 1)
    stat["baseline_brier"] = (float(stat.get("baseline_brier", 0.0)) * n + be) / (n + 1)
    stat["wins"] = float(stat.get("wins", 0.0)) + (1.0 if re < be else 0.5 if re == be else 0.0)
    stat["n"] = n + 1; stat["win_rate"] = stat["wins"] / stat["n"]
    stat["updated_at"] = core.iso(core.utcnow())


def _eligibility(stat: dict[str, Any], variable: str) -> dict[str, Any]:
    n = int(stat.get("n", 0)); win = core.safe_float(stat.get("win_rate"))
    rrfs = core.safe_float(stat.get("rrfs_brier" if variable == "precipitation" else "rrfs_mae"))
    base = core.safe_float(stat.get("baseline_brier" if variable == "precipitation" else "baseline_mae"))
    improvement = ((base - rrfs) / base) if rrfs is not None and base is not None and base > 1e-9 else None
    eligible = bool(n >= MIN_EVIDENCE and win is not None and win >= MIN_WIN_RATE and improvement is not None and improvement >= MIN_RELATIVE_IMPROVEMENT)
    return {
        "status": "eligible-for-limited-weight-review" if eligible else ("prospective-shadow-learning" if n < MIN_EVIDENCE else "prospective-shadow-no-promotion"),
        "samples": n, "paired_win_rate": win, "relative_improvement": improvement,
        "eligible_for_future_weight": eligible, "applied_production_weight": APPLIED_PRODUCTION_WEIGHT,
    }


def _latest_cycle(now: datetime) -> datetime:
    cycle = (now.hour // 6) * 6
    return now.replace(hour=cycle, minute=0, second=0, microsecond=0)


def _file_candidates(loc: dict[str, Any], cycle: datetime, forecast_hour: int) -> list[str]:
    date = cycle.strftime("%Y%m%d"); hh = cycle.strftime("%H"); f = f"{forecast_hour:03d}"; name = f"rrfs.t{hh}z"
    us = str(loc.get("country") or "CA").upper() == "US"
    paths = []
    if us:
        paths += [
            f"{BASE}/rrfs_public/rrfs.{date}/{hh}/{name}.2dfld.3km.f{f}.conus.grib2",
            f"{BASE}/rrfs_a/rrfs.{date}/{hh}/{name}.2dfld.3km.f{f}.conus.grib2",
            f"{BASE}/rrfs_a/rrfs.{date}/{hh}/{name}.natlev.3km.f{f}.na.grib2",
        ]
    else:
        paths += [
            f"{BASE}/rrfs_public/rrfs.{date}/{hh}/{name}.2dfld.13km.f{f}.na.grib2",
            f"{NOMADS}/rrfs.{date}/{hh}/{name}.2dfld.13km.f{f}.na.grib2",
            f"{BASE}/rrfs_a/rrfs.{date}/{hh}/{name}.natlev.3km.f{f}.na.grib2",
        ]
    return paths


def _text(url: str, timeout: int = 12) -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "weather-consensus/rrfsv1-shadow"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception:
        return None


def _range(url: str, start: int, end: int, timeout: int = 18) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "weather-consensus/rrfsv1-shadow", "Range": f"bytes={start}-{end}"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except Exception:
        return None


def _index(url: str) -> tuple[str, list[tuple[int, str]]] | None:
    for suffix in (".idx", ".grib2.idx"):
        idx_url = url + suffix if suffix == ".idx" else url[:-6] + suffix
        text = _text(idx_url)
        if not text:
            continue
        rows = []
        for line in text.splitlines():
            try: rows.append((int(line.split(":", 1)[0]), line))
            except Exception: continue
        if rows:
            return idx_url, rows
    return None


def _message(url: str, rows: list[tuple[int, str]], patterns: tuple[str, ...]) -> bytes | None:
    for i, (start, line) in enumerate(rows):
        if not any(p in line for p in patterns):
            continue
        if i + 1 >= len(rows):
            continue
        end = rows[i + 1][0] - 1
        return _range(url, start, end)
    return None


def _nearest_value(data: bytes, lat: float, lon: float) -> tuple[float | None, str | None]:
    if not ECCODES_AVAILABLE or not data:
        return None, None
    with tempfile.NamedTemporaryFile(suffix=".grib2") as tmp:
        tmp.write(data); tmp.flush(); tmp.seek(0)
        gid = codes_grib_new_from_file(tmp)
        if gid is None:
            return None, None
        try:
            found = codes_grib_find_nearest(gid, lat, lon, is_lsm=False, npoints=1)
            item = found[0] if isinstance(found, list) and found else found
            value = core.safe_float((item or {}).get("value") if isinstance(item, dict) else None)
            units = str(codes_get(gid, "units") or "")
            return value, units
        finally:
            codes_release(gid)


def _normalize(variable: str, value: float | None, units: str | None) -> float | None:
    if value is None: return None
    u = str(units or "").lower()
    if variable == "temperature_2m" and ("k" == u.strip() or "kelvin" in u): return value - 273.15
    if variable == "wind_gusts_10m" and ("m s" in u or "m/s" in u): return value * 3.6
    if variable == "precipitation":
        # RRFS PRATE is kg m-2 s-1, numerically mm/s for liquid water.
        if "s-1" in u or "/s" in u: return max(0.0, value * 3600.0)
        return max(0.0, value)
    if variable == "cloud_cover":
        if value <= 1.0 and ("fraction" in u or not u): return max(0.0, min(100.0, value * 100.0))
        return max(0.0, min(100.0, value))
    return value


def fetch_point(loc: dict[str, Any], cycle: datetime, forecast_hour: int) -> dict[str, Any]:
    if not ECCODES_AVAILABLE:
        return {"available": False, "reason": "eccodes-unavailable", "cycle": core.iso(cycle), "forecast_hour": forecast_hour}
    for url in _file_candidates(loc, cycle, forecast_hour):
        indexed = _index(url)
        if not indexed: continue
        _, rows = indexed; values = {}
        for variable, patterns in PATTERNS.items():
            data = _message(url, rows, patterns)
            value, units = _nearest_value(data or b"", float(loc["lat"]), float(loc["lon"]))
            values[variable] = _normalize(variable, value, units)
        if any(core.safe_float(v) is not None for v in values.values()):
            return {"available": True, "source": url, "cycle": core.iso(cycle), "forecast_hour": forecast_hour, "values": values}
    return {"available": False, "reason": "rrfs-file-or-index-unavailable", "cycle": core.iso(cycle), "forecast_hour": forecast_hour}


def _family_baseline(forecasts: dict[str, Any], target: datetime, variable: str) -> float | None:
    by_family: dict[str, list[float]] = defaultdict(list)
    for model, fc in forecasts.items():
        mp = (fc or {}).get(variable) or {}; key = core.nearest_hour_key(target, mp); value = core.safe_float(mp.get(key) if key else None)
        if value is None: continue
        fam = (core.MODEL_META.get(model) or {}).get("family", "other")
        by_family[fam].append(value)
    family_values = [sum(xs) / len(xs) for xs in by_family.values() if xs]
    return sum(family_values) / len(family_values) if family_values else None


def _production_baselines(engine: dict[str, Any], forecasts: dict[str, Any], loc: str, lead: int, target: datetime) -> dict[str, float | None]:
    h = (((engine.get("consensus") or {}).get(loc) or {}).get("hours") or {}).get(str(lead), {})
    return {
        "temperature_2m": core.safe_float(h.get("temperature_2m")),
        "precipitation": core.safe_float(h.get("precipitation_probability")),
        "wind_gusts_10m": _family_baseline(forecasts, target, "wind_gusts_10m"),
        "cloud_cover": _family_baseline(forecasts, target, "cloud_cover"),
    }


def score_due(state: dict[str, Any], observations: dict[str, Any]) -> int:
    now = core.utcnow(); scored = 0
    for row in state.setdefault("rows", []):
        if row.get("scored"): continue
        target = core.parse_stamp(row.get("target")); obs = observations.get(row.get("loc")) or {}; odt = core.parse_stamp(obs.get("time"))
        if not target or target > now + timedelta(minutes=20) or not odt or abs((odt - target).total_seconds()) > 90 * 60: continue
        actuals = obs.get("values") or {}; loc = str(row.get("loc")); lead = int(row.get("lead", -1)); rv = row.get("rrfs") or {}; base = row.get("baseline") or {}
        for variable in VARIABLES:
            r = core.safe_float(rv.get(variable)); b = core.safe_float(base.get(variable))
            if variable == "precipitation":
                a = core.safe_float(actuals.get("precipitation"))
                if r is None or b is None or a is None: continue
                wet = a >= core.PRECIP_THRESHOLD; rp = 100.0 if r >= core.PRECIP_THRESHOLD else 0.0
                _brier_update(state.setdefault("scores", {}).setdefault(f"{loc}:{lead}:{variable}", {}), rp, b, wet)
                row.setdefault("actual", {})[variable] = a
            else:
                a = core.safe_float(actuals.get(variable))
                if r is None or b is None or a is None: continue
                _stat_update(state.setdefault("scores", {}).setdefault(f"{loc}:{lead}:{variable}", {}), r - a, b - a)
                row.setdefault("actual", {})[variable] = a
        row["scored"] = True; row["scored_at"] = core.iso(now); scored += 1
    return scored


def add_current(state: dict[str, Any], engine: dict[str, Any], forecasts: dict[str, Any]) -> int:
    now = core.utcnow(); issued = now.replace(minute=0, second=0, microsecond=0); cycle = _latest_cycle(now)
    existing = {(r.get("loc"), int(r.get("lead", -1)), r.get("issued")) for r in state.setdefault("rows", [])}; added = 0
    for loc, locdef in core.LOCATIONS.items():
        for lead in LEADS:
            ident = (loc, lead, core.iso(issued))
            if ident in existing: continue
            target = issued + timedelta(hours=lead); fhr = int(round((target - cycle).total_seconds() / 3600.0))
            if fhr < 0 or fhr > 84: continue
            point = fetch_point(locdef, cycle, fhr); values = point.get("values") or {}
            if not point.get("available"):
                continue
            state["rows"].append({
                "loc": loc, "lead": lead, "issued": core.iso(issued), "target": core.iso(target),
                "cycle": core.iso(cycle), "forecast_hour": fhr, "source": point.get("source"),
                "rrfs": {v: core.safe_float(values.get(v)) for v in VARIABLES},
                "baseline": _production_baselines(engine, forecasts.get(loc, {}), loc, lead, target),
                "scored": False,
            }); existing.add(ident); added += 1
    return added


def report(state: dict[str, Any], current: dict[str, Any] | None = None) -> dict[str, Any]:
    evidence = {}
    for key, stat in (state.get("scores") or {}).items():
        parts = key.split(":")
        if len(parts) != 3: continue
        loc, lead, variable = parts
        evidence.setdefault(loc, {}).setdefault(lead, {})[variable] = {**stat, **_eligibility(stat, variable)}
    eligible = [f"{loc}:{lead}:{var}" for loc, leads in evidence.items() for lead, vars_ in leads.items() for var, s in vars_.items() if s.get("eligible_for_future_weight")]
    return {
        "version": VERSION, "status": "prospective-shadow-only", "model": "NOAA RRFSv1",
        "lead_hours": list(LEADS), "variables": list(VARIABLES), "eccodes_available": ECCODES_AVAILABLE,
        "source_policy": "try rrfs_public/pre-implementation-operational paths first; rrfs_a prototype is transition fallback; all failures are fail-soft",
        "promotion_policy": {"minimum_paired_samples": MIN_EVIDENCE, "minimum_paired_win_rate": MIN_WIN_RATE, "minimum_relative_improvement": MIN_RELATIVE_IMPROVEMENT, "eligible_for_review": eligible, "automatic_promotion": False},
        "applied_production_weight": APPLIED_PRODUCTION_WEIGHT,
        "production_changed": False,
        "scored_rows": sum(1 for r in state.get("rows", []) if r.get("scored")), "archived_rows": len(state.get("rows", [])),
        "evidence": evidence, "current_issue": current or {},
        "next_ensemble_candidate": "Google WeatherNext 2 for medium-range probabilistic diversity after RRFSv1 short-range evidence review",
    }


def update(engine: dict[str, Any], forecasts: dict[str, Any], observations: dict[str, Any]) -> dict[str, Any]:
    state = _load(); scored = score_due(state, observations); added = add_current(state, engine, forecasts); _save(state)
    out = report(state, {"scored_this_run": scored, "issued_this_run": added})
    return out
