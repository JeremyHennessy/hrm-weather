/* Plain-English forecast summary, meaningful-change notice, and time-aware
   sun protection guidance. Current wording is owned by live-current truth;
   near-term wording is derived from the same captured hourly response rendered
   by the forecast cards. Never substitute an Engine forecast lead for current. */
(()=>{
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const loc=()=>{try{return localStorage.getItem('wx-loc')||'hrm'}catch{return'hrm'}};
  const engine=()=>window.WXAccuracyV3||(()=>{try{return JSON.parse(localStorage.getItem('wx-engine-v3-startup')||'null')?.engine||null}catch{return null}})();
  const hours=()=>engine()?.consensus?.[loc()]?.hours||{};
  const row=l=>hours()[String(l)]||{};
  const n=v=>finite(v)?Number(v):null;
  const time=(s,tz)=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:tz||undefined,hour:'numeric',minute:'2-digit'}).format(new Date(s))}catch{return''}};
  const localHour=(tz,d=new Date())=>{try{return Number(new Intl.DateTimeFormat('en-CA',{timeZone:tz||undefined,hour:'2-digit',hour12:false}).format(d))}catch{return d.getHours()}};
  const localHourKey=(tz,d=new Date())=>{try{return new Intl.DateTimeFormat('sv-SE',{timeZone:tz||undefined,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false}).format(d).replace(' ','T').slice(0,13)}catch{return''}};
  const mean=xs=>{const v=xs.filter(finite).map(Number);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
  let painting=false,uvObserved=false,orderObserved=false;

  function currentTruth(){
    const key=loc(),f=window.__wxFastCurrent;
    if(f?.painted&&f.location===key&&finite(f.feel)&&finite(f.air))return{rf:Number(f.feel),air:Number(f.air),source:f.source||'live-current'};
    const rfEl=document.querySelector('#feels'),airEl=document.querySelector('#actual');
    const rfOwner=rfEl?.dataset?.currentSource||document.documentElement.dataset.wxRealFeel||'',airOwner=airEl?.dataset?.owner||'';
    if(!/current/i.test(rfOwner)||!/current/i.test(airOwner))return null;
    const rf=Number(String(rfEl?.textContent||'').replace(/[^0-9+\-.]/g,'')),m=String(airEl?.textContent||'').match(/-?\d+(?:\.\d+)?/),air=m?Number(m[0]):NaN;
    return Number.isFinite(rf)&&Number.isFinite(air)?{rf,air,source:'live-current-dom'}:null;
  }

  function hourlyOutlook(){
    const key=loc(),bucket=window.__wxDailyDetailRaw?.[key],points=Object.values(bucket?.points||{});if(!points.length)return null;
    const tz=bucket.timezone||points[0]?.data?.timezone||(key==='uws'?'America/New_York':'America/Halifax'),nowKey=localHourKey(tz);if(!nowKey)return null;
    const times=[...new Set(points.flatMap(p=>Array.isArray(p?.data?.hourly?.time)?p.data.hourly.time:[]))].filter(t=>String(t).slice(0,13)>=nowKey).sort().slice(0,12);if(!times.length)return null;
    const rows=times.map(target=>{
      const vals=points.map(p=>{const h=p?.data?.hourly,i=h?.time?.indexOf(target)??-1;if(i<0)return null;return{rf:h.apparent_temperature?.[i],air:h.temperature_2m?.[i],pop:h.precipitation_probability?.[i],rain:h.precipitation?.[i],wind:h.wind_speed_10m?.[i],gust:h.wind_gusts_10m?.[i]}}).filter(Boolean);
      return{target,rf:mean(vals.map(x=>x.rf)),air:mean(vals.map(x=>x.air)),pop:mean(vals.map(x=>x.pop)),rain:mean(vals.map(x=>x.rain)),wind:mean(vals.map(x=>x.wind)),gust:mean(vals.map(x=>x.gust))};
    });
    return{tz,rows};
  }

  function targetLabel(localTarget,tz){
    if(!localTarget)return'';
    try{
      const [d,t]=String(localTarget).split('T'),[y,m,day]=d.split('-').map(Number),[hh,mm]=t.split(':').map(Number);
      const pseudo=new Date(Date.UTC(y,m-1,day,hh,mm||0));
      return new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',hour:'numeric',minute:'2-digit'}).format(pseudo);
    }catch{return time(localTarget,tz)}
  }

  function periodWord(tz){const h=localHour(tz);return h>=21||h<5?'overnight':h<12?'this morning':h<17?'this afternoon':'this evening'};

  function temperatureSentence(cur,out){
    if(!cur)return'';
    const delta=cur.rf-cur.air,rf=Math.round(cur.rf),air=Math.round(cur.air);
    let now=Math.abs(delta)<1.5?`Right now, Real Feel is ${rf}°C, close to Actual ${air}°C.`:delta>0?`Right now, Real Feel is ${rf}°C versus Actual ${air}°C.`:`Right now, Real Feel is ${rf}°C, cooler than Actual ${air}°C.`;
    if(!out?.rows?.length)return now;
    const future=out.rows[Math.min(5,out.rows.length-1)],end=out.rows[out.rows.length-1],f=n(future?.rf),e=n(end?.rf);if(!finite(f))return now;
    const diff=f-cur.rf,label=targetLabel(future.target,out.tz);
    if(Math.abs(diff)<1.2)now+=` It stays fairly steady${label?` through ${label}`:''}.`;
    else if(diff<=-3)now+=` It turns noticeably cooler${label?` by ${label}`:''}, near ${Math.round(f)}°C.`;
    else if(diff<0)now+=` It gradually eases${label?` toward ${Math.round(f)}°C by ${label}`:` toward ${Math.round(f)}°C`}.`;
    else if(diff>=3)now+=` It warms noticeably${label?` by ${label}`:''}, toward ${Math.round(f)}°C.`;
    else now+=` It edges warmer${label?` toward ${Math.round(f)}°C by ${label}`:` toward ${Math.round(f)}°C`}.`;
    if(finite(e)&&Math.abs(e-f)>=2.5)now+=` By the end of the 12-hour period, Real Feel is near ${Math.round(e)}°C.`;
    return now;
  }

  function rainSentence(out){
    const rows=out?.rows||[],valid=rows.filter(x=>finite(x.pop));if(!valid.length)return'';
    const peak=valid.reduce((a,b)=>Number(b.pop)>Number(a.pop)?b:a,valid[0]),maxPop=Math.round(Number(peak.pop)),label=targetLabel(peak.target,out.tz),period=periodWord(out.tz);
    const amount=rows.filter(x=>finite(x.rain)).reduce((s,x)=>s+Math.max(0,Number(x.rain)),0),amountText=amount>=1?` About ${amount<10?amount.toFixed(1):Math.round(amount)} mm is indicated across the period.`:'';
    if(maxPop>=70)return`Rain is likely ${period}, with the highest chance around ${maxPop}%${label?` near ${label}`:''}.${amountText}`;
    if(maxPop>=40)return`There is a meaningful shower chance ${period}, peaking around ${maxPop}%${label?` near ${label}`:''}.${amountText}`;
    if(maxPop>=20)return`A small shower chance peaks around ${maxPop}%${label?` near ${label}`:''}, but much of the next 12 hours looks dry.${amountText}`;
    return`Rain risk stays low through the next 12 hours${maxPop>0?`, peaking near ${maxPop}%`:''}.`;
  }

  function windSentence(out){
    const rows=out?.rows||[],winds=rows.map(x=>finite(x.gust)?Number(x.gust):finite(x.wind)?Number(x.wind):null).filter(finite);if(!winds.length)return'';
    const peak=Math.max(...winds);if(peak>=60)return` Strong gusts near ${Math.round(peak)} km/h are also possible.`;if(peak>=40)return` Gusts may reach around ${Math.round(peak)} km/h.`;return'';
  }

  function summary(){
    const cur=currentTruth(),out=hourlyOutlook();if(!cur&&!out)return null;
    const temp=temperatureSentence(cur,out),rain=rainSentence(out),wind=windSentence(out);
    return`${temp} ${rain}${wind}`.replace(/\s+/g,' ').trim()||null;
  }

  function uvSeries(){return Object.entries(hours()).map(([lead,h])=>({lead:Number(lead),uv:n(h.real_feel_engine?.inputs?.uv_index),target:h.target})).filter(x=>finite(x.uv)).sort((a,b)=>a.lead-b.lead)}
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
    const cur={rev:e.updated_at,target:h1.target,temp:n(h1.temperature_2m),rf:n(h1.real_feel),pop:n(h1.precipitation_probability),conf:n(h1.forecast_confidence?.value)};const changes=[];
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
  function placeConfidence(){const top=document.querySelector('.heroTop'),orb=document.querySelector('.confidenceOrb');if(top&&orb&&orb.parentElement!==top)top.appendChild(orb)}
  function placeHourly(){const hero=document.querySelector('.hero');if(!hero)return;const hourly=[...document.querySelectorAll('.section')].find(s=>s.querySelector('h2')?.textContent.trim()==='Next 12 hours');if(hourly&&hero.nextElementSibling!==hourly)hero.insertAdjacentElement('afterend',hourly)}
  function observeOrder(){if(orderObserved)return;const app=document.querySelector('.app');if(!app)return;orderObserved=true;new MutationObserver(()=>queueMicrotask(placeHourly)).observe(app,{childList:true})}
  function paint(){if(painting)return;painting=true;try{placeConfidence();placeHourly();observeOrder();const s=summary(),target=document.querySelector('#daySummary');if(s&&target){if(target.textContent!==s)target.textContent=s;target.dataset.source='live-current-hourly-summary'}paintUV();changeNotice()}finally{painting=false}}
  if(!document.querySelector('#forecastInsightsStyle')){
    const st=document.createElement('style');st.id='forecastInsightsStyle';st.textContent=`
      .forecastChangeNotice{margin:0 0 10px;padding:9px 11px;border:1px solid rgba(138,188,216,.28);border-radius:12px;background:rgba(8,37,55,.5);font-size:10px;color:#dcecf4}
      .hero{min-height:440px!important}
      .heroTop{position:relative!important;min-height:78px!important;padding-right:148px!important;box-sizing:border-box!important}
      .heroTop .place{max-width:calc(100% - 4px)!important;line-height:1.25!important}
      .heroTop>.confidenceOrb{position:absolute!important;top:-3px!important;right:0!important;bottom:auto!important;width:auto!important;height:30px!important;min-width:0!important;min-height:0!important;padding:0 10px!important;z-index:7!important;display:flex!important;flex-direction:row!important;border-radius:999px!important;border:1px solid rgba(147,231,174,.38)!important;background:rgba(3,43,58,.68)!important;box-shadow:0 7px 18px rgba(0,0,0,.14)!important;backdrop-filter:blur(14px)!important;-webkit-backdrop-filter:blur(14px)!important;color:#edf9f2!important}
      .heroTop>.confidenceOrb:before{display:none!important}.heroTop>.confidenceOrb .wxConfidenceStable{font-size:9px!important;line-height:1!important}.heroTop>.confidenceOrb .wxConfidenceStable b{font-size:11px!important;color:#fff!important}.heroTop>.confidenceOrb .wxConfidenceStable span{font-size:8.5px!important;color:#c9e6d3!important}.heroTop>.confidenceOrb .wxConfidenceStable small{display:none!important}
      #heroIcon{position:absolute!important;right:8px!important;top:84px!important;margin:0!important;font-size:54px!important;z-index:3!important}
      #daySummary.heroSummary[data-source="live-current-hourly-summary"]{display:block!important;width:100%!important;max-width:100%!important;margin:10px 0 0!important;padding:10px 12px!important;box-sizing:border-box!important;border:1px solid rgba(255,255,255,.13)!important;border-radius:14px!important;background:rgba(3,28,47,.46)!important;backdrop-filter:blur(12px)!important;-webkit-backdrop-filter:blur(12px)!important;color:#eef7fb!important;font-size:11px!important;line-height:1.45!important;letter-spacing:.005em!important;text-indent:0!important;overflow:visible!important;overflow-wrap:break-word!important;-webkit-line-clamp:unset!important}
      .hero #uvGuidance.uvGuidance{position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;z-index:4!important;margin:9px 0 0!important;padding:0!important;border:1px solid rgba(255,232,143,.26)!important;border-radius:12px!important;background:rgba(19,35,46,.70)!important;backdrop-filter:blur(14px)!important;-webkit-backdrop-filter:blur(14px)!important;box-shadow:0 7px 18px rgba(0,0,0,.13)!important;color:#f7fbfd!important;font-size:10px!important;line-height:1.3!important;overflow:hidden!important}
      .hero #uvGuidance.uvGuidance[hidden]{display:none!important}.hero #uvGuidance.uvGuidance details{margin:0!important;padding:0!important}.hero #uvGuidance.uvGuidance summary{display:block!important;position:relative!important;padding:9px 31px 9px 11px!important;cursor:pointer!important;font-size:10px!important;line-height:1.2!important;font-weight:650!important;color:#fff!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;list-style:none!important}.hero #uvGuidance.uvGuidance summary::-webkit-details-marker{display:none!important}.hero #uvGuidance.uvGuidance summary:after{content:'›';position:absolute;right:12px;top:50%;transform:translateY(-50%) rotate(90deg);font-size:15px;color:#e8f2f6;transition:transform .15s ease}.hero #uvGuidance.uvGuidance details[open] summary:after{transform:translateY(-50%) rotate(-90deg)}.hero #uvGuidance.uvGuidance details>div{padding:0 11px 10px!important;border-top:1px solid rgba(255,255,255,.08)!important;padding-top:9px!important;font-size:9.5px!important;line-height:1.4!important;font-weight:400!important;color:#d8e7ee!important;overflow-wrap:anywhere!important}
      .hero.uvGuidanceActive{height:auto!important;min-height:440px!important;padding-bottom:18px!important}.hero.uvGuidanceActive .metrics{position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;width:100%!important;margin:11px 0 0!important;box-sizing:border-box!important}
      @media(max-width:620px){.hero{min-height:430px!important}.heroTop{min-height:76px!important;padding-right:142px!important}.heroTop>.confidenceOrb{top:-3px!important;right:0!important;height:29px!important;padding:0 9px!important}.heroTop>.confidenceOrb .wxConfidenceStable b{font-size:10.5px!important}.heroTop>.confidenceOrb .wxConfidenceStable span{font-size:8px!important}#heroIcon{right:8px!important;top:82px!important;font-size:51px!important}#daySummary.heroSummary[data-source="live-current-hourly-summary"]{width:100%!important;max-width:100%!important;margin:9px 0 0!important;padding:10px 11px!important;font-size:10.5px!important;line-height:1.42!important}.hero #uvGuidance.uvGuidance{margin-top:8px!important}.hero #uvGuidance.uvGuidance summary{padding:8px 30px 8px 10px!important;font-size:9.5px!important}.hero #uvGuidance.uvGuidance details>div{padding:8px 10px 9px!important;font-size:9.25px!important;line-height:1.38!important}.hero.uvGuidanceActive{min-height:430px!important}.hero.uvGuidanceActive .metrics{margin-top:10px!important}}
      @media(max-width:340px){.heroTop{padding-right:130px!important}.heroTop>.confidenceOrb{padding:0 8px!important}.heroTop>.confidenceOrb .wxConfidenceStable span{font-size:7.5px!important}.hero #uvGuidance.uvGuidance summary{font-size:9px!important}.hero #uvGuidance.uvGuidance details>div{font-size:9px!important;line-height:1.36!important}}
    `;document.head.appendChild(st)
  }
  window.WXRefreshForecastInsights=paint;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(paint,300),{once:true});else setTimeout(paint,300);
  window.addEventListener('wx-v3-ready',()=>setTimeout(paint,60));window.addEventListener('wx-fast-current-ready',()=>setTimeout(paint,30));window.addEventListener('wx-daily-detail-data',()=>setTimeout(paint,30));document.querySelector('#tabs')?.addEventListener('click',()=>setTimeout(paint,120));
  const summaryEl=document.querySelector('#daySummary');if(summaryEl)new MutationObserver(()=>{if(!painting&&summaryEl.dataset.source==='live-current-hourly-summary')queueMicrotask(paint)}).observe(summaryEl,{childList:true,subtree:true,characterData:true});
  setInterval(paint,30000);
})();
