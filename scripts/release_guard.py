#!/usr/bin/env python3
"""Release skill guard for Weather Consensus.

Fails a release when the deployed Engine 3 structure is invalid or when enough
prospective evidence shows the active production forecast is materially worse
than the V2 baseline. If Engine 3.1 has already activated an evidence-backed V2
safety fallback for the same location/lead, the degradation is considered
mitigated rather than blocking the release.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

STABLE_BRANCH = "stable-v52-confidence-lock"
MIN_SAMPLES = 12
RELATIVE_DEGRADATION = 0.20
ABSOLUTE_DEGRADATION_C = 0.25


def load(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text())


def _mitigated(engine:dict[str,Any],loc:str,lead:str)->bool:
    s=((((engine.get('engine31') or {}).get('safety_fallbacks') or {}).get(loc) or {}).get(str(lead)) or {})
    h=(((((engine.get('consensus') or {}).get(loc) or {}).get('hours') or {}).get(str(lead))) or {})
    return bool(s.get('active')) and h.get('production_safety_fallback')=='v2'


def prospective_failures(engine: dict[str, Any]) -> list[dict[str, Any]]:
    scores = ((engine.get("verification") or {}).get("scores") or {})
    failures = []
    for key, v3s in scores.items():
        if not key.endswith(":final_v3") or ":all:final_v3" not in key:
            continue
        parts=key.split(':')
        if len(parts)<4:continue
        loc,lead=parts[0],parts[1]
        prefix = key[: -len(":final_v3")]
        v2s = scores.get(prefix + ":v2") or {}
        n = min(int(v3s.get("n", 0)), int(v2s.get("n", 0)))
        if n < MIN_SAMPLES:
            continue
        v3_mae = v3s.get("mae");v2_mae = v2s.get("mae")
        if not isinstance(v3_mae, (int, float)) or not isinstance(v2_mae, (int, float)):
            continue
        rel = (v3_mae - v2_mae) / max(0.05, v2_mae);absolute = v3_mae - v2_mae
        if rel > RELATIVE_DEGRADATION and absolute > ABSOLUTE_DEGRADATION_C:
            if _mitigated(engine,loc,lead):continue
            failures.append({"key": key, "samples": n, "v3_mae": v3_mae, "v2_mae": v2_mae, "relative_degradation": rel})
    return failures


def structural_failures(engine: dict[str, Any], shadow: dict[str, Any]) -> list[str]:
    problems = []
    if engine.get("version") != "3.0": problems.append("Engine 3 version missing")
    if ((engine.get("forecast_confidence") or {}).get("owner")) != "accuracy-engine-3": problems.append("Forecast Confidence is not Engine-3-owned")
    if ((engine.get("walk_forward_verification") or {}).get("leakage_policy")) != "strictly-earlier-targets-only": problems.append("temperature walk-forward leakage guard missing")
    if ((engine.get("precipitation_walk_forward") or {}).get("leakage_policy")) != "strictly-earlier-targets-only": problems.append("precipitation walk-forward leakage guard missing")
    if ((engine.get("real_feel") or {}).get("forecast_points_ready", 0)) < len(engine.get("consensus") or {}): problems.append("Real Feel not published for every location")
    if "confidence_scores" not in shadow: problems.append("confidence reliability store missing")
    return problems


def main() -> int:
    engine = load("data/engine-v3.json");shadow = load("data/v3-verification.json")
    structural = structural_failures(engine, shadow);skill = prospective_failures(engine)
    report = {
        "status": "fail" if structural or skill else "pass",
        "stable_recovery_branch": STABLE_BRANCH,
        "minimum_samples": MIN_SAMPLES,
        "relative_degradation_limit": RELATIVE_DEGRADATION,
        "absolute_degradation_limit_c": ABSOLUTE_DEGRADATION_C,
        "structural_failures": structural,
        "skill_failures": skill,
        "mitigation_policy":"material V3 degradation is acceptable only when the current published point is explicitly falling back to V2"
    }
    Path("release-guard-report.json").write_text(json.dumps(report, indent=2) + "\n");print(json.dumps(report, indent=2))
    if structural or skill:
        print(f"RELEASE BLOCKED. Recovery target: {STABLE_BRANCH}");return 1
    print(f"Release guard passed. Recovery target remains {STABLE_BRANCH}");return 0


if __name__ == "__main__":
    raise SystemExit(main())
