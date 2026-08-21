#!/usr/bin/env python3
"""Install cloud consensus into Engine 3 without changing temperature/rain math."""
from __future__ import annotations
import accuracy_engine_v3 as v3
import cloud_consensus_engine as cloud

_INSTALLED=False
_ORIGINAL=v3.build_engine_v3

def _wrapped(*args,**kwargs):
    engine=_ORIGINAL(*args,**kwargs)
    # Forecasts are the third positional argument in the stable Engine 3 API.
    forecasts=args[2] if len(args)>=3 else kwargs.get('forecasts',{})
    return cloud.apply(engine,forecasts or {})

def install()->None:
    global _INSTALLED
    if _INSTALLED:return
    v3.build_engine_v3=_wrapped
    _INSTALLED=True
