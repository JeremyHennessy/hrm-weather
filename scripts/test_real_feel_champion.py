#!/usr/bin/env python3
"""Regression checks for Real Feel champion/challenger production selection."""
from __future__ import annotations

import accuracy_engine_v2 as core
import accuracy_engine_v3_publish as publish


def _engine():
    return {
        "consensus": {
            "hrm": {
                "regime": {"name": "test-regime"},
                "hours": {"1": {"target": core.iso(core.utcnow())}},
            }
        }
    }


def _run(gate_status: str):
    engine = _engine()
    original_predict = publish.realfeel.predict
    original_gate = publish.champion.real_feel_gate
    try:
        publish.realfeel.predict = lambda *args, **kwargs: {
            "available": True,
            "real_feel": 30.0,
            "physical_real_feel": 28.0,
            "local_correction": {"correction": 2.0},
        }
        publish.champion.real_feel_gate = lambda *args, **kwargs: {
            "status": gate_status,
            "samples": 24,
            "source": "test",
        }
        publish.apply_real_feel(engine, [], {"hrm": {}}, {"hrm": {"name": "test-regime"}}, {})
    finally:
        publish.realfeel.predict = original_predict
        publish.champion.real_feel_gate = original_gate
    return engine["consensus"]["hrm"]["hours"]["1"]


def main():
    losing = _run("challenger-underperforming")
    assert losing["real_feel"] == 28.0, losing
    assert losing["real_feel_source"] == "physical-real-feel-champion", losing
    assert losing["real_feel_engine"]["production_real_feel"] == 28.0, losing

    learning = _run("learning")
    assert learning["real_feel"] == 28.0, learning
    assert learning["real_feel_source"] == "physical-real-feel-champion", learning

    promoted = _run("promotion-approved")
    assert promoted["real_feel"] == 30.0, promoted
    assert promoted["real_feel_source"] == "local-calibrated-challenger", promoted
    print("real-feel champion selection: PASS")


if __name__ == "__main__":
    main()
