/* Server Truth UI
   Engine/shared server state owns health, observations, verification scorecard,
   Real Feel validation status, feed coverage and spread. Browser-local skill is
   retained only for legacy diagnostics and must not overwrite these fields. */
(()=>{
  const POINTS={
    hrm:[['Halifax Peninsula',44.6488,-63.5752],['Bedford',44.7318,-63.6619],['Dartmouth',44.6661,-63.5676]],
    moncton:[['Moncton',46.0878,-64.7782]],shediac:[['Shediac',46.2198,-64.5411]],lunenburg:[['Lunenburg',44.377896,-64.309529]],
    wolfville:[['Wolfville',45.091713,-64.359242],['Wolfville Core',45.067858,-64.460234],['Wolfville West',45.077707,-64.495306]],
    uws:[['UWS South',40.7745,-73.9840],['UWS Central',40.7870,-73.9754],['UWS North',40.7950,-73.9705]]
  };
  const TZ={uws:'America/New_York'};
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const num=v=>finite(v)?Number(v):null;
  const us=()=>document.documentElement.dataset.wxUnits==='us';
  const absTemp=v=>us()?Number(v)*9/5+32:Number(v);
  const deltaTemp=v=>us()?Number(v)*9/5:Number(v);
  const fmtAbs=(v,d=1)=>finite(v)?`${absTemp(v).toFixed(d)}°${us()?'F':''}`:'--';
  const fmtDelta=(v,d=1)=>finite(v)?`${deltaTemp(v).toFixed(d)}°${us()?'F':''}`:'--';
  const locKey=()=>{try{return localStorage.getItem('wx-loc')||'hrm'}catch{return'hrm'}};
  const timezone=key=>TZ[key]||'America/Halifax';
  const text=(el,v)=>{if(el&&v!=null&&el.textContent!==String(v))el.textContent=String(v)};
  const fmt=(v,d=1)=>finite(v)?Number(v).toFixed(d):'--';
  let V3=null,TRUTH=null,pointTruth=null,pointTruthLoc=null,pointJob=null,queued=false;

  function cachedV3(){if(window.WXAccuracyV3)return window.WXAccuracyV3;try{return JSON.parse(localStorage.getItem('wx-engine-v3-startup')||'null')?.engine||null}catch{return null}}
  async function getJson(path){const r=await fetch(`${path}${path.includes('?')?'&':'?'}truth=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw Error(`${path} ${r.status}`);return r.json()}
  function truthFrom(v3,v2){
    if(v3?.server_truth)return v3.server_truth;if(!v2)return null;const context={};
    for(const [loc,payload] of Object.entries(v2.consensus||{})){const leads={};for(const [lead,row] of Object.entries(payload?.hours||{}))leads[lead]={learned_spread:num(row?.learned_spread),ensemble_spread:num(row?.ensemble_spread),uncertainty:num(row?.uncertainty),effective_independent_sources:Number(row?.effective_independent_sources||0),ensemble_families:Number(row?.ensemble_families||0)};context[loc]=leads}
    return{version:'compat-v2',owner:'hourly-server-collector',updated_at:v2.updated_at,observations:v2.observations||{},source_health:v2.source_health||{},best_models:v2.best_models||{},model_families:v2.model_families||{},ensemble_products:v2.ensemble_products||{},consensus_context:context,policy:'server-owned fallback from engine-v2 during Engine 3 contract rollout'};
  }
  async function loadTruth(){try{V3=cachedV3()||await getJson('data/engine-v3.json');let v2=null;if(!V3?.server_truth)v2=await getJson('data/engine-v2.json');TRUTH=truthFrom(V3,v2);window.WXServerTruth={engine:V3,truth:TRUTH,owner:TRUTH?.owner||null};installOwnership();paintAll()}catch(e){console.warn('Server Truth UI unavailable',e)}}
  function observation(){return TRUTH?.observations?.[locKey()]||null}
  function sourceHealth(){return TRUTH?.source_health?.[locKey()]||null}
  function leadContext(lead='1'){return TRUTH?.consensus_context?.[locKey()]?.[String(lead)]||null}
  function officialSource(){const obs=observation(),h=sourceHealth();return String(obs?.provider||h?.observation_provider||(locKey()==='uws'?'NWS':'ECCC')).toUpperCase()}
  function officialDescriptor(){return officialSource()==='NWS'?'NWS station mesh':'ECCC SWOB mesh'}
  function serverFresh(){const t=Date.parse(V3?.updated_at||TRUTH?.updated_at||'');return Number.isFinite(t)&&Date.now()-t<3*60*60*1000&&Number(V3?.collector?.deterministic_forecasts||0)>0}

  function paintHealth(){
    const el=document.getElementById('health'),h=sourceHealth(),obs=observation();if(!el||!h)return false;
    const dm=Number(h.deterministic_models||0),de=Math.max(1,Number(h.deterministic_expected||13)),em=Number(h.ensemble_products||0),ee=Math.max(1,Number(h.ensemble_expected||4)),stations=Number(obs?.station_count||h.observation_stations||0),nowcast=Boolean(h.radar||h.radar_extrapolation||h.rdpa),feeds=Number(V3?.collector?.deterministic_forecasts||0),src=officialSource();
    const pct=Math.round(Math.max(0,Math.min(100,65*(dm/de)+15*(em/ee)+15*(stations>0?1:0)+5*(nowcast?1:0))));
    const html=`<b>${pct}% data health</b><span>${dm}/${de} models · ${feeds} forecast feeds · ${src} ${stations?stations+' station'+(stations===1?'':'s'):'observation unavailable'} · ensembles ${em}/${ee}</span>`;
    if(el.innerHTML!==html)el.innerHTML=html;el.dataset.owner='engine3-server-truth';return true;
  }
  function paintOfficial(){
    const obs=observation();if(!obs||Number(obs.station_count||0)<1)return false;
    const temp=num(obs?.values?.temperature_2m??obs.temp),count=Number(obs.station_count||0),src=officialSource(),station=obs.station||obs.stations?.map(x=>x.station).filter(Boolean).slice(0,3).join(' / ')||(src==='NWS'?'KNYC':'ECCC SWOB');
    const t=document.getElementById('officialTemp'),s=document.getElementById('officialStation'),line=document.getElementById('obsline');
    if(t&&finite(temp)){text(t,fmtAbs(temp,1));t.dataset.owner='engine3-server-truth';if(us())t.dataset.wxMetricTemp=String(temp)}
    if(s){text(s,`${officialDescriptor()} · ${count} station${count===1?'':'s'} · ${station}`);s.dataset.owner='engine3-server-truth'}
    if(line&&/unavailable|checking official|observation correction updating|corrected with/i.test(line.textContent||'')){text(line,`Server ${src} observation mesh · ${count} station${count===1?'':'s'} · current Real Feel remains live-input based`);line.dataset.owner='engine3-server-truth'}
    const officialSection=[...document.querySelectorAll('.section')].find(x=>x.querySelector('h2')?.textContent==='Official data'),tag=officialSection?.querySelector('.head span');if(tag)text(tag,src==='NWS'?'National Weather Service':'Environment Canada');
    return true;
  }
  function bestTemperatureModels(){return TRUTH?.best_models?.[locKey()]?.temperature_2m||[]}
  function paintScorecard(){
    const el=document.getElementById('scoreRows');if(!el)return false;const rows=bestTemperatureModels();
    if(rows.length){const html=rows.slice(0,8).map((x,i)=>`<div class="scoreRow"><b>${i+1}. ${x.label||x.model}</b><span>${fmtDelta(x.mae,2)} MAE · bias ${Number(x.bias||0)>=0?'+':''}${fmtDelta(x.bias||0,2)} · n=${Number(x.n||0)}</span></div>`).join('');if(el.innerHTML!==html)el.innerHTML=html;el.dataset.owner='engine3-server-truth'}
    const rain=document.getElementById('rainCal'),r=V3?.consensus?.[locKey()]?.hours?.['6']?.adaptive_skill?.precipitation_calibration;
    if(rain&&r){const suffix=finite(r.calibrated_brier)&&finite(r.raw_brier)?` · Brier ${fmt(r.raw_brier,3)} → ${fmt(r.calibrated_brier,3)}`:'';text(rain,`Server precipitation calibration: ${r.status||'learning'} · n=${Number(r.samples||0)}${suffix}`);rain.dataset.owner='engine3-server-truth'}
    return rows.length>0;
  }
  function paintAccuracy(){
    if(!V3)return false;const verified=Number(V3.collector?.verified_ledger_rows||0),best=bestTemperatureModels()[0],ctx=leadContext('1'),unc=num(ctx?.uncertainty??V3.consensus?.[locKey()]?.hours?.['1']?.v2_uncertainty);
    const vc=document.getElementById('verifiedCount'),bs=document.getElementById('bestSkill'),ue=document.getElementById('uncertainty'),note=document.getElementById('skillNote');
    if(vc){text(vc,String(verified));vc.dataset.owner='engine3-server-truth'}if(bs&&best){text(bs,best.label||best.model);bs.dataset.owner='engine3-server-truth'}if(ue&&finite(unc)){text(ue,`±${fmtDelta(unc,1)}`);ue.dataset.owner='engine3-server-truth'}
    if(note){const spread=num(ctx?.learned_spread),ind=Number(ctx?.effective_independent_sources||0),msg=best?`${best.label||best.model} leads the server temperature scorecard at ${fmtDelta(best.mae,2)} MAE from ${Number(best.n||0)} verified cases.${finite(spread)?` Current family spread ${fmtDelta(spread,2)}.`:''}${ind?` ${ind} independent model families contributing.`:''}`:`Server verification has ${verified} scored ledger rows.`;text(note,msg);note.dataset.owner='engine3-server-truth'}
    const mc=document.getElementById('modelCount'),feeds=Number(V3.collector?.deterministic_forecasts||0);if(mc&&feeds){text(mc,`${feeds} forecast feeds · Engine 3 server consensus`);mc.dataset.owner='engine3-server-truth'}return true;
  }
  function paintCoverage(){
    const chips=document.getElementById('chips'),h=sourceHealth(),ctx=leadContext('1'),obs=observation();if(!chips||!h)return false;
    const spread=num(ctx?.learned_spread),dm=Number(h.deterministic_models||0),de=Number(h.deterministic_expected||13),ind=Number(ctx?.effective_independent_sources||0),stations=Number(obs?.station_count||h.observation_stations||0),src=officialSource();
    const vals=[finite(spread)?`model spread ${fmtDelta(spread,1)} · server`:'model spread learning',`${dm}/${de} models`,ind?`${ind} independent families`:'family coverage learning',stations?`${src} ${stations} stations`:`${src} observation unavailable`];const html=vals.map(v=>`<span class="chip">${v}</span>`).join('');if(chips.innerHTML!==html)chips.innerHTML=html;chips.dataset.owner='engine3-server-truth';return true;
  }
  function paintRealFeelValidation(){const replay=V3?.real_feel_formula_replay,box=document.getElementById('v3RealFeel');if(!box||!replay)return false;const n=Number(replay.scored_rows||V3?.real_feel?.replay_scored_rows||0);text(box,n?`${n} replay rows`:'learning');box.dataset.owner='engine3-independent-replay';const span=box.parentElement?.querySelector('span');if(span)text(span,'independent formula replay');return true}

  function fastPointValues(){const f=window.__wxFastCurrent;if(f?.painted&&f.location===locKey()&&Array.isArray(f.point_values)&&f.point_values.length)return f.point_values;return null}
  async function queryPointTruth(key){
    const points=POINTS[key]||[];if(!points.length)return[];const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),6500);
    try{const jobs=points.map(async([name,lat,lon])=>{const q=new URLSearchParams({latitude:String(lat),longitude:String(lon),timezone:timezone(key),forecast_days:'1',temperature_unit:'celsius',current:'temperature_2m,apparent_temperature'});const r=await fetch(`https://api.open-meteo.com/v1/forecast?${q}`,{cache:'no-store',signal:ctrl.signal});if(!r.ok)throw Error(r.status);const d=await r.json(),c=d.current||{};return{name,air:num(c.temperature_2m),feel:num(c.apparent_temperature)}});const s=await Promise.allSettled(jobs);return s.filter(x=>x.status==='fulfilled'&&finite(x.value.air)&&finite(x.value.feel)).map(x=>x.value)}finally{clearTimeout(timer)}
  }
  async function ensurePointTruth(){const key=locKey(),fast=fastPointValues();if(fast){pointTruth=fast;pointTruthLoc=key;return fast}if(pointTruthLoc===key&&pointTruth?.length)return pointTruth;if(pointJob)return pointJob;pointJob=queryPointTruth(key).then(rows=>{if(locKey()===key){pointTruth=rows;pointTruthLoc=key;paintZones()}return rows}).catch(()=>[]).finally(()=>{pointJob=null});return pointJob}
  function paintZones(){
    const key=locKey(),values=fastPointValues()||(pointTruthLoc===key?pointTruth:null);if(!values?.length)return false;let changed=false;
    for(const card of document.querySelectorAll('#zones .card')){const name=card.querySelector('small')?.textContent?.trim(),p=values.find(x=>x.name===name);if(!p)continue;const rf=card.querySelector('.zt'),sub=card.querySelector('.sub');if(rf&&finite(p.feel)){text(rf,fmtAbs(p.feel,1));rf.dataset.owner='live-current-point-truth';if(us())rf.dataset.wxMetricTemp=String(p.feel)}if(sub&&finite(p.air)){const current=sub.textContent||'',replacement=`Actual ${fmtAbs(p.air,1)}`,next=/actual\s*-?\d+(?:\.\d+)?°(?:F)?/i.test(current)?current.replace(/actual\s*-?\d+(?:\.\d+)?°(?:F)?/i,replacement):`${replacement}${current?` · ${current}`:''}`;text(sub,next);sub.dataset.owner='live-current-point-truth'}card.dataset.currentTruth='provider-apparent-current';changed=true}return changed;
  }
  function installOwnership(){try{window.wxHealth=paintHealth;window.wxScorecard=paintScorecard}catch{}}
  function paintAll(){if(!TRUTH||!V3)return false;paintHealth();paintOfficial();paintAccuracy();paintScorecard();paintCoverage();paintRealFeelValidation();paintZones();ensurePointTruth();document.documentElement.dataset.wxServerTruth=serverFresh()?'fresh':'loaded';return true}
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;paintAll()})}
  function bind(){window.addEventListener('wx-v3-ready',()=>{V3=cachedV3()||V3;if(V3?.server_truth)TRUTH=V3.server_truth;installOwnership();schedule()});document.querySelector('#tabs')?.addEventListener('click',()=>{pointTruth=null;pointTruthLoc=null;setTimeout(()=>{schedule();ensurePointTruth()},80)});document.querySelector('#locPrev')?.addEventListener('click',()=>{pointTruth=null;pointTruthLoc=null;setTimeout(()=>{schedule();ensurePointTruth()},80)});document.querySelector('#locNext')?.addEventListener('click',()=>{pointTruth=null;pointTruthLoc=null;setTimeout(()=>{schedule();ensurePointTruth()},80)});new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,characterData:true});setInterval(paintAll,5000)}
  window.WXRefreshServerTruthUI=paintAll;if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{bind();loadTruth()},{once:true});else{bind();loadTruth()}
})();