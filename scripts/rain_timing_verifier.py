#!/usr/bin/env python3
"""Rain timing verification facade.

The primary verifier is now the prospective hourly 0-6 h archive in
precip_nowcast_verifier.  The former +1/+3/+6/+12 issue grid remains only as a
legacy fallback while the denser archive accumulates completed cycles.
"""
from __future__ import annotations
from collections import defaultdict
from typing import Any

import accuracy_engine_v2 as core
import precip_nowcast_verifier as dense

LEGACY_LEADS=(1,3,6,12)


def _stat(errors:list[float])->dict[str,Any]:
    if not errors:return {'n':0,'mae_hours':None,'bias_hours':None}
    return {'n':len(errors),'mae_hours':sum(abs(x) for x in errors)/len(errors),'bias_hours':sum(errors)/len(errors)}


def _legacy(state:dict[str,Any])->dict[str,Any]:
    groups=defaultdict(list)
    for row in state.get('forecasts',[]):
        lead=int(row.get('lead',-1))
        if lead in LEGACY_LEADS:groups[(str(row.get('loc')),str(row.get('issued')))].append(row)
    errors=[];hits=misses=false_alarms=dry_correct=0;cases=[]
    for (loc,issued),rows in groups.items():
        by={int(r.get('lead')):r for r in rows}
        if not all(l in by and by[l].get('scored') for l in LEGACY_LEADS):continue
        pred=actual=None
        for l in LEGACY_LEADS:
            p=core.safe_float((by[l].get('precip_candidates') or {}).get('calibrated'))
            if pred is None and p is not None and p>=dense.LIKELY_THRESHOLD_PCT:pred=l
            a=core.safe_float(by[l].get('actual_precipitation'))
            if actual is None and a is not None and a>=dense.WET_THRESHOLD_MM:actual=l
        if pred is not None and actual is not None:errors.append(float(pred-actual));hits+=1;status='timed-event'
        elif pred is None and actual is not None:misses+=1;status='miss'
        elif pred is not None and actual is None:false_alarms+=1;status='false-alarm'
        else:dry_correct+=1;status='correct-dry'
        cases.append({'loc':loc,'issued':issued,'predicted_onset_lead_h':pred,'observed_onset_lead_h':actual,'status':status})
    total=len(cases)
    return {'version':'1.0-legacy-fallback','mode':'legacy-coarse-issue-grid','lead_grid_hours':list(LEGACY_LEADS),'completed_issue_cycles':total,'timed_events':hits,'misses':misses,'false_alarms':false_alarms,'correct_dry':dry_correct,'timing':_stat(errors),'event_detection_accuracy':(hits+dry_correct)/total if total else None,'recent_cases':cases[-40:]}


def build(state:dict[str,Any])->dict[str,Any]:
    dense_state=dense._load()
    report=dense.summary(dense_state)
    if report.get('completed_cycles',0)>0 or report.get('rows',0)>0:
        report['owner']='precip-nowcast-verifier'
        report['legacy_fallback_active']=False
        return report
    legacy=_legacy(state)
    return {
        'version':'2.0','mode':'hourly-0-6-learning-with-legacy-fallback','owner':'precip-nowcast-verifier',
        'lead_grid_hours':list(dense.LEADS),'completed_cycles':0,'rows':0,
        'legacy_fallback_active':True,'legacy':legacy,
        'policy':'0-6 h hourly onset/cessation/intensity verification is authoritative once issued rows exist; old +1/+3/+6/+12 timing remains diagnostic only during bootstrap',
    }
