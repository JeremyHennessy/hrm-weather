#!/usr/bin/env python3
"""Publish Accuracy Engine 3.0 after the V2 production collector completes."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import accuracy_engine_v2 as core
import accuracy_engine_v3 as v3
import accuracy_engine_v3_verify as verify
from accuracy_engine_v3_pooling import install as install_v3_pooling

install_v3_pooling()


def apply_adaptive_verification(engine: dict, state: dict) -> None:
    """Reblend V3 using measured out-of-sample skill of each added layer."""
    summary = {}
    for loc, payload in (engine.get("consensus") or {}).items():
        regime = ((payload.get("regime") or {}).get("name")) or "unknown"
        loc_summary = {}
        for lead_s, h in (payload.get("hours") or {}).items():
            lead = int(lead_s)
            comps = h.get("components") or {}
            v2temp = core.safe_float(comps.get("v2_consensus"))
            mos = core.safe_float(comps.get("mos"))
            analog = core.safe_float(comps.get("analog"))
            nudge = core.safe_float(comps.get("observation_nudge"))
            mos_skill = verify.adaptive_factor(state, loc, lead, regime, "mos")
            analog_skill = verify.adaptive_factor(state, loc, lead, regime, "analog")
            nudge_skill = verify.adaptive_factor(state, loc, lead, regime, "nudge")

            weighted = []
            if v2temp is not None:
                weighted.append((v2temp, 0.58))
            if mos is not None:
                base = 0.27 if int(h.get("mos_samples", 0)) >= 24 else 0.18
                weighted.append((mos, base * float(mos_skill["factor"])))
            if analog is not None:
                weighted.append((analog, 0.15 * float(analog_skill["factor"])))
            if weighted:
                den = sum(w for _, w in weighted)
                temp = sum(v * w for v, w in weighted) / den
                if nudge is not None:
                    temp += max(-1.5, min(1.5, nudge * 0.65 * float(nudge_skill["factor"])))
                h["temperature_2m"] = temp

            raw_pop = core.safe_float(h.get("raw_precipitation_probability"))
            cal_pop = core.safe_float(h.get("precipitation_probability"))
            pop_skill = verify.precipitation_factor(state, loc, lead, regime)
            if raw_pop is not None and cal_pop is not None:
                f = float(pop_skill["factor"])
                h["precipitation_probability"] = raw_pop * (1 - f) + cal_pop * f

            h["adaptive_skill"] = {
                "mos": mos_skill,
                "analog": analog_skill,
                "observation_nudge": nudge_skill,
                "precipitation_calibration": pop_skill,
            }
            loc_summary[lead_s] = h["adaptive_skill"]
        summary[loc] = loc_summary
    engine["verification"] = {
        "mode": "shadow-out-of-sample",
        "minimum_samples_before_adaptation": verify.MIN_ADAPT_SAMPLES,
        "adaptive_layers": ["mos", "analog", "observation_nudge", "precipitation_calibration"],
        "scores": state.get("scores", {}),
        "precip_scores": state.get("precip_scores", {}),
        "adaptive_status": summary,
    }


def main() -> None:
    v2_engine = core.load(core.ENGINE, {})
    ledger = core.load(core.LEDGER, [])
    skill = core.load(core.SKILL, {})
    observations = skill.get("observations", {})
    forecasts = {name: {} for name in core.LOCATIONS}

    verification = verify.load_state()
    shadow_scored = verify.score_due(verification, observations)

    jobs = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        for lname, loc in core.LOCATIONS.items():
            for model, *_ in core.MODELS:
                jobs.append((lname, model, pool.submit(core.forecast_location, loc, model)))
        for lname, model, fut in jobs:
            try:
                result = fut.result()
            except Exception:
                result = None
            if result:
                forecasts[lname][model] = result

    regimes = {}
    for lname, loc in core.LOCATIONS.items():
        regime_fc = (
            forecasts[lname].get("gem_hrdps_continental")
            or forecasts[lname].get("gem_regional")
            or forecasts[lname].get("ecmwf_ifs025")
            or forecasts[lname].get("gfs_seamless")
        )
        regimes[lname] = core.classify_regime(observations.get(lname), regime_fc, loc)

    engine = v3.build_engine_v3(v2_engine, ledger, forecasts, observations, regimes)
    apply_adaptive_verification(engine, verification)
    shadow_added = verify.add_current_forecasts(verification, engine)
    verify.save_state(verification)

    engine["collector"] = {
        "deterministic_forecasts": sum(len(x) for x in forecasts.values()),
        "verified_ledger_rows": sum(1 for x in ledger if x.get("scored")),
        "training_ledger_rows": len(ledger),
        "lead_pooling": True,
        "shadow_forecasts_scored": shadow_scored,
        "shadow_forecasts_added": shadow_added,
        "shadow_history_rows": len(verification.get("forecasts", [])),
    }
    core.save(v3.ENGINE_V3, engine)
    mos_ready = sum(
        1 for loc in engine.get("diagnostics", {}).values()
        for item in (loc.get("mos") or {}).values() if item.get("available")
    )
    analog_ready = sum(
        1 for loc in engine.get("diagnostics", {}).values()
        for item in (loc.get("analogs") or {}).values() if item.get("available")
    )
    print(
        f"accuracy-v3 forecasts={engine['collector']['deterministic_forecasts']} "
        f"verified={engine['collector']['verified_ledger_rows']} mos_ready={mos_ready} analog_ready={analog_ready} "
        f"shadow_scored={shadow_scored} shadow_added={shadow_added}"
    )


if __name__ == "__main__":
    main()
