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
  let painting=false,uvObserved=false,orderObserved=false;
  function summary(){
    const h1=row(1),h6=row(6),h12=row(12);if(!h1.target)return null;
    const rf=n(h1.real_feel,NaN),air=n(h1.temperature_2m,NaN),pops=[h1,h6,h12].map(x=>n(x.precipitation_probability,0)),maxPop=Math.round(Math.max(...pops));
    const wind=n(h1.real_feel_engine?.inputs?.wind_speed_10m,0),reg=engine()?.consensus?.[loc()]?.regime?.name||'';
    let lead='';
    if(finite(rf)&&finite(air)){
      const delta=rf-air;
      lead=delta>=3?`It will feel notably warmer than the air temperature, near ${Math.round(rf)}°C.`:delta<=-3?`Wind and exposure make it feel cooler, near ${Math.round(rf)}°C.`:`Real Feel stays close to the air temperature near ${Math.round(rf)}°C.`;
    }
    const rain=maxPop>=70?'Rain is likely in the next 12 hours.':maxPop>=40?'There is a meaningful shower/rain chance in the next 12 hours.':maxPop>=20?'A small rain chance remains, but much of the period should stay dry.':'Rain risk is low through the next 12 hours.';
    const extra=wind>=35?' Strong winds are also a factor.':reg.includes('marine')?' Marine influence is affecting the local forecast.':'';
    return `${lead} ${rain}${extra}`.replace(/\s+/g,' ').trim();
  }
  function uvSeries(){return Object.entries(hours()).map(([lead,h])=>({lead:Number(lead),uv:n(h.real_feel_engine?.inputs?.uv_index,NaN),target:h.target})).filter(x=>finite(x.uv)).sort((a,b)=>a.lead-b.lead)}
  function uvAdvice(){
    const series=uvSeries();if(!series.length)return null;
    const now=series[0],peak=series.reduce((a,b)=>b.uv>a.uv?b:a,series[0]);if(peak.uv<3)return null;
    const peakText=`Peak UV ${Math.round(peak.uv*10)/10}${peak.target?` around ${time(peak.target)}`:''}.`;
    const level=peak.uv>=11?'Extreme':peak.uv>=8?'Very high':peak.uv>=6?'High':'Moderate';
    const spf=peak.uv>=8?'SPF 30+ minimum; SPF 50+ is a sensible choice for extended outdoor exposure.':'Use broad-spectrum SPF 30+.';
    const timing='Apply sunscreen about 15 minutes before going outside and reapply at least every 2 hours, and after swimming or heavy sweating.';
    const behavior=peak.uv>=8?'Seek shade and limit prolonged direct midday sun.':peak.uv>=6?'Add shade, sunglasses and a hat, especially around midday.':'Sunglasses, a hat and shade add useful protection.';
    if(now.uv<3){const first=series.find(x=>x.uv>=3);return{uv:peak.uv,level,summary:`UV rising to ${Math.round(peak.uv*10)/10} · ${level} · protection later`,detail:`Protection becomes useful${first?.target?` around ${time(first.target)}`:''}. ${spf} ${timing} ${behavior} ${peakText}`}}
    const rounded=Math.round(now.uv*10)/10;return{uv:peak.uv,level,summary:`UV ${rounded} · ${level} · SPF 30+`,detail:`${spf} ${timing} ${behavior} ${peakText}`};
  }
  function ensureUV(){let el=document.querySelector('#uvGuidance');if(el)return el;const hero=document.querySelector('.hero');if(!hero)return null;el=document.createElement('div');el.id='uvGuidance';el.className='uvGuidance';el.hidden=true;el.setAttribute('aria-live','polite');hero.appendChild(el);return el}
  function observeUV(el){if(uvObserved||!el)return;uvObserved=true;new MutationObserver(()=>{if(!painting&&el.dataset.owner==='forecast-insights')queueMicrotask(paint)}).observe(el,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']})}
  function paintUV(){const a=uvAdvice(),el=ensureUV(),hero=document.querySelector('.hero');if(!el)return;observeUV(el);el.dataset.owner='forecast-insights';if(!a){if(!el.hidden)el.hidden=true;hero?.classList.remove('uvGuidanceActive');return}const html=`<details><summary>${a.summary}</summary><div>${a.detail}</div></details>`;if(el.innerHTML!==html)el.innerHTML=html;if(el.hidden)el.hidden=false;hero?.classList.add('uvGuidanceActive')}
  function changeNotice(){
    const e=engine(),h1=row(1);if(!e||!h1.target)return;
    const key=`wx-engine-change-${loc()}`;let prior=null;try{prior=JSON.parse(localStorage.getItem(key)||'null')}catch{}
    const cur={rev:e.updated_at,target:h1.target,temp:n(h1.temperature_2m,NaN),rf:n(h1.real_feel,NaN),pop:n(h1.precipitation_probability,NaN),conf:n(h1.forecast_confidence?.value,NaN)};const changes=[];
    if(prior&&prior.target===cur.target){
      if(finite(cur.rf)&&finite(prior.rf)&&Math.abs(cur.rf-prior.rf)>=1.5)changes.push(`Real Feel ${cur.rf>prior.rf?'rose':'fell'} ${Math.abs(cur.rf-prior.rf).toFixed(1)}°`);
      if(finite(cur.pop)&&finite(prior.pop)&&Math.abs(cur.pop-prior.pop)>=20)changes.push(`rain chance ${cur.pop>prior.pop?'increased':'decreased'} ${Math.round(Math.abs(cur.pop-prior.pop))} points`);
      if(finite(cur.conf)&&finite(prior.conf)&&Math.abs(cur.conf-prior.conf)>=8)changes.push(`confidence ${cur.conf>prior.conf?'rose':'fell'} to ${Math.round(cur.conf)}%`);
    }
    try{localStorage.setItem(key,JSON.stringify(cur))}catch{}
    let note=document.querySelector('#forecastChangeNotice');if(!changes.length){note?.remove();return}
    if(!note){note=document.createElement('div');note.id='forecastChangeNotice';note.className='forecastChangeNotice';document.querySelector('.dayBrief')?.prepend(note)}
    const text=`Forecast changed: ${changes.join(' · ')}.`;if(note.textContent!==text)note.textContent=text;
  }
  function placeConfidence(){
    const top=document.querySelector('.heroTop'),orb=document.querySelector('.confidenceOrb');
    if(top&&orb&&orb.parentElement!==top)top.appendChild(orb);
  }
  function placeHourly(){
    const hero=document.querySelector('.hero');if(!hero)return;
    const hourly=[...document.querySelectorAll('.section')].find(s=>s.querySelector('h2')?.textContent.trim()==='Next 12 hours');
    if(hourly&&hero.nextElementSibling!==hourly)hero.insertAdjacentElement('afterend',hourly);
  }
  function observeOrder(){
    if(orderObserved)return;const app=document.querySelector('.app');if(!app)return;orderObserved=true;
    new MutationObserver(()=>queueMicrotask(placeHourly)).observe(app,{childList:true});
  }
  function paint(){if(painting)return;painting=true;try{placeConfidence();placeHourly();observeOrder();const s=summary(),target=document.querySelector('#daySummary');if(s&&target){if(target.textContent!==s)target.textContent=s;target.dataset.source='engine3-summary'}paintUV();changeNotice()}finally{painting=false}}
  if(!document.querySelector('#forecastInsightsStyle')){
    const st=document.createElement('style');st.id='forecastInsightsStyle';st.textContent=`
      .forecastChangeNotice{margin:0 0 10px;padding:9px 11px;border:1px solid rgba(138,188,216,.28);border-radius:12px;background:rgba(8,37,55,.5);font-size:10px;color:#dcecf4}
      .hero{min-height:440px!important}
      .heroTop{position:relative!important;min-height:78px!important;padding-right:148px!important;box-sizing:border-box!important}
      .heroTop .place{max-width:calc(100% - 4px)!important;line-height:1.25!important}
      .heroTop>.confidenceOrb{position:absolute!important;top:-3px!important;right:0!important;bottom:auto!important;width:auto!important;height:30px!important;min-width:0!important;min-height:0!important;padding:0 10px!important;z-index:7!important;display:flex!important;flex-direction:row!important;border-radius:999px!important;border:1px solid rgba(147,231,174,.38)!important;background:rgba(3,43,58,.68)!important;box-shadow:0 7px 18px rgba(0,0,0,.14)!important;backdrop-filter:blur(14px)!important;-webkit-backdrop-filter:blur(14px)!important;color:#edf9f2!important}
      .heroTop>.confidenceOrb:before{display:none!important}
      .heroTop>.confidenceOrb .wxConfidenceStable{font-size:9px!important;line-height:1!important}
      .heroTop>.confidenceOrb .wxConfidenceStable b{font-size:11px!important;color:#fff!important}
      .heroTop>.confidenceOrb .wxConfidenceStable span{font-size:8.5px!important;color:#c9e6d3!important}
      .heroTop>.confidenceOrb .wxConfidenceStable small{display:none!important}
      #heroIcon{position:absolute!important;right:8px!important;top:84px!important;margin:0!important;font-size:54px!important;z-index:3!important}
      #daySummary.heroSummary[data-source="engine3-summary"]{display:block!important;width:100%!important;max-width:100%!important;margin:10px 0 0!important;padding:10px 12px!important;box-sizing:border-box!important;border:1px solid rgba(255,255,255,.13)!important;border-radius:14px!important;background:rgba(3,28,47,.46)!important;backdrop-filter:blur(12px)!important;-webkit-backdrop-filter:blur(12px)!important;color:#eef7fb!important;font-size:11px!important;line-height:1.45!important;letter-spacing:.005em!important;text-indent:0!important;overflow:visible!important;overflow-wrap:break-word!important;-webkit-line-clamp:unset!important}
      .hero #uvGuidance.uvGuidance{position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;z-index:4!important;margin:9px 0 0!important;padding:0!important;border:1px solid rgba(255,232,143,.26)!important;border-radius:12px!important;background:rgba(19,35,46,.70)!important;backdrop-filter:blur(14px)!important;-webkit-backdrop-filter:blur(14px)!important;box-shadow:0 7px 18px rgba(0,0,0,.13)!important;color:#f7fbfd!important;font-size:10px!important;line-height:1.3!important;overflow:hidden!important}
      .hero #uvGuidance.uvGuidance[hidden]{display:none!important}
      .hero #uvGuidance.uvGuidance details{margin:0!important;padding:0!important}
      .hero #uvGuidance.uvGuidance summary{display:block!important;position:relative!important;padding:9px 31px 9px 11px!important;cursor:pointer!important;font-size:10px!important;line-height:1.2!important;font-weight:650!important;color:#fff!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;list-style:none!important}
      .hero #uvGuidance.uvGuidance summary::-webkit-details-marker{display:none!important}
      .hero #uvGuidance.uvGuidance summary:after{content:'›';position:absolute;right:12px;top:50%;transform:translateY(-50%) rotate(90deg);font-size:15px;color:#e8f2f6;transition:transform .15s ease}
      .hero #uvGuidance.uvGuidance details[open] summary:after{transform:translateY(-50%) rotate(-90deg)}
      .hero #uvGuidance.uvGuidance details>div{padding:0 11px 10px!important;border-top:1px solid rgba(255,255,255,.08)!important;padding-top:9px!important;font-size:9.5px!important;line-height:1.4!important;font-weight:400!important;color:#d8e7ee!important;overflow-wrap:anywhere!important}
      .hero.uvGuidanceActive{height:auto!important;min-height:440px!important;padding-bottom:18px!important}
      .hero.uvGuidanceActive .metrics{position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;width:100%!important;margin:11px 0 0!important;box-sizing:border-box!important}
      @media(max-width:620px){
        .hero{min-height:430px!important}
        .heroTop{min-height:76px!important;padding-right:142px!important}
        .heroTop>.confidenceOrb{top:-3px!important;right:0!important;height:29px!important;padding:0 9px!important}
        .heroTop>.confidenceOrb .wxConfidenceStable b{font-size:10.5px!important}
        .heroTop>.confidenceOrb .wxConfidenceStable span{font-size:8px!important}
        #heroIcon{right:8px!important;top:82px!important;font-size:51px!important}
        #daySummary.heroSummary[data-source="engine3-summary"]{width:100%!important;max-width:100%!important;margin:9px 0 0!important;padding:10px 11px!important;font-size:10.5px!important;line-height:1.42!important}
        .hero #uvGuidance.uvGuidance{margin-top:8px!important}
        .hero #uvGuidance.uvGuidance summary{padding:8px 30px 8px 10px!important;font-size:9.5px!important}
        .hero #uvGuidance.uvGuidance details>div{padding:8px 10px 9px!important;font-size:9.25px!important;line-height:1.38!important}
        .hero.uvGuidanceActive{min-height:430px!important}.hero.uvGuidanceActive .metrics{margin-top:10px!important}
      }
      @media(max-width:340px){
        .heroTop{padding-right:130px!important}.heroTop>.confidenceOrb{padding:0 8px!important}.heroTop>.confidenceOrb .wxConfidenceStable span{font-size:7.5px!important}
        .hero #uvGuidance.uvGuidance summary{font-size:9px!important}.hero #uvGuidance.uvGuidance details>div{font-size:9px!important;line-height:1.36!important}
      }
    `;document.head.appendChild(st)
  }
  window.WXRefreshForecastInsights=paint;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(paint,300),{once:true});else setTimeout(paint,300);
  window.addEventListener('wx-v3-ready',()=>setTimeout(paint,60));document.querySelector('#tabs')?.addEventListener('click',()=>setTimeout(paint,120));
  const summaryEl=document.querySelector('#daySummary');if(summaryEl)new MutationObserver(()=>{if(!painting&&summaryEl.dataset.source==='engine3-summary')queueMicrotask(paint)}).observe(summaryEl,{childList:true,subtree:true,characterData:true});
  setInterval(paint,30000);
})();
