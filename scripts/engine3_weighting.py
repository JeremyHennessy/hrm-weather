#!/usr/bin/env python3
"""Hierarchical OOS component weighting for Accuracy Engine 3.

Weights are learned from prospective location/lead/regime skill when mature,
otherwise from strict historical walk-forward location/lead skill. Estimates are
shrunk toward the production priors until sample size is substantial and are
bounded by champion/challenger decisions.
"""
from __future__ import annotations
from typing import Any

MIN_WEIGHT_SAMPLES=8
FULL_TRUST_SAMPLES=30


def _prior(mos_ready:bool)->dict[str,float]:
    return {"v2":0.58,"mos":0.27 if mos_ready else 0.18,"analog":0.15}


def _prospective(state:dict[str,Any],loc:str,lead:int,regime:str,layer:str)->dict[str,Any]|None:
    scores=state.get("scores",{})
    for suffix in [regime,"all"]:
        s=scores.get(f"{loc}:{lead}:{suffix}:{layer}")
        if s and int(s.get("n",0))>=MIN_WEIGHT_SAMPLES and s.get("mae") is not None:
            return {**s,"source":f"prospective:{suffix}"}
    return None


def _walk(walk:dict[str,Any],loc:str,lead:int,layer:str)->dict[str,Any]|None:
    s=((((walk.get("locations") or {}).get(loc) or {}).get(str(lead)) or {}).get("scores") or {}).get(layer)
    if s and int(s.get("n",0))>=MIN_WEIGHT_SAMPLES and s.get("mae") is not None:return {**s,"source":"historical-walk-forward"}
    return None


def _stat(state:dict[str,Any],walk:dict[str,Any],loc:str,lead:int,regime:str,layer:str)->dict[str,Any]|None:
    p=_prospective(state,loc,lead,regime,layer)
    return p or _walk(walk,loc,lead,layer)


def component_weights(state:dict[str,Any],walk:dict[str,Any],loc:str,lead:int,regime:str,available:set[str],mos_ready:bool,gates:dict[str,dict[str,Any]])->dict[str,Any]:
    pri=_prior(mos_ready);pri={k:v for k,v in pri.items() if k in available}
    pden=sum(pri.values()) or 1.0;prior_norm={k:v/pden for k,v in pri.items()}
    stats={k:_stat(state,walk,loc,lead,regime,k if k!="v2" else "v2") for k in available}
    base=stats.get("v2")
    if not base or base.get("mae") is None:
        return {"weights":prior_norm,"source":"production-prior","trust":0.0,"samples":0,"stats":stats}
    base_mae=max(0.05,float(base["mae"]));raw={};sample_counts=[]
    for k in available:
        s=stats.get(k)
        ratio=1.0
        if s and s.get("mae") is not None:
            ratio=max(0.40,min(2.0,base_mae/max(0.05,float(s["mae"]))))
            sample_counts.append(int(s.get("n",0)))
        if k in gates:
            cap=float((gates[k] or {}).get("max_boost",1.0));ratio=min(ratio,cap)
        raw[k]=prior_norm.get(k,0.0)*ratio
    rden=sum(raw.values()) or 1.0;learned={k:v/rden for k,v in raw.items()};n=min(sample_counts) if sample_counts else 0;trust=max(0.0,min(1.0,(n-MIN_WEIGHT_SAMPLES+1)/(FULL_TRUST_SAMPLES-MIN_WEIGHT_SAMPLES+1)))
    blended={k:prior_norm[k]*(1-trust)+learned[k]*trust for k in prior_norm};bden=sum(blended.values()) or 1.0;blended={k:v/bden for k,v in blended.items()}
    sources=sorted({str(s.get("source")) for s in stats.values() if s})
    return {"weights":blended,"prior":prior_norm,"learned_target":learned,"source":" + ".join(sources) if sources else "production-prior","trust":trust,"samples":n,"stats":stats}
