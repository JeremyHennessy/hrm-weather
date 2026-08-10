#!/usr/bin/env python3
"""One-purpose migration for unsafe Number(null) finite predicates found by P0 CI."""
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
REPLACEMENTS={
    "forecast-insights.js":[("const finite=v=>Number.isFinite(Number(v));","const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));")],
    "v5.js":[(".filter(x=>Number.isFinite(Number(x.properties?.TEMP)))",".filter(x=>x.properties?.TEMP!==null&&x.properties?.TEMP!==undefined&&x.properties?.TEMP!==''&&Number.isFinite(Number(x.properties?.TEMP)))")],
    "v6.js":[(".filter(x=>Number.isFinite(Number(x.properties?.TEMP)))",".filter(x=>x.properties?.TEMP!==null&&x.properties?.TEMP!==undefined&&x.properties?.TEMP!==''&&Number.isFinite(Number(x.properties?.TEMP)))")],
    "v6-extra.js":[(".filter(([k,v])=>Number.isFinite(Number(v))&&!/lat|lon|id|time|date|hour/i.test(k))",".filter(([k,v])=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&!/lat|lon|id|time|date|hour/i.test(k))")],
    "v5b.js":[(".filter(x=>Number.isFinite(Number(x.properties?.TEMP)))",".filter(x=>x.properties?.TEMP!==null&&x.properties?.TEMP!==undefined&&x.properties?.TEMP!==''&&Number.isFinite(Number(x.properties?.TEMP)))")],
    "scripts/server-truth-qa.mjs":[("if(!Number.isFinite(Number(p.air))||Math.abs(Number(p.air))<=8)continue;","if(p.air===null||p.air===undefined||p.air===''||!Number.isFinite(Number(p.air))||Math.abs(Number(p.air))<=8)continue;")],
}

changed=[]
for rel,repls in REPLACEMENTS.items():
    path=ROOT/rel;text=path.read_text(encoding="utf-8");original=text
    for old,new in repls:
        if old in text:text=text.replace(old,new)
        elif new not in text:raise SystemExit(f"expected numeric predicate not found in {rel}: {old}")
    if text!=original:path.write_text(text,encoding="utf-8");changed.append(rel)
print("numeric-safety changed:",", ".join(changed) if changed else "already clean")
