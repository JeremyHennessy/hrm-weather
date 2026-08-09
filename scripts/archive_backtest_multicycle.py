#!/usr/bin/env python3
"""21-day 00/06/12/18Z strict-causal Engine 3 hindcast.

Tests the same forecast architecture across four daily model cycles. Training for
MOS/analogs is restricted to targets strictly earlier than the held-out target,
so repeated intraday cycles cannot leak the answer for the same verifying hour.
"""
from __future__ import annotations
import json
import urllib.parse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import datetime,timezone,timedelta
from typing import Any
import accuracy_engine_v2 as core
import accuracy_engine_v3 as v3
import archive_backtest_v3 as base

OUT=core.DATA/'archive-backtest-multicycle.json'
DAYS=21
CYCLES=(0,6,12,18)
LEADS=(3,6,12)
MODELS=list(base.MODELS)
LOCATIONS=dict(base.LOCATIONS)
MAX_WORKERS=4


def fetch(task):
    loc,lat,lon,model,run=task
    q={'latitude':lat,'longitude':lon,'timezone':'UTC','temperature_unit':'celsius','hourly':'temperature_2m','models':model,'run':run.strftime('%Y-%m-%dT%H:00'),'forecast_hours':'13'}
    try:
        j=base.get_json('https://single-runs-api.open-meteo.com/v1/forecast?'+urllib.parse.urlencode(q));h=j.get('hourly') or {};times=h.get('time') or []
        return task,{t:core.safe_float(v) for t,v in zip(times,h.get('temperature_2m') or [])}
    except Exception as exc:return task,{},str(exc)[:160]


def evaluate(rows:list[dict[str,Any]]):
    stats={k:{} for k in ['v2','mos','analog','engine3_reconstructed']};cases=[]
    for i,row in enumerate(rows):
        actual=float(row['actual']);prior=[r for r in rows[:i] if r['dt']<row['dt']];v2p=base.v2_proxy(row);mos=analog=None
        if v2p is not None:base.update(stats['v2'],v2p,actual)
        if len(prior)>=12:
            m=v3.fit_mos(prior)
            if m.get('available'):
                mos=v3.predict_mos(m,row['families'],row['dt'])
                if mos is not None:base.update(stats['mos'],float(mos),actual)
        if len(prior)>=8:
            a=v3.analog_predict(prior,row['families'],row['dt'],'archive-unknown')
            if a.get('available'):
                analog=core.safe_float(a.get('prediction'))
                if analog is not None:base.update(stats['analog'],analog,actual)
        weighted=[]
        if v2p is not None:weighted.append((v2p,.58))
        if mos is not None:weighted.append((float(mos),.27 if len(prior)>=24 else .18))
        if analog is not None:weighted.append((analog,.15))
        final=sum(v*w for v,w in weighted)/sum(w for _,w in weighted) if weighted else None
        if final is not None:base.update(stats['engine3_reconstructed'],final,actual)
        cases.append({'target':core.iso(row['dt']),'issued':core.iso(row['issued']),'cycle_z':row['issued'].hour,'lead':row['lead'],'actual':actual,'v2':v2p,'mos':mos,'analog':analog,'engine3_reconstructed':final,'strict_prior_targets':len(prior)})
    return {k:base.finish(v) for k,v in stats.items()},cases


def score(cases):
    stats={k:{} for k in ['v2','mos','analog','engine3_reconstructed']}
    for c in cases:
        for k in stats:
            p=core.safe_float(c.get(k))
            if p is not None:base.update(stats[k],p,float(c['actual']))
    return {k:base.finish(v) for k,v in stats.items()}


def main():
    end=(datetime.now(timezone.utc)-timedelta(days=1)).replace(hour=0,minute=0,second=0,microsecond=0);start=end-timedelta(days=DAYS-1)
    obs={loc:base.observations(bbox,start,end+timedelta(days=1)) for loc,(_,_,bbox) in LOCATIONS.items()}
    tasks=[]
    for loc,(lat,lon,_) in LOCATIONS.items():
        for model in MODELS:
            for d in range(DAYS):
                for cycle in CYCLES:tasks.append((loc,lat,lon,model,start+timedelta(days=d,hours=cycle)))
    forecasts={};failures=[]
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futs=[pool.submit(fetch,t) for t in tasks]
        for fut in as_completed(futs):
            result=fut.result();task,fc=result[:2];loc,_,_,model,run=task;forecasts[(loc,model,core.iso(run))]=fc
            if len(result)>2:failures.append({'loc':loc,'model':model,'run':core.iso(run),'error':result[2]})
    grouped=defaultdict(list)
    for loc in LOCATIONS:
        for d in range(DAYS):
            for cycle in CYCLES:
                issued=start+timedelta(days=d,hours=cycle)
                for lead in LEADS:
                    target=issued+timedelta(hours=lead);actual=obs.get(loc,{}).get(target.strftime('%Y-%m-%dT%H'))
                    if actual is None:continue
                    fam=defaultdict(list)
                    for model in MODELS:
                        pred=(forecasts.get((loc,model,core.iso(issued))) or {}).get(target.strftime('%Y-%m-%dT%H:00'))
                        if pred is not None:fam[base.family_for(model)].append(pred)
                    families={k:sum(v)/len(v) for k,v in fam.items() if v}
                    if len(families)<2:continue
                    grouped[(loc,lead)].append({'loc':loc,'lead':lead,'issued':issued,'dt':target,'actual':float(actual),'families':families,'regime':'archive-unknown'})
    all_cases=[];locations={}
    for loc in LOCATIONS:
        locations[loc]={'leads':{}}
        for lead in LEADS:
            rows=sorted(grouped.get((loc,lead),[]),key=lambda r:(r['dt'],r['issued']));scores,cases=evaluate(rows);all_cases.extend(cases);locations[loc]['leads'][str(lead)]={'scores':scores,'n':len(cases)}
    overall=score(all_cases);by_cycle={str(c):score([x for x in all_cases if x['cycle_z']==c]) for c in CYCLES};by_lead={str(l):score([x for x in all_cases if x['lead']==l]) for l in LEADS}
    v2m=overall['v2'].get('mae');v3m=overall['engine3_reconstructed'].get('mae');improvement=(v2m-v3m)/v2m if v2m and v3m is not None else None
    report={'version':'1.0','method':'21-day four-cycle 00/06/12/18Z strict causal hindcast','days_requested':DAYS,'cycles_z':list(CYCLES),'leads_hours':list(LEADS),'start':core.iso(start),'end':core.iso(end+timedelta(days=1,hours=6)),'archive_requests':len(tasks),'archive_failures':len(failures),'archive_success_rate':(len(tasks)-len(failures))/len(tasks),'failure_examples':failures[:20],'leakage_policy':'strictly-earlier-targets-only-even-across-cycles','overall':overall,'by_cycle':by_cycle,'by_lead':by_lead,'locations':locations,'engine3_vs_v2_mae_improvement':improvement}
    OUT.write_text(json.dumps(report,indent=2,sort_keys=True,allow_nan=False)+'\n');print(json.dumps({'requests':len(tasks),'failures':len(failures),'success':report['archive_success_rate'],'overall':overall,'by_cycle':by_cycle,'improvement':improvement},indent=2))

if __name__=='__main__':main()
