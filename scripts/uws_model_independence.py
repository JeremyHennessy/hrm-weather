#!/usr/bin/env python3
"""UWS model-independence normalization.

HRRR is a distinct short-range NOAA model, not an institutionally independent
family from NOAA/GFS. Keep the model separate for verification while grouping
its family vote with NOAA so source-count confidence is not inflated.
"""
from __future__ import annotations

import accuracy_engine_v2 as core


def install() -> None:
    meta = core.MODEL_META.get("ncep_hrrr_conus")
    if meta:
        meta["family"] = "noaa"
