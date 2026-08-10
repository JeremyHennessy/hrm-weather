/* Final UI truth layer for server-first Engine 3 operation.
   Keeps intentionally skipped client model calls from being reported as failures,
   prevents broken live-base air temperature overwrites, and deliberately leaves
   the current Real Feel owned by the live current-conditions renderer. A future
   Engine 3 forecast row must never replace the value labelled RIGHT NOW. */
(()=>{
  const finite=v=>Number.isFinite(Number(v));
  const locKey=()=>{try{return localStorage.getItem('wx-loc')||'hrm'}catch{return 'hrm'}};
  function engine(){
    if(window.WXAccuracyV3)return window.WXAccuracyV3;
    try{return JSON.parse(localStorage.getItem('wx-engine-v3-startup')||'null')?.engine||null}catch{return null}
  }
  function fresh(e){const t=e?.updated_at?Date.parse(e.updated_at):0;return !!t&&Date.now()-t<3*60*60*1000&&Number(e?.collector?.deterministic_forecasts||0)>=20}
  function nearest(e,key){const h=e?.consensus?.[key]?.hours||{};return h['1']||h['3']||h['6']||Object.values(h)[0]||null}
  function numberFrom(text){const m=String(text||'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null}
  function normalize(){
    const e=engine();if(!fresh(e))return false;
    const key=locKey(),row=nearest(e,key),feeds=Number(e?.collector?.deterministic_forecasts||0);
    const modelCount=document.getElementById('modelCount');
    if(modelCount&&feeds)modelCount.textContent=`${feeds} forecast feeds · Engine 3 server consensus`;
    const warn=document.getElementById('warn');
    if(warn&&/model\/location feeds were unavailable|consensus is using the feeds that responded/i.test(warn.textContent||'')){
      warn.textContent='';warn.style.display='none';warn.dataset.serverConsensusCleared='1';
    }
    const engineAir=Number(row?.temperature_2m),actual=document.getElementById('actual'),feelsEl=document.getElementById('feels');
    const feel=numberFrom(feelsEl?.textContent),shownAir=numberFrom(actual?.textContent);
    const implausible=finite(engineAir)&&finite(shownAir)&&(
      Math.abs(shownAir-engineAir)>10 ||
      (Math.abs(shownAir)<0.1&&engineAir>8) ||
      (finite(feel)&&Math.abs(shownAir-feel)>14)
    );
    if(actual&&implausible){actual.innerHTML=`Actual <b>${engineAir.toFixed(1)}°</b>`;actual.dataset.engine3Corrected='1'}
    const firstHour=document.querySelector('#hours .hour');
    const sub=firstHour?.querySelector('.sub'),hourAir=numberFrom(sub?.textContent);
    if(sub&&finite(engineAir)&&finite(hourAir)&&Math.abs(hourAir-engineAir)>10){
      sub.textContent=sub.textContent.replace(/Actual\s*-?\d+(?:\.\d+)?°/i,`Actual ${Math.round(engineAir)}°`);sub.dataset.engine3Corrected='1';
    }
    document.documentElement.dataset.wxServerConsensus='fresh';
    document.documentElement.dataset.wxRealFeel='live-current-provider-apparent';
    return true;
  }
  window.WXNormalizeForecastUI=normalize;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',normalize,{once:true});else normalize();
  window.addEventListener('wx-v3-ready',normalize);
  let queued=false;
  new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;normalize()})}).observe(document.body,{childList:true,subtree:true,characterData:true});
  setInterval(normalize,5000);
})();