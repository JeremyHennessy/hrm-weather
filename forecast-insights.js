/* Engine-owned plain-English forecast summary, meaningful-change notice, and
   time-aware sun protection guidance. Uses the same Engine 3 snapshot as the UI. */
(()=>{
  const finite=v=>Number.isFinite(Number(v));
  const loc=()=>{try{return localStorage.getItem('wx-loc')||'hrm'}catch{return'hrm'}};
  const engine=()=>window.WXAccuracyV3||(()=>{try{return JSON.parse(localStorage.getItem('wx-engine-v3-startup')||'null')?.engine||null}catch{return null}})();
  const hours=()=>engine()?.consensus?.[loc()]?.hours||{};
  const row=l=>hours()[String(l)]||{};
  const n=(v,d=0)=>finite(v)?Number(v):d;
  const time=s=>{try{return new Date(s).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}catch{return''}};
  let painting=false;
  function summary(){
    const h1=row(1),h6=row(6),h12=row(12);if(!h1.target)return null;
    const rf=n(h1.real_feel,NaN),air=n(h1.temperature_2m,NaN),pops=[h1,h6,h12].map(x=>n(x.precipitation_probability,0)),maxPop=Math.round(Math.max(...pops));
    const wind=n(h1.real_feel_engine?.inputs?.wind_speed_10m,0),conf=h1.forecast_confidence?.value,reg=engine()?.consensus?.[loc()]?.regime?.name||'';
    let lead='';
    if(finite(rf)&&finite(air)){const delta=rf-air;lead=delta>=3?`It will feel notably warmer than the air temperature, near ${Math.round(rf)}°C.`:delta<=-3?`Wind and exposure make it feel cooler, near ${Math.round(rf)}°C.`:`Real Feel stays close to the air temperature near ${Math.round(rf)}°C.`}
    let rain=maxPop>=70?'Rain is likely in the next 12 hours.':maxPop>=40?'There is a meaningful shower/rain chance in the next 12 hours.':maxPop>=20?'A small rain chance remains, but much of the period should stay dry.':'Rain risk is low through the next 12 hours.';
    let extra=wind>=35?' Strong winds are also a factor.':reg.includes('marine')?' Marine influence is affecting the local forecast.':'';
    let confidence=finite(conf)?` Forecast confidence is ${Math.round(conf)}%.`:'';
    return `${lead} ${rain}${extra}${confidence}`.replace(/\s+/g,' ').trim();
  }
  function uvSeries(){return Object.entries(hours()).map(([lead,h])=>({lead:Number(lead),uv:n(h.real_feel_engine?.inputs?.uv_index,NaN),target:h.target})).filter(x=>finite(x.uv)).sort((a,b)=>a.lead-b.lead)}
  function uvAdvice(){
    const series=uvSeries();if(!series.length)return null;const now=series[0],peak=series.reduce((a,b)=>b.uv>a.uv?b:a,series[0]);
    if(peak.uv<3)return null;
    const peakText=`Peak UV ${Math.round(peak.uv*10)/10}${peak.target?` around ${time(peak.target)}`:''}.`;
    let level=peak.uv>=11?'Extreme':peak.uv>=8?'Very high':peak.uv>=6?'High':'Moderate';
    let spf=peak.uv>=8?'SPF 30+ minimum; SPF 50+ is a sensible choice for extended outdoor exposure.':'Use broad-spectrum SPF 30+.';
    let timing='Apply sunscreen about 15 minutes before going outside and reapply at least every 2 hours, and after swimming or heavy sweating.';
    let behavior=peak.uv>=8?' Seek shade and limit prolonged direct midday sun.':peak.uv>=6?' Add shade, sunglasses and a hat, especially around midday.':' Sunglasses, a hat and shade add useful protection.';
    if(now.uv<3){const first=series.find(x=>x.uv>=3);return {uv:peak.uv,level,title:`UV rising to ${Math.round(peak.uv*10)/10} · ${level}`,detail:`Protection becomes useful${first?.target?` around ${time(first.target)}`:''}. ${spf} ${timing}${behavior} ${peakText}`}}
    return {uv:peak.uv,level,title:`UV ${Math.round(now.uv*10)/10} now · ${level}`,detail:`${spf} ${timing}${behavior} ${peakText}`};
  }
  function paintUV(){
    const a=uvAdvice(),el=document.querySelector('#uvGuidance'),hero=document.querySelector('.hero');if(!el)return;
    if(!a){if(!el.hidden)el.hidden=true;hero?.classList.remove('uvGuidanceActive');return}
    const html=`<b>${a.title}</b><span>${a.detail}</span>`;if(el.innerHTML!==html)el.innerHTML=html;if(el.hidden)el.hidden=false;hero?.classList.add('uvGuidanceActive');el.dataset.owner='forecast-insights';
  }
  function changeNotice(){
    const e=engine(),h1=row(1);if(!e||!h1.target)return;const key=`wx-engine-change-${loc()}`;let prior=null;try{prior=JSON.parse(localStorage.getItem(key)||'null')}catch{}
    const cur={rev:e.updated_at,target:h1.target,temp:n(h1.temperature_2m,NaN),rf:n(h1.real_feel,NaN),pop:n(h1.precipitation_probability,NaN),conf:n(h1.forecast_confidence?.value,NaN)};
    const changes=[];if(prior&&prior.target===cur.target){if(finite(cur.rf)&&finite(prior.rf)&&Math.abs(cur.rf-prior.rf)>=1.5)changes.push(`Real Feel ${cur.rf>prior.rf?'rose':'fell'} ${Math.abs(cur.rf-prior.rf).toFixed(1)}°`);if(finite(cur.pop)&&finite(prior.pop)&&Math.abs(cur.pop-prior.pop)>=20)changes.push(`rain chance ${cur.pop>prior.pop?'increased':'decreased'} ${Math.round(Math.abs(cur.pop-prior.pop))} points`);if(finite(cur.conf)&&finite(prior.conf)&&Math.abs(cur.conf-prior.conf)>=8)changes.push(`confidence ${cur.conf>prior.conf?'rose':'fell'} to ${Math.round(cur.conf)}%`)}
    try{localStorage.setItem(key,JSON.stringify(cur))}catch{}
    let note=document.querySelector('#forecastChangeNotice');if(!changes.length){note?.remove();return}if(!note){note=document.createElement('div');note.id='forecastChangeNotice';note.className='forecastChangeNotice';document.querySelector('.dayBrief')?.prepend(note)}const text=`Forecast changed: ${changes.join(' · ')}.`;if(note.textContent!==text)note.textContent=text;
  }
  function paint(){if(painting)return;painting=true;try{const s=summary(),target=document.querySelector('#daySummary');if(s&&target){if(target.textContent!==s)target.textContent=s;target.dataset.source='engine3-summary'}paintUV();changeNotice()}finally{painting=false}}
  if(!document.querySelector('#forecastInsightsStyle')){const st=document.createElement('style');st.id='forecastInsightsStyle';st.textContent='.forecastChangeNotice{margin:0 0 10px;padding:9px 11px;border:1px solid rgba(138,188,216,.28);border-radius:12px;background:rgba(8,37,55,.5);font-size:10px;color:#dcecf4}.daySummary[data-source="engine3-summary"]{line-height:1.45}';document.head.appendChild(st)}
  window.WXRefreshForecastInsights=paint;if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(paint,300),{once:true});else setTimeout(paint,300);window.addEventListener('wx-v3-ready',()=>setTimeout(paint,60));document.querySelector('#tabs')?.addEventListener('click',()=>setTimeout(paint,120));
  const summaryEl=document.querySelector('#daySummary');if(summaryEl)new MutationObserver(()=>{if(!painting&&summaryEl.dataset.source==='engine3-summary')queueMicrotask(paint)}).observe(summaryEl,{childList:true,subtree:true,characterData:true});
  const uvEl=document.querySelector('#uvGuidance');if(uvEl)new MutationObserver(()=>{if(!painting&&uvEl.dataset.owner==='forecast-insights')queueMicrotask(paint)}).observe(uvEl,{childList:true,subtree:true,characterData:true});
  setInterval(paint,30000);
})();
