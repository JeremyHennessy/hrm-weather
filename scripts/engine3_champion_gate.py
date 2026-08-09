#!/usr/bin/env python3
"""Champion/challenger promotion gates for Accuracy Engine 3.

Promotion is based on paired prospective out-of-sample cases whenever possible:
the challenger and champion must have been issued for the same target and scored
against the same observation. Recent cases are time-decayed so stale wins cannot
keep a layer promoted indefinitely. Historical walk-forward remains a conservative
fallback for MOS/analog while prospective evidence accumulates.
"""
from __future__ import annotations
from typing import Any
import accuracy_engine_v2 as core

MIN_PROMOTION_SAMPLES = 12
PROMOTION_MARGIN = 0.02
DEMOTION_MARGIN = 0.05
MIN_PROMOTION_WIN_RATE = 0.55
MAX_DEMOTION_WIN_RATE = 0.45
HALF_LIFE_DAYS = 21.0
MIN_EFFECTIVE_WEIGHT = 7.0


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
        return {"status":"challenger-underperforming","samples":n,"challenger_mae":cm,"champion_mae":bm,"skill_ratio":ratio,"max_boost":0.85,"source":source}
    return {"status":"neutral","samples":n,"challenger_mae":cm,"champion_mae":bm,"skill_ratio":ratio,"max_boost":1.0,"source":source}


def _paired_temperature(state:dict[str,Any],loc:str,lead:int,regime:str,challenger:str,champion:str="v2")->dict[str,Any]|None:
    now=core.utcnow();cnum=bnum=den=wins=0.0;n=0
    for row in state.get("forecasts",[]):
        if not row.get("scored") or row.get("loc")!=loc or int(row.get("lead",-1))!=int(lead):continue
        if regime not in {"all","unknown"} and row.get("regime")!=regime:continue
        actual=core.safe_float(row.get("actual_temperature"));issued=core.parse_stamp(row.get("issued"));cand=row.get("temperature_candidates") or {}
        c=core.safe_float(cand.get(challenger));b=core.safe_float(cand.get(champion))
        if actual is None or c is None or b is None or not issued:continue
        age=max(0.0,(now-issued).total_seconds()/86400.0);w=0.5**(age/HALF_LIFE_DAYS);ce=abs(c-actual);be=abs(b-actual)
        cnum+=ce*w;bnum+=be*w;wins+=(1.0 if ce<be else 0.5 if ce==be else 0.0)*w;den+=w;n+=1
    if not den:return None
    return {"n":n,"effective_weight":den,"challenger_mae":cnum/den,"champion_mae":bnum/den,"win_rate":wins/den,"half_life_days":HALF_LIFE_DAYS}


def _paired_decision(stat:dict[str,Any]|None,source:str)->dict[str,Any]|None:
    if not stat:return None
    n=int(stat.get("n",0));eff=float(stat.get("effective_weight",0.0));cm=float(stat["challenger_mae"]);bm=max(0.05,float(stat["champion_mae"]));ratio=cm/bm;win=float(stat.get("win_rate",0.5))
    base={"samples":n,"effective_weight":eff,"challenger_mae":cm,"champion_mae":bm,"skill_ratio":ratio,"paired_win_rate":win,"max_boost":1.0,"source":source,"half_life_days":HALF_LIFE_DAYS}
    if n<MIN_PROMOTION_SAMPLES or eff<MIN_EFFECTIVE_WEIGHT:return {**base,"status":"learning"}
    if ratio<=1.0-PROMOTION_MARGIN and win>=MIN_PROMOTION_WIN_RATE:return {**base,"status":"promotion-approved","max_boost":1.25}
    if ratio>=1.0+DEMOTION_MARGIN and win<=MAX_DEMOTION_WIN_RATE:return {**base,"status":"challenger-underperforming","max_boost":0.85}
    return {**base,"status":"neutral"}


def component_gate(state: dict[str, Any], walk: dict[str, Any], loc: str, lead: int, regime: str, layer: str) -> dict[str, Any]:
    for suffix in [regime,"all"]:
        d=_paired_decision(_paired_temperature(state,loc,lead,suffix,layer,"v2"),f"prospective-paired-decayed:{suffix}")
        if d and d.get("status")!="learning":return d
        if d and int(d.get("samples",0))>=MIN_PROMOTION_SAMPLES and float(d.get("effective_weight",0))>=MIN_EFFECTIVE_WEIGHT:return d
    if layer in {"mos","analog"}:
        wf=(((walk.get("locations") or {}).get(loc) or {}).get(str(lead)) or {}).get("scores") or {}
        d=_decision(wf.get(layer),wf.get("v2"),"historical-walk-forward")
        if d:return d
    return {"status":"learning","samples":0,"max_boost":1.0,"source":"insufficient-paired-oos-evidence"}


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
