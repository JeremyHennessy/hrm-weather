#!/usr/bin/env python3
"""Publish Accuracy Engine 3.0 after the V2 production collector completes."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import accuracy_engine_v2 as core
import accuracy_engine_v3 as v3
from accuracy_engine_v3_pooling import install as install_v3_pooling

install_v3_pooling()


def main() -> None:
    v2_engine = core.load(core.ENGINE, {})
    ledger = core.load(core.LEDGER, [])
    skill = core.load(core.SKILL, {})
    observations = skill.get("observations", {})
    forecasts = {name: {} for name in core.LOCATIONS}

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
    engine["collector"] = {
        "deterministic_forecasts": sum(len(x) for x in forecasts.values()),
        "verified_ledger_rows": sum(1 for x in ledger if x.get("scored")),
        "training_ledger_rows": len(ledger),
        "lead_pooling": True,
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
        f"verified={engine['collector']['verified_ledger_rows']} mos_ready={mos_ready} analog_ready={analog_ready}"
    )


if __name__ == "__main__":
    main()
