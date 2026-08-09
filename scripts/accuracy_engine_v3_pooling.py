#!/usr/bin/env python3
"""Lead-aware sample pooling for early Accuracy Engine 3.0 training.

Exact lead-time verification remains the preferred signal, but a new installation
has too few unique atmospheric situations at each exact lead. Pooling adjacent
lead buckets gives MOS/analogs enough independent situations to start learning;
the pool tightens naturally as exact-lead history accumulates.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import accuracy_engine_v2 as core
import accuracy_engine_v3 as v3


def nearby_leads(lead: int) -> set[int]:
    if lead <= 1:
        return {1, 3}
    if lead <= 3:
        return {1, 3, 6}
    if lead <= 6:
        return {3, 6, 12}
    if lead <= 12:
        return {6, 12, 24}
    if lead <= 24:
        return {12, 24, 48}
    if lead <= 48:
        return {24, 48, 72}
    return {48, 72}


def pooled_training_groups(ledger: list[dict[str, Any]], loc: str, lead: int) -> list[dict[str, Any]]:
    allowed = nearby_leads(int(lead))
    groups: dict[str, dict[str, Any]] = {}
    for row in ledger:
        row_lead = int(row.get("lead", -1))
        if row.get("loc") != loc or row_lead not in allowed:
            continue
        if row.get("variable", "temperature_2m") != "temperature_2m" or not row.get("scored"):
            continue
        actual = core.safe_float(row.get("actual")); pred = core.safe_float(row.get("pred"))
        target = str(row.get("target") or ""); model = str(row.get("model") or "")
        if actual is None or pred is None or not target or model.startswith("ensemble:"):
            continue
        # Do not merge forecasts issued at different horizons into one model state.
        key = f"{target}|{row_lead}"
        g = groups.setdefault(key, {"target": target, "lead": row_lead, "actuals": [], "models": {}, "regime": row.get("regime", "unknown")})
        g["actuals"].append(actual); g["models"][model] = pred
    out = []
    for g in groups.values():
        fam = v3._family_snapshot(g["models"]); actual = v3._mean(g["actuals"])
        if actual is None or len(fam) < 2: continue
        dt = core.parse_stamp(g["target"])
        out.append({**g, "families": fam, "actual": actual, "dt": dt})
    out.sort(key=lambda r: r.get("dt") or datetime.min.replace(tzinfo=timezone.utc))
    return out[-360:]


def install() -> None:
    v3._training_groups = pooled_training_groups
