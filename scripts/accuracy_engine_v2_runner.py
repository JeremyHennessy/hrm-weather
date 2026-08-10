#!/usr/bin/env python3
"""Production runner for Accuracy Engine 2.0.

Parallelizes independent network probes and supplies real optional challenger
adapters for Pirate Weather, Tomorrow.io and meteoblue. The statistical and
consensus primitives stay in accuracy_engine_v2.py so there is one source of
truth for scoring mathematics.
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any

import accuracy_engine_v2 as core

MAX_WORKERS = int(os.getenv("WX_COLLECT_WORKERS", "16"))


def post_json(url: str, body: dict[str, Any], timeout: int = 18, headers: dict[str, str] | None = None) -> Any:
    h = {"User-Agent": "weather-consensus/2.0", "Content-Type": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def recursive_number(obj: Any, names: set[str]) -> float | None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.lower() in names:
                x = core.safe_float(v)
                if x is not None:
                    return x
        for v in obj.values():
            x = recursive_number(v, names)
            if x is not None:
                return x
    elif isinstance(obj, list):
        for v in obj[:12]:
            x = recursive_number(v, names)
            if x is not None:
                return x
    return None


def models_for_location(lname: str, loc: dict[str, Any]) -> list[tuple]:
    fn = getattr(core, "models_for_location", None)
    if callable(fn):
        return list(fn(loc))
    return list(core.MODELS)


def nbm_benchmark(loc: dict[str, Any]) -> dict[str, Any]:
    """Open-Meteo NBM adapter for U.S. benchmark context only.

    NBM is a post-processed blend and therefore is deliberately not counted as
    an independent NWP-family vote.
    """
    if str(loc.get("country") or "CA").upper() != "US":
        return {"configured": False, "status": "not-applicable", "role": "challenger-only"}
    q = {
        "latitude": loc["lat"], "longitude": loc["lon"], "timezone": "UTC",
        "forecast_days": 2, "temperature_unit": "celsius", "wind_speed_unit": "kmh",
        "models": "ncep_nbm_conus",
        "current": "temperature_2m,apparent_temperature,precipitation,wind_speed_10m,wind_gusts_10m,cloud_cover",
    }
    try:
        j = core.get_json("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(q), timeout=18)
        c = j.get("current") or {}
        return {
            "configured": True, "status": "ok", "role": "challenger-only", "provider": "NOAA NBM via Open-Meteo",
            "temperature": core.safe_float(c.get("temperature_2m")),
            "apparent_temperature": core.safe_float(c.get("apparent_temperature")),
            "precipitation": core.safe_float(c.get("precipitation")),
            "wind_speed": core.safe_float(c.get("wind_speed_10m")),
            "wind_gust": core.safe_float(c.get("wind_gusts_10m")),
            "cloud_cover": core.safe_float(c.get("cloud_cover")),
        }
    except Exception as e:
        return {"configured": True, "status": "error", "role": "challenger-only", "error": type(e).__name__}


def challenger_benchmarks(loc: dict[str, Any]) -> dict[str, Any]:
    """Fetch credential-gated meta/provider challengers.

    These are intentionally benchmark-only. They are never promoted to an
    independent NWP family vote, because their products can themselves blend
    models already present in Weather Consensus.
    """
    lat, lon = loc["lat"], loc["lon"]
    out: dict[str, Any] = {"nbm": nbm_benchmark(loc)}

    pirate = os.getenv("PIRATE_WEATHER_API_KEY")
    if not pirate:
        out["pirate_weather"] = {"configured": False, "status": "not-configured", "role": "challenger-only"}
    else:
        try:
            url = f"https://api.pirateweather.net/forecast/{urllib.parse.quote(pirate)}/{lat},{lon}?units=si&extend=hourly"
            j = core.get_json(url, timeout=18)
            cur = j.get("currently") or {}
            out["pirate_weather"] = {
                "configured": True, "status": "ok", "role": "challenger-only",
                "temperature": core.safe_float(cur.get("temperature")),
                "apparent_temperature": core.safe_float(cur.get("apparentTemperature")),
                "precipitation_probability": core.safe_float(cur.get("precipProbability")),
            }
        except Exception as e:
            out["pirate_weather"] = {"configured": True, "status": "error", "role": "challenger-only", "error": type(e).__name__}

    tomorrow = os.getenv("TOMORROW_API_KEY")
    if not tomorrow:
        out["tomorrow_io"] = {"configured": False, "status": "not-configured", "role": "challenger-only"}
    else:
        try:
            q = urllib.parse.urlencode({"location": f"{lat},{lon}", "timesteps": "1h", "units": "metric", "apikey": tomorrow})
            j = core.get_json("https://api.tomorrow.io/v4/weather/forecast?" + q, timeout=18)
            out["tomorrow_io"] = {
                "configured": True, "status": "ok", "role": "challenger-only",
                "temperature": recursive_number(j, {"temperature", "temperatureavg"}),
                "apparent_temperature": recursive_number(j, {"temperatureapparent", "temperatureapparentavg"}),
                "precipitation_probability": recursive_number(j, {"precipitationprobability"}),
                "wind_speed": recursive_number(j, {"windspeed", "windspeedavg"}),
            }
        except Exception as e:
            out["tomorrow_io"] = {"configured": True, "status": "error", "role": "challenger-only", "error": type(e).__name__}

    meteoblue = os.getenv("METEOBLUE_API_KEY")
    if not meteoblue:
        out["meteoblue"] = {"configured": False, "status": "not-configured", "role": "challenger-only"}
    else:
        try:
            q = urllib.parse.urlencode({"lat": lat, "lon": lon, "apikey": meteoblue})
            j = core.get_json("https://my.meteoblue.com/packages/basic-1h?" + q, timeout=18)
            out["meteoblue"] = {
                "configured": True, "status": "ok", "role": "challenger-only",
                "temperature": recursive_number(j, {"temperature", "temperature_mean", "temperaturemean"}),
                "apparent_temperature": recursive_number(j, {"felttemperature", "felt_temperature", "apparent_temperature"}),
                "precipitation_probability": recursive_number(j, {"precipitation_probability", "precipitationprobability"}),
                "wind_speed": recursive_number(j, {"windspeed", "wind_speed"}),
            }
        except Exception as e:
            out["meteoblue"] = {"configured": True, "status": "error", "role": "challenger-only", "error": type(e).__name__}
    return out


def forecast_task(lname: str, loc: dict[str, Any], model: str):
    return lname, model, core.forecast_location(loc, model)


def observation_task(lname: str, loc: dict[str, Any]):
    return lname, core.eccc_observation_mesh(loc)


def nowcast_task(lname: str, loc: dict[str, Any]):
    return lname, core.geomet_nowcast(loc)


def ensemble_task(lname: str, loc: dict[str, Any]):
    return lname, core.ensemble_summary(loc)


def benchmark_task(lname: str, loc: dict[str, Any]):
    return lname, challenger_benchmarks(loc)


def main() -> None:
    now = core.utcnow()
    state = core.load(core.SKILL, {"updated_at": None, "skills": {}})
    skill = state.get("skills", {})
    ledger = core.load(core.LEDGER, [])
    history = core.load(core.RUN_HISTORY, [])

    observations: dict[str, Any] = {k: None for k in core.LOCATIONS}
    nowcasts: dict[str, Any] = {k: {} for k in core.LOCATIONS}
    ensembles: dict[str, Any] = {k: {} for k in core.LOCATIONS}
    benchmarks: dict[str, Any] = {k: {} for k in core.LOCATIONS}
    forecasts: dict[str, dict[str, Any]] = {k: {} for k in core.LOCATIONS}
    expected_models = {k: models_for_location(k, v) for k, v in core.LOCATIONS.items()}

    jobs = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for lname, loc in core.LOCATIONS.items():
            jobs.append(("obs", pool.submit(observation_task, lname, loc)))
            jobs.append(("nowcast", pool.submit(nowcast_task, lname, loc)))
            jobs.append(("ensemble", pool.submit(ensemble_task, lname, loc)))
            jobs.append(("benchmark", pool.submit(benchmark_task, lname, loc)))
            for model, *_ in expected_models[lname]:
                jobs.append(("forecast", pool.submit(forecast_task, lname, loc, model)))

        for kind, fut in jobs:
            try:
                result = fut.result()
            except Exception:
                continue
            if kind == "obs":
                lname, value = result
                observations[lname] = value
            elif kind == "nowcast":
                lname, value = result
                nowcasts[lname] = value or {}
            elif kind == "ensemble":
                lname, value = result
                ensembles[lname] = value or {}
            elif kind == "benchmark":
                lname, value = result
                benchmarks[lname] = value or {}
            else:
                lname, model, value = result
                if value:
                    forecasts[lname][model] = value

    regimes: dict[str, Any] = {}
    source_health: dict[str, Any] = {}
    for lname, loc in core.LOCATIONS.items():
        regime_fc = (
            forecasts[lname].get("ncep_hrrr_conus")
            or forecasts[lname].get("gem_hrdps_continental")
            or forecasts[lname].get("gem_regional")
            or forecasts[lname].get("ecmwf_ifs025")
            or forecasts[lname].get("gfs_seamless")
        )
        regimes[lname] = core.classify_regime(observations.get(lname), regime_fc, loc)
        products = ensembles.get(lname) or {}
        source_health[lname] = {
            "deterministic_models": len(forecasts[lname]),
            "deterministic_expected": len(expected_models[lname]),
            "ensemble_products": sum(1 for e in products.values() if e.get("variables")),
            "ensemble_expected": len(core.ENSEMBLE_META),
            "radar": bool((nowcasts.get(lname) or {}).get("radar_available")),
            "radar_extrapolation": bool((nowcasts.get(lname) or {}).get("radar_extrapolation_available")),
            "rdpa": bool((nowcasts.get(lname) or {}).get("rdpa_available")),
            "observation_stations": int((observations.get(lname) or {}).get("station_count", 0)),
            "observation_provider": (observations.get(lname) or {}).get("provider") or loc.get("official_source") or "ECCC",
            "challengers_configured": sum(1 for x in (benchmarks.get(lname) or {}).values() if x.get("configured")),
            "challengers_live": sum(1 for x in (benchmarks.get(lname) or {}).values() if x.get("status") == "ok"),
        }

    scored = core.score_ledger(ledger, skill, observations, nowcasts)
    added = core.create_targets(ledger, history, forecasts, regimes)
    added += core.create_ensemble_targets(ledger, ensembles, regimes)
    stability = core.stability_from_history(history)
    consensus = core.build_consensus(skill, stability, forecasts, ensembles, observations, nowcasts, regimes)

    ledger = [e for e in ledger if (core.parse_stamp(e.get("issued")) or now) > now - timedelta(days=45)]
    history = [e for e in history if (core.parse_stamp(e.get("issued")) or now) > now - timedelta(days=14)]

    state = {"version": 2, "updated_at": core.iso(now), "observations": observations, "skills": skill}
    engine = {
        "version": "2.0",
        "updated_at": core.iso(now),
        "architecture": {
            "engines": ["nowcast", "learned_local", "raw_ensemble"],
            "blend_weights": {str(h): core.blend_weights(h) for h in core.LEADS},
            "family_aware_weighting": True,
            "bias_correction": True,
            "run_stability": True,
            "regime_conditioning": True,
            "parallel_collection": True,
            "location_specific_model_sets": True,
            "metrics": ["MAE", "bias", "RMSE", "Brier", "CRPS", "run-change MAE"],
        },
        "model_families": {m: core.MODEL_META[m]["family"] for m in core.MODEL_META},
        "location_model_sets": {loc: [m[0] for m in rows] for loc, rows in expected_models.items()},
        "ensemble_products": core.ENSEMBLE_META,
        "observations": observations,
        "nowcast": nowcasts,
        "regimes": regimes,
        "stability": stability,
        "consensus": consensus,
        "best_models": {loc: core.aggregate_best_models(skill, loc) for loc in core.LOCATIONS},
        "source_health": source_health,
        "benchmarks": benchmarks,
        "collector": {"workers": MAX_WORKERS, "scored_this_run": scored, "targets_added": added, "ledger_rows": len(ledger), "history_rows": len(history)},
    }
    core.save(core.SKILL, state)
    core.save(core.LEDGER, ledger)
    core.save(core.RUN_HISTORY, history)
    core.save(core.ENGINE, engine)

    print(
        f"accuracy-v2 parallel workers={MAX_WORKERS} scored={scored} added={added} "
        f"skills={len(skill)} ledger={len(ledger)} history={len(history)} "
        f"obs={sum(1 for x in observations.values() if x)} "
        f"models={sum(v['deterministic_models'] for v in source_health.values())} "
        f"ensembles={sum(v['ensemble_products'] for v in source_health.values())}"
    )


if __name__ == "__main__":
    main()
