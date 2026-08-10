/* Upper West Side / Manhattan browser adapter.
   Keeps the existing Canadian UI paths intact and swaps only the selected U.S.
   location to New York local time, NWS observations/alerts and HRRR guidance. */
(()=>{
  if(typeof L==='undefined'||typeof M==='undefined')return;
  L.uws={n:'Upper West Side',k:'UPPER WEST SIDE NY',s:'Upper West Side · Manhattan',tz:'America/New_York',country:'US',
    core:[['UWS South',40.7745,-73.9840],['UWS Central',40.7870,-73.9754],['UWS North',40.7950,-73.9705]],micro:[],bbox:[-74.03,40.73,-73.93,40.83]};
  if(!M.some(m=>m[0]==='ncep_hrrr_conus'))M.push(['ncep_hrrr_conus','HRRR','NOAA',1.14]);
  try{if(sessionStorage.getItem('wx-pending-loc')==='uws'){loc='uws';localStorage.setItem('wx-loc','uws');sessionStorage.removeItem('wx-pending-loc')}}catch{}
  const tz=()=>L[loc]?.tz||'America/Halifax';
  const localHourKey=(d=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:tz(),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false}).format(d).replace(' ','T').slice(0,13);
  const hourLabel=t=>{const h=Number(String(t||'').slice(11,13)),m=String(t||'').slice(14,16)||'00';if(!Number.isFinite(h))return'--';const ap=h>=12?'p.m.':'a.m.',hh=h%12||12;return m==='00'?`${hh} ${ap}`:`${hh}:${m} ${ap}`};
  const newYorkDaypart=(d=new Date())=>{const h=+new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',hour:'2-digit',hour12:false}).format(d);if(h>=5&&h<8)return'dawn';if(h>=8&&h<18)return'day';if(h>=18&&h<21)return'dusk';return'night'};
  function syncUwsChrome(){if(loc!=='uws')return;const brand=document.querySelector('.brand h1'),hero=document.querySelector('.hero');if(brand&&brand.textContent!=='Upper West Side, NY')brand.textContent='Upper West Side, NY';const kicker=document.querySelector('#kicker');if(kicker&&kicker.textContent!=='UPPER WEST SIDE NY')kicker.textContent='UPPER WEST SIDE NY';if(hero){if(hero.dataset.location!=='Upper West Side')hero.dataset.location='Upper West Side';const part=newYorkDaypart();if(hero.dataset.daypart!==part)hero.dataset.daypart=part}}
  idx=function(d){const n=localHourKey(),i=d?.hourly?.time?.findIndex(t=>t.slice(0,13)>=n)??-1;return i<0?0:i};
  hourName=function(t){return hourLabel(t)};
  clock=function(t){return hourLabel(t)};
  dayName=function(d){try{return new Intl.DateTimeFormat('en-CA',{weekday:'short',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'))}catch{return d}};

  baseQ=async function(z){
    const p=new URLSearchParams({latitude:z[1],longitude:z[2],timezone:tz(),forecast_days:7,temperature_unit:'celsius',wind_speed_unit:'kmh',
      current:'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code',
      hourly:'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index',
      daily:'temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max,precipitation_sum,weather_code,sunrise,sunset,uv_index_max'});
    const r=await fetch('https://api.open-meteo.com/v1/forecast?'+p,{cache:'no-store'});if(!r.ok)throw Error(r.status);return{z,d:await r.json()};
  };
  modelQ=async function(z,m){
    if(m[0]==='ncep_hrrr_conus'&&loc!=='uws')throw Error('not-applicable');
    const p=new URLSearchParams({latitude:z[1],longitude:z[2],timezone:tz(),forecast_days:7,temperature_unit:'celsius',current:'temperature_2m',hourly:'temperature_2m,precipitation',daily:'temperature_2m_max,temperature_2m_min',models:m[0]});
    const c=new AbortController(),tm=setTimeout(()=>c.abort(),15000);try{const r=await fetch('https://api.open-meteo.com/v1/forecast?'+p,{signal:c.signal,cache:'no-store'});if(!r.ok)throw Error(r.status);const d=await r.json();if(!d.hourly)throw Error('incomplete');return{z,m,d}}finally{clearTimeout(tm)};
  };

  const priorObs=ecccObservation,priorAlerts=ecccAlerts,priorRegime=regimeFactor,priorBacktest=runHistoricalBacktest;
  const qv=(q,wind=false,precip=false)=>{if(!q||!Number.isFinite(Number(q.value)))return null;let v=Number(q.value),u=String(q.unitCode||'').toLowerCase();if(wind&&u.includes('m_s-1'))v*=3.6;if(precip&&(u.endsWith(':m')||u.includes('unit:m')))v*=1000;return v};
  async function nwsLatest(station){try{const r=await fetch(`https://api.weather.gov/stations/${station}/observations/latest`,{cache:'no-store',headers:{Accept:'application/geo+json'}});if(!r.ok)throw Error(r.status);const j=await r.json(),p=j.properties||{};return{station,temp:qv(p.temperature),rh:qv(p.relativeHumidity),wind:qv(p.windSpeed,true),gust:qv(p.windGust,true),precip:qv(p.precipitationLastHour,false,true),time:p.timestamp}}catch{return null}};
  ecccObservation=async function(){
    if(loc!=='uws')return priorObs();
    const rows=(await Promise.all(['KNYC','KJRB','KLGA'].map(nwsLatest))).filter(x=>x&&Number.isFinite(x.temp));if(!rows.length)return null;
    const anchor=rows.find(x=>x.station==='KNYC')||rows[0],vals=rows.map((x,i)=>({v:x.temp,w:x.station==='KNYC'?1.6:1/(1+i*.4)})),den=vals.reduce((a,x)=>a+x.w,0),temp=vals.reduce((a,x)=>a+x.v*x.w,0)/den;
    return{temp,hour:new Date(anchor.time||Date.now()).getHours(),station:rows.map(x=>x.station).join(' · '),count:rows.length,provider:'NWS',officialStation:'KNYC'};
  };
  ecccAlerts=async function(){
    if(loc!=='uws')return priorAlerts();
    try{const z=L.uws.core[1],r=await fetch(`https://api.weather.gov/alerts/active?point=${z[1]},${z[2]}`,{cache:'no-store',headers:{Accept:'application/geo+json'}});if(!r.ok)throw Error(r.status);const j=await r.json();return(j.features||[]).map(f=>{const p=f.properties||{};return{alert_name_en:p.event||p.headline||'NWS alert',alert_short_name_en:p.event||'NWS alert',feature_name_en:p.areaDesc||'',description:p.description||'',instruction:p.instruction||''}})}catch{return[]}
  };
  regimeFactor=function(id,lead,windDir){let f=priorRegime(id,lead,windDir);if(loc==='uws'&&id==='ncep_hrrr_conus'&&lead<=12)f*=1.12;return f};
  if(typeof wxPart==='function')wxPart=function(d=new Date()){const h=+new Intl.DateTimeFormat('en-CA',{timeZone:tz(),hour:'2-digit',hour12:false}).format(d);return h<6?'night':h<12?'morning':h<18?'afternoon':'evening'};
  runHistoricalBacktest=async function(days=90){if(loc!=='uws')return priorBacktest(days);const out=document.getElementById('backtestStatus');if(out)out.textContent='Upper West Side learns prospectively from NWS/KNYC outcomes; no Canadian ECCC archive is substituted for New York.';const btn=document.getElementById('backtestBtn');if(btn){btn.disabled=false;btn.textContent='Prospective learning active'}};

  const priorRender=render;
  render=function(base,mods,official,alertData,loading){priorRender(base,mods,official,alertData,loading);if(loc!=='uws')return;
    const zoneTitle=document.getElementById('zoneTitle'),micro=document.getElementById('microSection'),officialHead=[...document.querySelectorAll('.section')].find(s=>s.querySelector('h2')?.textContent==='Official data');
    if(zoneTitle)zoneTitle.textContent='Across the Upper West Side';if(micro)micro.style.display='none';
    const station=document.getElementById('officialStation'),obsline=document.getElementById('obsline');if(station&&official)station.textContent=`NWS Central Park KNYC · ${official.station}`;if(obsline&&official)obsline.textContent=`Now corrected with NWS/KNYC observation (${fmt(official.temp)}° · ${official.count} station${official.count===1?'':'s'})`;
    const hs=officialHead?.querySelector('.head span');if(hs)hs.textContent='National Weather Service';const cardSubs=officialHead?.querySelectorAll('.official .sub')||[];if(cardSubs[1]&&/ECCC/i.test(cardSubs[1].textContent))cardSubs[1].textContent=cardSubs[1].textContent.replace(/ECCC/gi,'NWS');
    const footer=[...document.querySelectorAll('.footer')].find(x=>/alerts remain authoritative/i.test(x.textContent||''));if(footer)footer.textContent='Weather Consensus · locally calibrated experimental forecast. NWS alerts remain authoritative for hazardous weather in New York.';
    const upd=document.getElementById('updated');if(upd&&lastUpdated)upd.textContent=`Updated ${new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:tz()}).format(lastUpdated)} · Upper West Side, Manhattan.`;syncUwsChrome();
  };
  if(typeof wxHealth==='function'){
    const oldHealth=wxHealth;wxHealth=function(){oldHealth();if(loc!=='uws')return;const el=document.getElementById('health');if(el)el.innerHTML=el.innerHTML.replace(/ECCC observation/gi,'NWS observation')};
  }
  const brand=document.querySelector('.brand h1'),hero=document.querySelector('.hero');
  if(brand)new MutationObserver(syncUwsChrome).observe(brand,{childList:true,subtree:true,characterData:true});
  if(hero)new MutationObserver(()=>{if(loc==='uws')queueMicrotask(syncUwsChrome)}).observe(hero,{attributes:true,attributeFilter:['data-location','data-daypart']});
  window.WX_LOCATION_TIMEZONE=tz;
  nav();syncUwsChrome();
  if(loc==='uws')load().catch(e=>console.warn('UWS reload failed',e));
  setInterval(syncUwsChrome,2000);
})();
