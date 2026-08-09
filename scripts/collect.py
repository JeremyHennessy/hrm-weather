#!/usr/bin/env python3
"""Compatibility entry point for the Weather Consensus hourly collector."""
from eccc_observation_mesh_v2 import install as install_eccc_observation_mesh

install_eccc_observation_mesh()

from accuracy_engine_v2_runner import main

if __name__ == '__main__':
    main()
