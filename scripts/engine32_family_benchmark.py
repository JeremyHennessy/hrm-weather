#!/usr/bin/env python3
"""Engine 3.2 family-taxonomy historical challenger benchmark.

Compares the current Engine 3 eight-family feature taxonomy with a ten-family
variant that preserves KMA, BOM and CMA as independent model families. The
comparison is strict historical walk-forward: every held-out target is predicted
using only earlier targets, with the same 240-target training window used by the
online Engine 3 learner. Production is never changed by this module.
"""
from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

import accuracy_engine_v2 as core
import accuracy_engine_v3 as v3

EIGHT_FAMILIES=("canada","ecmwf","noaa","dwd","ukmo","meteofrance","jma","other")
TEN_FAMILIES=("canada","ecmwf","noaa","dwd","ukmo","meteofrance","jma","kma","bom","cma")
TAXONOMIES={"8-family":EIGHT_FAMILIES,"10-family":TEN_FAMILIES}
MAX_TRAIN=240
MIN_MOS_TRAIN=12
MIN_ANALOG_TRAIN=8
RIDGE=2.5


def mean(xs):
    vals=[float(x) for x in xs if core.safe_float(x) is not None]
    return sum(vals)/len(vals) if vals else None


def family_for(model:str,taxonomy:tuple[str,...])->str|None:
    fam=str((core.MODEL_META.get(model) or {}).get("family","other"))
    if fam in taxonomy:return fam
    return "other" if "other" in taxonomy else None


def family_snapshot(models:dict[str,float],taxonomy:tuple[str,...])->dict[str,float]:
    by:dict[str,list[float]]=defaultdict(list)
    for model,value in models.items():
        val=core.safe_float(value);fam=family_for(model,taxonomy)
        if val is not None and fam:by[fam].append(val)
    return {fam:mean(vals) for fam,vals in by.items() if vals}


def groups_for(ledger:list[dict[str,Any]],loc:str,lead:int,taxonomy:tuple[str,...])->list[dict[str,Any]]:
    groups:dict[str,dict[str,Any]]={}
    for row in ledger:
        if row.get("loc")!=loc or int(row.get("lead",-1))!=int(lead):continue
        if row.get("variable","temperature_2m")!="temperature_2m" or not row.get("scored"):continue
        actual=core.safe_float(row.get("actual"));pred=core.safe_float(row.get("pred"));target=str(row.get("target") or "");model=str(row.get("model") or "")
        if actual is None or pred is None or not target or model.startswith("ensemble:"):continue
        g=groups.setdefault(target,{"target":target,"actuals":[],"models":{},"regime":row.get("regime","unknown")})
        g["actuals"].append(actual);g["models"][model]=pred
    out=[]
    for g in groups.values():
        fam=family_snapshot(g["models"],taxonomy);canonical=family_snapshot(g["models"],TEN_FAMILIES);actual=mean(g["actuals"]);dt=core.parse_stamp(g["target"])
        if actual is None or dt is None or len(fam)<2 or len(canonical)<2:continue
        out.append({**g,"families":fam,"canonical_families":canonical,"actual":actual,"dt":dt})
    out.sort(key=lambda r:r["dt"])
    return out


def features(fam:dict[str,float],dt,taxonomy:tuple[str,...])->list[float]:
    present=list(fam.values());fill=mean(present) or 0.0;month=dt.month-1;hour=dt.hour
    return [1.0,*[float(fam.get(name,fill)) for name in taxonomy],math.sin(2*math.pi*month/12),math.cos(2*math.pi*month/12),math.sin(2*math.pi*hour/24),math.cos(2*math.pi*hour/24)]


def fit_mos(rows:list[dict[str,Any]],taxonomy:tuple[str,...])->dict[str,Any]:
    if len(rows)<MIN_MOS_TRAIN:return {"available":False,"samples":len(rows)}
    xs=[features(r["families"],r["dt"],taxonomy) for r in rows];ys=[float(r["actual"]) for r in rows];p=len(xs[0]);xtx=[[0.0]*p for _ in range(p)];xty=[0.0]*p
    for x,y in zip(xs,ys):
        for i in range(p):
            xty[i]+=x[i]*y
            for j in range(p):xtx[i][j]+=x[i]*x[j]
    for i in range(1,p):xtx[i][i]+=RIDGE
    beta=v3._solve(xtx,xty)
    return {"available":bool(beta),"samples":len(rows),"coefficients":beta}


def predict_mos(model:dict[str,Any],fam:dict[str,float],dt,taxonomy:tuple[str,...])->float|None:
    beta=model.get("coefficients") if model.get("available") else None
    if not beta:return None
    return sum(float(c)*x for c,x in zip(beta,features(fam,dt,taxonomy)))


def analog_predict(prior:list[dict[str,Any]],fam:dict[str,float],dt,regime:str,k:int=8)->float|None:
    if len(prior)<MIN_ANALOG_TRAIN or len(fam)<2:return None
    current_mean=mean(fam.values());ranked=[]
    if current_mean is None:return None
    for r in prior:
        shared=[name for name in fam if name in r["families"]]
        if len(shared)<2:continue
        dist=mean(abs(fam[n]-r["families"][n]) for n in shared) or 99.0
        if r.get("regime")!=regime:dist+=0.45
        dm=abs(dt.month-r["dt"].month);dist+=0.06*min(dm,12-dm)
        hist_mean=mean(r["families"].values());correction=float(r["actual"])-float(hist_mean if hist_mean is not None else r["actual"])
        ranked.append((dist,correction))
    ranked.sort(key=lambda x:x[0]);chosen=ranked[:k]
    if not chosen:return None
    weights=[1/max(0.15,d) for d,_ in chosen];correction=sum(w*c for w,(_,c) in zip(weights,chosen))/sum(weights)
    return current_mean+correction


def evaluate_taxonomy(ledger:list[dict[str,Any]],taxonomy_name:str)->dict[str,Any]:
    taxonomy=TAXONOMIES[taxonomy_name];predictions={};group_count=temp_rows=0
    for row in ledger:
        if row.get("variable","temperature_2m")=="temperature_2m" and row.get("scored"):temp_rows+=1
    for loc in core.LOCATIONS:
        for lead in core.LEADS:
            rows=groups_for(ledger,loc,lead,taxonomy);group_count+=len(rows)
            for i,row in enumerate(rows):
                prior=rows[max(0,i-MAX_TRAIN):i];actual=float(row["actual"]);fam=row["families"];dt=row["dt"]
                v2p=mean(row["canonical_families"].values())
                mos=None;analog=None
                if len(prior)>=MIN_MOS_TRAIN:mos=predict_mos(fit_mos(prior,taxonomy),fam,dt,taxonomy)
                if len(prior)>=MIN_ANALOG_TRAIN:analog=analog_predict(prior,fam,dt,str(row.get("regime","unknown")))
                weighted=[]
                if v2p is not None:weighted.append((v2p,0.58))
                if mos is not None:weighted.append((mos,0.27 if len(prior)>=24 else 0.18))
                if analog is not None:weighted.append((analog,0.15))
                if not weighted:continue
                den=sum(w for _,w in weighted);pred=sum(val*w for val,w in weighted)/den
                key=f"{loc}|{lead}|{row['target']}";predictions[key]={"loc":loc,"lead":lead,"target":row["target"],"actual":actual,"prediction":pred,"mos":mos,"analog":analog,"v2_proxy":v2p,"families":sorted(fam)}
    return {"taxonomy":taxonomy_name,"families":list(taxonomy),"ledger_rows":len(ledger),"scored_temperature_rows":temp_rows,"grouped_targets":group_count,"predictions":predictions}


def stats(errors:list[float])->dict[str,Any]:
    if not errors:return {"n":0,"mae":None,"bias":None,"rmse":None}
    return {"n":len(errors),"mae":sum(abs(e) for e in errors)/len(errors),"bias":sum(errors)/len(errors),"rmse":math.sqrt(sum(e*e for e in errors)/len(errors))}


def compare(a:dict[str,Any],b:dict[str,Any])->dict[str,Any]:
    pa,pb=a["predictions"],b["predictions"];keys=sorted(set(pa)&set(pb));ea=[];eb=[];wins10=0.0;by_lead=defaultdict(lambda:[[],[]]);by_loc=defaultdict(lambda:[[],[]])
    for key in keys:
        aa=pa[key];bb=pb[key];actual=float(aa["actual"]);e8=float(aa["prediction"])-actual;e10=float(bb["prediction"])-actual;ea.append(e8);eb.append(e10);wins10+=1.0 if abs(e10)<abs(e8) else 0.5 if abs(e10)==abs(e8) else 0.0;by_lead[str(aa["lead"])][0].append(e8);by_lead[str(aa["lead"])][1].append(e10);by_loc[aa["loc"]][0].append(e8);by_loc[aa["loc"]][1].append(e10)
    s8,s10=stats(ea),stats(eb);winner="10-family" if (s10["mae"] is not None and s8["mae"] is not None and s10["mae"]<s8["mae"]) else "8-family"
    def detail(groups):return {k:{"8-family":stats(v[0]),"10-family":stats(v[1])} for k,v in groups.items()}
    return {"paired_cases":len(keys),"8-family":s8,"10-family":s10,"mae_delta_10_minus_8_c":(s10["mae"]-s8["mae"]) if s8["mae"] is not None and s10["mae"] is not None else None,"relative_mae_improvement_10_vs_8":((s8["mae"]-s10["mae"])/s8["mae"]) if s8["mae"] else None,"paired_win_rate_10_family":wins10/len(keys) if keys else None,"historical_winner":winner,"by_lead":detail(by_lead),"by_location":detail(by_loc)}


def build(ledger:list[dict[str,Any]])->dict[str,Any]:
    eight=evaluate_taxonomy(ledger,"8-family");ten=evaluate_taxonomy(ledger,"10-family");comparison=compare(eight,ten)
    return {"version":"3.2-family-taxonomy-benchmark","mode":"historical-walk-forward","leakage_policy":"strictly-earlier-targets-only","training_window_targets":MAX_TRAIN,"production_changed":False,"ledger_rows":len(ledger),"taxonomies":{"8-family":list(EIGHT_FAMILIES),"10-family":list(TEN_FAMILIES)},"preserved_families":["kma","bom","cma"],"comparison":comparison,"selected_for_prospective_shadow":comparison["historical_winner"],"note":"Historical family-taxonomy evidence chooses only the Engine 3.2 shadow candidate. Production Engine 3/3.1 remains unchanged until separate prospective paired OOS evidence exists."}


def main():
    p=argparse.ArgumentParser();p.add_argument("--ledger",default=str(core.LEDGER));p.add_argument("--write",default=None);args=p.parse_args();ledger=core.load(Path(args.ledger),[]);result=build(ledger);print(json.dumps(result,indent=2,sort_keys=True));
    if args.write:Path(args.write).write_text(json.dumps(result,indent=2,sort_keys=True)+"\n")

if __name__=="__main__":main()
