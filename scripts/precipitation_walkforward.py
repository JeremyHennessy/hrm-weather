#!/usr/bin/env python3
"""Strict out-of-sample precipitation verification for Accuracy Engine 3.

Replays the currently deployed Bayesian reliability calibration across archived
ledger targets. For every held-out target, the calibration table may use only
strictly earlier scored forecasts. Raw and calibrated probabilities are then
compared with the later ECCC wet/dry outcome using Brier score and reliability.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

import accuracy_engine_v2 as core
import accuracy_engine_v3 as v3

MAX_TARGETS = 240
MIN_TRAIN_TARGETS = 6


def _prob(v: Any) -> float | None:
    p = core.safe_float(v)
    if p is None:
        return None
    if p <= 1.0:
        p *= 100.0
    return max(0.0, min(100.0, p))


def _family_probability(rows: list[dict[str, Any]]) -> float | None:
    by_family: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        p = _prob(row.get("probability"))
        if p is None:
            continue
        family = str(row.get("family") or row.get("model") or "unknown")
        by_family[family].append(p)
    family_means = [sum(vals) / len(vals) for vals in by_family.values() if vals]
    return sum(family_means) / len(family_means) if family_means else None


def _target_groups(ledger: list[dict[str, Any]], loc: str, lead: int) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in ledger:
        if row.get("loc") != loc or row.get("variable") != "precipitation" or not row.get("scored"):
            continue
        if int(row.get("lead", -999)) != int(lead):
            continue
        target = str(row.get("target") or "")
        if not target or core.safe_float(row.get("actual")) is None:
            continue
        groups[target].append(row)
    out = []
    for target, rows in groups.items():
        dt = core.parse_stamp(target)
        if not dt:
            continue
        raw = _family_probability(rows)
        actuals = [core.safe_float(r.get("actual")) for r in rows]
        actuals = [x for x in actuals if x is not None]
        if raw is None or not actuals:
            continue
        out.append({"target": target, "dt": dt, "raw": raw, "actual": sum(actuals) / len(actuals), "rows": rows})
    out.sort(key=lambda x: x["dt"])
    return out[-MAX_TARGETS:]


def _brier(prob_pct: float, wet: bool) -> float:
    p = max(0.0, min(1.0, prob_pct / 100.0))
    return (p - (1.0 if wet else 0.0)) ** 2


def _update(stat: dict[str, Any], value: float) -> None:
    n = int(stat.get("n", 0))
    stat["mean"] = (float(stat.get("mean", 0.0)) * n + value) / (n + 1)
    stat["n"] = n + 1


def _reliability_update(bins: dict[str, Any], prob_pct: float, wet: bool) -> None:
    key = str(int(max(0, min(100, round(prob_pct / 10.0) * 10))))
    b = bins.setdefault(key, {"n": 0, "forecast_sum": 0.0, "wet": 0})
    b["n"] += 1
    b["forecast_sum"] += prob_pct / 100.0
    b["wet"] += int(wet)


def _finish_bins(bins: dict[str, Any]) -> tuple[dict[str, Any], float | None]:
    total = sum(int(b.get("n", 0)) for b in bins.values())
    if not total:
        return bins, None
    ece = 0.0
    for b in bins.values():
        n = int(b.get("n", 0))
        if not n:
            continue
        b["forecast_mean"] = float(b["forecast_sum"]) / n
        b["observed_frequency"] = float(b["wet"]) / n
        b["absolute_calibration_error"] = abs(b["forecast_mean"] - b["observed_frequency"])
        ece += (n / total) * b["absolute_calibration_error"]
        b.pop("forecast_sum", None)
    return bins, ece


def evaluate(ledger: list[dict[str, Any]], loc: str, lead: int) -> dict[str, Any]:
    groups = _target_groups(ledger, loc, lead)
    raw_stat: dict[str, Any] = {}
    cal_stat: dict[str, Any] = {}
    raw_bins: dict[str, Any] = {}
    cal_bins: dict[str, Any] = {}
    cases = []
    for idx, held in enumerate(groups):
        prior_groups = groups[:idx]
        if len(prior_groups) < MIN_TRAIN_TARGETS:
            continue
        prior_rows = [row for g in prior_groups for row in g["rows"]]
        table = v3.precipitation_reliability(prior_rows, loc, lead)
        raw = float(held["raw"])
        calibrated = v3.calibrate_probability(raw, table)
        if calibrated is None:
            continue
        wet = float(held["actual"]) >= core.PRECIP_THRESHOLD
        rb = _brier(raw, wet)
        cb = _brier(float(calibrated), wet)
        _update(raw_stat, rb)
        _update(cal_stat, cb)
        _reliability_update(raw_bins, raw, wet)
        _reliability_update(cal_bins, float(calibrated), wet)
        cases.append({
            "target": held["target"],
            "raw_probability": raw,
            "calibrated_probability": float(calibrated),
            "wet": wet,
            "raw_brier": rb,
            "calibrated_brier": cb,
            "training_targets": len(prior_groups),
        })
    raw_bins, raw_ece = _finish_bins(raw_bins)
    cal_bins, cal_ece = _finish_bins(cal_bins)
    raw_brier = raw_stat.get("mean")
    cal_brier = cal_stat.get("mean")
    improvement = None
    if isinstance(raw_brier, (int, float)) and raw_brier > 0 and isinstance(cal_brier, (int, float)):
        improvement = (raw_brier - cal_brier) / raw_brier
    return {
        "targets_available": len(groups),
        "targets_evaluated": int(cal_stat.get("n", 0)),
        "minimum_training_targets": MIN_TRAIN_TARGETS,
        "raw": {"brier": raw_brier, "reliability_ece": raw_ece, "bins": raw_bins},
        "calibrated": {"brier": cal_brier, "reliability_ece": cal_ece, "bins": cal_bins},
        "relative_brier_improvement": improvement,
        "recent_cases": cases[-24:],
    }


def build(ledger: list[dict[str, Any]]) -> dict[str, Any]:
    locations: dict[str, Any] = {}
    total = 0
    for loc in core.LOCATIONS:
        by_lead = {}
        for lead in core.LEADS:
            result = evaluate(ledger, loc, lead)
            total += int(result.get("targets_evaluated", 0))
            by_lead[str(lead)] = result
        locations[loc] = by_lead
    return {
        "mode": "historical-walk-forward-probability",
        "leakage_policy": "strictly-earlier-targets-only",
        "metric": "Brier score + expected calibration error",
        "evaluated_targets": total,
        "locations": locations,
    }
