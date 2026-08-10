#!/usr/bin/env python3
"""Regression contracts for target-time truth, locations, and rain authority."""
from __future__ import annotations

import json
import re
from datetime import timedelta
from pathlib import Path

import accuracy_engine_v2 as core
import accuracy_engine_v3_verify as verify
import location_registry
import precip_nowcast_verifier as p06
import target_truth_archive as archive

ROOT=Path(__file__).resolve().parents[1]


def test_locations()->None:
    location_registry.install_core_locations(core)
    assert list(core.LOCATIONS)==["hrm","moncton","shediac","lunenburg","wolfville","uws"]
    assert [p[0] for p in core.LOCATIONS["wolfville"]["points"]]==["Wolfville","New Minas","Kentville"]
    assert core.LOCATIONS["moncton"]["timezone"]=="America/Moncton"


def test_target_time_variable_scoring()->None:
    now=core.utcnow().replace(minute=0,second=0,microsecond=0);target=now-timedelta(hours=2)
    state={"forecasts":[{"loc":"hrm","lead":1,"regime":"test","issued":core.iso(target-timedelta(hours=1)),"target":core.iso(target),"temperature_candidates":{"v2":20.0,"final_v3":19.5},"precip_candidates":{"raw":30.0,"calibrated":40.0},"real_feel_candidates":{},"issued_confidence":{},"scored":False,"temperature_scored":False,"precipitation_scored":False,"real_feel_scored":False,"truth_complete":False,"truth_variables":{}}],"scores":{},"precip_scores":{},"real_feel_reference_scores":{},"confidence_scores":{}}
    truth={"observations":{"hrm":[
        {"valid_time":core.iso(target+timedelta(minutes=30)),"provider":"ECCC","values":{"temperature_2m":18.0}},
        {"valid_time":core.iso(target+timedelta(hours=2)),"provider":"ECCC","values":{"precipitation":1.0}}
    ]}}
    latest={"hrm":{"time":core.iso(target+timedelta(hours=2)),"provider":"ECCC","values":{"temperature_2m":99.0,"precipitation":1.0}}}
    touched=verify.score_due(state,latest,truth);row=state["forecasts"][0]
    assert touched>=1
    assert row["temperature_scored"] is True and row["actual_temperature"]==18.0
    assert row["truth_variables"]["temperature_2m"]["offset_minutes"]==30.0
    assert row["precipitation_scored"] is False, row
    assert row["truth_complete"] is False
    assert "hrm:1:test:v2" in state["scores"]
    assert not state["precip_scores"]


def test_rain_raw_until_proven()->None:
    learning=p06._gate({"brier":{}},"hrm",1)
    assert learning["use"]=="raw" and learning["production_authority"]==0.0
    proven=p06._gate({"brier":{"hrm:1:raw":{"n":20,"brier":.12},"hrm:1:calibrated":{"n":20,"brier":.11}}},"hrm",1)
    assert proven["use"]=="calibrated" and proven["production_authority"]==1.0
    worse=p06._gate({"brier":{"hrm:1:raw":{"n":20,"brier":.10},"hrm:1:calibrated":{"n":20,"brier":.14}}},"hrm",1)
    assert worse["use"]=="raw" and worse["production_authority"]==0.0
    target=core.utcnow().replace(minute=0,second=0,microsecond=0)-timedelta(hours=1)
    gauge,wet,meta=p06._actual_from({"loc":"hrm","target":core.iso(target)},None,{"radar":{"hrm":[]}})
    assert gauge is None and wet is None and meta["source"] is None
    hist={"radar":{"hrm":[{"valid_time":core.iso(target+timedelta(minutes=10)),"values":{"radar_rain_rate":0.2}}]}}
    gauge,wet,meta=p06._actual_from({"loc":"hrm","target":core.iso(target)},None,hist)
    assert gauge is None and wet is True and meta["source"]=="archived-radar-target-time"


def test_no_unsafe_numeric_predicates()->None:
    offenders=[]
    for path in list(ROOT.glob("*.js"))+list((ROOT/"scripts").glob("*.mjs")):
        for lineno,line in enumerate(path.read_text(encoding="utf-8").splitlines(),1):
            if "Number.isFinite(Number(" not in line:continue
            # A coercive finite predicate is acceptable only when the same predicate
            # explicitly rejects null/undefined/empty-string before Number(...).
            safe=bool(re.search(r"(?:!==?null|!==?undefined|!==?'')",line))
            if not safe:offenders.append(f"{path.relative_to(ROOT)}:{lineno}:{line.strip()}")
    assert not offenders,"unsafe null->0 numeric predicate(s):\n"+"\n".join(offenders)


def main()->None:
    test_locations();test_target_time_variable_scoring();test_rain_raw_until_proven();test_no_unsafe_numeric_predicates();print("P0 truth/location/precip contracts passed")

if __name__=="__main__":main()
