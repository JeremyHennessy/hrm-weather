#!/usr/bin/env python3
"""90-day strict causal archived-model hindcast with regime/season breakdowns."""
from __future__ import annotations

import json
import math
import urllib.parse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from typing import Any

import accuracy_engine_v2 as core
import accuracy_engine_v3 as v3
import archive_backtest_v3 as base

OUT = core.DATA / "archive-backtest-90d.json"
DAYS = 90
LEADS = [3, 6, 12]
MODELS = list(base.MODELS)
LOCATIONS = dict(base.LOCATIONS)
MAX_WORKERS = 4
FORECAST_VARS = ["temperature_2m"]
CONTEXT_VARS = ["temperature_2m", "wind_speed_10m", "wind_direction_10m", "precipitation", "cloud_cover"]


def season(dt: datetime) -> str:
    if dt.month in (12, 1, 2): return "winter"
    if dt.month in (3, 4, 5): return "spring"
    if dt.month in (6, 7, 8): return "summer"
    return "autumn"


def val(series: dict[str, dict[str, float]], var: str, target: datetime):
    return (series.get(var) or {}).get(target.strftime("%Y-%m-%dT%H:00"))


def classify_regime(context: dict[str, dict[str, float]], target: datetime) -> str:
    ws = core.safe_float(val(context, "wind_speed_10m", target))
    wd = core.safe_float(val(context, "wind_direction_10m", target))
    pp = core.safe_float(val(context, "precipitation", target))
    cc = core.safe_float(val(context, "cloud_cover", target))
    if pp is not None and pp >= 0.2: return "wet/frontal"
    if ws is not None and ws >= 25: return "windy"
    if wd is not None and 45 <= wd <= 180: return "easterly/marine"
    if wd is not None and 225 <= wd <= 315: return "westerly/continental"
    if ws is not None and ws < 8 and (cc is None or cc < 40): return "calm/clear"
    if cc is not None and cc >= 75: return "cloudy/mixed"
    return "mixed"


def fetch_run(task):
    loc, lat, lon, model, run = task
    variables = CONTEXT_VARS if model == "gfs_seamless" else FORECAST_VARS
    q = {
        "latitude": lat, "longitude": lon, "timezone": "UTC", "temperature_unit": "celsius",
        "wind_speed_unit": "kmh", "precipitation_unit": "mm", "hourly": ",".join(variables),
        "models": model, "run": run.strftime("%Y-%m-%dT00:00"), "forecast_hours": "13",
    }
    try:
        j = base.get_json("https://single-runs-api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(q))
        h = j.get("hourly") or {}; times = h.get("time") or []
        return task, {var: {t: core.safe_float(x) for t, x in zip(times, h.get(var) or [])} for var in variables}
    except Exception as exc:
        return task, {}, str(exc)[:180]


def build_rows(obs_by_loc, forecasts, start):
    out = defaultdict(list)
    for loc in LOCATIONS:
        for day in range(DAYS):
            run = start + timedelta(days=day); daykey = run.strftime("%Y-%m-%d")
            context = forecasts.get((loc, "gfs_seamless", daykey), {})
            for lead in LEADS:
                target = run + timedelta(hours=lead)
                actual = obs_by_loc.get(loc, {}).get(target.strftime("%Y-%m-%dT%H"))
                if actual is None: continue
                fam_values = defaultdict(list); model_values = {}
                for model in MODELS:
                    fc = forecasts.get((loc, model, daykey), {})
                    pred = core.safe_float(val(fc, "temperature_2m", target))
                    if pred is None: continue
                    model_values[model] = pred; fam_values[base.family_for(model)].append(pred)
                families = {f: sum(v)/len(v) for f,v in fam_values.items() if v}
                if len(families) < 2: continue
                out[(loc, lead)].append({
                    "dt": target, "actual": float(actual), "families": families, "models": model_values,
                    "regime": classify_regime(context, target), "month": target.strftime("%Y-%m"),
                    "season": season(target), "loc": loc, "lead": lead,
                })
    for rows in out.values(): rows.sort(key=lambda r:r["dt"])
    return out


def evaluate(rows):
    stats = {k:{} for k in ["v2","mos","analog","engine3_reconstructed"]}
    model_stats = defaultdict(dict); cases=[]
    for i,row in enumerate(rows):
        actual=float(row["actual"]); prior=rows[:i]; v2p=base.v2_proxy(row); mos=analog=None
        if v2p is not None: base.update(stats["v2"],v2p,actual)
        for m,p in row["models"].items(): base.update(model_stats[m],float(p),actual)
        if len(prior)>=12:
            model=v3.fit_mos(prior)
            if model.get("available"):
                mos=v3.predict_mos(model,row["families"],row["dt"])
                if mos is not None: base.update(stats["mos"],float(mos),actual)
        if len(prior)>=8:
            a=v3.analog_predict(prior,row["families"],row["dt"],row["regime"])
            if a.get("available"):
                analog=core.safe_float(a.get("prediction"))
                if analog is not None: base.update(stats["analog"],analog,actual)
        weighted=[]
        if v2p is not None: weighted.append((v2p,.58))
        if mos is not None: weighted.append((float(mos),.27 if len(prior)>=24 else .18))
        if analog is not None: weighted.append((analog,.15))
        final=None
        if weighted:
            final=sum(v*w for v,w in weighted)/sum(w for _,w in weighted); base.update(stats["engine3_reconstructed"],final,actual)
        cases.append({
            "target":core.iso(row["dt"]),"actual":actual,"v2":v2p,"mos":mos,"analog":analog,
            "engine3_reconstructed":final,"models":row["models"],"regime":row["regime"],
            "month":row["month"],"season":row["season"],"loc":row["loc"],"lead":row["lead"],"prior_days":i,
        })
    return {k:base.finish(v) for k,v in stats.items()},{k:base.finish(v) for k,v in model_stats.items()},cases


def score_cases(cases):
    sources={k:{} for k in ["v2","mos","analog","engine3_reconstructed"]}; models=defaultdict(dict)
    for c in cases:
        a=float(c["actual"])
        for name in sources:
            p=core.safe_float(c.get(name))
            if p is not None: base.update(sources[name],p,a)
        for name,p in (c.get("models") or {}).items():
            p=core.safe_float(p)
            if p is not None: base.update(models[name],p,a)
    return {"forecast_sources":{k:base.finish(v) for k,v in sources.items()},"individual_models":{k:base.finish(v) for k,v in models.items()}}


def breakdown(cases, dimension):
    groups=defaultdict(list)
    for c in cases: groups[str(c.get(dimension,"unknown"))].append(c)
    return {k:score_cases(v) for k,v in sorted(groups.items())}


def main():
    end=(datetime.now(timezone.utc)-timedelta(days=1)).replace(hour=0,minute=0,second=0,microsecond=0)
    start=end-timedelta(days=DAYS-1)
    obs={}
    for loc,(_,_,bbox) in LOCATIONS.items(): obs[loc]=base.observations(bbox,start,end)
    tasks=[(loc,lat,lon,model,start+timedelta(days=d)) for loc,(lat,lon,_) in LOCATIONS.items() for model in MODELS for d in range(DAYS)]
    forecasts={}; failures=[]
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futs=[pool.submit(fetch_run,t) for t in tasks]
        for fut in as_completed(futs):
            result=fut.result(); task,fc=result[:2]; loc,_,_,model,run=task
            forecasts[(loc,model,run.strftime("%Y-%m-%d"))]=fc
            if len(result)>2: failures.append({"loc":loc,"model":model,"run":run.strftime("%Y-%m-%d"),"error":result[2]})
    rows=build_rows(obs,forecasts,start); locations={}; all_cases=[]
    for loc in LOCATIONS:
        leads={}
        for lead in LEADS:
            scores,models,cases=evaluate(rows.get((loc,lead),[])); all_cases.extend(cases)
            leads[str(lead)]={"scores":scores,"individual_models":models,"case_count":len(cases)}
        locations[loc]={"leads":leads}
    overall=score_cases(all_cases); v2m=overall["forecast_sources"]["v2"].get("mae"); v3m=overall["forecast_sources"]["engine3_reconstructed"].get("mae")
    improvement=(v2m-v3m)/v2m if v2m and v3m is not None else None
    report={
        "version":"2.0","method":"90-day archived 00Z strict causal Engine 3 temperature hindcast",
        "start":core.iso(start),"end":core.iso(end+timedelta(hours=12)),"days_requested":DAYS,"leads_hours":LEADS,
        "models":MODELS,"archive_requests":len(tasks),"archive_failures":len(failures),
        "archive_success_rate":(len(tasks)-len(failures))/len(tasks),"failure_examples":failures[:20],
        "leakage_policy":"strictly-earlier-days-only","overall":overall["forecast_sources"],
        "individual_models":overall["individual_models"],"engine3_vs_v2_mae_improvement":improvement,
        "locations":locations,"breakdowns":{
            "by_regime":breakdown(all_cases,"regime"),"by_season":breakdown(all_cases,"season"),
            "by_month":breakdown(all_cases,"month"),"by_lead":breakdown(all_cases,"lead"),"by_location":breakdown(all_cases,"loc")},
        "regime_definition":{
            "wet/frontal":"GFS archived precipitation >= 0.2 mm/h","windy":"wind >= 25 km/h",
            "easterly/marine":"wind direction 45-180 degrees","westerly/continental":"wind direction 225-315 degrees",
            "calm/clear":"wind < 8 km/h and cloud < 40%","cloudy/mixed":"cloud >= 75%","mixed":"remaining cases"},
        "limitations":[
            "Uses one standardized 00Z archived run per day, not every intraday cycle.",
            "Regimes are classified from issue-time archived GFS wind/precipitation/cloud context, not future observations.",
            "Reconstructed Engine 3 includes family consensus, causal MOS and causal analog layers; live observation nudge and later prospective champion decisions are excluded to prevent look-ahead.",
            "Historical ECCC climate-hourly mesh is the temperature verification target."],
    }
    OUT.write_text(json.dumps(report,indent=2,sort_keys=True,allow_nan=False)+"\n")
    print(json.dumps({"archive_requests":len(tasks),"archive_failures":len(failures),"success":report["archive_success_rate"],"overall":report["overall"],"improvement":improvement,"regimes":{k:v["forecast_sources"]["engine3_reconstructed"] for k,v in report["breakdowns"]["by_regime"].items()}},indent=2))

if __name__=="__main__": main()
