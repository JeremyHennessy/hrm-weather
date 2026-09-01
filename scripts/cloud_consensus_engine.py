#!/usr/bin/env python3
"""Family-aware cloud/sky consensus for Weather Consensus.

Uses cloud_cover already collected per deterministic model by solar_context_v2.
It does not change temperature, Real Feel, precipitation, or model-family weights.
"""
from __future__ import annotations
import statistics
from typing import Any
import accuracy_engine_v2 as core
import accuracy_engine_v3 as v3

VERSION="1.1"


def classify_cloud(cloud_cover:float|None)->str|None:
    c=core.safe_float(cloud_cover)
    if c is None:return None
    if c<=18:return "sunny"
    if c<=42:return "mostly-sunny"
    if c<=68:return "partly-cloudy"
    if c<=88:return "mostly-cloudy"
    return "cloudy"


def cloud_consensus(forecasts:dict[str,Any],target)->dict[str,Any]:
    families=v3.current_family_values(forecasts,target,var="cloud_cover")
    vals=[]
    for value in families.values():
        x=core.safe_float(value)
        if x is not None:vals.append(max(0.0,min(100.0,float(x))))
    if not vals:return {"available":False,"version":VERSION,"role":"family-aware-cloud-consensus","reason":"no-cloud-model-values"}
    mean=sum(vals)/len(vals);spread=statistics.pstdev(vals) if len(vals)>1 else 0.0
    return {"available":True,"version":VERSION,"role":"family-aware-cloud-consensus","cloud_cover":mean,"family_spread":spread,"independent_families":len(vals),"sky_condition":classify_cloud(mean),"family_values":families,"calibration_status":"family-consensus; direct observed cloud truth not yet available"}


def apply(engine:dict[str,Any],forecasts:dict[str,Any])->dict[str,Any]:
    ready=0;by_location={}
    for loc,payload in (engine.get("consensus") or {}).items():
        loc_diag={}
        for lead_s,hour in (payload.get("hours") or {}).items():
            target=core.parse_stamp(hour.get("target"))
            if not target:continue
            result=cloud_consensus(forecasts.get(loc,{}) or {},target);hour["cloud_consensus"]=result
            if result.get("available"):
                hour["cloud_cover"]=result.get("cloud_cover");hour["cloud_cover_spread"]=result.get("family_spread");hour["cloud_independent_families"]=result.get("independent_families");hour["sky_condition"]=result.get("sky_condition");ready+=1
            loc_diag[lead_s]={k:v for k,v in result.items() if k!="family_values"}
        by_location[loc]=loc_diag
    engine["cloud_sky"]={"version":VERSION,"owner":"accuracy-engine-3-family-cloud-consensus","status":"production-dry-sky-classifier","forecast_points_ready":ready,"thresholds_pct":{"sunny":18,"mostly_sunny":42,"partly_cloudy":68,"mostly_cloudy":88},"wet_weather_policy":"client preserves rain/snow/fog/storm weather types; cloud consensus only resolves dry-sky sunny/partly/cloudy states","verification_policy":"no direct observed cloud truth synthesized; condition accuracy is regression-tested separately from temperature and precipitation" ,"locations":by_location}
    return engine
