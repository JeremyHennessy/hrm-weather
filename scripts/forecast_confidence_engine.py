#!/usr/bin/env python3
"""Empirically calibrated Forecast Confidence for Accuracy Engine 3.

Confidence means the estimated probability that the final V3 air-temperature
forecast will land inside a lead-appropriate useful-error band. Historical
prospective V3 errors provide the likelihood; model uncertainty supplies a weak
prior while samples are small. Issued confidence values are later reliability-
scored by accuracy_engine_v3_verify so a displayed 70-79% bin can be checked
against its realized hit frequency.
"""
from __future__ import annotations

from typing import Any

import accuracy_engine_v2 as core

MIN_EXACT_SAMPLES = 6
PRIOR_STRENGTH = 8.0
RELIABILITY_MIN_SAMPLES = 5

TOLERANCE_C = {
    1: 1.0,
    3: 1.2,
    6: 1.5,
    12: 1.8,
    24: 2.2,
    48: 2.8,
    72: 3.2,
}


def tolerance_for(lead: int) -> float:
    if lead in TOLERANCE_C:
        return TOLERANCE_C[lead]
    nearest = min(TOLERANCE_C, key=lambda x: abs(x - lead))
    return TOLERANCE_C[nearest]


def uncertainty_prior(uncertainty: Any, lead: int) -> float:
    u = core.safe_float(uncertainty)
    if u is None:
        return max(0.58, min(0.86, 0.82 - lead / 400.0))
    score = 0.965 - 0.075 * max(0.0, u)
    if lead >= 24:
        score -= min(0.08, (lead - 12) / 800.0)
    return max(0.52, min(0.96, score))


def _historical_cases(state: dict[str, Any], loc: str, lead: int) -> list[dict[str, Any]]:
    exact = []
    pooled = []
    tol = tolerance_for(lead)
    for row in state.get("forecasts", []):
        if row.get("loc") != loc or not row.get("scored"):
            continue
        actual = core.safe_float(row.get("actual_temperature"))
        pred = core.safe_float((row.get("temperature_candidates") or {}).get("final_v3"))
        if actual is None or pred is None:
            continue
        rlead = int(row.get("lead", -999))
        case = {"hit": abs(pred - actual) <= tol, "error": pred - actual, "lead": rlead}
        if rlead == lead:
            exact.append(case)
        elif abs(rlead - lead) <= max(3, lead // 2):
            pooled.append(case)
    return exact if len(exact) >= MIN_EXACT_SAMPLES else (exact + pooled)


def _bin_key(value: float) -> str:
    lo = int(max(0, min(90, (value // 10) * 10)))
    return f"{lo}-{lo+9}"


def _prospective_reliability(state: dict[str, Any], raw_pct: float) -> dict[str, Any]:
    bins = state.get("confidence_scores", {})
    key = _bin_key(raw_pct)
    b = bins.get(key) or {}
    n = int(b.get("n", 0))
    observed = core.safe_float(b.get("hit_rate"))
    if n < RELIABILITY_MIN_SAMPLES or observed is None:
        return {"available": False, "samples": n, "bin": key}
    nominal = raw_pct / 100.0
    trust = min(0.75, n / 30.0)
    calibrated = nominal * (1.0 - trust) + observed * trust
    return {"available": True, "samples": n, "bin": key, "observed_hit_rate": observed, "trust": trust, "value": calibrated}


def calculate(state: dict[str, Any], loc: str, lead: int, uncertainty: Any) -> dict[str, Any]:
    tol = tolerance_for(lead)
    prior = uncertainty_prior(uncertainty, lead)
    cases = _historical_cases(state, loc, lead)
    hits = sum(1 for x in cases if x["hit"])
    n = len(cases)
    posterior = (hits + PRIOR_STRENGTH * prior) / (n + PRIOR_STRENGTH)
    posterior = max(0.50, min(0.96, posterior))
    raw_pct = 100.0 * posterior
    reliability = _prospective_reliability(state, raw_pct)
    calibrated = float(reliability.get("value", posterior)) if reliability.get("available") else posterior
    value = int(round(max(50.0, min(96.0, calibrated * 100.0))))
    return {
        "value": value,
        "meaning": f"estimated chance final air temperature is within ±{tol:.1f}°C",
        "tolerance_c": tol,
        "historical_cases": n,
        "historical_hits": hits,
        "historical_hit_rate": (hits / n) if n else None,
        "uncertainty_prior": prior,
        "prospective_reliability": reliability,
        "method": "bayesian empirical coverage + prospective reliability calibration",
    }


def apply(engine: dict[str, Any], state: dict[str, Any]) -> None:
    summary = {}
    for loc, payload in (engine.get("consensus") or {}).items():
        loc_out = {}
        for lead_s, row in (payload.get("hours") or {}).items():
            lead = int(lead_s)
            result = calculate(state, loc, lead, row.get("v2_uncertainty"))
            row["forecast_confidence"] = result
            loc_out[lead_s] = result
        summary[loc] = loc_out
    engine["forecast_confidence"] = {
        "version": "2.0",
        "owner": "accuracy-engine-3",
        "display_policy": "one value per location/forecast revision",
        "calibration_target": "observed coverage should match displayed probability bins",
        "tolerances_c": {str(k): v for k, v in TOLERANCE_C.items()},
        "locations": summary,
    }
