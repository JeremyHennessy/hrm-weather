#!/usr/bin/env python3
"""Multi-week archived-model hindcast for Weather Consensus Engine 3.

Fetches historical 00Z model runs from Open-Meteo Single Runs and historical
ECCC hourly observations. For each location and +3/+6/+12h lead it replays the
current causal temperature architecture: family-aware V2 proxy, MOS trained on
strictly earlier days, analog forecasting from strictly earlier days, and the
production-prior reconstructed Engine 3 blend. No future observation is used to
predict an earlier date.
"""
from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import accuracy_engine_v2 as core
import accuracy_engine_v3 as v3

OUT = core.DATA / "archive-backtest-v3.json"
DAYS = 21
LEADS = [3, 6, 12]
MAX_WORKERS = 14
HTTP_TIMEOUT = 16
MODELS = [
    "gem_hrdps_continental",
    "gem_regional",
    "ecmwf_ifs025",
    "gfs_seamless",
    "icon_seamless",
    "ukmo_seamless",
]
LOCATIONS = {
    "hrm": (44.6488, -63.5752, [-63.80, 44.48, -63.42, 44.84]),
    "moncton": (46.0878, -64.7782, [-64.95, 45.98, -64.62, 46.20]),
    "shediac": (46.2198, -64.5411, [-64.68, 46.10, -64.40, 46.34]),
    "lunenburg": (44.377896, -64.309529, [-64.46, 44.25, -64.15, 44.50]),
    "wolfville": (45.0791, -64.4383, [-64.62, 44.98, -64.22, 45.20]),
}


def get_json(url: str, timeout: int = HTTP_TIMEOUT) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "weather-consensus-archive-backtest/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def observations(bbox, start, end) -> dict[str, float]:
    q = {
        "bbox": ",".join(map(str, bbox)),
        "datetime": f"{start:%Y-%m-%d}T00:00:00Z/{end:%Y-%m-%d}T23:59:59Z",
        "limit": "10000",
        "f": "json",
    }
    j = get_json("https://api.weather.gc.ca/collections/climate-hourly/items?" + urllib.parse.urlencode(q), 25)
    groups: dict[str, list[float]] = defaultdict(list)
    for f in j.get("features", []):
        p = f.get("properties") or {}
        stamp = p.get("UTC_DATE") or p.get("DATE")
        t = core.safe_float(p.get("TEMP"))
        if stamp and t is not None:
            groups[str(stamp).replace(" ", "T")[:13]].append(t)
    return {k: sum(v) / len(v) for k, v in groups.items() if v}


def fetch_run(task):
    loc, lat, lon, model, run = task
    q = {
        "latitude": lat,
        "longitude": lon,
        "timezone": "UTC",
        "temperature_unit": "celsius",
        "hourly": "temperature_2m",
        "models": model,
        "run": run.strftime("%Y-%m-%dT00:00"),
        "forecast_hours": "13",
    }
    try:
        j = get_json("https://single-runs-api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(q))
        h = j.get("hourly") or {}
        return task, {t: core.safe_float(v) for t, v in zip(h.get("time", []), h.get("temperature_2m", []))}
    except Exception as exc:
        return task, {}, str(exc)[:160]


def family_for(model: str) -> str:
    meta = core.MODEL_META.get(model) or {}
    return str(meta.get("family") or model)


def build_rows(obs_by_loc, forecasts, start) -> dict[tuple[str, int], list[dict[str, Any]]]:
    out: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for loc in LOCATIONS:
        for day in range(DAYS):
            run = start + timedelta(days=day)
            for lead in LEADS:
                target = run + timedelta(hours=lead)
                actual = obs_by_loc.get(loc, {}).get(target.strftime("%Y-%m-%dT%H"))
                if actual is None:
                    continue
                fam_values: dict[str, list[float]] = defaultdict(list)
                model_values = {}
                for model in MODELS:
                    pred = forecasts.get((loc, model, run.strftime("%Y-%m-%d")), {}).get(target.strftime("%Y-%m-%dT%H:00"))
                    if pred is None:
                        continue
                    model_values[model] = pred
                    fam_values[family_for(model)].append(pred)
                families = {f: sum(v) / len(v) for f, v in fam_values.items() if v}
                if len(families) < 2:
                    continue
                out[(loc, lead)].append({
                    "dt": target,
                    "actual": actual,
                    "families": families,
                    "models": model_values,
                    "regime": "archive-unknown",
                })
    for rows in out.values(): rows.sort(key=lambda r: r["dt"])
    return out


def update(s: dict[str, Any], pred: float, actual: float) -> None:
    e = pred - actual
    n = int(s.get("n", 0))
    s["n"] = n + 1
    s["mae"] = (float(s.get("mae", 0)) * n + abs(e)) / (n + 1)
    s["mse"] = (float(s.get("mse", 0)) * n + e * e) / (n + 1)
    s["bias"] = (float(s.get("bias", 0)) * n + e) / (n + 1)
    s["within_1c"] = int(s.get("within_1c", 0)) + int(abs(e) <= 1)
    s["within_2c"] = int(s.get("within_2c", 0)) + int(abs(e) <= 2)


def finish(s: dict[str, Any]) -> dict[str, Any]:
    n = int(s.get("n", 0))
    return {
        "n": n,
        "mae": s.get("mae"),
        "rmse": math.sqrt(float(s.get("mse", 0))) if n else None,
        "bias": s.get("bias"),
        "within_1c": int(s.get("within_1c", 0)) / n if n else None,
        "within_2c": int(s.get("within_2c", 0)) / n if n else None,
    }


def v2_proxy(row):
    vals = [core.safe_float(x) for x in (row.get("families") or {}).values()]
    vals = [x for x in vals if x is not None]
    return sum(vals) / len(vals) if vals else None


def evaluate(rows):
    stats = {k: {} for k in ["v2", "mos", "analog", "engine3_reconstructed"]}
    model_stats: dict[str, dict[str, Any]] = defaultdict(dict)
    cases = []
    for i, row in enumerate(rows):
        actual = float(row["actual"])
        prior = rows[:i]
        v2p = v2_proxy(row)
        mos = analog = None
        if v2p is not None: update(stats["v2"], v2p, actual)
        for model, pred in (row.get("models") or {}).items(): update(model_stats[model], float(pred), actual)
        if len(prior) >= 12:
            m = v3.fit_mos(prior)
            if m.get("available"):
                mos = v3.predict_mos(m, row["families"], row["dt"])
                if mos is not None: update(stats["mos"], float(mos), actual)
        if len(prior) >= 8:
            a = v3.analog_predict(prior, row["families"], row["dt"], "archive-unknown")
            if a.get("available"):
                analog = core.safe_float(a.get("prediction"))
                if analog is not None: update(stats["analog"], analog, actual)
        weighted = []
        if v2p is not None: weighted.append((v2p, .58))
        if mos is not None: weighted.append((float(mos), .27 if len(prior) >= 24 else .18))
        if analog is not None: weighted.append((analog, .15))
        final = None
        if weighted:
            final = sum(v*w for v,w in weighted) / sum(w for _,w in weighted)
            update(stats["engine3_reconstructed"], final, actual)
        cases.append({"target": core.iso(row["dt"]), "actual": actual, "v2": v2p, "mos": mos, "analog": analog, "engine3_reconstructed": final, "prior_days": i})
    return {k: finish(v) for k,v in stats.items()}, {k: finish(v) for k,v in model_stats.items()}, cases


def aggregate(results, key):
    acc: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for loc in results.values():
        for lead in loc["leads"].values():
            for name, s in lead.get(key, {}).items():
                n = int(s.get("n", 0))
                if not n: continue
                a = acc[name]; a["n"] += n; a["mae"] += float(s["mae"])*n; a["mse"] += float(s["rmse"])**2*n; a["bias"] += float(s["bias"])*n; a["w1"] += float(s["within_1c"])*n; a["w2"] += float(s["within_2c"])*n
    out={}
    for name,a in acc.items():
        n=int(a["n"]);out[name]={"n":n,"mae":a["mae"]/n,"rmse":math.sqrt(a["mse"]/n),"bias":a["bias"]/n,"within_1c":a["w1"]/n,"within_2c":a["w2"]/n}
    return out


def main():
    end = (datetime.now(timezone.utc) - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    start = end - timedelta(days=DAYS-1)
    obs_by_loc = {}
    for loc, (_,_,bbox) in LOCATIONS.items():
        try: obs_by_loc[loc] = observations(bbox, start, end)
        except Exception: obs_by_loc[loc] = {}
    tasks=[]
    for loc,(lat,lon,_) in LOCATIONS.items():
        for model in MODELS:
            for day in range(DAYS): tasks.append((loc,lat,lon,model,start+timedelta(days=day)))
    forecasts={};failures=[]
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures=[pool.submit(fetch_run,t) for t in tasks]
        for fut in as_completed(futures):
            result=fut.result();task,fc=result[:2];loc,_,_,model,run=task
            forecasts[(loc,model,run.strftime("%Y-%m-%d"))]=fc
            if len(result)>2: failures.append({"loc":loc,"model":model,"run":run.strftime("%Y-%m-%d"),"error":result[2]})
    rows=build_rows(obs_by_loc,forecasts,start)
    locations={}
    for loc in LOCATIONS:
        leads={}
        for lead in LEADS:
            scores,models,cases=evaluate(rows.get((loc,lead),[]))
            leads[str(lead)]={"scores":scores,"individual_models":models,"cases":cases}
        locations[loc]={"leads":leads}
    overall=aggregate(locations,"scores");individual=aggregate(locations,"individual_models")
    v2=(overall.get("v2") or {}).get("mae");v3m=(overall.get("engine3_reconstructed") or {}).get("mae")
    improvement=(v2-v3m)/v2 if isinstance(v2,(int,float)) and v2>0 and isinstance(v3m,(int,float)) else None
    report={
        "version":"1.0","method":"21-day archived 00Z strict causal Engine 3 temperature hindcast","start":core.iso(start),"end":core.iso(end+timedelta(hours=12)),"days_requested":DAYS,"leads_hours":LEADS,"models":MODELS,"archive_requests":len(tasks),"archive_failures":len(failures),"failure_examples":failures[:20],"leakage_policy":"strictly-earlier-days-only","overall":overall,"individual_models":individual,"engine3_vs_v2_mae_improvement":improvement,"locations":locations,
        "limitations":["Uses one standardized 00Z archived model run per day, not every intraday model cycle.","Reconstructed Engine 3 includes family consensus, causal MOS and causal analog layers; live observation nudge and later champion/weight decisions are excluded to prevent look-ahead.","Historical ECCC climate-hourly mesh is used as the verifying observation target."],
    }
    OUT.write_text(json.dumps(report,indent=2,sort_keys=True,allow_nan=False)+"\n")
    print(json.dumps({"start":report["start"],"end":report["end"],"archive_requests":len(tasks),"archive_failures":len(failures),"overall":overall,"individual_models":individual,"engine3_vs_v2_mae_improvement":improvement},indent=2))

if __name__=="__main__": main()
