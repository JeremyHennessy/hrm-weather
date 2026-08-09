/* Single authoritative Forecast Confidence controller.
   One visible value per forecast revision/location. Legacy writers are hidden so
   their background updates cannot make the displayed number flicker. */
(()=>{
  const STORE='wx-forecast-confidence-v1';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=v=>Number.isFinite(Number(v));
  const locKey=()=>{try{return localStorage.getItem('wx-loc')||'hrm'}catch{return 'hrm'}};
  function cachedEngine(){
    if(window.WXAccuracyV3)return window.WXAccuracyV3;
    try{return JSON.parse(localStorage.getItem('wx-engine-v3-startup')||'null')?.engine||null}catch{return null}
  }
  function nearest(engine,loc){const h=engine?.consensus?.[loc]?.hours||{};return h['1']||h['3']||h['6']||Object.values(h)[0]||null}
  function revision(engine){return engine?.updated_at||engine?.generated_at||'unknown'}
  function scoreFor(engine,loc){
    const row=nearest(engine,loc)||{};
    const u=Number(row.v2_uncertainty??row.uncertainty);
    let score=finite(u)?(u<=.6?95:u<=1?92:u<=1.5?88:u<=2.2?82:u<=3?76:70):78;
    const feeds=Number(engine?.collector?.deterministic_forecasts||0);
    const expected=62;
    if(feeds>0)score-=Math.round((1-Math.min(1,feeds/expected))*12); else score-=7;
    const adapt=row.adaptive_skill||{};
    const statuses=Object.values(adapt).map(x=>x?.status).filter(Boolean);
    const damped=statuses.filter(x=>x==='damped').length,learning=statuses.filter(x=>x==='learning').length;
    score-=Math.min(4,damped*2);score-=Math.min(3,learning);
    const verified=Number(engine?.collector?.verified_ledger_rows||0);
    if(verified>=1000)score+=1;
    return clamp(Math.round(score),55,97);
  }
  function label(score){return score>=90?'High':score>=80?'Good':score>=70?'Moderate':'Limited'}
  function getLocked(engine,loc){
    const rev=revision(engine),key=`${rev}:${loc}`;
    try{const saved=JSON.parse(localStorage.getItem(STORE)||'null');if(saved?.key===key&&finite(saved.score))return saved}catch{}
    const score=scoreFor(engine,loc),value={key,score,revision:rev,location:loc,saved_at:Date.now()};
    try{localStorage.setItem(STORE,JSON.stringify(value))}catch{}
    return value;
  }
  function style(){
    if(document.getElementById('wx-confidence-lock-style'))return;
    const s=document.createElement('style');s.id='wx-confidence-lock-style';s.textContent=`
      .confidenceOrb.wxConfidenceLocked>strong,.confidenceOrb.wxConfidenceLocked>span,.confidenceOrb.wxConfidenceLocked>small{display:none!important}
      .wxConfidenceStable{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-width:0}
      .wxConfidenceStable b{display:block;font-size:inherit;line-height:1;font-weight:700;color:inherit}
      .wxConfidenceStable span{display:block;font-size:9px;line-height:1.15;margin-top:3px;color:inherit}
      .wxConfidenceStable small{display:block;font-size:8px;line-height:1.2;margin-top:3px;color:var(--muted,#b7cad5)}
    `;document.head.appendChild(s);
  }
  function paint(){
    style();const orb=document.querySelector('.confidenceOrb');if(!orb)return false;
    let stable=orb.querySelector('.wxConfidenceStable');if(!stable){stable=document.createElement('div');stable.className='wxConfidenceStable';stable.setAttribute('aria-live','off');orb.appendChild(stable)}
    const engine=cachedEngine(),loc=locKey();
    if(!engine){if(!stable.dataset.ready)stable.innerHTML='<b>--%</b><span>Forecast Confidence</span><small>loading Engine 3</small>';orb.classList.add('wxConfidenceLocked');return false}
    const locked=getLocked(engine,loc),feeds=Number(engine?.collector?.deterministic_forecasts||0),rev=revision(engine);
    const html=`<b>${locked.score}%</b><span>Forecast Confidence</span><small>${label(locked.score)} · Engine 3${feeds?` · ${feeds} feeds`:''}</small>`;
    if(stable.innerHTML!==html)stable.innerHTML=html;
    stable.dataset.ready='1';stable.dataset.revision=rev;stable.dataset.location=loc;orb.classList.add('wxConfidenceLocked');orb.dataset.confidenceOwner='engine3-locked';orb.dataset.confidenceScore=String(locked.score);
    window.WX_FORECAST_CONFIDENCE={score:locked.score,revision:rev,location:loc,feeds};
    return true;
  }
  window.WXRefreshForecastConfidence=paint;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',paint,{once:true});else paint();
  window.addEventListener('wx-v3-ready',paint);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')paint()});
  document.querySelector('#tabs')?.addEventListener('click',()=>setTimeout(paint,60));
  document.querySelector('#locPrev')?.addEventListener('click',()=>setTimeout(paint,60));
  document.querySelector('#locNext')?.addEventListener('click',()=>setTimeout(paint,60));
  new MutationObserver(()=>paint()).observe(document.documentElement,{childList:true,subtree:true});
  setInterval(paint,10000);
})();
