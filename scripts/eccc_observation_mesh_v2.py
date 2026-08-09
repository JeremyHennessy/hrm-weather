#!/usr/bin/env python3
"""Real-time ECCC SWOB observation mesh for Weather Consensus."""
from __future__ import annotations
import math
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import Any
import accuracy_engine_v2 as core


def first_number(mapping: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        v = core.safe_float(mapping.get(key))
        if v is not None:return v
    return None


def first_number_with_key(mapping: dict[str, Any], *keys: str) -> tuple[float | None, str | None]:
    for key in keys:
        v = core.safe_float(mapping.get(key))
        if v is not None:return v, key
    return None, None


def wind_to_kmh(value: float | None, uom: Any) -> float | None:
    if value is None:return None
    unit = str(uom or "").strip().lower().replace(" ", "")
    if any(token in unit for token in ("m/s", "m_s-1", "m.s-1", "ms-1", "m%2fs")):return value * 3.6
    if any(token in unit for token in ("kt", "knot")):return value * 1.852
    return value


def solar_to_wm2(value: float | None, uom: Any) -> float | None:
    """Normalize SWOB global solar radiation to W/m² where units are explicit."""
    if value is None:return None
    unit=str(uom or "").strip().lower().replace(" ","")
    if "kj/m" in unit or "kjm" in unit:
        # Energy accumulated over one hour -> mean flux.
        return value * 1000.0 / 3600.0
    if "mj/m" in unit or "mjm" in unit:
        return value * 1_000_000.0 / 3600.0
    return value


def station_coords(feature: dict[str, Any], fallback_lat: float, fallback_lon: float) -> tuple[float, float]:
    coords=(feature.get("geometry") or {}).get("coordinates") or []
    if len(coords)>=2:
        lon=core.safe_float(coords[0]);lat=core.safe_float(coords[1])
        if lat is not None and lon is not None:return lat,lon
    return fallback_lat,fallback_lon


def weighted_linear(rows:list[dict[str,Any]],var:str)->float|None:
    num=den=0.0
    for r in rows:
        v=core.safe_float(r.get(var))
        if v is None:continue
        w=max(1e-6,float(r["weight"]));num+=v*w;den+=w
    return num/den if den else None


def fetch_mesh(loc: dict[str, Any]) -> dict[str, Any] | None:
    now=datetime.now(timezone.utc);b=loc["bbox"];start=now-timedelta(hours=7);end=now+timedelta(minutes=20)
    params={"bbox":",".join(map(str,b)),"datetime":f"{core.iso(start).replace('+00:00','Z')}/{core.iso(end).replace('+00:00','Z')}","limit":"1000","f":"json"}
    try:j=core.get_json("https://api.weather.gc.ca/collections/swob-realtime/items?"+urllib.parse.urlencode(params),timeout=25)
    except Exception:return None
    rows=[]
    for feature in j.get("features",[]):
        p=feature.get("properties") or {};temp=first_number(p,"air_temp","avg_air_temp_pst1hr","avg_air_temp_pst2mts")
        if temp is None:continue
        dt=core.parse_stamp(p.get("obs_date_tm") or p.get("date_tm-value") or p.get("processed_date_tm"))
        if not dt:continue
        age_h=(now-dt).total_seconds()/3600
        if age_h < -0.5 or age_h > 7.5:continue
        slat,slon=station_coords(feature,loc["lat"],loc["lon"]);dist=core.hav(loc["lat"],loc["lon"],slat,slon)
        spatial=1/(1+(dist/10.0)**1.45);temporal=math.exp(-max(0.0,age_h)/2.2);w=spatial*temporal
        rh=first_number(p,"rel_hum","avg_rel_hum_pst1hr");precip=first_number(p,"pcpn_amt_pst1hr","rnfl_amt_pst1hr")
        wind_raw,wind_key=first_number_with_key(p,"avg_wnd_spd_10m_pst10mts","avg_wnd_spd_10m_pst2mts","avg_wnd_spd_10m_pst1mt","avg_wnd_spd_10m_pst1hr","avg_wnd_spd_pst10mts","avg_wnd_spd_pst2mts","wnd_spd","wind_speed")
        gust_raw,gust_key=first_number_with_key(p,"max_wnd_gst_spd_10m_pst10mts","max_wnd_spd_10m_pst10mts","max_wnd_spd_10m_pst1hr","max_wnd_spd_pst10mts","max_wnd_spd_pst1hr","wnd_gust_spd","wind_gust")
        direction=first_number(p,"avg_wnd_dir_10m_pst10mts","avg_wnd_dir_10m_pst2mts","avg_wnd_dir_10m_pst1mt","avg_wnd_dir_10m_pst1hr","avg_wnd_dir_pst10mts","wnd_dir","wind_direction")
        solar_raw,solar_key=first_number_with_key(p,"avg_globl_solr_radn_pst1hr","avg_globl_solr_radn_pst1mt","avg_globl_solr_radn_pst10mts")
        wind_uom=p.get(f"{wind_key}-uom") if wind_key else None;gust_uom=p.get(f"{gust_key}-uom") if gust_key else None;solar_uom=p.get(f"{solar_key}-uom") if solar_key else None
        rows.append({
            "time":core.iso(dt),"station":p.get("stn_nam-value") or p.get("stn_id-value") or p.get("msc_id-value") or "ECCC SWOB",
            "lat":slat,"lon":slon,"distance_km":dist,"age_hours":max(0.0,age_h),"weight":w,
            "temperature_2m":temp,"relative_humidity_2m":rh,"wind_speed_10m":wind_to_kmh(wind_raw,wind_uom),"wind_gusts_10m":wind_to_kmh(gust_raw,gust_uom),"wind_direction_10m":direction,
            "shortwave_radiation":solar_to_wm2(solar_raw,solar_uom),"wind_source_field":wind_key,"wind_source_uom":wind_uom,"gust_source_field":gust_key,"gust_source_uom":gust_uom,"solar_source_field":solar_key,"solar_source_uom":solar_uom,"precipitation":precip,
        })
    if not rows:return None
    latest_dt=max(core.parse_stamp(r["time"]) for r in rows if core.parse_stamp(r["time"]));fresh=[r for r in rows if abs((latest_dt-core.parse_stamp(r["time"])).total_seconds())<=4500];fresh.sort(key=lambda r:(-r["weight"],r["distance_km"]))
    seen=set();unique=[]
    for r in fresh:
        if r["station"] in seen:continue
        seen.add(r["station"]);unique.append(r)
        if len(unique)>=8:break
    fresh=unique
    if not fresh:return None
    values={var:weighted_linear(fresh,var) for var in core.VERIFY_VARS};values["shortwave_radiation"]=weighted_linear(fresh,"shortwave_radiation")
    sin_sum=cos_sum=dir_weight=0.0
    for r in fresh:
        d=core.safe_float(r.get("wind_direction_10m"))
        if d is None:continue
        rw=max(1e-6,float(r["weight"]));rad=math.radians(d%360.0);sin_sum+=math.sin(rad)*rw;cos_sum+=math.cos(rad)*rw;dir_weight+=rw
    values["wind_direction_10m"]=math.degrees(math.atan2(sin_sum,cos_sum))%360.0 if dir_weight else None
    return {
        "time":core.iso(latest_dt),"values":values,"stations":fresh,"station_count":len(fresh),
        "wind_station_count":sum(1 for r in fresh if r.get("wind_speed_10m") is not None),"gust_station_count":sum(1 for r in fresh if r.get("wind_gusts_10m") is not None),"direction_station_count":sum(1 for r in fresh if r.get("wind_direction_10m") is not None),"solar_station_count":sum(1 for r in fresh if r.get("shortwave_radiation") is not None),
        "temp":values.get("temperature_2m"),"station":" / ".join(r["station"] for r in fresh[:3]),"method":"ECCC SWOB real-time mesh; distance + recency weighted; 10m wind in km/h; observed global solar normalized to W/m²","collection":"swob-realtime",
    }


def install()->None:core.eccc_observation_mesh=fetch_mesh
