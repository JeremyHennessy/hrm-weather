#!/usr/bin/env python3
"""Champion/challenger promotion gates for Accuracy Engine 3.

A challenger may be damped when evidence shows it is worse, but it may not receive
an above-baseline weight boost until it has enough genuinely out-of-sample cases
and beats the production baseline by a meaningful margin.
"""
from __future__ import annotations
from typing import Any

MIN_PROMOTION_SAMPLES = 12
PROMOTION_MARGIN = 0.02
DEMOTION_MARGIN = 0.05


def _decision(challenger: dict[str, Any] | None, champion: dict[str, Any] | None, source: str) -> dict[str, Any] | None:
    if not challenger or not champion:return None
    n=min(int(challenger.get("n",0)),int(champion.get("n",0)))
    cm=challenger.get("mae");bm=champion.get("mae")
    if cm is None or bm is None:return None
    cm=float(cm);bm=max(0.05,float(bm))
    if n<MIN_PROMOTION_SAMPLES:
        return {"status":"learning","samples":n,"challenger_mae":cm,"champion_mae":bm,"max_boost":1.0,"source":source}
    ratio=cm/bm
    if ratio <= 1.0-PROMOTION_MARGIN:
        return {"status":"promotion-approved","samples":n,"challenger_mae":cm,"champion_mae":bm,"skill_ratio":ratio,"max_boost":1.25,"source":source}
    if ratio >= 1.0+DEMOTION_MARGIN:
        # No positive promotion and make downstream weighting eligible for damping.
        return {"status":"challenger-underperforming","samples":n,"challenger_mae":cm,"champion_mae":bm,"skill_ratio":ratio,"max_boost":0.85,"source":source}
    return {"status":"neutral","samples":n,"challenger_mae":cm,"champion_mae":bm,"skill_ratio":ratio,"max_boost":1.0,"source":source}


def component_gate(state: dict[str, Any], walk: dict[str, Any], loc: str, lead: int, regime: str, layer: str) -> dict[str, Any]:
    scores=state.get("scores",{})
    for suffix in [regime,"all"]:
        d=_decision(scores.get(f"{loc}:{lead}:{suffix}:{layer}"),scores.get(f"{loc}:{lead}:{suffix}:v2"),"prospective-shadow")
        if d and int(d.get("samples",0))>=MIN_PROMOTION_SAMPLES:return d
    # Historical walk-forward can authorize MOS/analog promotion while the exact
    # prospective deployed blend is still accumulating, but never nudge because
    # observation nudging is not reconstructed historically.
    if layer in {"mos","analog"}:
        wf=(((walk.get("locations") or {}).get(loc) or {}).get(str(lead)) or {}).get("scores") or {}
        d=_decision(wf.get(layer),wf.get("v2"),"historical-walk-forward")
        if d:return d
    return {"status":"learning","samples":0,"max_boost":1.0,"source":"insufficient-oos-evidence"}


def real_feel_gate(state: dict[str, Any], loc: str, lead: int, regime: str) -> dict[str, Any]:
    scores=state.get("real_feel_scores",{})
    for suffix in [regime,"all"]:
        cal=scores.get(f"{loc}:{lead}:{suffix}:calibrated");physical=scores.get(f"{loc}:{lead}:{suffix}:physical")
        d=_decision(cal,physical,"prospective-real-feel")
        if d:return d
    return {"status":"learning","samples":0,"max_boost":1.0,"source":"prospective-real-feel"}


def apply_cap(skill: dict[str, Any], gate: dict[str, Any]) -> dict[str, Any]:
    out=dict(skill);raw=float(out.get("factor",1.0));cap=float(gate.get("max_boost",1.0))
    out["raw_factor"]=raw;out["factor"]=min(raw,cap);out["champion_gate"]=gate
    if cap<1.0:out["factor"]=min(out["factor"],cap)
    return out
