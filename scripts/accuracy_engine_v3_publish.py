#!/usr/bin/env python3
"""Publish Accuracy Engine 3.0 after the V2 production collector completes."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
import accuracy_engine_v2 as core
import accuracy_engine_v3 as v3
import accuracy_engine_v3_verify as verify
import accuracy_engine_v3_walkforward as walkforward
import precipitation_walkforward as precip_walkforward
import precip_nowcast_verifier as precip_nowcast
import forecast_confidence_engine as confidence
import engine3_champion_gate as champion
import engine3_weighting as weighting
import real_feel_engine as realfeel
import engine32_family_taxonomy as engine32
import rrfsv1_shadow as rrfsv1
from accuracy_engine_v3_pooling import install as install_v3_pooling
install_v3_pooling()


def models_for_location(loc:dict)->list[tuple]:
    fn=getattr(core,"models_for_location",None)
    return list(fn(loc)) if callable(fn) else list(core.MODELS)


def apply_adaptive_verification(engine:dict,state:dict,walk:dict)->None:
    summary={};gate_summary={};weight_summary={}
    for loc,payload in (engine.get("consensus") or {}).items():
        regime=((payload.get("regime") or {}).get("name")) or "unknown";loc_summary={};loc_gates={};loc_weights={}
        for lead_s,h in (payload.get("hours") or {}).items():
            lead=int(lead_s);comps=h.get("components") or {};v2temp=core.safe_float(comps.get("v2_consensus"));mos=core.safe_float(comps.get("mos"));analog=core.safe_float(comps.get("analog"));nudge=core.safe_float(comps.get("observation_nudge"))
            mg=champion.component_gate(state,walk,loc,lead,regime,"mos");ag=champion.component_gate(state,walk,loc,lead,regime,"analog");ng=champion.component_gate(state,walk,loc,lead,regime,"nudge")
            mos_skill=champion.apply_cap(verify.adaptive_factor(state,loc,lead,regime,"mos"),mg);analog_skill=champion.apply_cap(verify.adaptive_factor(state,loc,lead,regime,"analog"),ag);nudge_skill=champion.apply_cap(verify.adaptive_factor(state,loc,lead,regime,"nudge"),ng)
            available=set()
            if v2temp is not None:available.add("v2")
            if mos is not None:available.add("mos")
            if analog is not None:available.add("analog")
            wdiag=weighting.component_weights(state,walk,loc,lead,regime,available,int(h.get("mos_samples",0))>=24,{"mos":mg,"analog":ag})
            weights=wdiag.get("weights") or {};weighted=[]
            if v2temp is not None:weighted.append((v2temp,float(weights.get("v2",0.0))))
            if mos is not None:weighted.append((mos,float(weights.get("mos",0.0))))
            if analog is not None:weighted.append((analog,float(weights.get("analog",0.0))))
            weighted=[x for x in weighted if x[1]>0]
            if weighted:
                den=sum(w for _,w in weighted);temp=sum(v*w for v,w in weighted)/den
                if nudge is not None:temp+=max(-1.5,min(1.5,nudge*0.65*float(nudge_skill["factor"])))
                h["temperature_2m"]=temp
            raw_pop=core.safe_float(h.get("raw_precipitation_probability"));cal_pop=core.safe_float(h.get("precipitation_probability"));pop_skill=verify.precipitation_factor(state,loc,lead,regime)
            if raw_pop is not None and cal_pop is not None:
                f=float(pop_skill["factor"]);h["precipitation_probability"]=raw_pop*(1-f)+cal_pop*f
            h["adaptive_skill"]={"mos":mos_skill,"analog":analog_skill,"observation_nudge":nudge_skill,"precipitation_calibration":pop_skill};h["component_weighting"]=wdiag
            loc_summary[lead_s]=h["adaptive_skill"];loc_gates[lead_s]={"mos":mg,"analog":ag,"observation_nudge":ng};loc_weights[lead_s]=wdiag
        summary[loc]=loc_summary;gate_summary[loc]=loc_gates;weight_summary[loc]=loc_weights
    engine["verification"]={
        "mode":"prospective-shadow-out-of-sample","minimum_samples_before_adaptation":verify.MIN_ADAPT_SAMPLES,
        "adaptive_layers":["mos","analog","observation_nudge","precipitation_calibration"],"scores":state.get("scores",{}),"precip_scores":state.get("precip_scores",{}),
        "real_feel_scores_legacy_synthetic":state.get("real_feel_scores",{}),"real_feel_reference_scores":state.get("real_feel_reference_scores",{}),
        "confidence_scores":state.get("confidence_scores",{}),"adaptive_status":summary
    }
    engine["champion_challenger"]={"minimum_promotion_samples":champion.MIN_PROMOTION_SAMPLES,"promotion_margin":champion.PROMOTION_MARGIN,"demotion_margin":champion.DEMOTION_MARGIN,"policy":"no challenger boost without OOS win; evidence-backed underperformers may be damped","components":gate_summary}
    engine["learned_component_weights"]={"minimum_samples":weighting.MIN_WEIGHT_SAMPLES,"full_trust_samples":weighting.FULL_TRUST_SAMPLES,"hierarchy":"prospective location/lead/regime -> historical walk-forward location/lead -> production prior","weights":weight_summary}


def apply_real_feel(engine:dict,ledger:list[dict],forecasts:dict,regimes:dict,state:dict)->None:
    ready=0;sources={};shadow={}
    for loc,payload in (engine.get("consensus") or {}).items():
        regime=((regimes.get(loc) or {}).get("name")) or "unknown";sources[loc]={};shadow[loc]={}
        for lead_s,h in (payload.get("hours") or {}).items():
            lead=int(lead_s);target=core.parse_stamp(h.get("target"))
            if not target:continue
            result=realfeel.predict(ledger,forecasts.get(loc,{}),loc,lead,target,regime,corrected_temp=core.safe_float(h.get("temperature_2m")))
            h["real_feel_engine"]=result
            if result.get("available"):
                inputs=result.get("inputs") or {};provider=core.safe_float(inputs.get("provider_apparent_temperature"));steadman=core.safe_float(result.get("physical_real_feel"));calibrated=core.safe_float(result.get("real_feel"))
                if provider is not None:production=provider;source="provider-apparent-champion"
                elif steadman is not None:production=steadman;source="steadman-fallback"
                else:production=calibrated;source="local-calibrated-last-resort"
                h["real_feel"]=production;h["real_feel_source"]=source
                result["production_real_feel"]=production;result["production_source"]=source;result["validation_status"]="independent-formula-replay";result["local_calibration_role"]="shadow-only"
                sources[loc][lead_s]=source;shadow[loc][lead_s]={"provider_apparent":provider,"steadman":steadman,"local_calibrated":calibrated,"legacy_humidex_transition":core.safe_float(result.get("legacy_real_feel"))};ready+=1
    replay=verify.real_feel_replay(state)
    engine["real_feel"]={"version":"2.0","method":"provider apparent production champion; Steadman/wind-chill fallback; local residual remains shadow-only while independent formula replay accumulates","forecast_points_ready":ready,"calibration_minimum_samples":realfeel.MIN_LOCAL_SAMPLES,"maximum_local_correction_c":realfeel.MAX_CORRECTION,"production_sources":sources,"shadow_candidates":shadow,"formula_validation":"comparative independent references; no synthetic single observed Real Feel target","replay_scored_rows":replay.get("scored_rows",0)}
    engine["real_feel_formula_replay"]=replay


def main()->None:
    v2_engine=core.load(core.ENGINE,{});ledger=core.load(core.LEDGER,[]);skill=core.load(core.SKILL,{});observations=skill.get("observations",{});forecasts={name:{} for name in core.LOCATIONS};verification=verify.load_state();shadow_scored=verify.score_due(verification,observations)
    jobs=[]
    with ThreadPoolExecutor(max_workers=16) as pool:
        for lname,loc in core.LOCATIONS.items():
            for model,*_ in models_for_location(loc):jobs.append((lname,model,pool.submit(core.forecast_location,loc,model)))
        for lname,model,fut in jobs:
            try:result=fut.result()
            except Exception:result=None
            if result:forecasts[lname][model]=result
    regimes={}
    for lname,loc in core.LOCATIONS.items():
        regime_fc=forecasts[lname].get("ncep_hrrr_conus") or forecasts[lname].get("gem_hrdps_continental") or forecasts[lname].get("gem_regional") or forecasts[lname].get("ecmwf_ifs025") or forecasts[lname].get("gfs_seamless");regimes[lname]=core.classify_regime(observations.get(lname),regime_fc,loc)
    engine=v3.build_engine_v3(v2_engine,ledger,forecasts,observations,regimes)
    engine.setdefault("architecture",{})["observation_nudging"]="live location-official model-error correction (ECCC for Canadian locations; NWS for Upper West Side) with 4h exponential decay"
    engine.setdefault("architecture",{})["official_observation_policy"]="location-specific official mesh: ECCC SWOB in Canada; NWS/KNYC-led mesh for Upper West Side"
    # Save/score the dense 0-6 h precipitation project before the Engine 3.1
    # wrapper renders its rain-timing facade, so that facade sees this run's data.
    engine["precipitation_nowcast_verification"]=precip_nowcast.update(ledger,forecasts,observations,v2_engine.get("nowcast") or {})
    walk=walkforward.build(ledger);engine["walk_forward_verification"]=walk;engine["precipitation_walk_forward"]=precip_walkforward.build(ledger)
    apply_adaptive_verification(engine,verification,walk)
    # RRFSv1 is deliberately downstream of the final production blend so its
    # paired baseline is what the app would actually have issued.
    engine["rrfsv1"]=rrfsv1.update(engine,forecasts,observations)
    engine32.apply(engine,ledger,forecasts,regimes,verification)
    apply_real_feel(engine,ledger,forecasts,regimes,verification);confidence.apply(engine,verification)
    shadow_added=verify.add_current_forecasts(verification,engine);verify.save_state(verification)
    engine["collector"]={"deterministic_forecasts":sum(len(x) for x in forecasts.values()),"verified_ledger_rows":sum(1 for x in ledger if x.get("scored")),"training_ledger_rows":len(ledger),"lead_pooling":True,"shadow_forecasts_scored":shadow_scored,"shadow_forecasts_added":shadow_added,"shadow_history_rows":len(verification.get("forecasts",[]))};core.save(v3.ENGINE_V3,engine)
    mos_ready=sum(1 for loc in engine.get("diagnostics",{}).values() for item in (loc.get("mos") or {}).values() if item.get("available"));analog_ready=sum(1 for loc in engine.get("diagnostics",{}).values() for item in (loc.get("analogs") or {}).values() if item.get("available"))
    print(f"accuracy-v3 forecasts={engine['collector']['deterministic_forecasts']} verified={engine['collector']['verified_ledger_rows']} mos_ready={mos_ready} analog_ready={analog_ready} engine32_ready={engine.get('engine32',{}).get('forecast_points_ready',0)} engine32_taxonomy={engine.get('engine32',{}).get('selected_taxonomy')} precip06_rows={engine.get('precipitation_nowcast_verification',{}).get('rows',0)} rrfs_rows={engine.get('rrfsv1',{}).get('archived_rows',0)} realfeel_ready={engine.get('real_feel',{}).get('forecast_points_ready',0)} realfeel_replay={engine.get('real_feel_formula_replay',{}).get('scored_rows',0)} precip_oos={engine.get('precipitation_walk_forward',{}).get('evaluated_targets',0)} confidence_owner={engine.get('forecast_confidence',{}).get('owner')} shadow_scored={shadow_scored} shadow_added={shadow_added}")


if __name__=="__main__":main()
