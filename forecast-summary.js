/* Final plain-English forecast summary owner for the original metric app.
   Current conditions come from the exact live-current object that owns the hero.
   Near-term trend/rain come from the same 12 hourly cards shown to the user.
   No forecast lead is allowed to masquerade as current conditions.
   The separate New York U.S.-units spin keeps its existing presentation layer. */
(()=>{
  if(new URLSearchParams(location.search).get('units')==='us')return;
  const SOURCE='live-current-hourly-summary';
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const loc=()=>{try{return localStorage.getItem('wx-loc')||'hrm'}catch{return'hrm'}};
  const tz=()=>{try{return typeof window.WX_LOCATION_TIMEZONE==='function'?window.WX_LOCATION_TIMEZONE():(loc()==='uws'?'America/New_York':'America/Halifax')}catch{return loc()==='uws'?'America/New_York':'America/Halifax'}};
  const localHour=()=>{try{return Number(new Intl.DateTimeFormat('en-CA',{timeZone:tz(),hour:'2-digit',hour12:false}).format(new Date()))}catch{return new Date().getHours()}};
  const period=()=>{const h=localHour();if(h<5)return'overnight';if(h<12)return'this morning';if(h<17)return'this afternoon';if(h<21)return'this evening';return'tonight'};
  const current=()=>{const c=window.__wxFastCurrent;if(!c?.painted||c.location!==loc()||!finite(c.feel)||!finite(c.air))return null;return{feel:Number(c.feel),air:Number(c.air),source:c.source||'current'}};
  const parseTemp=t=>{const m=String(t||'').match(/(-?\d+(?:\.\d+)?)\s*°/);return m?Number(m[1]):null};
  const parseRain=t=>{const m=String(t||'').match(/Rain\s+(\d+(?:\.\d+)?)%/i);return m?Number(m[1]):null};
  function hourly(){
    return [...document.querySelectorAll('#hours .hour')].slice(0,12).map(card=>{
      const smalls=[...card.querySelectorAll('small')];
      return{time:smalls[0]?.textContent?.trim()||'',feel:parseTemp(card.querySelector('b')?.textContent),air:parseTemp(card.querySelector('.sub')?.textContent),rain:parseRain(smalls.map(x=>x.textContent).join(' · '))};
    }).filter(x=>x.time||finite(x.feel)||finite(x.rain));
  }
  const degrees=v=>`${Math.round(v)}°C`;
  function currentText(c){
    const delta=c.feel-c.air;
    if(delta>=3)return`Right now, Real Feel is ${degrees(c.feel)}, about ${Math.round(delta)}° warmer than Actual.`;
    if(delta<=-3)return`Right now, Real Feel is ${degrees(c.feel)}, about ${Math.round(Math.abs(delta))}° cooler than Actual.`;
    return`Right now, Real Feel is ${degrees(c.feel)}, close to Actual ${degrees(c.air)}.`;
  }
  function trendText(c,rows){
    const valid=rows.filter(x=>finite(x.feel));if(valid.length<3)return'';
    const end=valid[Math.min(valid.length-1,5)],diff=end.feel-c.feel,span=end.time?` by ${end.time}`:'';
    if(diff<=-3)return`It cools gradually${span}, with Real Feel falling about ${Math.round(Math.abs(diff))}°.`;
    if(diff>=3)return`It warms${span}, with Real Feel rising about ${Math.round(diff)}°.`;
    return`Temperatures stay fairly steady ${period()}.`;
  }
  function rainText(rows){
    const valid=rows.filter(x=>finite(x.rain));if(!valid.length)return'';
    const peak=valid.reduce((a,b)=>b.rain>a.rain?b:a,valid[0]),p=Math.round(peak.rain),when=peak.time?` around ${peak.time}`:'';
    if(p>=70)return`Rain is likely${when}, with the chance peaking near ${p}%.`;
    if(p>=40)return`The best shower or rain chance is${when} at about ${p}%.`;
    if(p>=20)return`A small shower chance peaks${when} near ${p}%, but much of the period should stay dry.`;
    return`Rain risk stays low ${period()}.`;
  }
  function build(){
    const c=current(),rows=hourly();if(!c)return null;
    return[currentText(c),trendText(c,rows),rainText(rows)].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  }
  let painting=false;
  function paint(){
    if(painting)return;const target=document.querySelector('#daySummary'),text=build();if(!target||!text)return;
    painting=true;try{if(target.textContent!==text)target.textContent=text;target.dataset.source=SOURCE;target.dataset.currentSource=window.__wxFastCurrent?.source||'current';target.dataset.hourlyCount=String(hourly().length)}finally{painting=false}
  }
  function start(){
    const target=document.querySelector('#daySummary');if(!target){setTimeout(start,100);return}
    new MutationObserver(()=>{if(!painting&&target.dataset.source!==SOURCE)queueMicrotask(paint)}).observe(target,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-source']});
    const hours=document.querySelector('#hours');if(hours)new MutationObserver(()=>queueMicrotask(paint)).observe(hours,{childList:true,subtree:true,characterData:true});
    window.addEventListener('wx-fast-current-ready',()=>setTimeout(paint,0));
    window.addEventListener('wx-v3-ready',()=>setTimeout(paint,80));
    document.querySelector('#tabs')?.addEventListener('click',()=>setTimeout(paint,180));
    paint();setInterval(paint,5000);
  }
  window.WXRefreshForecastSummary=paint;
  window.WXBuildForecastSummary=build;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
