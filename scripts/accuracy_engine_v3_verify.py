#!/usr/bin/env python3
"""Prospective shadow verification for Accuracy Engine 3.0.

Forecast variables are scored independently against the nearest archived official
observation at the forecast target time.  The target-time archive is authoritative;
the latest observation is only a bounded compatibility fallback and never receives
the former multi-hour acceptance window.
"""
from __future__ import annotations
from datetime import timedelta
from typing import Any
import accuracy_engine_v2 as core
import real_feel_engine as rf
import target_truth_archive as truth

VERIFY=core.DATA/"v3-verification.json"
MAX_AGE_DAYS=60
MIN_ADAPT_SAMPLES=8
TRUTH_MAX_OFFSET_MINUTES=45


def _bucket(lead:int)->int:return int(lead)


def _stat_update(s:dict[str,Any],error:float)->None:
    n=int(s.get("n",0));s["mae"]=(float(s.get("mae",0.0))*n+abs(error))/(n+1);s["bias"]=(float(s.get("bias",0.0))*n+error)/(n+1);s["rmse"] = ((float(s.get("rmse",0.0))**2*n+error*error)/(n+1))**0.5;s["n"]=n+1;s["updated_at"]=core.iso(core.utcnow())


def _brier_update(s:dict[str,Any],probability_pct:float,wet:bool)->None:
    p=max(0.0,min(1.0,probability_pct/100.0));b=(p-(1.0 if wet else 0.0))**2;n=int(s.get("n",0));s["brier"]=(float(s.get("brier",0.0))*n+b)/(n+1);s["n"]=n+1;s["updated_at"]=core.iso(core.utcnow())


def _confidence_bin(value:float)->str:
    lo=int(max(0,min(90,(value//10)*10)));return f"{lo}-{lo+9}"


def _confidence_update(s:dict[str,Any],issued_pct:float,hit:bool)->None:
    n=int(s.get("n",0));hits=int(s.get("hits",0))+int(hit);s["forecast_mean"]=(float(s.get("forecast_mean",0.0))*n+issued_pct/100.0)/(n+1);s["n"]=n+1;s["hits"]=hits;s["hit_rate"]=hits/(n+1);s["calibration_error"]=s["hit_rate"]-s["forecast_mean"];s["updated_at"]=core.iso(core.utcnow())


def _keys(loc:str,lead:int,regime:str,layer:str)->list[str]:
    return [f"{loc}:{_bucket(lead)}:{regime}:{layer}",f"{loc}:{_bucket(lead)}:all:{layer}",f"{loc}:all:all:{layer}"]


def _real_feel_reference_keys(loc:str,lead:int,regime:str,reference:str,candidate:str)->list[str]:
    return [f"{loc}:{_bucket(lead)}:{regime}:{reference}:{candidate}",f"{loc}:{_bucket(lead)}:all:{reference}:{candidate}",f"{loc}:all:all:{reference}:{candidate}"]


def _latest_truth(observations:dict[str,Any],loc:str,target,variable:str)->dict[str,Any]|None:
    """Compatibility fallback: latest obs is accepted only inside the same 45m gate."""
    obs=observations.get(loc) or {};dt=core.parse_stamp(obs.get("time"));value=core.safe_float((obs.get("values") or {}).get(variable))
    if not dt or value is None or not target:return None
    offset=abs((dt-target).total_seconds())/60.0
    if offset>TRUTH_MAX_OFFSET_MINUTES:return None
    return {"value":value,"valid_time":core.iso(dt),"offset_minutes":offset,"provider":obs.get("provider") or ("NWS" if loc=="uws" else "ECCC"),"station":obs.get("station"),"source":"latest-official-compat"}


def _truth_value(archive:dict[str,Any]|None,observations:dict[str,Any],loc:str,target,variable:str)->dict[str,Any]|None:
    hit=truth.nearest_observation(archive or {},loc,target,variable,TRUTH_MAX_OFFSET_MINUTES) if archive else None
    if hit:
        hit=dict(hit);hit["source"]="target-time-archive";return hit
    return _latest_truth(observations,loc,target,variable)


def score_due(state:dict[str,Any],observations:dict[str,Any],archive:dict[str,Any]|None=None)->int:
    now=core.utcnow();scores=state.setdefault("scores",{});precip_scores=state.setdefault("precip_scores",{});reference_scores=state.setdefault("real_feel_reference_scores",{});confidence_scores=state.setdefault("confidence_scores",{});scored=0
    for row in state.setdefault("forecasts",[]):
        if row.get("truth_complete"):continue
        target=core.parse_stamp(row.get("target"))
        if not target or target>now+timedelta(minutes=20):continue
        loc=str(row.get("loc"));lead=int(row.get("lead",-1));regime=str(row.get("regime","unknown"));meta=row.setdefault("truth_variables",{});row_touched=False

        temp_hit=_truth_value(archive,observations,loc,target,"temperature_2m")
        if temp_hit:
            meta["temperature_2m"]={k:temp_hit.get(k) for k in ("valid_time","offset_minutes","provider","station","source")};meta["temperature_2m"]["available"]=True
            actual=core.safe_float(temp_hit.get("value"));row["actual_temperature"]=actual
            if actual is not None and not row.get("temperature_scored"):
                for layer,pred in (row.get("temperature_candidates") or {}).items():
                    p=core.safe_float(pred)
                    if p is None:continue
                    for key in _keys(loc,lead,regime,layer):_stat_update(scores.setdefault(key,{}),p-actual)
                issued_conf=row.get("issued_confidence") or {};conf=core.safe_float(issued_conf.get("value"));tol=core.safe_float(issued_conf.get("tolerance_c"));final=core.safe_float((row.get("temperature_candidates") or {}).get("final_v3"))
                if conf is not None and tol is not None and final is not None:
                    hit=abs(final-actual)<=tol;bin_key=_confidence_bin(conf);_confidence_update(confidence_scores.setdefault(bin_key,{}),conf,hit);row["confidence_hit"]=hit;row["confidence_bin"]=bin_key
                row["temperature_scored"]=True;row["scored"]=True;row_touched=True
        else:meta.setdefault("temperature_2m",{"available":False})

        precip_hit=_truth_value(archive,observations,loc,target,"precipitation")
        if precip_hit:
            meta["precipitation"]={k:precip_hit.get(k) for k in ("valid_time","offset_minutes","provider","station","source")};meta["precipitation"]["available"]=True
            precip_actual=core.safe_float(precip_hit.get("value"));row["actual_precipitation"]=precip_actual
            if precip_actual is not None and not row.get("precipitation_scored"):
                wet=precip_actual>=core.PRECIP_THRESHOLD
                for layer,prob in (row.get("precip_candidates") or {}).items():
                    p=core.safe_float(prob)
                    if p is None:continue
                    for key in _keys(loc,lead,regime,layer):_brier_update(precip_scores.setdefault(key,{}),p,wet)
                row["precipitation_scored"]=True;row_touched=True
        else:meta.setdefault("precipitation",{"available":False})

        rh_hit=_truth_value(archive,observations,loc,target,"relative_humidity_2m");wind_hit=_truth_value(archive,observations,loc,target,"wind_speed_10m");solar_hit=_truth_value(archive,observations,loc,target,"shortwave_radiation")
        for var,hit in (("relative_humidity_2m",rh_hit),("wind_speed_10m",wind_hit),("shortwave_radiation",solar_hit)):
            if hit:
                meta[var]={k:hit.get(k) for k in ("valid_time","offset_minutes","provider","station","source")};meta[var]["available"]=True
            else:meta.setdefault(var,{"available":False})
        actual=core.safe_float(temp_hit.get("value")) if temp_hit else None;rh=core.safe_float(rh_hit.get("value")) if rh_hit else None;wind=core.safe_float(wind_hit.get("value")) if wind_hit else None;solar=core.safe_float(solar_hit.get("value")) if solar_hit else None
        refs=rf.independent_references(actual,rh,wind)
        if refs and not row.get("real_feel_scored"):
            candidates=row.get("real_feel_candidates") or {}
            for reference,reference_value in refs.items():
                for candidate,pred in candidates.items():
                    p=core.safe_float(pred)
                    if p is None:continue
                    for key in _real_feel_reference_keys(loc,lead,regime,reference,candidate):_stat_update(reference_scores.setdefault(key,{}),p-float(reference_value))
            row["actual_real_feel_references"]=refs;row["actual_real_feel_reference_inputs"]={"temperature_2m":actual,"relative_humidity_2m":rh,"wind_speed_10m":wind,"shortwave_radiation":solar,"temperature_source":meta.get("temperature_2m"),"humidity_source":meta.get("relative_humidity_2m"),"wind_source":meta.get("wind_speed_10m"),"solar_source":meta.get("shortwave_radiation")};row["actual_real_feel_reference_version"]="independent-v3-target-time";row["real_feel_scored"]=True;row_touched=True

        row["truth_complete"]=bool(row.get("temperature_scored") and row.get("precipitation_scored") and row.get("real_feel_scored"))
        if row.get("temperature_scored") or row.get("precipitation_scored") or row.get("real_feel_scored"):row["scored_at"]=core.iso(now)
        if row_touched:scored+=1
    cutoff=now-timedelta(days=MAX_AGE_DAYS);state["forecasts"]=[r for r in state.get("forecasts",[]) if (core.parse_stamp(r.get("issued")) or now)>=cutoff];state["updated_at"]=core.iso(now);return scored


def adaptive_factor(state:dict[str,Any],loc:str,lead:int,regime:str,layer:str)->dict[str,Any]:
    scores=state.get("scores",{});layer_stat=base_stat=None
    for suffix in [regime,"all"]:
        l=scores.get(f"{loc}:{_bucket(lead)}:{suffix}:{layer}");b=scores.get(f"{loc}:{_bucket(lead)}:{suffix}:v2")
        if l and b and min(int(l.get("n",0)),int(b.get("n",0)))>=MIN_ADAPT_SAMPLES:layer_stat,base_stat=l,b;break
    if not layer_stat or not base_stat:return {"factor":1.0,"samples":0,"status":"learning"}
    lm=max(0.05,float(layer_stat.get("mae",99)));bm=max(0.05,float(base_stat.get("mae",99)));ratio=bm/lm;factor=max(0.25,min(1.25,ratio));factor=1.0 if 0.95<=ratio<=1.05 else factor
    return {"factor":factor,"samples":min(int(layer_stat.get("n",0)),int(base_stat.get("n",0))),"layer_mae":lm,"v2_mae":bm,"status":"boosted" if factor>1.02 else ("damped" if factor<0.98 else "neutral")}


def precipitation_factor(state:dict[str,Any],loc:str,lead:int,regime:str)->dict[str,Any]:
    scores=state.get("precip_scores",{});cal=raw=None
    for suffix in [regime,"all"]:
        c=scores.get(f"{loc}:{_bucket(lead)}:{suffix}:calibrated");r=scores.get(f"{loc}:{_bucket(lead)}:{suffix}:raw")
        if c and r and min(int(c.get("n",0)),int(r.get("n",0)))>=MIN_ADAPT_SAMPLES:cal,raw=c,r;break
    if not cal or not raw:return {"factor":1.0,"samples":0,"status":"learning"}
    cb=max(1e-4,float(cal.get("brier",1)));rb=max(1e-4,float(raw.get("brier",1)));ratio=rb/cb;factor=max(0.0,min(1.0,(ratio-0.85)/0.15)) if ratio<1 else 1.0
    return {"factor":factor,"samples":min(int(cal.get("n",0)),int(raw.get("n",0))),"calibrated_brier":cb,"raw_brier":rb,"status":"active" if factor>=0.98 else "damped"}


def real_feel_replay(state:dict[str,Any])->dict[str,Any]:
    scores=state.get("real_feel_reference_scores",{});locations={}
    for key,stat in scores.items():
        parts=key.split(':')
        if len(parts)!=5:continue
        loc,lead,regime,reference,candidate=parts
        if regime!='all' or lead=='all':continue
        out=locations.setdefault(loc,{}).setdefault(lead,{}).setdefault(reference,{})
        out[candidate]={k:stat.get(k) for k in ('n','mae','bias','rmse','updated_at') if k in stat}
    scored_rows=sum(1 for r in state.get('forecasts',[]) if str(r.get('actual_real_feel_reference_version','')).startswith('independent-v') and r.get('actual_real_feel_references'))
    return {"version":"3.0","mode":"comparative-independent-reference-replay","scored_rows":scored_rows,"method":"Issued Real Feel candidates are compared prospectively against separate external references built from independently time-matched official temperature, humidity and wind truth; no candidate formula is declared observed human-perception truth.","target_time_tolerance_minutes":TRUTH_MAX_OFFSET_MINUTES,"references":{"bom_steadman_shade":"Steadman apparent temperature using observed temperature, humidity and wind","eccc_humidex":"ECCC Humidex only when air temperature is at least 20 C and Humidex is at least 1 C above air temperature","eccc_wind_chill":"Canadian wind chill when observed temperature/wind satisfy the cold-weather formula inputs"},"promotion_policy":"diagnostic-only while the independent replay accumulates; Real Feel formula changes are not auto-promoted from the legacy synthetic target","locations":locations}


def add_current_forecasts(state:dict[str,Any],engine:dict[str,Any])->int:
    issued=core.parse_stamp(engine.get("updated_at")) or core.utcnow();existing={(r.get("loc"),r.get("lead"),r.get("issued")) for r in state.setdefault("forecasts",[])};added=0
    for loc,payload in (engine.get("consensus") or {}).items():
        regime=((payload.get("regime") or {}).get("name")) or "unknown"
        for lead_s,h in (payload.get("hours") or {}).items():
            lead=int(lead_s);ident=(loc,lead,core.iso(issued))
            if ident in existing:continue
            comps=h.get("components") or {};v2=core.safe_float(comps.get("v2_consensus"));nudge=core.safe_float(comps.get("observation_nudge"));temp_candidates={"v2":v2,"mos":core.safe_float(comps.get("mos")),"analog":core.safe_float(comps.get("analog")),"final_v3":core.safe_float(h.get("temperature_2m"))}
            if v2 is not None and nudge is not None:temp_candidates["nudge"]=v2+max(-1.5,min(1.5,nudge*0.65))
            rfe=h.get("real_feel_engine") or {};inputs=rfe.get("inputs") or {};fc=h.get("forecast_confidence") or {}
            state["forecasts"].append({"loc":loc,"lead":lead,"regime":regime,"issued":core.iso(issued),"target":h.get("target"),"temperature_candidates":temp_candidates,"precip_candidates":{"raw":core.safe_float(h.get("raw_precipitation_probability")),"calibrated":core.safe_float(h.get("precipitation_probability"))},"real_feel_candidates":{"provider_apparent":core.safe_float(inputs.get("provider_apparent_temperature")),"steadman":core.safe_float(rfe.get("steadman_real_feel") or rfe.get("physical_real_feel")),"local_calibrated":core.safe_float(rfe.get("real_feel")),"legacy_humidex_transition":core.safe_float(rfe.get("legacy_real_feel")),"production":core.safe_float(h.get("real_feel"))},"real_feel_context":{"relative_humidity_2m":core.safe_float(inputs.get("relative_humidity_2m")),"wind_speed_10m":core.safe_float(inputs.get("wind_speed_10m")),"shortwave_radiation":core.safe_float(inputs.get("shortwave_radiation")),"cloud_cover":core.safe_float(inputs.get("cloud_cover")),"uv_index":core.safe_float(inputs.get("uv_index"))},"issued_confidence":{"value":core.safe_float(fc.get("value")),"tolerance_c":core.safe_float(fc.get("tolerance_c")),"method":fc.get("method")},"scored":False,"temperature_scored":False,"precipitation_scored":False,"real_feel_scored":False,"truth_complete":False,"truth_variables":{}});existing.add(ident);added+=1
    return added


def load_state()->dict[str,Any]:return core.load(VERIFY,{"version":"3.0","updated_at":None,"scores":{},"precip_scores":{},"real_feel_scores":{},"real_feel_reference_scores":{},"confidence_scores":{},"forecasts":[]})


def save_state(state:dict[str,Any])->None:
    state["version"]="3.0";state.setdefault("confidence_scores",{});state.setdefault("real_feel_reference_scores",{});core.save(VERIFY,state)
