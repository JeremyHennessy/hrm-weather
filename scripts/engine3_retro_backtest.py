#!/usr/bin/env python3
"""Readable strict hindcast report for the current Weather Consensus architecture.

Replays archived temperature forecast states with a strict time arrow: MOS and
analog layers may train only on targets earlier than the held-out target. The
report covers the most recent requested window available in the ledger and
compares V2 family consensus, MOS, analog, and reconstructed Engine 3 against
actual ECCC observations.

This is intentionally a reconstructed Engine 3 temperature hindcast. Live
observation nudge, future champion-gate decisions, and future-learned weights are
not smuggled backward in time, because doing that would leak the answers.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import timedelta
from pathlib import Path
from typing import Any

import accuracy_engine_v2 as core
import accuracy_engine_v3 as v3

OUT = core.DATA / "backtest-v3.json"
REQUESTED_DAYS = 28
MIN_MOS_TRAIN = 12
MIN_ANALOG_TRAIN = 8


def _v2_proxy(row: dict[str, Any]) -> float | None:
    vals = [core.safe_float(x) for x in (row.get("families") or {}).values()]
    vals = [x for x in vals if x is not None]
    return sum(vals) / len(vals) if vals else None


def _update(s: dict[str, Any], pred: float, actual: float) -> None:
    err = pred - actual
    n = int(s.get("n", 0))
    s["mae"] = (float(s.get("mae", 0.0)) * n + abs(err)) / (n + 1)
    s["mse"] = (float(s.get("mse", 0.0)) * n + err * err) / (n + 1)
    s["bias"] = (float(s.get("bias", 0.0)) * n + err) / (n + 1)
    s["within_1c"] = int(s.get("within_1c", 0)) + int(abs(err) <= 1.0)
    s["within_2c"] = int(s.get("within_2c", 0)) + int(abs(err) <= 2.0)
    s["n"] = n + 1


def _finish(s: dict[str, Any]) -> dict[str, Any]:
    n = int(s.get("n", 0))
    return {
        "n": n,
        "mae": s.get("mae"),
        "rmse": (float(s.get("mse", 0.0)) ** 0.5) if n else None,
        "bias": s.get("bias"),
        "within_1c": (int(s.get("within_1c", 0)) / n) if n else None,
        "within_2c": (int(s.get("within_2c", 0)) / n) if n else None,
    }


def evaluate_rows(rows: list[dict[str, Any]], cutoff) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    rows = sorted(rows, key=lambda r: r.get("dt") or core.utcnow())
    stats = {k: {} for k in ["v2", "mos", "analog", "engine3_reconstructed"]}
    cases = []
    for row in rows:
        dt = row.get("dt")
        actual = core.safe_float(row.get("actual"))
        fam = row.get("families") or {}
        if not dt or actual is None or len(fam) < 2 or dt < cutoff:
            continue
        prior = [r for r in rows if r.get("dt") is not None and r.get("dt") < dt]
        v2p = _v2_proxy(row)
        mos = None
        analog = None
        if v2p is not None:
            _update(stats["v2"], v2p, actual)
        if len(prior) >= MIN_MOS_TRAIN:
            model = v3.fit_mos(prior)
            if model.get("available"):
                mos = v3.predict_mos(model, fam, dt)
                if mos is not None:
                    _update(stats["mos"], mos, actual)
        if len(prior) >= MIN_ANALOG_TRAIN:
            a = v3.analog_predict(prior, fam, dt, str(row.get("regime", "unknown")))
            if a.get("available"):
                analog = core.safe_float(a.get("prediction"))
                if analog is not None:
                    _update(stats["analog"], analog, actual)
        weighted = []
        if v2p is not None: weighted.append((v2p, 0.58))
        if mos is not None: weighted.append((mos, 0.27 if len(prior) >= 24 else 0.18))
        if analog is not None: weighted.append((analog, 0.15))
        final = None
        if weighted:
            den = sum(w for _, w in weighted)
            final = sum(v * w for v, w in weighted) / den
            _update(stats["engine3_reconstructed"], final, actual)
        cases.append({
            "target": core.iso(dt),
            "actual": actual,
            "v2": v2p,
            "mos": mos,
            "analog": analog,
            "engine3_reconstructed": final,
            "training_cases": len(prior),
        })
    return {k: _finish(v) for k, v in stats.items()}, cases


def aggregate(per_location: dict[str, Any]) -> dict[str, Any]:
    sums: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for loc in per_location.values():
        for lead in loc.get("leads", {}).values():
            for name, s in lead.get("scores", {}).items():
                n = int(s.get("n", 0))
                if not n: continue
                sums[name]["n"] += n
                sums[name]["abs"] += float(s.get("mae") or 0) * n
                sums[name]["sq"] += float(s.get("rmse") or 0) ** 2 * n
                sums[name]["bias"] += float(s.get("bias") or 0) * n
                sums[name]["w1"] += float(s.get("within_1c") or 0) * n
                sums[name]["w2"] += float(s.get("within_2c") or 0) * n
    out = {}
    for name, x in sums.items():
        n = int(x["n"])
        out[name] = {
            "n": n,
            "mae": x["abs"] / n,
            "rmse": (x["sq"] / n) ** 0.5,
            "bias": x["bias"] / n,
            "within_1c": x["w1"] / n,
            "within_2c": x["w2"] / n,
        }
    return out


def main() -> None:
    ledger = core.load(core.LEDGER, [])
    all_dts = []
    for loc in core.LOCATIONS:
        for lead in core.LEADS:
            all_dts.extend(r.get("dt") for r in v3._training_groups(ledger, loc, lead) if r.get("dt"))
    if not all_dts:
        raise SystemExit("No scored temperature history available")
    max_dt = max(all_dts)
    min_dt = min(all_dts)
    cutoff = max_dt - timedelta(days=REQUESTED_DAYS)
    per_location = {}
    for loc in core.LOCATIONS:
        leads = {}
        for lead in core.LEADS:
            rows = v3._training_groups(ledger, loc, lead)
            scores, cases = evaluate_rows(rows, cutoff)
            leads[str(lead)] = {"scores": scores, "cases": cases[-48:]}
        per_location[loc] = {"leads": leads}
    overall = aggregate(per_location)
    v2_mae = (overall.get("v2") or {}).get("mae")
    v3_mae = (overall.get("engine3_reconstructed") or {}).get("mae")
    improvement = None
    if isinstance(v2_mae, (int, float)) and v2_mae > 0 and isinstance(v3_mae, (int, float)):
        improvement = (v2_mae - v3_mae) / v2_mae
    report = {
        "version": "1.0",
        "method": "strict causal reconstructed Engine 3 hindcast",
        "requested_days": REQUESTED_DAYS,
        "history_available_start": core.iso(min_dt),
        "history_available_end": core.iso(max_dt),
        "evaluated_window_start": core.iso(max(cutoff, min_dt)),
        "evaluated_window_end": core.iso(max_dt),
        "available_span_days": (max_dt - min_dt).total_seconds() / 86400.0,
        "leakage_policy": "strictly-earlier-targets-only",
        "limitations": [
            "reconstructed Engine 3 excludes live observation nudge because historical issue-time observations are incomplete",
            "champion/challenger and learned production weights are not back-propagated from future evidence",
            "prospective shadow verification remains authoritative for the exact deployed final blend",
        ],
        "overall": overall,
        "engine3_vs_v2_mae_improvement": improvement,
        "locations": per_location,
    }
    OUT.write_text(json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n")
    print(json.dumps({
        "span_days": report["available_span_days"],
        "window_start": report["evaluated_window_start"],
        "window_end": report["evaluated_window_end"],
        "overall": overall,
        "engine3_vs_v2_mae_improvement": improvement,
    }, indent=2))


if __name__ == "__main__":
    main()
