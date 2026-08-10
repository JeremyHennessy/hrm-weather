#!/usr/bin/env python3
"""Runtime guard around the RRFSv1 shadow connector.

RRFS is optional challenger data. A NOAA/AWS transition, missing index, or slow
range request must not delay or break the hourly production forecast. This
module adds per-run caches, shorter I/O timeouts, a wall-clock issue budget and
fail-soft reporting while leaving RRFS production weight at zero.
"""
from __future__ import annotations

import time
from typing import Any

import rrfsv1_shadow as base

MAX_ISSUE_SECONDS = 75.0
_INDEX_CACHE: dict[str, Any] = {}
_MESSAGE_CACHE: dict[tuple[str, tuple[str, ...]], bytes | None] = {}
_ORIG_TEXT = base._text
_ORIG_RANGE = base._range
_ORIG_INDEX = base._index
_ORIG_MESSAGE = base._message
_ORIG_FETCH_POINT = base.fetch_point
_ORIG_UPDATE = base.update
_deadline = 0.0


def _text(url: str, timeout: int = 12):
    return _ORIG_TEXT(url, timeout=min(timeout, 4))


def _range(url: str, start: int, end: int, timeout: int = 18):
    return _ORIG_RANGE(url, start, end, timeout=min(timeout, 6))


def _index(url: str):
    if url not in _INDEX_CACHE:
        _INDEX_CACHE[url] = _ORIG_INDEX(url)
    return _INDEX_CACHE[url]


def _message(url: str, rows, patterns: tuple[str, ...]):
    key = (url, tuple(patterns))
    if key not in _MESSAGE_CACHE:
        _MESSAGE_CACHE[key] = _ORIG_MESSAGE(url, rows, patterns)
    return _MESSAGE_CACHE[key]


def _fetch_point(loc: dict[str, Any], cycle, forecast_hour: int):
    if _deadline and time.monotonic() >= _deadline:
        return {"available": False, "reason": "rrfs-run-network-budget-exhausted", "cycle": base.core.iso(cycle), "forecast_hour": forecast_hour}
    return _ORIG_FETCH_POINT(loc, cycle, forecast_hour)


# The original functions resolve these module globals at call time, so replacing
# them here makes caching effective across all six locations.
base._text = _text
base._range = _range
base._index = _index
base._message = _message
base.fetch_point = _fetch_point


def update(engine: dict[str, Any], forecasts: dict[str, Any], observations: dict[str, Any]) -> dict[str, Any]:
    global _deadline
    _INDEX_CACHE.clear(); _MESSAGE_CACHE.clear(); _deadline = time.monotonic() + MAX_ISSUE_SECONDS
    try:
        out = _ORIG_UPDATE(engine, forecasts, observations)
        out["availability_this_run"] = "available" if int(out.get("current_issue", {}).get("issued_this_run", 0)) > 0 else "no-rows-this-run"
        out["runtime_guard"] = {
            "max_issue_seconds": MAX_ISSUE_SECONDS,
            "index_cache_entries": len(_INDEX_CACHE),
            "message_cache_entries": len(_MESSAGE_CACHE),
            "io_timeout_seconds": {"index": 4, "range": 6},
            "production_dependency": False,
        }
        return out
    except Exception as exc:
        # Preserve accumulated prospective state and expose the failure; never
        # block production publication because an optional challenger failed.
        state = base._load()
        out = base.report(state, {"status": "runtime-error", "error": type(exc).__name__})
        out["availability_this_run"] = "runtime-error"
        out["runtime_guard"] = {
            "max_issue_seconds": MAX_ISSUE_SECONDS,
            "index_cache_entries": len(_INDEX_CACHE),
            "message_cache_entries": len(_MESSAGE_CACHE),
            "io_timeout_seconds": {"index": 4, "range": 6},
            "production_dependency": False,
            "error": type(exc).__name__,
        }
        out["applied_production_weight"] = 0.0
        out["production_changed"] = False
        return out
    finally:
        _deadline = 0.0


# Any later `import rrfsv1_shadow as rrfsv1` in this collector process receives
# the guarded update path automatically.
base.update = update
