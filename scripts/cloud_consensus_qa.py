#!/usr/bin/env python3
"""Deterministic contract tests for the Halifax cloud consensus layer."""
from __future__ import annotations
from datetime import datetime, timezone
import accuracy_engine_v2 as core
import cloud_consensus_engine as cloud
import solar_context_v2 as solar

solar.install()
assert 'cloud_cover' in core.VARS
assert 'shortwave_radiation' in core.VARS
assert 'shortwave_radiation' in core.VERIFY_VARS
assert 'cloud_cover' not in core.VERIFY_VARS, 'do not synthesize observed cloud truth'

assert cloud.classify_cloud(5)=='sunny'
assert cloud.classify_cloud(30)=='mostly-sunny'
assert cloud.classify_cloud(55)=='partly-cloudy'
assert cloud.classify_cloud(80)=='mostly-cloudy'
assert cloud.classify_cloud(95)=='cloudy'

target=datetime(2026,8,21,18,tzinfo=timezone.utc)
key=core.iso(target)
forecasts={
    'gem_hrdps_continental':{'cloud_cover':{key:90}},
    'gem_regional':{'cloud_cover':{key:80}},
    'ecmwf_ifs025':{'cloud_cover':{key:70}},
    'gfs_seamless':{'cloud_cover':{key:50}},
    'icon_seamless':{'cloud_cover':{key:60}},
}
r=cloud.cloud_consensus(forecasts,target)
assert r['available'] is True
# Two Canadian products collapse to one institutional family rather than two votes.
assert r['independent_families']==4, r
assert 60 <= r['cloud_cover'] <= 75, r
assert r['sky_condition'] in {'partly-cloudy','mostly-cloudy'}, r

engine={'consensus':{'hrm':{'hours':{'1':{'target':key}}}}}
cloud.apply(engine,{'hrm':forecasts})
h=engine['consensus']['hrm']['hours']['1']
assert h['cloud_consensus']['role']=='family-aware-cloud-consensus'
assert h['cloud_independent_families']==4
assert engine['cloud_sky']['owner']=='accuracy-engine-3-family-cloud-consensus'
assert engine['cloud_sky']['forecast_points_ready']==1
print('Cloud consensus server QA passed',h['cloud_cover'],h['sky_condition'])
