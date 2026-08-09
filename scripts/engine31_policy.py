#!/usr/bin/env python3
"""Engine 3.1 challenger policy.

Builds a regime-aware, lead-aware, time-decayed challenger on top of the stable
Engine 3 forecast. It never silently replaces production: promotion requires
prospective OOS evidence against final_v3. The candidate is stored in shadow
verification so it can earn authority over time.
"""
from __future__ import annotations
import hashlib
import json
from typing import Any

import accuracy_engine_v2 as core

MIN_PROMOTION_SAMPLES=12
PROMOTION_MARGIN=0.02
HALF_LIFE_DAYS=14.0
MODEL_STATE=core.DATA/'model-set-state.json'


def _norm(weights:dict[str,float])->dict[str,float]:
    d=sum(max(0.0,float(v)) for v in weights.values()) or 1.0
    return {k:max(0.0,float(v))/d for k,v in weights.items()}


def _lead_mod(lead:int)->dict[str,float]:
    if lead<=3:return {'v2':1.10,'mos':1.04,'analog':0.94}
    if lead<=12:return {'v2':1.00,'mos':1.06,'analog':1.05}
    return {'v2':1.04,'mos':1.02,'analog':0.96}


def _regime_mod(regime:str)->dict[str,float]:
    r=str(regime or 'unknown')
    if r in {'marine_onshore','marine_mixed'}:return {'v2':0.98,'mos':1.08,'analog':1.08}
    if r in {'frontal','convective'}:return {'v2':1.10,'mos':1.02,'analog':0.86}
    if r=='stable':return {'v2':0.96,'mos':1.06,'analog':1.10}
    if r=='offshore':return {'v2':1.02,'mos':1.06,'analog':1.02}
    return {'v2':1.0,'mos':1.0,'analog':1.0}


def _recent_mae(state:dict[str,Any],loc:str,lead:int,regime:str,layer:str)->dict[str,Any]|None:
    now=core.utcnow();num=den=0.0;n=0
    for row in state.get('forecasts',[]):
        if not row.get('scored') or row.get('loc')!=loc or int(row.get('lead',-1))!=lead:continue
        if regime not in {'unknown','all'} and row.get('regime') not in {regime,None}:continue
        actual=core.safe_float(row.get('actual_temperature'));pred=core.safe_float((row.get('temperature_candidates') or {}).get(layer));issued=core.parse_stamp(row.get('issued'))
        if actual is None or pred is None or not issued:continue
        age=max(0.0,(now-issued).total_seconds()/86400.0);w=0.5**(age/HALF_LIFE_DAYS);num+=abs(pred-actual)*w;den+=w;n+=1
    return {'mae':num/den,'n':n,'effective_weight':den} if den>0 and n>=6 else None


def _skill_mod(state:dict[str,Any],loc:str,lead:int,regime:str,available:set[str])->dict[str,float]:
    base=_recent_mae(state,loc,lead,regime,'final_v3') or _recent_mae(state,loc,lead,'all','final_v3')
    if not base:return {k:1.0 for k in available}
    bm=max(0.05,float(base['mae']));out={}
    for layer in available:
        s=_recent_mae(state,loc,lead,regime,layer) or _recent_mae(state,loc,lead,'all',layer)
        out[layer]=max(0.88,min(1.12,bm/max(0.05,float(s['mae'])))) if s else 1.0
    return out


def candidate(base_weights:dict[str,float],components:dict[str,Any],state:dict[str,Any],loc:str,lead:int,regime:str)->dict[str,Any]:
    values={'v2':core.safe_float(components.get('v2_consensus')),'mos':core.safe_float(components.get('mos')),'analog':core.safe_float(components.get('analog'))};available={k for k,v in values.items() if v is not None}
    if not available:return {'available':False}
    weights={k:float(base_weights.get(k,0.0)) for k in available};lm=_lead_mod(lead);rm=_regime_mod(regime);sm=_skill_mod(state,loc,lead,regime,available)
    for k in weights:weights[k]*=lm.get(k,1.0)*rm.get(k,1.0)*sm.get(k,1.0)
    weights=_norm(weights);temp=sum(float(values[k])*weights[k] for k in weights)
    return {'available':True,'temperature_2m':temp,'weights':weights,'lead_modifier':lm,'regime_modifier':rm,'time_decayed_skill_modifier':sm,'half_life_days':HALF_LIFE_DAYS}


def gate(state:dict[str,Any],loc:str,lead:int,regime:str)->dict[str,Any]:
    scores=state.get('scores',{})
    for suffix in [regime,'all']:
        c=scores.get(f'{loc}:{lead}:{suffix}:engine31');b=scores.get(f'{loc}:{lead}:{suffix}:final_v3')
        if not c or not b:continue
        n=min(int(c.get('n',0)),int(b.get('n',0)));cm=core.safe_float(c.get('mae'));bm=core.safe_float(b.get('mae'))
        if cm is None or bm is None:continue
        if n<MIN_PROMOTION_SAMPLES:return {'status':'learning','samples':n,'challenger_mae':cm,'champion_mae':bm}
        ratio=cm/max(0.05,bm)
        if ratio<=1-PROMOTION_MARGIN:return {'status':'promotion-approved','samples':n,'skill_ratio':ratio,'challenger_mae':cm,'champion_mae':bm}
        return {'status':'hold-champion','samples':n,'skill_ratio':ratio,'challenger_mae':cm,'champion_mae':bm}
    return {'status':'learning','samples':0}


def _fingerprint()->str:
    payload=[{'id':m[0],'family':m[3],'weight':m[4]} for m in core.MODELS];return hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()[:16]


def model_set_watch()->dict[str,Any]:
    fp=_fingerprint();old=core.load(MODEL_STATE,{});changed=bool(old.get('fingerprint') and old.get('fingerprint')!=fp)
    state={'fingerprint':fp,'previous_fingerprint':old.get('fingerprint'),'changed':changed,'model_ids':[m[0] for m in core.MODELS],'checked_at':core.iso(core.utcnow()),'policy':'explicit configured model-set changes are detected immediately; unseen upstream revisions are caught by time-decayed prospective skill'};core.save(MODEL_STATE,state);return state


def hrm_microclimate()->dict[str,Any]:
    """Fail-soft HRDPS point diagnostic for Peninsula/Bedford/Dartmouth."""
    loc=core.LOCATIONS['hrm'];now=core.utcnow().replace(minute=0,second=0,microsecond=0);points=[]
    for name,lat,lon,kind in loc['points']:
        fc=core.forecast_point(lat,lon,'gem_hrdps_continental')
        if not fc:continue
        tkey=core.nearest_hour_key(now+core.timedelta(hours=1),fc.get('temperature_2m',{}));wkey=core.nearest_hour_key(now+core.timedelta(hours=1),fc.get('wind_direction_10m',{}));skey=core.nearest_hour_key(now+core.timedelta(hours=1),fc.get('wind_speed_10m',{}))
        points.append({'name':name,'kind':kind,'temperature_1h':core.safe_float((fc.get('temperature_2m') or {}).get(tkey)) if tkey else None,'wind_direction_1h':core.safe_float((fc.get('wind_direction_10m') or {}).get(wkey)) if wkey else None,'wind_speed_1h':core.safe_float((fc.get('wind_speed_10m') or {}).get(skey)) if skey else None})
    temps=[p['temperature_1h'] for p in points if p.get('temperature_1h') is not None];spread=(max(temps)-min(temps)) if len(temps)>=2 else None
    peninsula=next((p for p in points if p['name']=='Halifax Peninsula'),None);bedford=next((p for p in points if p['name']=='Bedford'),None);wd=core.safe_float((peninsula or {}).get('wind_direction_1h'));ws=core.safe_float((peninsula or {}).get('wind_speed_1h'));sea_breeze=bool(wd is not None and 70<=wd<=190 and (ws or 0)>=6 and spread is not None and spread>=1.0)
    return {'available':bool(points),'points':points,'temperature_spread_c':spread,'sea_breeze_signal':sea_breeze,'peninsula_vs_bedford_c':(core.safe_float((peninsula or {}).get('temperature_1h'))-core.safe_float((bedford or {}).get('temperature_1h'))) if peninsula and bedford and core.safe_float(peninsula.get('temperature_1h')) is not None and core.safe_float(bedford.get('temperature_1h')) is not None else None,'method':'HRDPS point-level Peninsula/Bedford/Dartmouth diagnostic'}


def apply(engine:dict[str,Any],state:dict[str,Any])->None:
    locations={};promoted=0
    for loc,payload in (engine.get('consensus') or {}).items():
        regime=((payload.get('regime') or {}).get('name')) or 'unknown';locations[loc]={}
        for lead_s,h in (payload.get('hours') or {}).items():
            lead=int(lead_s);w=((h.get('component_weighting') or {}).get('weights') or {});c=candidate(w,h.get('components') or {},state,loc,lead,regime);g=gate(state,loc,lead,regime);c['gate']=g;h['engine31_challenger']=c
            if c.get('available') and g.get('status')=='promotion-approved':h['temperature_2m']=c['temperature_2m'];h['engine31_promoted']=True;promoted+=1
            else:h['engine31_promoted']=False
            locations[loc][lead_s]=c
    v2=core.load(core.ENGINE,{})
    engine['nowcast_intelligence']={'source':'Accuracy Engine 2 GeoMet radar/RDPA','locations':v2.get('nowcast',{}),'lead_priority':'0-3h'}
    try:micro=hrm_microclimate()
    except Exception as exc:micro={'available':False,'error':type(exc).__name__}
    engine['microclimate_intelligence']={'hrm':micro}
    engine['engine31']={'version':'3.1-challenger','status':'shadow-with-automatic-evidence-gated-promotion','regime_aware':True,'lead_aware':True,'time_decayed_skill_half_life_days':HALF_LIFE_DAYS,'minimum_promotion_samples':MIN_PROMOTION_SAMPLES,'promotion_margin':PROMOTION_MARGIN,'promoted_points':promoted,'model_set_watch':model_set_watch(),'locations':locations}
