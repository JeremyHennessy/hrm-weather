#!/usr/bin/env python3
"""Hierarchical OOS component weighting for Accuracy Engine 3.

Prospective component skill is now time-decayed from the raw paired shadow
forecasts before falling back to aggregate prospective scores and then strict
historical walk-forward. This keeps the production blend responsive to changing
model behaviour without allowing a few fresh cases to overpower the priors.
"""
from __future__ import annotations
from typing import Any
import accuracy_engine_v2 as core

MIN_WEIGHT_SAMPLES=8
FULL_TRUST_SAMPLES=30
HALF_LIFE_DAYS=21.0
MIN_EFFECTIVE_WEIGHT=4.0


def _prior(mos_ready:bool)->dict[str,float]:
    return {"v2":0.58,"mos":0.27 if mos_ready else 0.18,"analog":0.15}


def _recent(state:dict[str,Any],loc:str,lead:int,regime:str,layer:str)->dict[str,Any]|None:
    now=core.utcnow();num=den=0.0;n=0
    for row in state.get("forecasts",[]):
        if not row.get("scored") or row.get("loc")!=loc or int(row.get("lead",-1))!=int(lead):continue
        if regime not in {"all","unknown"} and row.get("regime")!=regime:continue
        actual=core.safe_float(row.get("actual_temperature"));pred=core.safe_float((row.get("temperature_candidates") or {}).get(layer));issued=core.parse_stamp(row.get("issued"))
        if actual is None or pred is None or not issued:continue
        age=max(0.0,(now-issued).total_seconds()/86400.0);w=0.5**(age/HALF_LIFE_DAYS);num+=abs(pred-actual)*w;den+=w;n+=1
    if n<MIN_WEIGHT_SAMPLES or den<MIN_EFFECTIVE_WEIGHT:return None
    return {"mae":num/den,"n":n,"effective_weight":den,"half_life_days":HALF_LIFE_DAYS,"source":f"prospective-decayed:{regime}"}


def _prospective(state:dict[str,Any],loc:str,lead:int,regime:str,layer:str)->dict[str,Any]|None:
    for suffix in [regime,"all"]:
        recent=_recent(state,loc,lead,suffix,layer)
        if recent:return recent
    scores=state.get("scores",{})
    for suffix in [regime,"all"]:
        s=scores.get(f"{loc}:{lead}:{suffix}:{layer}")
        if s and int(s.get("n",0))>=MIN_WEIGHT_SAMPLES and s.get("mae") is not None:return {**s,"effective_weight":float(s.get("n",0)),"source":f"prospective-aggregate:{suffix}"}
    return None


def _walk(walk:dict[str,Any],loc:str,lead:int,layer:str)->dict[str,Any]|None:
    s=((((walk.get("locations") or {}).get(loc) or {}).get(str(lead)) or {}).get("scores") or {}).get(layer)
    if s and int(s.get("n",0))>=MIN_WEIGHT_SAMPLES and s.get("mae") is not None:return {**s,"effective_weight":float(s.get("n",0)),"source":"historical-walk-forward"}
    return None


def _stat(state:dict[str,Any],walk:dict[str,Any],loc:str,lead:int,regime:str,layer:str)->dict[str,Any]|None:
    return _prospective(state,loc,lead,regime,layer) or _walk(walk,loc,lead,layer)


def component_weights(state:dict[str,Any],walk:dict[str,Any],loc:str,lead:int,regime:str,available:set[str],mos_ready:bool,gates:dict[str,dict[str,Any]])->dict[str,Any]:
    pri=_prior(mos_ready);pri={k:v for k,v in pri.items() if k in available};pden=sum(pri.values()) or 1.0;prior_norm={k:v/pden for k,v in pri.items()}
    stats={k:_stat(state,walk,loc,lead,regime,k) for k in available};base=stats.get("v2")
    if not base or base.get("mae") is None:return {"weights":prior_norm,"source":"production-prior","trust":0.0,"samples":0,"effective_samples":0.0,"stats":stats}
    base_mae=max(0.05,float(base["mae"]));raw={};sample_counts=[];effective_counts=[]
    for k in available:
        s=stats.get(k);ratio=1.0
        if s and s.get("mae") is not None:
            ratio=max(0.50,min(1.75,base_mae/max(0.05,float(s["mae"]))))
            sample_counts.append(int(s.get("n",0)));effective_counts.append(float(s.get("effective_weight",s.get("n",0))))
        if k in gates:
            cap=float((gates[k] or {}).get("max_boost",1.0));ratio=min(ratio,cap)
        raw[k]=prior_norm.get(k,0.0)*ratio
    rden=sum(raw.values()) or 1.0;learned={k:v/rden for k,v in raw.items()};n=min(sample_counts) if sample_counts else 0;effective=min(effective_counts) if effective_counts else 0.0
    trust=max(0.0,min(1.0,(effective-MIN_EFFECTIVE_WEIGHT)/(FULL_TRUST_SAMPLES-MIN_EFFECTIVE_WEIGHT)))
    blended={k:prior_norm[k]*(1-trust)+learned[k]*trust for k in prior_norm};bden=sum(blended.values()) or 1.0;blended={k:v/bden for k,v in blended.items()};sources=sorted({str(s.get("source")) for s in stats.values() if s})
    return {"weights":blended,"prior":prior_norm,"learned_target":learned,"source":" + ".join(sources) if sources else "production-prior","trust":trust,"samples":n,"effective_samples":effective,"time_decay_half_life_days":HALF_LIFE_DAYS,"stats":stats}
