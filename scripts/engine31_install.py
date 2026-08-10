#!/usr/bin/env python3
"""Install Engine 3.1 as a safe wrapper around the stable Engine 3 publisher."""
from __future__ import annotations
import accuracy_engine_v3_publish as pub
import accuracy_engine_v3_verify as verify
import accuracy_engine_v2 as core
import engine31_policy as policy
import rain_timing_verifier as rain_timing

_INSTALLED=False


def _attach_server_truth(engine:dict)->None:
    """Carry verified server-owned UI truth from Engine 2 into Engine 3.

    Engine 2 owns observation collection, deterministic/ensemble source health,
    individual-model skill and the underlying family/ensemble spread diagnostics.
    Engine 3 is the browser's authoritative snapshot, so surface those fields
    explicitly instead of forcing the client to reconstruct them from local state.
    """
    v2=core.load(core.ENGINE,{})
    context={}
    for loc,payload in (v2.get('consensus') or {}).items():
        by_lead={}
        for lead_s,row in ((payload or {}).get('hours') or {}).items():
            by_lead[str(lead_s)]={
                'learned_spread':core.safe_float(row.get('learned_spread')),
                'ensemble_spread':core.safe_float(row.get('ensemble_spread')),
                'uncertainty':core.safe_float(row.get('uncertainty')),
                'effective_independent_sources':int(row.get('effective_independent_sources') or 0),
                'ensemble_families':int(row.get('ensemble_families') or 0),
            }
        context[loc]=by_lead
    engine['server_truth']={
        'version':'1.0',
        'owner':'hourly-server-collector',
        'updated_at':v2.get('updated_at') or engine.get('updated_at'),
        'observations':v2.get('observations') or {},
        'source_health':v2.get('source_health') or {},
        'best_models':v2.get('best_models') or {},
        'model_families':v2.get('model_families') or {},
        'ensemble_products':v2.get('ensemble_products') or {},
        'consensus_context':context,
        'policy':'server-owned health, observations, verification leaderboard and spread context; browser-local skill is diagnostic only',
    }


def install()->None:
    global _INSTALLED
    if _INSTALLED:return
    _INSTALLED=True
    original_apply=pub.apply_adaptive_verification
    original_add=verify.add_current_forecasts

    def apply_with_engine31(engine,state,walk):
        original_apply(engine,state,walk)
        policy.apply(engine,state)
        engine['rain_timing_verification']=rain_timing.build(state)
        _attach_server_truth(engine)

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
