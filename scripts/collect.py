#!/usr/bin/env python3
"""Compatibility entry point for the Weather Consensus hourly collector."""
from eccc_observation_mesh_v2 import install as install_eccc_observation_mesh
from solar_context_v2 import install as install_solar_context

install_eccc_observation_mesh()
install_solar_context()

from accuracy_engine_v2_runner import main as run_v2
from accuracy_engine_v3_publish import main as run_v3

if __name__ == '__main__':
    run_v2()
    run_v3()
