#!/usr/bin/env python3
"""Compatibility entry point for the Weather Consensus hourly collector."""
# Operational restart marker: 2026-08-21. No forecast logic is changed here;
# this main-branch scripts/** update intentionally retriggers the existing hourly
# collector after the observed Aug 16-21 publication gap.
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
from cloud_consensus_install import install as install_cloud_consensus
install_cloud_consensus()
import rrfsv1_runtime  # noqa: F401
from engine31_install import install as install_engine31
install_engine31()

from accuracy_engine_v2_runner import main as run_v2
from accuracy_engine_v3_publish import main as run_v3


PUBLISHED_LEDGER_MAX_BYTES = 90_000_000
PUBLISHED_LEDGER_TARGET_BYTES = 85_000_000


def _encode_ledger(rows: list) -> bytes:
    """Stable, line-oriented JSON with less whitespace than the training writer."""
    text = json.dumps(
        rows,
        indent=0,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ) + "\n"
    return text.encode("utf-8")


def bound_published_ledger() -> None:
    """Keep the committed raw ledger safely below GitHub's 100 MB hard limit.

    Engine 2 and Engine 3 consume the full in-run ledger before this function is
    called. The publication copy is first re-encoded without indentation while
    preserving every row. Only if that is still larger than 90 MB are the oldest
    rows that are explicitly already scored removed until the file is near 85 MB.
    Unscored/future targets, malformed rows, and durable learned aggregates are
    never discarded here.
    """
    path = Path(__file__).resolve().parents[1] / "data" / "ledger.json"
    if not path.exists():
        return
    try:
        rows = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot read verification ledger for publication: {exc}") from exc
    if not isinstance(rows, list):
        raise RuntimeError("verification ledger is not a JSON array")

    original_rows = len(rows)
    payload = _encode_ledger(rows)
    if len(payload) <= PUBLISHED_LEDGER_MAX_BYTES:
        path.write_bytes(payload)
        print(
            f"published ledger compacted with all rows preserved: "
            f"rows={original_rows} bytes={len(payload)}"
        )
        return

    bytes_to_remove = len(payload) - PUBLISHED_LEDGER_TARGET_BYTES
    drop_indexes: set[int] = set()
    estimated_removed = 0
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or row.get("scored") is not True:
            continue
        row_bytes = len(
            json.dumps(
                row,
                indent=0,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8")
        ) + 2
        drop_indexes.add(index)
        estimated_removed += row_bytes
        if estimated_removed >= bytes_to_remove:
            break

    if estimated_removed < bytes_to_remove:
        raise RuntimeError(
            "published ledger exceeds safe GitHub size and there are not enough "
            "already-scored rows to remove without touching active targets"
        )

    kept = [row for index, row in enumerate(rows) if index not in drop_indexes]
    payload = _encode_ledger(kept)
    if len(payload) > PUBLISHED_LEDGER_MAX_BYTES:
        raise RuntimeError(
            f"published ledger remains too large after scored-row trim: {len(payload)} bytes"
        )

    path.write_bytes(payload)
    print(
        f"published ledger bounded by byte headroom: rows={original_rows}->{len(kept)} "
        f"removed_scored={len(drop_indexes)} bytes={len(payload)}"
    )


if __name__ == '__main__':
    run_v2()
    run_v3()
    bound_published_ledger()
