#!/usr/bin/env python3
"""Prospective 0-6 hour precipitation accuracy project.

Archives hourly issue-time precipitation probability/intensity at 0/1/2/3/4/5/6h,
the official GeoMet radar extrapolation signal already collected by Engine 2, and
later official gauge/radar/RDPA outcomes. Scores onset, cessation, false alarms,
intensity and raw-vs-calibrated Brier skill. Calibration is evidence-gated and
falls back to raw probability where paired prospective Brier is worse.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

import accuracy_engine_v2 as core
import accuracy_engine_v3 as v3

STATE = core.DATA / "precip-nowcast-verification.json"
VERSION = "2.0"
LEADS = tuple(range(0, 7))
WET_THRESHOLD_MM = core.PRECIP_THRESHOLD
LIKELY_THRESHOLD_PCT = 50.0
RADAR_WET_RATE = 0.05
MIN_GATE_SAMPLES = 20
MAX_AGE_DAYS = 60
RADAR_LAYER = "Radar_1km_RainPrecipRate-Extrapolation"


def _load() -> dict[str, Any]:
    return core.load(STATE, {"version": VERSION, "updated_at": None, "rows": [], "cycles": [], "brier": {}, "intensity": {}, "events": {}, "rdpa6": {}})


def _save(state: dict[str, Any]) -> None:
    state["version"] = VERSION
    state["updated_at"] = core.iso(core.utcnow())
    cutoff = core.utcnow() - timedelta(days=MAX_AGE_DAYS)
    state["rows"] = [r for r in state.get("rows", []) if (core.parse_stamp(r.get("issued")) or core.utcnow()) >= cutoff]
    state["cycles"] = [r for r in state.get("cycles", []) if (core.parse_stamp(r.get("issued")) or core.utcnow()) >= cutoff]
    core.save(STATE, state)


def _brier_update(stat: dict[str, Any], probability: float, wet: bool) -> None:
    p = max(0.0, min(1.0, probability / 100.0)); b = (p - (1.0 if wet else 0.0)) ** 2; n = int(stat.get("n", 0))
    stat["brier"] = (float(stat.get("brier", 0.0)) * n + b) / (n + 1); stat["n"] = n + 1; stat["updated_at"] = core.iso(core.utcnow())


def _mae_update(stat: dict[str, Any], error: float) -> None:
    n = int(stat.get("n", 0)); stat["mae"] = (float(stat.get("mae", 0.0)) * n + abs(error)) / (n + 1); stat["bias"] = (float(stat.get("bias", 0.0)) * n + error) / (n + 1); stat["rmse"] = math.sqrt((float(stat.get("rmse", 0.0)) ** 2 * n + error * error) / (n + 1)); stat["n"] = n + 1; stat["updated_at"] = core.iso(core.utcnow())


def _event_stat(state: dict[str, Any], loc: str) -> dict[str, Any]:
    return state.setdefault("events", {}).setdefault(loc, {"completed_cycles": 0, "timed_onsets": 0, "misses": 0, "false_alarms": 0, "correct_dry": 0, "onset_errors_h": [], "cessation_errors_h": [], "missed_cessations": 0, "hourly_false_alarms": 0, "hourly_predicted_wet": 0})


def _gate(state: dict[str, Any], loc: str, lead: int) -> dict[str, Any]:
    raw = (state.get("brier") or {}).get(f"{loc}:{lead}:raw") or {}; cal = (state.get("brier") or {}).get(f"{loc}:{lead}:calibrated") or {}; n = min(int(raw.get("n", 0)), int(cal.get("n", 0))); rb = core.safe_float(raw.get("brier")); cb = core.safe_float(cal.get("brier"))
    if n < MIN_GATE_SAMPLES or rb is None or cb is None: return {"status": "learning", "samples": n, "use": "calibrated", "raw_brier": rb, "calibrated_brier": cb}
    use = "calibrated" if cb <= rb else "raw"
    return {"status": "active" if use == "calibrated" else "calibration-disabled-worse-than-raw", "samples": n, "use": use, "raw_brier": rb, "calibrated_brier": cb, "relative_improvement": (rb - cb) / rb if rb > 1e-9 else None}


def _family_intensity(forecasts: dict[str, Any], target: datetime) -> float | None:
    fam = v3.current_family_values(forecasts, target, var="precipitation"); vals = [core.safe_float(x) for x in fam.values()]; vals = [x for x in vals if x is not None]
    return sum(vals) / len(vals) if vals else None


def _actual_from(row: dict[str, Any], obs: dict[str, Any] | None, nowcast: dict[str, Any] | None) -> tuple[float | None, bool | None, dict[str, Any]]:
    target = core.parse_stamp(row.get("target")); odt = core.parse_stamp((obs or {}).get("time")); gauge = None
    if target and odt and abs((odt - target).total_seconds()) <= 90 * 60: gauge = core.safe_float(((obs or {}).get("values") or {}).get("precipitation"))
    radar = core.safe_float((nowcast or {}).get("radar_rain_rate")); wet = (gauge >= WET_THRESHOLD_MM) if gauge is not None else ((radar >= RADAR_WET_RATE) if radar is not None else None)
    return gauge, wet, {"gauge_mm": gauge, "radar_rate_mm_h": radar, "observation_time": (obs or {}).get("time"), "observation_provider": (obs or {}).get("provider") or ("NWS" if row.get("loc") == "uws" else "ECCC")}


def score_due(state: dict[str, Any], observations: dict[str, Any], nowcasts: dict[str, Any]) -> int:
    now = core.utcnow(); scored = 0
    for row in state.setdefault("rows", []):
        if row.get("scored"): continue
        target = core.parse_stamp(row.get("target"))
        if not target or target > now + timedelta(minutes=20): continue
        actual, wet, truth = _actual_from(row, observations.get(row.get("loc")), nowcasts.get(row.get("loc")))
        if wet is None: continue
        row["actual_precipitation_mm"] = actual; row["wet"] = bool(wet); row["truth"] = truth; loc = str(row.get("loc")); lead = int(row.get("lead", -1))
        for candidate in ("raw", "calibrated"):
            p = core.safe_float(row.get(f"{candidate}_probability"))
            if p is not None: _brier_update(state.setdefault("brier", {}).setdefault(f"{loc}:{lead}:{candidate}", {}), p, bool(wet))
        pred = core.safe_float(row.get("forecast_intensity_mm_h"))
        if pred is not None and actual is not None: _mae_update(state.setdefault("intensity", {}).setdefault(f"{loc}:{lead}", {}), pred - actual)
        row["scored"] = True; row["scored_at"] = core.iso(now); scored += 1
    return scored


def _transition(values: dict[int, bool], to_wet: bool) -> int | None:
    for lead in LEADS:
        if lead not in values: continue
        if lead == 0:
            if to_wet and values[lead]: return 0
            continue
        if (lead - 1) not in values: continue
        if to_wet and not values[lead - 1] and values[lead]: return lead
        if not to_wet and values[lead - 1] and not values[lead]: return lead
    return None


def score_cycles(state: dict[str, Any], nowcasts: dict[str, Any]) -> int:
    groups = defaultdict(list)
    for row in state.get("rows", []): groups[(str(row.get("loc")), str(row.get("issued")))].append(row)
    existing = {(c.get("loc"), c.get("issued")) for c in state.setdefault("cycles", [])}; added = 0
    for (loc, issued), rows in groups.items():
        if (loc, issued) in existing: continue
        by = {int(r.get("lead", -1)): r for r in rows}
        if not all(lead in by and by[lead].get("scored") for lead in LEADS): continue
        actual = {lead: bool(by[lead].get("wet")) for lead in LEADS}; predicted = {}
        for lead in LEADS:
            gate = _gate(state, loc, lead); key = "raw_probability" if gate.get("use") == "raw" else "calibrated_probability"; p = core.safe_float(by[lead].get(key)); predicted[lead] = bool(p is not None and p >= LIKELY_THRESHOLD_PCT)
        actual_onset = _transition(actual, True); pred_onset = _transition(predicted, True); actual_cease = _transition(actual, False); pred_cease = _transition(predicted, False); e = _event_stat(state, loc); e["completed_cycles"] += 1
        if actual_onset is not None and pred_onset is not None: e["timed_onsets"] += 1; e["onset_errors_h"].append(float(pred_onset - actual_onset))
        elif actual_onset is not None: e["misses"] += 1
        elif pred_onset is not None: e["false_alarms"] += 1
        else: e["correct_dry"] += 1
        if actual_cease is not None:
            if pred_cease is None: e["missed_cessations"] += 1
            else: e["cessation_errors_h"].append(float(pred_cease - actual_cease))
        for lead in LEADS:
            if predicted[lead]:
                e["hourly_predicted_wet"] += 1
                if not actual[lead]: e["hourly_false_alarms"] += 1
        e["onset_errors_h"] = e["onset_errors_h"][-200:]; e["cessation_errors_h"] = e["cessation_errors_h"][-200:]
        rdpa = core.safe_float((nowcasts.get(loc) or {}).get("rdpa_6h_precip")); forecast6 = sum(core.safe_float(by[h].get("forecast_intensity_mm_h")) or 0.0 for h in range(1, 7))
        if rdpa is not None: _mae_update(state.setdefault("rdpa6", {}).setdefault(loc, {}), forecast6 - rdpa)
        state["cycles"].append({"loc": loc, "issued": issued, "actual_onset_lead_h": actual_onset, "predicted_onset_lead_h": pred_onset, "actual_cessation_lead_h": actual_cease, "predicted_cessation_lead_h": pred_cease, "actual_wet": actual, "predicted_wet": predicted, "rdpa_6h_mm": rdpa, "forecast_6h_mm": forecast6, "scored_at": core.iso(core.utcnow())}); existing.add((loc, issued)); added += 1
    return added


def add_current(state: dict[str, Any], ledger: list[dict[str, Any]], forecasts: dict[str, Any], nowcasts: dict[str, Any]) -> int:
    issued = core.utcnow().replace(minute=0, second=0, microsecond=0); issued_s = core.iso(issued); existing = {(r.get("loc"), int(r.get("lead", -1)), r.get("issued")) for r in state.setdefault("rows", [])}; added = 0
    for loc in core.LOCATIONS:
        nc = nowcasts.get(loc) or {}; radar_rate = core.safe_float(nc.get("radar_extrapolated_rain_rate")); radar_available = bool(nc.get("radar_extrapolation_available")); rdpa_issue = core.safe_float(nc.get("rdpa_6h_precip"))
        for lead in LEADS:
            ident = (loc, lead, issued_s)
            if ident in existing: continue
            target = issued + timedelta(hours=lead); raw = v3.raw_probability(forecasts.get(loc, {}), target); table = v3.precipitation_reliability(ledger, loc, lead); calibrated = v3.calibrate_probability(raw, table); gate = _gate(state, loc, lead); gated = raw if gate.get("use") == "raw" else calibrated
            state["rows"].append({"loc": loc, "lead": lead, "issued": issued_s, "target": core.iso(target), "raw_probability": raw, "calibrated_probability": calibrated, "gated_probability": gated, "calibration_gate_at_issue": gate, "forecast_intensity_mm_h": _family_intensity(forecasts.get(loc, {}), target), "radar_extrapolation_context": {"layer": RADAR_LAYER, "rain_rate_mm_h": radar_rate, "available": radar_available, "checked_at": nc.get("checked_at"), "role": "issue-time-near-term-context-not-6h-extrapolation"}, "rdpa_6h_at_issue_mm": rdpa_issue, "scored": False}); existing.add(ident); added += 1
    return added


def _timing(errors: list[float]) -> dict[str, Any]:
    if not errors: return {"n": 0, "mae_hours": None, "bias_hours": None}
    return {"n": len(errors), "mae_hours": sum(abs(x) for x in errors) / len(errors), "bias_hours": sum(errors) / len(errors)}


def summary(state: dict[str, Any]) -> dict[str, Any]:
    locations = {}
    for loc in core.LOCATIONS:
        e = (state.get("events") or {}).get(loc) or {}
        locations[loc] = {"completed_cycles": int(e.get("completed_cycles", 0)), "timed_onsets": int(e.get("timed_onsets", 0)), "misses": int(e.get("misses", 0)), "false_alarms": int(e.get("false_alarms", 0)), "correct_dry": int(e.get("correct_dry", 0)), "onset": _timing(list(e.get("onset_errors_h") or [])), "cessation": _timing(list(e.get("cessation_errors_h") or [])), "missed_cessations": int(e.get("missed_cessations", 0)), "hourly_false_alarm_rate": (int(e.get("hourly_false_alarms", 0)) / int(e.get("hourly_predicted_wet", 0))) if int(e.get("hourly_predicted_wet", 0)) else None, "calibration_gate": {str(lead): _gate(state, loc, lead) for lead in LEADS}, "intensity": {str(lead): (state.get("intensity") or {}).get(f"{loc}:{lead}") or {"n": 0} for lead in LEADS}, "rdpa_6h": (state.get("rdpa6") or {}).get(loc) or {"n": 0}}
    return {"version": VERSION, "mode": "prospective-hourly-0-6-model-plus-radar-vs-official-gauge-radar-rdpa", "lead_grid_hours": list(LEADS), "wet_threshold_mm": WET_THRESHOLD_MM, "likely_threshold_pct": LIKELY_THRESHOLD_PCT, "calibration_policy": "paired prospective Brier gate; calibrated probability is disabled to raw wherever calibrated Brier is worse after the minimum sample count", "radar_policy": "the existing official GeoMet radar extrapolated rain-rate signal is archived at issue time as near-term context; it is not mislabeled as a synthetic 2-6h extrapolation", "truth_policy": "location-official station hourly precipitation when time-aligned; official radar occurrence as fallback; RDPA 6h accumulation retained as separate intensity truth", "rows": len(state.get("rows", [])), "scored_rows": sum(1 for r in state.get("rows", []) if r.get("scored")), "completed_cycles": len(state.get("cycles", [])), "locations": locations, "recent_cycles": (state.get("cycles") or [])[-30:]}


def update(ledger: list[dict[str, Any]], forecasts: dict[str, Any], observations: dict[str, Any], nowcasts: dict[str, Any]) -> dict[str, Any]:
    state = _load(); scored = score_due(state, observations, nowcasts); cycles = score_cycles(state, nowcasts); added = add_current(state, ledger, forecasts, nowcasts); _save(state); out = summary(state); out["this_run"] = {"scored_rows": scored, "completed_cycles": cycles, "issued_rows": added}; return out
