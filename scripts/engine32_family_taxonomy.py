#!/usr/bin/env python3
"""Engine 3.2 family-taxonomy challenger.

The 2026-08-10 historical walk-forward compared the incumbent 8-family Engine 3
feature taxonomy with a 10-family alternative that preserves KMA, BOM and CMA.
The 8-family incumbent won by a tiny paired-MAE margin, so this module shadows
that historical winner prospectively. It never mutates the production forecast.
The 10-family architecture remains explicit and testable for a future benchmark.
"""
from __future__ import annotations

from typing import Any

import accuracy_engine_v2 as core
import engine32_family_benchmark as bench

BENCHMARK_FILE=core.DATA/'engine32-family-benchmark.json'
CANDIDATE_KEY='engine32_family'
VERSION='3.2-family-taxonomy-challenger'


def _benchmark()->dict[str,Any]:
    return core.load(BENCHMARK_FILE,{})


def _selected()->str:
    result=_benchmark();selected=str(result.get('selected_for_prospective_shadow') or result.get('historical_winner') or '8-family')
    return selected if selected in bench.TAXONOMIES else '8-family'


def _current_family_values(forecasts:dict[str,Any],target,taxonomy:tuple[str,...])->dict[str,float]:
    model_values={}
    for model,fc in forecasts.items():
        mp=(fc or {}).get('temperature_2m') or {};key=core.nearest_hour_key(target,mp);value=core.safe_float(mp.get(key) if key else None)
        if value is not None:model_values[model]=value
    return bench.family_snapshot(model_values,taxonomy)


def _prospective_pair(state:dict[str,Any],loc:str|None=None,lead:int|None=None)->dict[str,Any]:
    challenger=[];champion=[];wins=0.0
    for row in state.get('forecasts',[]):
        if not row.get('scored'):continue
        if loc is not None and row.get('loc')!=loc:continue
        if lead is not None and int(row.get('lead',-1))!=int(lead):continue
        actual=core.safe_float(row.get('actual_temperature'));cand=row.get('temperature_candidates') or {};c=core.safe_float(cand.get(CANDIDATE_KEY));p=core.safe_float(cand.get('final_v3'))
        if actual is None or c is None or p is None:continue
        ce=abs(c-actual);pe=abs(p-actual);challenger.append(ce);champion.append(pe);wins+=1.0 if ce<pe else 0.5 if ce==pe else 0.0
    n=len(challenger)
    return {
        'samples':n,
        'challenger_mae':sum(challenger)/n if n else None,
        'production_mae':sum(champion)/n if n else None,
        'paired_win_rate':wins/n if n else None,
        'status':'prospective-shadow-learning' if n<30 else 'prospective-shadow-observed',
        'promotion_allowed':False,
    }


def _candidate(engine_row:dict[str,Any],ledger:list[dict[str,Any]],forecasts:dict[str,Any],loc:str,lead:int,regime:str,taxonomy_name:str)->dict[str,Any]:
    taxonomy=bench.TAXONOMIES[taxonomy_name];target=core.parse_stamp(engine_row.get('target'))
    if target is None:return {'available':False,'reason':'missing-target','taxonomy':taxonomy_name}
    fam=_current_family_values(forecasts,target,taxonomy)
    if len(fam)<2:return {'available':False,'reason':'insufficient-current-families','taxonomy':taxonomy_name,'families_present':sorted(fam)}
    rows=bench.groups_for(ledger,loc,lead,taxonomy)[-bench.MAX_TRAIN:]
    mos_model=bench.fit_mos(rows,taxonomy);mos=bench.predict_mos(mos_model,fam,target,taxonomy) if mos_model.get('available') else None
    analog=bench.analog_predict(rows,fam,target,regime) if len(rows)>=bench.MIN_ANALOG_TRAIN else None
    components=engine_row.get('components') or {};v2=core.safe_float(components.get('v2_consensus'));weights=((engine_row.get('component_weighting') or {}).get('weights') or {})
    available=[]
    if v2 is not None:available.append(('v2',v2,float(weights.get('v2',0.0))))
    if mos is not None:available.append(('mos',mos,float(weights.get('mos',0.0))))
    if analog is not None:available.append(('analog',analog,float(weights.get('analog',0.0))))
    positive=[x for x in available if x[2]>0]
    if not positive:
        # This is a shadow diagnostic only. If adaptive weights are unavailable,
        # use the same production priors rather than inventing a new blend.
        pri={'v2':0.58,'mos':0.27 if int(mos_model.get('samples',0))>=24 else 0.18,'analog':0.15}
        positive=[(name,value,pri[name]) for name,value,_ in available if pri.get(name,0)>0]
    if not positive:return {'available':False,'reason':'no-temperature-components','taxonomy':taxonomy_name,'families_present':sorted(fam)}
    den=sum(w for _,_,w in positive);temperature=sum(value*w for _,value,w in positive)/den
    nudge=core.safe_float(components.get('observation_nudge'));nudge_factor=core.safe_float((((engine_row.get('adaptive_skill') or {}).get('observation_nudge') or {}).get('factor')))
    applied_nudge=0.0
    if nudge is not None:
        factor=nudge_factor if nudge_factor is not None else 1.0;applied_nudge=max(-1.5,min(1.5,nudge*0.65*factor));temperature+=applied_nudge
    return {
        'available':True,
        'temperature_2m':temperature,
        'taxonomy':taxonomy_name,
        'family_count':len(taxonomy),
        'families_present':sorted(fam),
        'components':{'v2_consensus':v2,'mos':mos,'analog':analog,'observation_nudge_applied':applied_nudge},
        'weights':{name:w/den for name,_,w in positive},
        'mos_samples':int(mos_model.get('samples',0)),
        'training_window_targets':bench.MAX_TRAIN,
        'role':'prospective-shadow-only',
    }


def apply(engine:dict[str,Any],ledger:list[dict[str,Any]],forecasts:dict[str,Any],regimes:dict[str,Any],state:dict[str,Any])->None:
    benchmark=_benchmark();selected=_selected();locations={};ready=0
    for loc,payload in (engine.get('consensus') or {}).items():
        regime=((regimes.get(loc) or {}).get('name')) or ((payload.get('regime') or {}).get('name')) or 'unknown';loc_out={}
        for lead_s,row in (payload.get('hours') or {}).items():
            lead=int(lead_s);candidate=_candidate(row,ledger,forecasts.get(loc,{}) or {},loc,lead,regime,selected);candidate['prospective_score']=_prospective_pair(state,loc,lead);row['engine32_family_challenger']=candidate;loc_out[lead_s]=candidate
            if candidate.get('available'):ready+=1
        locations[loc]=loc_out
    engine['engine32']={
        'version':VERSION,
        'status':'historical-winner-prospective-shadow',
        'selected_taxonomy':selected,
        'candidate_key':CANDIDATE_KEY,
        'forecast_points_ready':ready,
        'production_replacement':False,
        'automatic_promotion':False,
        'historical_benchmark':{
            'ledger_rows':benchmark.get('ledger_rows'),
            'paired_cases':benchmark.get('paired_cases'),
            'historical_winner':benchmark.get('historical_winner'),
            '8-family':(benchmark.get('scores') or {}).get('8-family'),
            '10-family':(benchmark.get('scores') or {}).get('10-family'),
            'mae_delta_10_minus_8_c':benchmark.get('mae_delta_10_minus_8_c'),
            'paired_win_rate_10_family':benchmark.get('paired_win_rate_10_family'),
        },
        'taxonomies':benchmark.get('taxonomies') or {k:list(v) for k,v in bench.TAXONOMIES.items()},
        'ten_family_distinct_families':['kma','bom','cma'],
        'prospective_shadow':_prospective_pair(state),
        'policy':'Historical evidence selects only which family taxonomy enters prospective shadow. Engine 3.2 cannot replace production automatically; a future production change requires a separate explicit evidence review.',
        'locations':locations,
    }
