#!/usr/bin/env python3
"""Weather Consensus Accuracy Engine 3.0 statistical post-processing.

V3 intentionally sits above the proven V2 collector. It adds four local layers:
- MOS-style ridge regression trained from verified model forecasts
- analog forecasting from historically similar multi-model situations
- short-range observation nudging using the live ECCC mesh error
- reliability calibration for precipitation probability

No third-party ML dependency is required; the hourly GitHub runner can retrain the
small local models directly from the forecast ledger on every run.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

import accuracy_engine_v2 as core

ENGINE_V3 = core.DATA / "engine-v3.json"
FAMILIES = ["canada", "ecmwf", "noaa", "dwd", "ukmo", "meteofrance", "jma", "other"]


def _family(model: str) -> str:
    fam = (core.MODEL_META.get(model) or {}).get("family", "other")
    return fam if fam in FAMILIES else "other"


def _mean(xs):
    vals = [float(x) for x in xs if core.safe_float(x) is not None]
    return sum(vals) / len(vals) if vals else None


def _family_snapshot(model_values: dict[str, float]) -> dict[str, float]:
    by: dict[str, list[float]] = defaultdict(list)
    for model, value in model_values.items():
        v = core.safe_float(value)
        if v is not None:
            by[_family(model)].append(v)
    return {fam: _mean(vals) for fam, vals in by.items() if vals}


def _training_groups(ledger: list[dict[str, Any]], loc: str, lead: int) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for row in ledger:
        if row.get("loc") != loc or int(row.get("lead", -1)) != int(lead):
            continue
        if row.get("variable", "temperature_2m") != "temperature_2m" or not row.get("scored"):
            continue
        actual = core.safe_float(row.get("actual"))
        pred = core.safe_float(row.get("pred"))
        target = str(row.get("target") or "")
        model = str(row.get("model") or "")
        if actual is None or pred is None or not target or model.startswith("ensemble:"):
            continue
        g = groups.setdefault(target, {"target": target, "actuals": [], "models": {}, "regime": row.get("regime", "unknown")})
        g["actuals"].append(actual)
        g["models"][model] = pred
    out = []
    for g in groups.values():
        fam = _family_snapshot(g["models"])
        actual = _mean(g["actuals"])
        if actual is None or len(fam) < 2:
            continue
        dt = core.parse_stamp(g["target"])
        out.append({**g, "families": fam, "actual": actual, "dt": dt})
    out.sort(key=lambda r: r.get("dt") or datetime.min.replace(tzinfo=core.timezone.utc))
    return out[-240:]


def _features(fam: dict[str, float], dt: datetime | None) -> list[float]:
    present = list(fam.values())
    fill = _mean(present) or 0.0
    month = (dt.month if dt else 1) - 1
    hour = dt.hour if dt else 12
    return [
        1.0,
        *[float(fam.get(name, fill)) for name in FAMILIES],
        math.sin(2 * math.pi * month / 12), math.cos(2 * math.pi * month / 12),
        math.sin(2 * math.pi * hour / 24), math.cos(2 * math.pi * hour / 24),
    ]


def _solve(a: list[list[float]], b: list[float]) -> list[float] | None:
    n = len(b)
    aug = [list(a[i]) + [b[i]] for i in range(n)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(aug[r][col]))
        if abs(aug[pivot][col]) < 1e-9:
            return None
        aug[col], aug[pivot] = aug[pivot], aug[col]
        p = aug[col][col]
        aug[col] = [x / p for x in aug[col]]
        for r in range(n):
            if r == col:
                continue
            f = aug[r][col]
            if abs(f) < 1e-12:
                continue
            aug[r] = [aug[r][c] - f * aug[col][c] for c in range(n + 1)]
    return [aug[i][-1] for i in range(n)]


def fit_mos(rows: list[dict[str, Any]], ridge: float = 2.5) -> dict[str, Any]:
    if len(rows) < 12:
        return {"available": False, "samples": len(rows), "reason": "needs-12-verified-targets"}
    xs = [_features(r["families"], r.get("dt")) for r in rows]
    ys = [float(r["actual"]) for r in rows]
    p = len(xs[0])
    xtx = [[0.0] * p for _ in range(p)]
    xty = [0.0] * p
    for x, y in zip(xs, ys):
        for i in range(p):
            xty[i] += x[i] * y
            for j in range(p):
                xtx[i][j] += x[i] * x[j]
    for i in range(1, p):
        xtx[i][i] += ridge
    beta = _solve(xtx, xty)
    if not beta:
        return {"available": False, "samples": len(rows), "reason": "singular"}
    preds = [sum(c * v for c, v in zip(beta, x)) for x in xs]
    mae = _mean([abs(a - p_) for a, p_ in zip(ys, preds)])
    return {"available": True, "samples": len(rows), "coefficients": beta, "training_mae": mae, "ridge": ridge}


def predict_mos(model: dict[str, Any], fam: dict[str, float], dt: datetime) -> float | None:
    beta = model.get("coefficients") if model.get("available") else None
    if not beta:
        return None
    x = _features(fam, dt)
    return sum(float(c) * v for c, v in zip(beta, x))


def analog_predict(rows: list[dict[str, Any]], fam: dict[str, float], dt: datetime, regime: str, k: int = 8) -> dict[str, Any]:
    if len(rows) < 8 or len(fam) < 2:
        return {"available": False, "samples": len(rows)}
    current_mean = _mean(list(fam.values()))
    ranked = []
    for r in rows:
        shared = [name for name in fam if name in r["families"]]
        if len(shared) < 2:
            continue
        dist = _mean([abs(fam[n] - r["families"][n]) for n in shared]) or 99
        if r.get("regime") != regime:
            dist += 0.45
        if r.get("dt"):
            # Prefer the same season without making calendar distance dominant.
            dm = abs(dt.month - r["dt"].month)
            dist += 0.06 * min(dm, 12 - dm)
        hist_mean = _mean(list(r["families"].values()))
        correction = float(r["actual"]) - float(hist_mean if hist_mean is not None else r["actual"])
        ranked.append((dist, correction, r))
    ranked.sort(key=lambda x: x[0])
    chosen = ranked[:k]
    if not chosen or current_mean is None:
        return {"available": False, "samples": len(rows)}
    weights = [1 / max(0.15, d) for d, _, _ in chosen]
    correction = sum(w * c for w, (_, c, _) in zip(weights, chosen)) / sum(weights)
    return {
        "available": True,
        "neighbors": len(chosen),
        "mean_distance": _mean([d for d, _, _ in chosen]),
        "correction": correction,
        "prediction": current_mean + correction,
    }


def current_family_values(forecasts: dict[str, Any], target: datetime, var: str = "temperature_2m") -> dict[str, float]:
    model_values: dict[str, float] = {}
    for model, fc in forecasts.items():
        mp = fc.get(var, {})
        key = core.nearest_hour_key(target, mp)
        value = mp.get(key) if key else None
        if core.safe_float(value) is not None:
            model_values[model] = float(value)
    return _family_snapshot(model_values)


def observation_nudge(forecasts: dict[str, Any], obs: dict[str, Any] | None, now: datetime, lead: int) -> dict[str, Any]:
    fam_now = current_family_values(forecasts, now)
    raw_now = _mean(list(fam_now.values()))
    observed = core.safe_float(((obs or {}).get("values") or {}).get("temperature_2m"))
    if raw_now is None or observed is None:
        return {"available": False, "correction": 0.0}
    error = max(-3.0, min(3.0, observed - raw_now))
    decay = math.exp(-max(0, lead) / 4.0)
    return {"available": True, "current_error": error, "decay": decay, "correction": error * decay}


def precipitation_reliability(ledger: list[dict[str, Any]], loc: str, lead: int) -> dict[str, Any]:
    bins = {i: {"n": 0, "wet": 0} for i in range(0, 101, 10)}
    for row in ledger:
        if row.get("loc") != loc or row.get("variable") != "precipitation" or not row.get("scored"):
            continue
        row_lead = int(row.get("lead", -99))
        if abs(row_lead - lead) > max(3, lead // 2):
            continue
        p = core.safe_float(row.get("probability"))
        actual = core.safe_float(row.get("actual"))
        if p is None or actual is None:
            continue
        if p <= 1.0:
            p *= 100
        key = int(max(0, min(100, round(p / 10) * 10)))
        bins[key]["n"] += 1
        bins[key]["wet"] += int(actual >= core.PRECIP_THRESHOLD)
    for key, b in bins.items():
        # Beta prior centred on the nominal probability prevents tiny samples from
        # producing absurd 0/100% corrections.
        prior_strength = 8.0
        nominal = key / 100
        b["calibrated"] = 100 * (b["wet"] + prior_strength * nominal) / (b["n"] + prior_strength)
    return {"bins": bins, "samples": sum(b["n"] for b in bins.values())}


def calibrate_probability(raw: float | None, table: dict[str, Any]) -> float | None:
    if raw is None:
        return None
    p = float(raw) * 100 if raw <= 1 else float(raw)
    key = int(max(0, min(100, round(p / 10) * 10)))
    b = (table.get("bins") or {}).get(key) or (table.get("bins") or {}).get(str(key))
    if not b:
        return max(0.0, min(100.0, p))
    n = int(b.get("n", 0))
    calibrated = core.safe_float(b.get("calibrated"))
    if calibrated is None:
        return max(0.0, min(100.0, p))
    trust = min(0.85, n / 30)
    return max(0.0, min(100.0, p * (1 - trust) + calibrated * trust))


def raw_probability(forecasts: dict[str, Any], target: datetime) -> float | None:
    by_family: dict[str, list[float]] = defaultdict(list)
    for model, fc in forecasts.items():
        mp = fc.get("precipitation_probability", {})
        key = core.nearest_hour_key(target, mp)
        v = core.safe_float(mp.get(key) if key else None)
        if v is not None:
            by_family[_family(model)].append(v * 100 if v <= 1 else v)
    vals = [_mean(x) for x in by_family.values() if x]
    return _mean([x for x in vals if x is not None])


def build_engine_v3(
    v2_engine: dict[str, Any], ledger: list[dict[str, Any]], forecasts: dict[str, Any],
    observations: dict[str, Any], regimes: dict[str, Any]
) -> dict[str, Any]:
    now = core.utcnow().replace(minute=0, second=0, microsecond=0)
    consensus: dict[str, Any] = {}
    diagnostics: dict[str, Any] = {}
    for loc in core.LOCATIONS:
        hours = {}
        loc_diag = {"mos": {}, "analogs": {}, "precip_calibration": {}}
        regime = (regimes.get(loc) or {}).get("name", "unknown")
        for lead in core.LEADS:
            target = now + timedelta(hours=lead)
            rows = _training_groups(ledger, loc, lead)
            fam = current_family_values(forecasts.get(loc, {}), target)
            mos_model = fit_mos(rows)
            mos = predict_mos(mos_model, fam, target)
            analog = analog_predict(rows, fam, target, regime)
            nudge = observation_nudge(forecasts.get(loc, {}), observations.get(loc), now, lead)
            v2h = (((v2_engine.get("consensus") or {}).get(loc) or {}).get("hours") or {}).get(str(lead), {})
            v2temp = core.safe_float(v2h.get("temperature_2m"))
            components = []
            if v2temp is not None:
                components.append((v2temp, 0.58))
            if mos is not None:
                components.append((mos, 0.27 if mos_model.get("samples", 0) >= 24 else 0.18))
            if analog.get("available"):
                components.append((float(analog["prediction"]), 0.15))
            if components:
                den = sum(w for _, w in components)
                temperature = sum(v * w for v, w in components) / den
                if nudge.get("available"):
                    temperature += max(-1.5, min(1.5, float(nudge["correction"]) * 0.65))
            else:
                temperature = None

            reliability = precipitation_reliability(ledger, loc, lead)
            pop_raw = raw_probability(forecasts.get(loc, {}), target)
            pop = calibrate_probability(pop_raw, reliability)
            hours[str(lead)] = {
                "target": core.iso(target),
                "temperature_2m": temperature,
                "precipitation_probability": pop,
                "raw_precipitation_probability": pop_raw,
                "components": {
                    "v2_consensus": v2temp,
                    "mos": mos,
                    "analog": analog.get("prediction") if analog.get("available") else None,
                    "observation_nudge": nudge.get("correction") if nudge.get("available") else None,
                },
                "mos_samples": mos_model.get("samples", 0),
                "mos_training_mae": mos_model.get("training_mae"),
                "analog_neighbors": analog.get("neighbors", 0),
                "analog_distance": analog.get("mean_distance"),
                "precip_calibration_samples": reliability.get("samples", 0),
                "v2_uncertainty": v2h.get("uncertainty"),
            }
            loc_diag["mos"][str(lead)] = {k: v for k, v in mos_model.items() if k != "coefficients"}
            loc_diag["analogs"][str(lead)] = analog
            loc_diag["precip_calibration"][str(lead)] = {"samples": reliability.get("samples", 0)}
        consensus[loc] = {"hours": hours, "regime": regimes.get(loc)}
        diagnostics[loc] = loc_diag
    return {
        "version": "3.0",
        "updated_at": core.iso(core.utcnow()),
        "architecture": {
            "base": "Accuracy Engine 2.0",
            "layers": ["family-aware NWP", "ensemble", "MOS ridge regression", "analog forecast", "observation nudging", "probability calibration"],
            "mos": "online ridge regression from verified targets",
            "analogs": "nearest historical multi-model states with local residual transfer",
            "observation_nudging": "live ECCC model-error correction with 4h exponential decay",
            "probability_calibration": "reliability bins with Bayesian shrinkage",
        },
        "consensus": consensus,
        "diagnostics": diagnostics,
        "source_health": v2_engine.get("source_health", {}),
        "observations": observations,
    }
