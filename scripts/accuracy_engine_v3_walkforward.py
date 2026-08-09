#!/usr/bin/env python3
"""Historical walk-forward verification for Accuracy Engine 3.

This module complements the prospective shadow verifier. For every historical
forecast situation it trains only on strictly earlier situations, predicts the
held-out target, and accumulates out-of-sample MAE/bias for reconstructed V2,
MOS, analog, and a reconstructed V3 blend. No held-out target is allowed into
its own training set.
"""
from __future__ import annotations

from typing import Any

import accuracy_engine_v2 as core
import accuracy_engine_v3 as v3

MIN_MOS_TRAIN = 12
MIN_ANALOG_TRAIN = 8
MAX_CASES = 180


def _update(stat: dict[str, Any], error: float) -> None:
    n = int(stat.get("n", 0))
    stat["mae"] = (float(stat.get("mae", 0.0)) * n + abs(error)) / (n + 1)
    stat["bias"] = (float(stat.get("bias", 0.0)) * n + error) / (n + 1)
    stat["rmse"] = ((float(stat.get("rmse", 0.0)) ** 2 * n + error * error) / (n + 1)) ** 0.5
    stat["n"] = n + 1


def _v2_proxy(row: dict[str, Any]) -> float | None:
    vals = [core.safe_float(x) for x in (row.get("families") or {}).values()]
    vals = [x for x in vals if x is not None]
    return sum(vals) / len(vals) if vals else None


def evaluate_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    rows = sorted(rows, key=lambda r: r.get("dt") or core.utcnow())[-MAX_CASES:]
    stats: dict[str, dict[str, Any]] = {k: {} for k in ["v2", "mos", "analog", "v3_reconstructed"]}
    evaluated = 0
    for row in rows:
        actual = core.safe_float(row.get("actual"))
        fam = row.get("families") or {}
        dt = row.get("dt")
        if actual is None or not dt or len(fam) < 2:
            continue
        # Strict leakage barrier: pooled forecasts for the same target timestamp
        # are never allowed into the held-out case's training set.
        prior = [r for r in rows if r.get("dt") is not None and r.get("dt") < dt]

        v2p = _v2_proxy(row)
        if v2p is not None:
            _update(stats["v2"], v2p - actual)

        mos = None
        mos_model = v3.fit_mos(prior) if len(prior) >= MIN_MOS_TRAIN else {"available": False}
        if mos_model.get("available"):
            mos = v3.predict_mos(mos_model, fam, dt)
            if mos is not None:
                _update(stats["mos"], mos - actual)

        analog = None
        if len(prior) >= MIN_ANALOG_TRAIN:
            a = v3.analog_predict(prior, fam, dt, str(row.get("regime", "unknown")))
            if a.get("available"):
                analog = core.safe_float(a.get("prediction"))
                if analog is not None:
                    _update(stats["analog"], analog - actual)

        weighted = []
        if v2p is not None:
            weighted.append((v2p, 0.58))
        if mos is not None:
            weighted.append((mos, 0.27 if len(prior) >= 24 else 0.18))
        if analog is not None:
            weighted.append((analog, 0.15))
        if weighted:
            den = sum(w for _, w in weighted)
            v3p = sum(v * w for v, w in weighted) / den
            _update(stats["v3_reconstructed"], v3p - actual)
        evaluated += 1

    clean = {}
    for name, s in stats.items():
        clean[name] = {
            "n": int(s.get("n", 0)),
            "mae": s.get("mae"),
            "bias": s.get("bias"),
            "rmse": s.get("rmse"),
        }
    return {"cases_seen": len(rows), "cases_evaluated": evaluated, "scores": clean}


def build(ledger: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "mode": "historical-walk-forward",
        "leakage_policy": "strictly-earlier-targets-only",
        "note": "V2/V3 are reconstructed from archived family states; prospective shadow verification remains authoritative for the deployed final blend and observation nudge.",
        "locations": {},
    }
    for loc in core.LOCATIONS:
        loc_out = {}
        for lead in core.LEADS:
            rows = v3._training_groups(ledger, loc, lead)
            loc_out[str(lead)] = evaluate_rows(rows)
        out["locations"][loc] = loc_out
    return out
