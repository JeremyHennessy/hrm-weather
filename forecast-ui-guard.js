/* Final UI truth layer for server-first Engine 3 operation.
   Keeps intentionally skipped client model calls from being reported as failures,
   prevents broken live-base air temperature overwrites, and keeps RIGHT NOW
   Real Feel + Actual owned by the live current-condition path. A future Engine 3
   forecast row must never replace values labelled current. */
(()=>{
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const us=()=>document.documentElement.dataset.wxUnits==='us';
  const absTemp=v=>us()?Number(v)*9/5+32:Number(v);
  const absText=v=>`${absTemp(v).toFixed(1)}°${us()?'F':''}`;
  const locKey=()=>{try{return localStorage.getItem('wx-loc')||'hrm'}catch{return 'hrm'}};
  function engine(){
    if(window.WXAccuracyV3)return window.WXAccuracyV3;
    try{return JSON.parse(localStorage.getItem('wx-engine-v3-startup')||'null')?.engine||null}catch{return null}
  }
  function fresh(e){const t=e?.updated_at?Date.parse(e.updated_at):0;return !!t&&Date.now()-t<3*60*60*1000&&Number(e?.collector?.deterministic_forecasts||0)>=20}
  function nearest(e,key){const h=e?.consensus?.[key]?.hours||{};return h['1']||h['3']||h['6']||Object.values(h)[0]||null}
  function numberFrom(text){const m=String(text||'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null}
  function currentTruth(key){const c=window.__wxFastCurrent;return c?.painted&&c.location===key&&finite(c.feel)&&finite(c.air)?c:null}
  function currentPresentation(c){
    if(c?.source==='provider-apparent-current')return{feelSource:'provider-apparent-fast-current',owner:'live-current-provider-apparent'};
    if(c?.source==='nws-apparent-fallback-current')return{feelSource:'nws-apparent-fallback-current',owner:'live-current-nws-apparent-fallback'};
    if(c?.source==='nws-stored-observation-steadman-current')return{feelSource:'nws-stored-observation-steadman-current',owner:'live-current-nws-apparent-fallback'};
    if(c?.source==='official-observation-steadman-current')return{feelSource:'official-observation-steadman-current',owner:'live-current-official-observation-fallback'};
    return{feelSource:c?.source||'live-current',owner:'live-current-input'};
  }
  function paintCurrentTruth(key){
    const c=currentTruth(key);if(!c)return false;const p=currentPresentation(c);
    const feelsEl=document.getElementById('feels'),actual=document.getElementById('actual'),feelShown=absTemp(c.feel),airShown=absTemp(c.air);
    if(feelsEl){const next=absText(c.feel);if(feelsEl.textContent!==next)feelsEl.textContent=next;feelsEl.dataset.currentSource=p.feelSource;delete feelsEl.dataset.engine3RealFeel;if(us())feelsEl.dataset.wxMetricTemp=String(c.feel)}
    if(actual){const shown=numberFrom(actual.textContent);if(!finite(shown)||Math.abs(Number(shown)-airShown)>.05)actual.innerHTML=`Actual <b>${airShown.toFixed(1)}°${us()?'F':''}</b>`;actual.dataset.currentSource=c.source||'live-current';if(us())actual.dataset.wxMetricTemp=String(c.air)}
    document.documentElement.dataset.wxRealFeel=p.owner;document.documentElement.dataset.wxCurrentActual='live-current-input';return true;
  }
  function normalize(){
    const e=engine(),key=locKey();paintCurrentTruth(key);if(!fresh(e))return false;
    const row=nearest(e,key),feeds=Number(e?.collector?.deterministic_forecasts||0),modelCount=document.getElementById('modelCount');
    if(modelCount&&feeds)modelCount.textContent=`${feeds} forecast feeds · Engine 3 server consensus`;
    const warn=document.getElementById('warn');if(warn&&/model\/location feeds were unavailable|consensus is using the feeds that responded/i.test(warn.textContent||'')){warn.textContent='';warn.style.display='none';warn.dataset.serverConsensusCleared='1'}
    const engineAir=Number(row?.temperature_2m),engineShown=finite(engineAir)?absTemp(engineAir):null,actual=document.getElementById('actual'),feelsEl=document.getElementById('feels'),hasCurrent=Boolean(currentTruth(key)),feel=numberFrom(feelsEl?.textContent),shownAir=numberFrom(actual?.textContent);
    const implausible=!hasCurrent&&finite(engineShown)&&finite(shownAir)&&(Math.abs(shownAir-engineShown)>18||(Math.abs(shownAir)<0.1&&engineShown>(us()?46:8))||(finite(feel)&&Math.abs(shownAir-feel)>(us()?25:14)));
    if(actual&&implausible){actual.innerHTML=`Actual <b>${engineShown.toFixed(1)}°${us()?'F':''}</b>`;actual.dataset.engine3Corrected='1';if(us())actual.dataset.wxMetricTemp=String(engineAir)}
    const firstHour=document.querySelector('#hours .hour'),sub=firstHour?.querySelector('.sub'),hourAir=numberFrom(sub?.textContent);if(sub&&finite(engineShown)&&finite(hourAir)&&Math.abs(hourAir-engineShown)>(us()?18:10)){sub.textContent=sub.textContent.replace(/Actual\s*-?\d+(?:\.\d+)?°(?:F)?/i,`Actual ${engineShown.toFixed(us()?1:0)}°${us()?'F':''}`);sub.dataset.engine3Corrected='1'}
    document.documentElement.dataset.wxServerConsensus='fresh';paintCurrentTruth(key);return true;
  }
  window.WXNormalizeForecastUI=normalize;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',normalize,{once:true});else normalize();
  window.addEventListener('wx-v3-ready',normalize);window.addEventListener('wx-fast-current-ready',normalize);
  let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;normalize()})}).observe(document.body,{childList:true,subtree:true,characterData:true});setInterval(normalize,5000);
})();