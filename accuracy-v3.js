/* Weather Consensus Accuracy Engine 3.0 client integration */
(()=>{
  let V3=null;
  const finite=x=>Number.isFinite(Number(x));
  const locKey=()=>typeof loc!=='undefined'?loc:'hrm';
  const fresh=()=>{const t=V3?.updated_at?Date.parse(V3.updated_at):0;return !!t&&Date.now()-t<3*60*60*1000};
  function atLead(lead){
    const hs=V3?.consensus?.[locKey()]?.hours||{},keys=Object.keys(hs).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    if(!keys.length)return null;
    const min=keys[0],max=keys[keys.length-1];
    if(lead<min||lead>max)return null;
    if(hs[String(lead)])return hs[String(lead)];
    const lo=keys.filter(x=>x<=lead).pop(),hi=keys.find(x=>x>=lead);
    if(lo===undefined||hi===undefined)return null;
    const a=hs[String(lo)]||{},b=hs[String(hi)]||{};if(lo===hi)return a;
    const f=(lead-lo)/(hi-lo),interp=(x,y)=>finite(x)&&finite(y)?Number(x)+(Number(y)-Number(x))*f:(finite(x)?Number(x):(finite(y)?Number(y):null));
    return{temperature_2m:interp(a.temperature_2m,b.temperature_2m),real_feel:interp(a.real_feel,b.real_feel),precipitation_probability:interp(a.precipitation_probability,b.precipitation_probability)};
  }
  function install(){
    if(!V3||!fresh())return;
    const previous=window.weightedModel;
    if(typeof previous==='function'&&!window.__wxV3WeightingInstalled){
      window.__wxV3WeightingInstalled=true;
      window.weightedModel=function(mods,zname,getter,lead=0,windDir=null){const h=lead>0?atLead(lead):null;if(h&&finite(h.temperature_2m))return Number(h.temperature_2m);return previous(mods,zname,getter,lead,windDir)};
    }
    window.WXAccuracyV3=V3;
    window.WXCalibratedPop=function(lead,raw){const h=atLead(lead);return h&&finite(h.precipitation_probability)?Number(h.precipitation_probability):raw};
    window.WXRealFeelAtLead=function(lead,raw){const h=atLead(lead);return h&&finite(h.real_feel)?Number(h.real_feel):raw};
    window.dispatchEvent(new CustomEvent('wx-v3-ready'));
  }
  function ensureUI(){
    const section=[...document.querySelectorAll('.section')].find(s=>s.querySelector('h2')?.textContent.trim()==='Accuracy engine');
    if(!section||document.getElementById('v3Engine'))return;
    const grid=document.getElementById('v2EngineGrid')||section.querySelector('.accuracy');
    const box=document.createElement('div');box.id='v3Engine';box.className='v3Engine';box.innerHTML='<div><small>LOCAL MOS</small><b id="v3Mos">learning</b><span>verified-target regression</span></div><div><small>ANALOGS</small><b id="v3Analog">learning</b><span>similar historical setups</span></div><div><small>REAL FEEL</small><b id="v3RealFeel">learning</b><span>independent formula replay</span></div><div><small>RAIN CALIBRATION</small><b id="v3Rain">learning</b><span>observed reliability</span></div><div><small>OBS NUDGE</small><b id="v3Nudge">--</b><span>live local model error</span></div><div><small>WALK-FORWARD</small><b id="v3Walk">learning</b><span>strict out-of-sample check</span></div>';grid?.insertAdjacentElement('afterend',box);
    const st=document.createElement('style');st.id='v3-style';st.textContent='.v3Engine{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px}.v3Engine>div{border:1px solid var(--line);border-radius:15px;padding:10px;background:#0b243555}.v3Engine small,.v3Engine span{display:block;color:var(--muted);font-size:9px}.v3Engine b{display:block;font-size:15px;margin:4px 0}@media(max-width:620px){.v3Engine{grid-template-columns:repeat(2,1fr)}}';document.head.appendChild(st);
  }
  function render(){
    ensureUI();if(!V3)return;const d=V3.diagnostics?.[locKey()]||{},h=V3.consensus?.[locKey()]?.hours?.['6']||{};
    const mos=d.mos?.['6']||{},analog=d.analogs?.['6']||{},rain=d.precip_calibration?.['6']||{},nudge=h.components?.observation_nudge;
    const replay=V3.real_feel_formula_replay||{},wf=V3.walk_forward_verification?.locations?.[locKey()]?.['6']?.scores?.v3_reconstructed||{};
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v};
    set('v3Mos',mos.available?`${mos.samples} samples`:`${mos.samples||0}/12`);set('v3Analog',analog.available?`${analog.neighbors} matches`:'learning');set('v3Rain',rain.samples?`${rain.samples} scored`:'learning');set('v3Nudge',finite(nudge)?`${Number(nudge)>=0?'+':''}${Number(nudge).toFixed(1)}°`:'--');
    set('v3RealFeel',Number(replay.scored_rows||0)?`${Number(replay.scored_rows)} replay rows`:'learning');set('v3Walk',wf.n?`${wf.mae?.toFixed?.(2)??'--'}° MAE`:'learning');
    const feeds=Number(V3.collector?.deterministic_forecasts||0),mc=document.getElementById('modelCount');if(mc&&feeds)mc.textContent=`${feeds} forecast feeds · Engine 3 server consensus`;
    const note=document.getElementById('v2EngineNote');if(note)note.textContent=`V3: local MOS + historical analogs + observation nudging + independent Real Feel replay + calibrated rain · ${V3.collector?.verified_ledger_rows??0} verified ledger rows.`;
  }
  async function loadV3(){try{const r=await fetch('data/engine-v3.json?ts='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error(r.status);V3=await r.json();install();render()}catch{ensureUI()}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadV3,{once:true});else loadV3();
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&(!V3||!fresh()))loadV3()});setInterval(render,60000);
})();
import('./server-truth-ui.js?v=1').catch(()=>{});
