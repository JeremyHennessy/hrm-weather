#!/usr/bin/env python3
"""Locally calibrated Real Feel layer for Weather Consensus.

Physics baseline: humidex in warm weather, Canadian wind chill in cold weather,
and a bounded radiant-load proxy. Local residual calibration is learned from
verified ECCC temperature/humidity/wind. Older cases without observed SWOB wind
remain usable while history is sparse, but fully wind-verified cases become the
preferred calibration population as soon as enough exist.
"""
from __future__ import annotations
import math
from collections import defaultdict
from typing import Any
import accuracy_engine_v2 as core
import accuracy_engine_v3 as v3

MIN_LOCAL_SAMPLES=8
MAX_CORRECTION=2.5

def dewpoint_c(temp_c:float,rh:float)->float:
    rh=max(1.0,min(100.0,rh));a,b=17.625,243.04
    g=math.log(rh/100.0)+(a*temp_c)/(b+temp_c)
    return (b*g)/(a-g)

def humidex(temp_c:float,rh:float)->float:
    td=dewpoint_c(temp_c,rh)
    e=6.11*math.exp(5417.7530*(1/273.16-1/(273.15+td)))
    return temp_c+0.5555*(e-10.0)

def wind_chill(temp_c:float,wind_kmh:float)->float:
    v=max(4.8,wind_kmh);p=v**0.16
    return 13.12+0.6215*temp_c-11.37*p+0.3965*temp_c*p

def solar_adjustment(shortwave_wm2:float|None=None,uv:float|None=None,cloud:float|None=None)->float:
    sw=core.safe_float(shortwave_wm2)
    if sw is not None:return max(0.0,min(2.5,(sw-150.0)*0.0035))
    u=core.safe_float(uv)
    if u is not None:
        cf=1.0-0.45*max(0.0,min(1.0,(core.safe_float(cloud) or 0.0)/100.0))
        return max(0.0,min(1.8,u*0.18*cf))
    return 0.0

def physical_real_feel(temp_c:float,rh:float|None,wind_kmh:float|None,shortwave_wm2:float|None=None,uv:float|None=None,cloud:float|None=None)->dict[str,float|str]:
    t=float(temp_c);h=50.0 if core.safe_float(rh) is None else float(rh);w=0.0 if core.safe_float(wind_kmh) is None else max(0.0,float(wind_kmh));solar=solar_adjustment(shortwave_wm2,uv,cloud)
    if t<=10.0 and w>=4.8:base=wind_chill(t,w);mode='wind-chill'
    elif t>=20.0:base=humidex(t,h);mode='humidex'
    elif t>10.0:
        hx=humidex(t,h);f=(t-10.0)/10.0;base=t*(1-f)+hx*f;mode='transition'
    else:base=t;mode='air-temperature'
    if t>=12.0:base+=solar
    return {'value':base,'mode':mode,'solar_adjustment':solar}

def _family_mean(model_values:dict[str,float])->float|None:
    fam=v3._family_snapshot(model_values);vals=[core.safe_float(x) for x in fam.values()];vals=[x for x in vals if x is not None]
    return sum(vals)/len(vals) if vals else None

def _training_cases(ledger:list[dict[str,Any]],loc:str,lead:int)->list[dict[str,Any]]:
    groups={};allowed={lead}
    try:
        import accuracy_engine_v3_pooling as pooling
        allowed=pooling.nearby_leads(lead)
    except Exception:pass
    for row in ledger:
        if row.get('loc')!=loc or int(row.get('lead',-1)) not in allowed or not row.get('scored'):continue
        var=str(row.get('variable') or '')
        if var not in {'temperature_2m','relative_humidity_2m','wind_speed_10m'}:continue
        actual=core.safe_float(row.get('actual'));pred=core.safe_float(row.get('pred'));target=str(row.get('target') or '');model=str(row.get('model') or '')
        if actual is None or pred is None or not target or model.startswith('ensemble:'):continue
        key=f"{target}|{int(row.get('lead',lead))}"
        g=groups.setdefault(key,{'target':target,'regime':row.get('regime','unknown'),'actual':{},'pred':defaultdict(dict)})
        g['actual'].setdefault(var,[]).append(actual);g['pred'][var][model]=pred
    out=[]
    for g in groups.values():
        at=core.avg(g['actual'].get('temperature_2m',[]));arh=core.avg(g['actual'].get('relative_humidity_2m',[]));aw=core.avg(g['actual'].get('wind_speed_10m',[]))
        pt=_family_mean(g['pred'].get('temperature_2m',{}));prh=_family_mean(g['pred'].get('relative_humidity_2m',{}));pw=_family_mean(g['pred'].get('wind_speed_10m',{}))
        if None in (at,arh,pt,prh):continue
        if pw is None:pw=0.0
        wind_for_observed=aw if aw is not None else pw
        observed=physical_real_feel(at,arh,wind_for_observed)['value'];forecast=physical_real_feel(pt,prh,pw)['value']
        out.append({'target':g['target'],'regime':g['regime'],'residual':float(observed)-float(forecast),'observed_wind_used':aw is not None})
    return out[-360:]

def local_correction(ledger:list[dict[str,Any]],loc:str,lead:int,regime:str)->dict[str,Any]:
    cases=_training_cases(ledger,loc,lead)
    wind_cases=[x for x in cases if x.get('observed_wind_used')]
    population=wind_cases if len(wind_cases)>=MIN_LOCAL_SAMPLES else cases
    same=[x['residual'] for x in population if x.get('regime')==regime]
    vals=same if len(same)>=MIN_LOCAL_SAMPLES else [x['residual'] for x in population]
    if not vals:return {'correction':0.0,'samples':0,'status':'learning','wind_verified_samples':0,'calibration_population':'none'}
    raw=sum(vals)/len(vals);trust=min(1.0,len(vals)/30.0);corr=max(-MAX_CORRECTION,min(MAX_CORRECTION,raw*trust));mae=sum(abs(x-raw) for x in vals)/len(vals)
    wind_preferred=len(wind_cases)>=MIN_LOCAL_SAMPLES
    return {
        'correction':corr,'raw_correction':raw,'samples':len(vals),'residual_mae':mae,
        'status':'active' if len(vals)>=MIN_LOCAL_SAMPLES else 'learning','regime_specific':len(same)>=MIN_LOCAL_SAMPLES,
        'verified_variables':['temperature_2m','relative_humidity_2m','wind_speed_10m'] if wind_preferred else ['temperature_2m','relative_humidity_2m'],
        'wind_verified_samples':len(wind_cases),'calibration_population':'fully-wind-verified' if wind_preferred else 'mixed-history',
        'wind_observation_policy':'prefer-observed-wind-after-minimum-sample-threshold'
    }

def forecast_inputs(forecasts:dict[str,Any],target,corrected_temp:float|None=None)->dict[str,float|None]:
    def mean_var(var):
        fam=v3.current_family_values(forecasts,target,var);vals=[core.safe_float(x) for x in fam.values()];vals=[x for x in vals if x is not None]
        return sum(vals)/len(vals) if vals else None
    return {
        'temperature_2m':corrected_temp if corrected_temp is not None else mean_var('temperature_2m'),
        'relative_humidity_2m':mean_var('relative_humidity_2m'),
        'wind_speed_10m':mean_var('wind_speed_10m'),
        'shortwave_radiation':mean_var('shortwave_radiation'),
        'cloud_cover':mean_var('cloud_cover'),
        'uv_index':mean_var('uv_index'),
        'provider_apparent_temperature':mean_var('apparent_temperature')
    }

def predict(ledger:list[dict[str,Any]],forecasts:dict[str,Any],loc:str,lead:int,target,regime:str,corrected_temp:float|None=None)->dict[str,Any]:
    inputs=forecast_inputs(forecasts,target,corrected_temp);t=core.safe_float(inputs['temperature_2m'])
    if t is None:return {'available':False,'reason':'missing-temperature'}
    physical=physical_real_feel(t,core.safe_float(inputs['relative_humidity_2m']),core.safe_float(inputs['wind_speed_10m']),core.safe_float(inputs['shortwave_radiation']),core.safe_float(inputs['uv_index']),core.safe_float(inputs['cloud_cover']))
    calibration=local_correction(ledger,loc,lead,regime);value=float(physical['value'])+float(calibration['correction']);value=max(t-15.0,min(t+15.0,value))
    return {'available':True,'real_feel':value,'physical_real_feel':physical['value'],'mode':physical['mode'],'solar_adjustment':physical['solar_adjustment'],'local_correction':calibration,'inputs':inputs,'method':'physics-plus-local-verified-residual'}
