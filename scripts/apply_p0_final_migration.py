#!/usr/bin/env python3
"""One-purpose migration to finish canonical-location and verifier bookkeeping changes."""
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

# 1) Accuracy Engine 2 must consume the canonical registry directly, so every
# Python importer sees the same location definitions even outside collect.py.
p=ROOT/'scripts/accuracy_engine_v2.py';text=p.read_text(encoding='utf-8')
start=text.index('LOCATIONS = {')
end=text.index('\n\n# Deterministic model families.',start)
replacement="from location_registry import load_registry\n\nLOCATIONS = load_registry()"
text=text[:start]+replacement+text[end:]
p.write_text(text,encoding='utf-8')

# 2) The UWS adapter augments observation/model behavior only; its location
# payload comes from the same registry rather than another literal copy.
p=ROOT/'scripts/location_uws.py';text=p.read_text(encoding='utf-8')
if 'from location_registry import REGISTRY' not in text:
    text=text.replace('import accuracy_engine_v2 as core\n','import accuracy_engine_v2 as core\nfrom location_registry import REGISTRY\n')
start=text.index('UWS_LOCATION = {')
end=text.index('\n\n\ndef _quantity',start)
text=text[:start]+'UWS_LOCATION = dict(REGISTRY[LOCATION_KEY])'+text[end:]
p.write_text(text,encoding='utf-8')

# 3) score_due return value remains a count of forecast rows touched, not a
# count of independently-scored variables. Variable flags remain independent.
p=ROOT/'scripts/accuracy_engine_v3_verify.py';text=p.read_text(encoding='utf-8')
needle='loc=str(row.get("loc"));lead=int(row.get("lead",-1));regime=str(row.get("regime","unknown"));meta=row.setdefault("truth_variables",{})'
if needle in text and needle+';row_touched=False' not in text:
    text=text.replace(needle,needle+';row_touched=False')
text=text.replace('row["temperature_scored"]=True;row["scored"]=True;scored+=1','row["temperature_scored"]=True;row["scored"]=True;row_touched=True')
text=text.replace('row["precipitation_scored"]=True;scored+=1','row["precipitation_scored"]=True;row_touched=True')
text=text.replace('row["real_feel_scored"]=True;scored+=1','row["real_feel_scored"]=True;row_touched=True')
old='if row.get("temperature_scored") or row.get("precipitation_scored") or row.get("real_feel_scored"):row["scored_at"]=core.iso(now)'
new=old+'\n        if row_touched:scored+=1'
if old in text and new not in text:text=text.replace(old,new)
p.write_text(text,encoding='utf-8')

print('final P0 migration applied')
