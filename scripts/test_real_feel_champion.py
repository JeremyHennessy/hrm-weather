#!/usr/bin/env python3
"""Regression checks for Real Feel production selection."""
from __future__ import annotations
import accuracy_engine_v2 as core
import accuracy_engine_v3_publish as publish


def _engine():
    return {"consensus":{"hrm":{"regime":{"name":"test-regime"},"hours":{"1":{"target":core.iso(core.utcnow())}}}}}


def _run(provider):
    engine=_engine()
    original_predict=publish.realfeel.predict
    try:
        publish.realfeel.predict=lambda *args, **kwargs:{
            "available":True,"real_feel":30.0,"physical_real_feel":28.0,"steadman_real_feel":28.0,
            "legacy_real_feel":31.0,"local_correction":{"correction":2.0},
            "inputs":{"provider_apparent_temperature":provider},
        }
        publish.apply_real_feel(engine,[],{"hrm":{}},{"hrm":{"name":"test-regime"}},{"real_feel_reference_scores":{},"forecasts":[]})
    finally:
        publish.realfeel.predict=original_predict
    return engine["consensus"]["hrm"]["hours"]["1"]


def main():
    provider=_run(21.0)
    assert provider["real_feel"]==21.0,provider
    assert provider["real_feel_source"]=="provider-apparent-champion",provider
    assert provider["real_feel_engine"]["production_real_feel"]==21.0,provider
    assert provider["real_feel_engine"]["local_calibration_role"]=="shadow-only",provider
    fallback=_run(None)
    assert fallback["real_feel"]==28.0,fallback
    assert fallback["real_feel_source"]=="steadman-fallback",fallback
    print("real-feel production selection: PASS")


if __name__=="__main__":main()
