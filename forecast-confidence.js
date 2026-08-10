/* Single authoritative Forecast Confidence controller.
   Engine 3 owns the displayed probability. One value is locked per forecast
   revision/location so background renders cannot make it flicker. */
(()=>{
  const STORE='wx-forecast-confidence-v2';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=v=>Number.isFinite(Number(v));
  const locKey=()=>{try{return localStorage.getItem('wx-loc')||'hrm'}catch{return'hrm'}};
  function cachedEngine(){
    if(window.WXAccuracyV3)return window.WXAccuracyV3;
    try{return JSON.parse(localStorage.getItem('wx-engine-v3-startup')||'null')?.engine||null}catch{return null}
  }
  function nearest(engine,loc){const h=engine?.consensus?.[loc]?.hours||{};return h['1']||h['3']||h['6']||Object.values(h)[0]||null}
  function revision(engine){return engine?.updated_at||engine?.generated_at||'unknown'}
  function fallbackScore(engine,loc){
    const row=nearest(engine,loc)||{},u=Number(row.v2_uncertainty??row.uncertainty);
    let score=finite(u)?(u<=.6?92:u<=1?89:u<=1.5?85:u<=2.2?79:u<=3?73:67):74;
    const feeds=Number(engine?.collector?.deterministic_forecasts||0);if(feeds>0)score-=Math.round((1-Math.min(1,feeds/62))*10);else score-=6;
    return clamp(Math.round(score),50,94);
  }
  function scoreFor(engine,loc){
    const row=nearest(engine,loc)||{},server=row.forecast_confidence||{};
    if(finite(server.value))return{score:clamp(Math.round(Number(server.value)),50,96),source:'engine3-empirical',meta:server};
    return{score:fallbackScore(engine,loc),source:'legacy-fallback',meta:null};
  }
  function label(score){return score>=90?'High':score>=80?'Good':score>=70?'Moderate':'Limited'}
  function getLocked(engine,loc){
    const rev=revision(engine),key=`${rev}:${loc}`;
    try{const saved=JSON.parse(localStorage.getItem(STORE)||'null');if(saved?.key===key&&finite(saved.score))return saved}catch{}
    const calculated=scoreFor(engine,loc),value={key,score:calculated.score,source:calculated.source,meta:calculated.meta,revision:rev,location:loc,saved_at:Date.now()};
    try{localStorage.setItem(STORE,JSON.stringify(value))}catch{}
    return value;
  }
  function style(){
    if(document.getElementById('wx-confidence-lock-style'))return;
    const s=document.createElement('style');s.id='wx-confidence-lock-style';s.textContent=`
      .confidenceOrb.wxConfidenceLocked>strong,.confidenceOrb.wxConfidenceLocked>span,.confidenceOrb.wxConfidenceLocked>small{display:none!important}
      .wxConfidenceStable{display:flex;flex-direction:row;align-items:center;justify-content:center;gap:5px;text-align:left;min-width:0;white-space:nowrap}
      .wxConfidenceStable b{display:inline;font-size:inherit;line-height:1;font-weight:700;color:inherit}
      .wxConfidenceStable span{display:inline;font-size:inherit;line-height:1;color:inherit;margin:0}
      .wxConfidenceStable small{display:none!important}
    `;document.head.appendChild(s);
  }
  function paint(){
    style();const orb=document.querySelector('.confidenceOrb');if(!orb)return false;
    let stable=orb.querySelector('.wxConfidenceStable');if(!stable){stable=document.createElement('div');stable.className='wxConfidenceStable';stable.setAttribute('aria-live','off');orb.appendChild(stable)}
    const engine=cachedEngine(),loc=locKey();
    if(!engine){if(!stable.dataset.ready)stable.innerHTML='<b>--%</b><span>Confidence</span>';orb.classList.add('wxConfidenceLocked');orb.setAttribute('aria-label','Forecast Confidence loading');return false}
    const locked=getLocked(engine,loc),feeds=Number(engine?.collector?.deterministic_forecasts||0),rev=revision(engine),status=label(locked.score);
    const html=`<b>${locked.score}%</b><span>Confidence · ${status}</span>`;
    if(stable.innerHTML!==html)stable.innerHTML=html;
    const empirical=locked.source==='engine3-empirical',detail=`Forecast Confidence ${locked.score}% · ${status} · Engine 3${empirical?' calibrated':''}${feeds?` · ${feeds} feeds`:''}`;
    orb.setAttribute('aria-label',detail);orb.title=detail;
    stable.dataset.ready='1';stable.dataset.revision=rev;stable.dataset.location=loc;orb.classList.add('wxConfidenceLocked');orb.dataset.confidenceOwner=locked.source;orb.dataset.confidenceScore=String(locked.score);
    window.WX_FORECAST_CONFIDENCE={score:locked.score,revision:rev,location:loc,feeds,owner:locked.source,meta:locked.meta};
    return true;
  }
  window.WXRefreshForecastConfidence=paint;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',paint,{once:true});else paint();
  window.addEventListener('wx-v3-ready',paint);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')paint()});
  document.querySelector('#tabs')?.addEventListener('click',()=>setTimeout(paint,60));document.querySelector('#locPrev')?.addEventListener('click',()=>setTimeout(paint,60));document.querySelector('#locNext')?.addEventListener('click',()=>setTimeout(paint,60));
  new MutationObserver(()=>paint()).observe(document.documentElement,{childList:true,subtree:true});setInterval(paint,10000);
})();
