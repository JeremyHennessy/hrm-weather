#!/usr/bin/env python3
"""Run the 90-day backtest with ECCC history fetched in bounded chunks."""
from datetime import timedelta
import archive_backtest_90d as bt

_raw = bt.base.observations

def chunked_observations(bbox, start, end):
    out = {}
    cursor = start
    while cursor <= end:
        chunk_end = min(end, cursor + timedelta(days=29))
        out.update(_raw(bbox, cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)
    return out

bt.base.observations = chunked_observations

if __name__ == '__main__':
    bt.main()
