#!/usr/bin/env python3
"""Install Engine 3.1 as a safe wrapper around the stable Engine 3 publisher."""
from __future__ import annotations
import accuracy_engine_v3_publish as pub
import accuracy_engine_v3_verify as verify
import accuracy_engine_v2 as core
import engine31_policy as policy

_INSTALLED=False

def install()->None:
    global _INSTALLED
    if _INSTALLED:return
    _INSTALLED=True
    original_apply=pub.apply_adaptive_verification
    original_add=verify.add_current_forecasts

    def apply_with_engine31(engine,state,walk):
        original_apply(engine,state,walk)
        policy.apply(engine,state)

    def add_with_engine31(state,engine):
        before={(r.get('loc'),int(r.get('lead',-1)),r.get('issued')) for r in state.get('forecasts',[])}
        added=original_add(state,engine)
        issued=core.parse_stamp(engine.get('updated_at')) or core.utcnow();issued_s=core.iso(issued)
        lookup={}
        for loc,payload in (engine.get('consensus') or {}).items():
            for lead_s,h in (payload.get('hours') or {}).items():
                c=h.get('engine31_challenger') or {};v=core.safe_float(c.get('temperature_2m'))
                if v is not None:lookup[(loc,int(lead_s))]=v
        for row in state.get('forecasts',[]):
            ident=(row.get('loc'),int(row.get('lead',-1)),row.get('issued'))
            if ident in before or row.get('issued')!=issued_s:continue
            v=lookup.get((row.get('loc'),int(row.get('lead',-1))))
            if v is not None:(row.setdefault('temperature_candidates',{}))['engine31']=v
        return added

    pub.apply_adaptive_verification=apply_with_engine31
    verify.add_current_forecasts=add_with_engine31
