/* Halifax cloud/sun condition owner.
   Temperature, Real Feel, precipitation and hazardous-weather types are untouched.
   Dry-sky icons use the Engine 3 family-aware cloud consensus already published
   by the hourly collector. Day/night presentation uses the sunrise/sunset values
   already present in the captured Halifax base forecast; this layer makes no
   additional weather API calls. */
(()=>{
  if(window.__wxCloudSkyInstalled)return;window.__wxCloudSkyInstalled=true;
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const dryKinds=new Set(['sun','partly','cloud']);
  const wetKindIcon={rain:'🌧️',storm:'⛈️',snow:'🌨️',fog:'🌫️'};
  const classify=c=>{c=Number(c);if(!Number.isFinite(c))return null;if(c<=18)return'sunny';if(c<=42)return'mostly-sunny';if(c<=68)return'partly-cloudy';if(c<=88)return'mostly-cloudy';return'cloudy'};
  const iconFor=c=>{const s=classify(c);return s==='sunny'?'☀️':s==='mostly-sunny'?'🌤️':s==='partly-cloudy'?'⛅️':'☁️'};
  const nightIconFor=c=>{const s=classify(c);return s==='sunny'||s==='mostly-sunny'?'🌙':s==='partly-cloudy'?'🌙☁️':'☁️'};
  const heroCondition=c=>{const s=classify(c);return s==='sunny'||s==='mostly-sunny'?'sun':s==='partly-cloudy'?'partly':'cloud'};
  const loc=()=>{try{return localStorage.getItem('wx-loc')||'hrm'}catch{return'hrm'}};
  const engine=()=>window.WXAccuracyV3||(()=>{try{return JSON.parse(localStorage.getItem('wx-engine-v3-startup')||'null')?.engine||null}catch{return null}})();

  function enginePoints(){
    const hours=engine()?.consensus?.hrm?.hours||{};
    return Object.entries(hours).map(([lead,h])=>({lead:Number(lead),cloud:finite(h?.cloud_cover)?Number(h.cloud_cover):finite(h?.cloud_consensus?.cloud_cover)?Number(h.cloud_consensus.cloud_cover):null,families:Number(h?.cloud_independent_families||h?.cloud_consensus?.independent_families||0)})).filter(x=>Number.isFinite(x.lead)&&finite(x.cloud)).sort((a,b)=>a.lead-b.lead);
  }
  function engineCloud(lead){
    const pts=enginePoints();if(!pts.length)return null;if(lead<=pts[0].lead)return pts[0].cloud;if(lead>=pts[pts.length-1].lead)return pts[pts.length-1].cloud;
    for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];if(lead<=b.lead){const f=(lead-a.lead)/(b.lead-a.lead);return a.cloud+(b.cloud-a.cloud)*f}}
    return null;
  }

  function solarSource(){
    const bucket=window.__wxDailyDetailRaw?.hrm,points=Object.values(bucket?.points||{}),point=points.find(p=>p?.data?.hourly?.time?.length&&p?.data?.daily?.time?.length&&p?.data?.daily?.sunrise?.length&&p?.data?.daily?.sunset?.length);
    if(!point?.data)return null;return{data:point.data,tz:bucket?.timezone||point.data.timezone||'America/Halifax'};
  }
  function localStamp(date=new Date(),tz='America/Halifax'){
    try{return new Intl.DateTimeFormat('sv-SE',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date).replace(' ','T')}catch{return''}
  }
  function solarForTime(localTime){
    const src=solarSource(),t=String(localTime||'');if(!src||!t)return null;const date=t.slice(0,10),i=src.data.daily.time?.indexOf(date)??-1;if(i<0)return null;
    const sunrise=src.data.daily.sunrise?.[i],sunset=src.data.daily.sunset?.[i];if(!sunrise||!sunset)return null;
    return{night:t<sunrise||t>=sunset,sunrise,sunset,time:t};
  }
  function currentSolar(){const src=solarSource();return src?solarForTime(localStamp(new Date(),src.tz)):null}
  function hourlyTimeAt(index){
    const src=solarSource(),times=src?.data?.hourly?.time;if(!times?.length)return null;const now=localStamp(new Date(),src.tz).slice(0,13);let start=times.findIndex(t=>String(t).slice(0,13)>=now);if(start<0)start=0;return times[start+index]||null;
  }
  function skyWords(cloud,night){
    const s=classify(cloud);if(!night)return s?.replace('-',' ')||'mixed';
    if(s==='sunny')return'clear night';if(s==='mostly-sunny')return'mostly clear';return s?.replace('-',' ')||'mixed';
  }

  function clearCloud(el){if(!el)return;delete el.dataset.cloudSky;delete el.dataset.cloudCover;delete el.dataset.solarPhase}
  function rawIcon(el){return `${el?.dataset?.wxRaw||''} ${el?.textContent||''}`}
  function isDryIcon(el){const raw=rawIcon(el);if(/[⛈🌧🌦🌨❄🌫]/u.test(raw))return false;return /[☀🌤⛅🌥☁🌙]/u.test(raw)||Boolean(el?.dataset?.cloudSky)}
  function setIcon(el,cloud,label,night=false){
    if(!el||!finite(cloud))return false;
    const sky=classify(cloud),rounded=Math.round(Number(cloud)),expected=night?nightIconFor(cloud):iconFor(cloud),phase=night?'night':'day',aria=`${label||'Sky'}: ${skyWords(cloud,night)}, ${rounded}% cloud`;
    const already=el.dataset.cloudSky===sky&&Number(el.dataset.cloudCover)===rounded&&el.dataset.solarPhase===phase&&(el.dataset.wxRaw===expected||el.textContent.includes(expected));
    if(!already){el.textContent=expected;el.dataset.wxRaw=expected;el.dataset.cloudSky=sky||'';el.dataset.cloudCover=rounded;el.dataset.solarPhase=phase}
    if(el.getAttribute('aria-label')!==aria)el.setAttribute('aria-label',aria);
    return true;
  }
  function normalizeShowersForSolar(el,night,label){
    if(!el)return false;const raw=rawIcon(el);if(!/[🌦]/u.test(raw)&&!(/🌙/u.test(raw)&&/🌧/u.test(raw)))return false;
    const expected=night?'🌙🌧️':'🌦️',phase=night?'night':'day';
    if(el.dataset.wxRaw!==expected||el.dataset.solarPhase!==phase){el.textContent=expected;el.dataset.wxRaw=expected;el.dataset.solarPhase=phase}
    el.setAttribute('aria-label',`${label||'Showers'} · ${night?'nighttime':'daytime'}`);return true;
  }
  function relinquishHero(heroEl,iconEl){
    const kind=heroEl?.dataset?.condition||'';clearCloud(iconEl);if(heroEl){delete heroEl.dataset.cloudSky;delete heroEl.dataset.cloudCover}
    if(wetKindIcon[kind]&&iconEl)iconEl.dataset.wxRaw=wetKindIcon[kind];
  }
  function applyDays(){
    const cards=[...document.querySelectorAll('#days .v11Day')].slice(0,7);
    cards.forEach((card,i)=>{
      const icon=card.querySelector('.v11DayWx');
      if(i>3||!isDryIcon(icon)){clearCloud(icon);delete card.dataset.cloudConsensus;return}
      const lead=i===0?6:i*24,cloud=engineCloud(lead);
      if(setIcon(icon,cloud,`Daytime sky for ${card.querySelector('.v11DayName')?.textContent?.trim()||`day ${i+1}`}`,false))card.dataset.cloudConsensus=String(Math.round(cloud));
    });
  }
  function apply(){
    if(loc()!=='hrm'){delete document.documentElement.dataset.wxCloudSky;return false}
    const hero=document.querySelector('#heroIcon'),heroEl=document.querySelector('.hero'),kind=heroEl?.dataset?.condition||'',heroSolar=currentSolar();
    if(dryKinds.has(kind)){
      const cloud=engineCloud(1);
      if(setIcon(hero,cloud,'Current sky',heroSolar?.night===true)&&heroEl){heroEl.dataset.condition=heroCondition(cloud);heroEl.dataset.cloudSky='engine3-family-cloud-consensus';heroEl.dataset.cloudCover=Math.round(Number(cloud));if(heroSolar)heroEl.dataset.solarPhase=heroSolar.night?'night':'day'}
    }else relinquishHero(heroEl,hero);

    const cards=[...document.querySelectorAll('#hours .hour')].slice(0,12);
    cards.forEach((card,j)=>{
      const icon=card.querySelector('.wx'),time=hourlyTimeAt(j),solar=solarForTime(time),night=solar?.night===true,label=`Sky at ${card.querySelector('small')?.textContent?.trim()||`+${Math.max(1,j)}h`}`;
      if(!isDryIcon(icon)){clearCloud(icon);delete card.dataset.cloudConsensus;if(solar&&normalizeShowersForSolar(icon,night,label))card.dataset.solarPhase=night?'night':'day';return}
      const lead=Math.max(1,j),cloud=engineCloud(lead);if(setIcon(icon,cloud,label,night)){card.dataset.cloudConsensus=String(Math.round(cloud));if(solar)card.dataset.solarPhase=night?'night':'day'}
    });
    applyDays();document.documentElement.dataset.wxCloudSky='halifax-family-cloud-consensus';return true;
  }
  function start(){
    apply();window.addEventListener('wx-v3-ready',()=>setTimeout(apply,80));window.addEventListener('wx-daily-detail-data',()=>setTimeout(apply,40));
    document.querySelector('#tabs')?.addEventListener('click',()=>setTimeout(apply,100));
    const hours=document.querySelector('#hours');if(hours)new MutationObserver(()=>queueMicrotask(apply)).observe(hours,{childList:true,subtree:true});
    const days=document.querySelector('#days');if(days)new MutationObserver(()=>queueMicrotask(applyDays)).observe(days,{childList:true,subtree:true});
    setInterval(apply,30000);
  }
  window.WXCloudSky={classify,iconFor,nightIconFor,engineCloud,solarForTime,hourlyTimeAt,apply,applyDays};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
