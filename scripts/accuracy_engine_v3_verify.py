#!/usr/bin/env python3
"""Shadow verification for Accuracy Engine 3.0.

Scores previously-issued V3 component forecasts against the current ECCC observation
mesh, tracks per-location/lead/regime MAE and precipitation Brier score, and exposes
conservative adaptive multipliers for MOS, analog, and observation-nudge layers.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

import accuracy_engine_v2 as core

VERIFY = core.DATA / "v3-verification.json"
MAX_AGE_DAYS = 60
MIN_ADAPT_SAMPLES = 8


def _bucket(lead: int) -> int:
    return int(lead)


def _stat_update(s: dict[str, Any], error: float) -> None:
    n = int(s.get("n", 0))
    s["mae"] = (float(s.get("mae", 0.0)) * n + abs(error)) / (n + 1)
    s["bias"] = (float(s.get("bias", 0.0)) * n + error) / (n + 1)
    s["n"] = n + 1
    s["updated_at"] = core.iso(core.utcnow())


def _brier_update(s: dict[str, Any], probability_pct: float, wet: bool) -> None:
    p = max(0.0, min(1.0, probability_pct / 100.0))
    b = (p - (1.0 if wet else 0.0)) ** 2
    n = int(s.get("n", 0))
    s["brier"] = (float(s.get("brier", 0.0)) * n + b) / (n + 1)
    s["n"] = n + 1
    s["updated_at"] = core.iso(core.utcnow())


def _keys(loc: str, lead: int, regime: str, layer: str) -> list[str]:
    return [
        f"{loc}:{_bucket(lead)}:{regime}:{layer}",
        f"{loc}:{_bucket(lead)}:all:{layer}",
        f"{loc}:all:all:{layer}",
    ]


def score_due(state: dict[str, Any], observations: dict[str, Any]) -> int:
    now = core.utcnow()
    scores = state.setdefault("scores", {})
    precip_scores = state.setdefault("precip_scores", {})
    scored = 0
    for row in state.setdefault("forecasts", []):
        if row.get("scored"):
            continue
        target = core.parse_stamp(row.get("target"))
        if not target or target > now + timedelta(minutes=20):
            continue
        obs = observations.get(row.get("loc")) or {}
        obs_time = core.parse_stamp(obs.get("time"))
        if not obs_time or abs((obs_time - target).total_seconds()) > 2.5 * 3600:
            continue
        actual = core.safe_float(((obs.get("values") or {}).get("temperature_2m")))
        if actual is not None:
            for layer, pred in (row.get("temperature_candidates") or {}).items():
                p = core.safe_float(pred)
                if p is None:
                    continue
                err = p - actual
                for key in _keys(str(row["loc"]), int(row["lead"]), str(row.get("regime", "unknown")), layer):
                    _stat_update(scores.setdefault(key, {}), err)
        precip_actual = core.safe_float(((obs.get("values") or {}).get("precipitation")))
        if precip_actual is not None:
            wet = precip_actual >= core.PRECIP_THRESHOLD
            for layer, prob in (row.get("precip_candidates") or {}).items():
                p = core.safe_float(prob)
                if p is None:
                    continue
                for key in _keys(str(row["loc"]), int(row["lead"]), str(row.get("regime", "unknown")), layer):
                    _brier_update(precip_scores.setdefault(key, {}), p, wet)
        row["scored"] = True
        row["actual_temperature"] = actual
        row["actual_precipitation"] = precip_actual
        row["scored_at"] = core.iso(now)
        scored += 1
    cutoff = now - timedelta(days=MAX_AGE_DAYS)
    state["forecasts"] = [
        r for r in state.get("forecasts", [])
        if (core.parse_stamp(r.get("issued")) or now) >= cutoff
    ]
    state["updated_at"] = core.iso(now)
    return scored


def adaptive_factor(state: dict[str, Any], loc: str, lead: int, regime: str, layer: str) -> dict[str, Any]:
    """Return a conservative multiplier relative to V2 baseline skill."""
    scores = state.get("scores", {})
    layer_stat = None
    base_stat = None
    for suffix in [regime, "all"]:
        l = scores.get(f"{loc}:{_bucket(lead)}:{suffix}:{layer}")
        b = scores.get(f"{loc}:{_bucket(lead)}:{suffix}:v2")
        if l and b and min(int(l.get("n", 0)), int(b.get("n", 0))) >= MIN_ADAPT_SAMPLES:
            layer_stat, base_stat = l, b
            break
    if not layer_stat or not base_stat:
        return {"factor": 1.0, "samples": 0, "status": "learning"}
    lm = max(0.05, float(layer_stat.get("mae", 99)))
    bm = max(0.05, float(base_stat.get("mae", 99)))
    ratio = bm / lm
    factor = max(0.25, min(1.25, ratio))
    if 0.95 <= ratio <= 1.05:
        factor = 1.0
    return {
        "factor": factor,
        "samples": min(int(layer_stat.get("n", 0)), int(base_stat.get("n", 0))),
        "layer_mae": lm,
        "v2_mae": bm,
        "status": "boosted" if factor > 1.02 else ("damped" if factor < 0.98 else "neutral"),
    }


def precipitation_factor(state: dict[str, Any], loc: str, lead: int, regime: str) -> dict[str, Any]:
    scores = state.get("precip_scores", {})
    cal = raw = None
    for suffix in [regime, "all"]:
        c = scores.get(f"{loc}:{_bucket(lead)}:{suffix}:calibrated")
        r = scores.get(f"{loc}:{_bucket(lead)}:{suffix}:raw")
        if c and r and min(int(c.get("n", 0)), int(r.get("n", 0))) >= MIN_ADAPT_SAMPLES:
            cal, raw = c, r
            break
    if not cal or not raw:
        return {"factor": 1.0, "samples": 0, "status": "learning"}
    cb = max(1e-4, float(cal.get("brier", 1)))
    rb = max(1e-4, float(raw.get("brier", 1)))
    ratio = rb / cb
    factor = max(0.0, min(1.0, (ratio - 0.85) / 0.15)) if ratio < 1 else 1.0
    return {
        "factor": factor,
        "samples": min(int(cal.get("n", 0)), int(raw.get("n", 0))),
        "calibrated_brier": cb,
        "raw_brier": rb,
        "status": "active" if factor >= 0.98 else "damped",
    }


def add_current_forecasts(state: dict[str, Any], engine: dict[str, Any]) -> int:
    issued = core.parse_stamp(engine.get("updated_at")) or core.utcnow()
    existing = {(r.get("loc"), r.get("lead"), r.get("issued")) for r in state.setdefault("forecasts", [])}
    added = 0
    for loc, payload in (engine.get("consensus") or {}).items():
        regime = ((payload.get("regime") or {}).get("name")) or "unknown"
        for lead_s, h in (payload.get("hours") or {}).items():
            lead = int(lead_s)
            ident = (loc, lead, core.iso(issued))
            if ident in existing:
                continue
            comps = h.get("components") or {}
            v2 = core.safe_float(comps.get("v2_consensus"))
            nudge = core.safe_float(comps.get("observation_nudge"))
            temp_candidates = {
                "v2": v2,
                "mos": core.safe_float(comps.get("mos")),
                "analog": core.safe_float(comps.get("analog")),
                "final_v3": core.safe_float(h.get("temperature_2m")),
            }
            if v2 is not None and nudge is not None:
                temp_candidates["nudge"] = v2 + max(-1.5, min(1.5, nudge * 0.65))
            state["forecasts"].append({
                "loc": loc,
                "lead": lead,
                "regime": regime,
                "issued": core.iso(issued),
                "target": h.get("target"),
                "temperature_candidates": temp_candidates,
                "precip_candidates": {
                    "raw": core.safe_float(h.get("raw_precipitation_probability")),
                    "calibrated": core.safe_float(h.get("precipitation_probability")),
                },
                "scored": False,
            })
            existing.add(ident)
            added += 1
    return added


def load_state() -> dict[str, Any]:
    return core.load(VERIFY, {"version": "1.0", "updated_at": None, "scores": {}, "precip_scores": {}, "forecasts": []})


def save_state(state: dict[str, Any]) -> None:
    core.save(VERIFY, state)
