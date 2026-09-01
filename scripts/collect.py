#!/usr/bin/env python3
"""Compatibility entry point for the Weather Consensus hourly collector."""
# Operational restart marker: 2026-08-21. No forecast logic is changed here;
# this main-branch scripts/** update intentionally retriggers the existing hourly
# collector after the observed Aug 16-21 publication gap.
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

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
import rrfsv1_runtime  # noqa: F401
from engine31_install import install as install_engine31
install_engine31()

from accuracy_engine_v2_runner import main as run_v2
from accuracy_engine_v3_publish import main as run_v3


def bound_published_ledger(days: int = 30) -> None:
    """Keep the committed verification ledger below GitHub's file-size ceiling.

    Engine 2/3 complete their scoring and verification first. The durable skill
    aggregates remain in skill.json; this only removes old raw target rows from
    the file that is committed by the hourly workflow. A 30-day raw window keeps
    substantially more verification history than the active target-scoring
    window while restoring reliable publication.
    """
    path = Path(__file__).resolve().parents[1] / "data" / "ledger.json"
    if not path.exists():
        return
    try:
        rows = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(rows, list):
        return
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    kept = []
    for row in rows:
        stamp = row.get("issued") if isinstance(row, dict) else None
        try:
            dt = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            # Preserve malformed/legacy rows rather than silently deleting data.
            kept.append(row)
            continue
        if dt > cutoff:
            kept.append(row)
    if len(kept) != len(rows):
        path.write_text(json.dumps(kept, indent=2) + "\n")
        print(f"published ledger bounded to {days}d: {len(rows)} -> {len(kept)} rows")


if __name__ == '__main__':
    run_v2()
    run_v3()
    bound_published_ledger()
