#!/usr/bin/env python3
"""Coarse prospective rain-onset verification from issued Engine 3 forecasts.

Uses only probabilities saved at issue time and later ECCC precipitation outcomes.
The current forecast grid is +1/+3/+6/+12h, so onset error is intentionally
reported as coarse lead-grid timing until a denser nowcast archive is available.
"""
from __future__ import annotations
from collections import defaultdict
from typing import Any
import accuracy_engine_v2 as core

WET_THRESHOLD_MM=core.PRECIP_THRESHOLD
LIKELY_THRESHOLD_PCT=50.0
LEADS=(1,3,6,12)


def _stat(errors:list[float])->dict[str,Any]:
    if not errors:return {'n':0,'mae_hours':None,'bias_hours':None}
    return {'n':len(errors),'mae_hours':sum(abs(x) for x in errors)/len(errors),'bias_hours':sum(errors)/len(errors)}


def build(state:dict[str,Any])->dict[str,Any]:
    groups=defaultdict(list)
    for row in state.get('forecasts',[]):
        lead=int(row.get('lead',-1))
        if lead not in LEADS:continue
        groups[(str(row.get('loc')),str(row.get('issued')))].append(row)
    errors=[];hits=misses=false_alarms=dry_correct=0;cases=[]
    for (loc,issued),rows in groups.items():
        by={int(r.get('lead')):r for r in rows}
        if not all(l in by and by[l].get('scored') for l in LEADS):continue
        pred_lead=None;actual_lead=None
        for l in LEADS:
            p=core.safe_float((by[l].get('precip_candidates') or {}).get('calibrated'))
            if pred_lead is None and p is not None and p>=LIKELY_THRESHOLD_PCT:pred_lead=l
            a=core.safe_float(by[l].get('actual_precipitation'))
            if actual_lead is None and a is not None and a>=WET_THRESHOLD_MM:actual_lead=l
        if pred_lead is not None and actual_lead is not None:
            err=float(pred_lead-actual_lead);errors.append(err);hits+=1;status='timed-event'
        elif pred_lead is None and actual_lead is not None:misses+=1;status='miss'
        elif pred_lead is not None and actual_lead is None:false_alarms+=1;status='false-alarm'
        else:dry_correct+=1;status='correct-dry'
        cases.append({'loc':loc,'issued':issued,'predicted_onset_lead_h':pred_lead,'observed_onset_lead_h':actual_lead,'status':status})
    total=len(cases);timing=_stat(errors)
    return {'version':'1.0','mode':'prospective-issue-time-probability-vs-later-ECCC','lead_grid_hours':list(LEADS),'likely_threshold_pct':LIKELY_THRESHOLD_PCT,'wet_threshold_mm':WET_THRESHOLD_MM,'completed_issue_cycles':total,'timed_events':hits,'misses':misses,'false_alarms':false_alarms,'correct_dry':dry_correct,'timing':timing,'event_detection_accuracy':(hits+dry_correct)/total if total else None,'recent_cases':cases[-40:]}
