#!/usr/bin/env python3
"""Compatibility entry point for the Weather Consensus hourly collector."""
# Operational restart marker: 2026-08-21. No forecast logic is changed here;
# this scripts/** update retriggers the existing hourly collector after the
# observed Aug 16-21 publication gap.
from eccc_observation_mesh_v2 import install as install_eccc_observation_mesh

install_eccc_observation_mesh()
from location_uws import install as install_uws
install_uws()
from uws_model_independence import install as install_uws_model_independence
install_uws_model_independence()

# Shediac local accuracy: resolve the single-point forecast into coast, town and
# inland points. This changes spatial sampling only; model weights are untouched.
import accuracy_engine_v2 as _core
_shediac=_core.LOCATIONS.get("shediac")
if _shediac:
    _shediac["lat"],_shediac["lon"]=46.221272,-64.539767
    _shediac["points"]=[
        ("Pointe-du-Chene",46.23663,-64.52178,"open-coast"),
        ("Shediac Centre",46.221272,-64.539767,"coastal-town"),
        ("Scoudouc",46.16533,-64.56204,"inland"),
    ]
    _shediac["coastal"]=True
    _shediac["mesh_role"]="coast-centre-inland-front-detection"

from solar_context_v2 import install as install_solar_context
install_solar_context()

# Cloud cover is already collected per deterministic model. Promote that signal
# into Engine 3 as its own family-aware sky product without touching temperature,
# Real Feel, precipitation, or existing component weights.
from cloud_consensus_install import install as install_cloud_consensus
install_cloud_consensus()

import rrfsv1_runtime  # noqa: F401
from engine31_install import install as install_engine31
install_engine31()

from accuracy_engine_v2_runner import main as run_v2
from accuracy_engine_v3_publish import main as run_v3

if __name__ == '__main__':
    run_v2()
    run_v3()
