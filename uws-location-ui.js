/* Upper West Side / Manhattan browser adapter.
   Canadian UI/source behavior remains unchanged. UWS uses New York local time,
   NWS official observations/alerts, and a resilient current Real Feel path:
   provider apparent temperature when available, then bounded live NWS current,
   then the fresh hourly-stored NWS mesh. All fallbacks use the same deterministic
   Steadman/wind-chill policy as the server engine. Server model id
   ncep_hrrr_conus (HRRR) remains UWS-only and is never added to the
   Canadian/client independent-model denominator. */
(()=>{
  if(typeof L==='undefined'||typeof M==='undefined')return;

  L.uws={
    n:'Upper West Side',k:'UPPER WEST SIDE NY',s:'Upper West Side · Manhattan',
    tz:'America/New_York',country:'US',
    core:[['UWS South',40.7745,-73.9840],['UWS Central',40.7870,-73.9754],['UWS North',40.7950,-73.9705]],
    micro:[],bbox:[-74.03,40.73,-73.93,40.83]
  };
  try{
    if(sessionStorage.getItem('wx-pending-loc')==='uws'){
      loc='uws';localStorage.setItem('wx-loc','uws');sessionStorage.removeItem('wx-pending-loc');
    }
  }catch{}

  const tz=()=>L[loc]?.tz||'America/Halifax';
  const localHourKey=(d=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:tz(),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false}).format(d).replace(' ','T').slice(0,13);
  const hourLabel=t=>{const h=Number(String(t||'').slice(11,13)),m=String(t||'').slice(14,16)||'00';if(!Number.isFinite(h))return'--';const ap=h>=12?'p.m.':'a.m.',hh=h%12||12;return m==='00'?`${hh} ${ap}`:`${hh}:${m} ${ap}`};
  const newYorkDaypart=(d=new Date())=>{const h=+new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',hour:'2-digit',hour12:false}).format(d);if(h>=5&&h<8)return'dawn';if(h>=8&&h<18)return'day';if(h>=18&&h<21)return'dusk';return'night'};
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const diag=(status,extra={})=>window.__wxUwsQuick={status,at:Date.now(),loc,stored:localStorage.getItem('wx-loc'),fast:window.__wxFastCurrent||null,...extra};
  const officialSection=()=>[...document.querySelectorAll('.section')].find(s=>s.querySelector('h2')?.textContent==='Official data');

  function syncUwsChrome(){
    if(loc!=='uws')return;
    const brand=document.querySelector('.brand h1'),hero=document.querySelector('.hero'),place=document.querySelector('#place'),kicker=document.querySelector('#kicker'),zoneTitle=document.querySelector('#zoneTitle'),micro=document.querySelector('#microSection'),official=officialSection(),officialHead=official?.querySelector('.head span'),station=document.querySelector('#officialStation');
    if(brand&&brand.textContent!=='Upper West Side, NY')brand.textContent='Upper West Side, NY';
    if(place&&place.textContent!=='Upper West Side · Manhattan')place.textContent='Upper West Side · Manhattan';
    if(kicker&&kicker.textContent!=='UPPER WEST SIDE NY')kicker.textContent='UPPER WEST SIDE NY';
    if(zoneTitle&&zoneTitle.textContent!=='Across the Upper West Side')zoneTitle.textContent='Across the Upper West Side';
    if(micro)micro.style.display='none';
    if(officialHead&&officialHead.textContent!=='National Weather Service')officialHead.textContent='National Weather Service';
    if(station&&/ECCC|SWOB|checking official|official observation updating/i.test(station.textContent||''))station.textContent='NWS Central Park KNYC · official observation loading…';
    if(hero){if(hero.dataset.location!=='Upper West Side')hero.dataset.location='Upper West Side';const part=newYorkDaypart();if(hero.dataset.daypart!==part)hero.dataset.daypart=part}
  }

  idx=function(d){const n=localHourKey(),i=d?.hourly?.time?.findIndex(t=>t.slice(0,13)>=n)??-1;return i<0?0:i};
  hourName=function(t){return hourLabel(t)};
  clock=function(t){return hourLabel(t)};
  dayName=function(d){try{return new Intl.DateTimeFormat('en-CA',{weekday:'short',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'))}catch{return d}};

  baseQ=async function(z){
    const p=new URLSearchParams({latitude:z[1],longitude:z[2],timezone:tz(),forecast_days:7,temperature_unit:'celsius',wind_speed_unit:'kmh',current:'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code',hourly:'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index',daily:'temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max,precipitation_sum,weather_code,sunrise,sunset,uv_index_max'});
    const r=await fetch('https://api.open-meteo.com/v1/forecast?'+p,{cache:'no-store'});if(!r.ok)throw Error(r.status);return{z,d:await r.json()};
  };
  modelQ=async function(z,m){
    const p=new URLSearchParams({latitude:z[1],longitude:z[2],timezone:tz(),forecast_days:7,temperature_unit:'celsius',current:'temperature_2m',hourly:'temperature_2m,precipitation',daily:'temperature_2m_max,temperature_2m_min',models:m[0]});
    const c=new AbortController(),tm=setTimeout(()=>c.abort(),15000);try{const r=await fetch('https://api.open-meteo.com/v1/forecast?'+p,{signal:c.signal,cache:'no-store'});if(!r.ok)throw Error(r.status);const d=await r.json();if(!d.hourly)throw Error('incomplete');return{z,m,d}}finally{clearTimeout(tm)}
  };

  const qv=(q,wind=false,precip=false)=>{if(!q||!finite(q.value))return null;let v=Number(q.value),u=String(q.unitCode||'').toLowerCase();if(wind&&(u.includes('m_s-1')||u.includes('m/s')))v*=3.6;if(precip&&(u.endsWith(':m')||u.includes('unit:m')))v*=1000;return v};
  const vapour=(t,rh)=>rh/100*6.105*Math.exp(17.27*t/(237.7+t));
  function deterministicApparent(row){
    if(finite(row.heatIndex))return Number(row.heatIndex);
    if(finite(row.windChill))return Number(row.windChill);
    const t=finite(row.temp)?Number(row.temp):null,rh=finite(row.rh)?Number(row.rh):null,wind=finite(row.wind)?Number(row.wind):null;
    if(t===null)return null;
    if(t<=10&&wind!==null&&wind>=4.8)return 13.12+0.6215*t-11.37*Math.pow(wind,.16)+0.3965*t*Math.pow(wind,.16);
    if(t<=10)return t;
    if(rh===null||wind===null)return t;
    return t+0.33*vapour(t,rh)-0.70*(wind/3.6)-4.0;
  }

  let nwsCache={at:0,rows:[]},nwsPending=null,storedCache={at:0,rows:[]};
  async function nwsLatest(station){
    const ctrl=new AbortController(),tm=setTimeout(()=>ctrl.abort(),3500);
    try{
      const r=await fetch(`https://api.weather.gov/stations/${station}/observations/latest`,{cache:'no-store',signal:ctrl.signal,headers:{Accept:'application/geo+json'}});if(!r.ok)throw Error(r.status);
      const j=await r.json(),p=j.properties||{};
      const row={station,temp:qv(p.temperature),rh:qv(p.relativeHumidity),wind:qv(p.windSpeed,true),gust:qv(p.windGust,true),precip:qv(p.precipitationLastHour,false,true),heatIndex:qv(p.heatIndex),windChill:qv(p.windChill),time:p.timestamp,stored:false};
      row.feel=deterministicApparent(row);return row;
    }catch{return null}finally{clearTimeout(tm)}
  }
  async function nwsRows(){
    if(Date.now()-nwsCache.at<120000&&nwsCache.rows.length)return nwsCache.rows;
    if(nwsPending)return nwsPending;
    nwsPending=Promise.all(['KNYC','KJRB','KLGA'].map(nwsLatest)).then(rows=>rows.filter(x=>x&&finite(x.temp)&&finite(x.feel))).then(rows=>{if(rows.length)nwsCache={at:Date.now(),rows};return rows}).finally(()=>{nwsPending=null});
    return nwsPending;
  }
  async function storedNwsRows(){
    if(Date.now()-storedCache.at<120000&&storedCache.rows.length)return storedCache.rows;
    const ctrl=new AbortController(),tm=setTimeout(()=>ctrl.abort(),2500);
    try{
      const r=await fetch(`./data/skill.json?uwscurrent=${Date.now()}`,{cache:'no-store',signal:ctrl.signal});if(!r.ok)throw Error(r.status);const j=await r.json(),obs=j?.observations?.uws;
      if(!obs||obs.provider!=='NWS')throw Error('stored NWS observation unavailable');const stamp=obs.time,ts=stamp?Date.parse(stamp):NaN,age=Number.isFinite(ts)?Date.now()-ts:Infinity;if(age < -30*60*1000||age>2*60*60*1000)throw Error('stored NWS observation stale');
      let rows=(obs.stations||[]).map(x=>{const row={station:x.station||'NWS',temp:x.temperature_2m,rh:x.relative_humidity_2m,wind:x.wind_speed_10m,gust:x.wind_gusts_10m,precip:x.precipitation,time:x.time||stamp,stored:true};row.feel=deterministicApparent(row);return row}).filter(x=>finite(x.temp)&&finite(x.feel));
      if(!rows.length){const v=obs.values||{},row={station:obs.official_station||'KNYC',temp:v.temperature_2m??obs.temp,rh:v.relative_humidity_2m,wind:v.wind_speed_10m,gust:v.wind_gusts_10m,precip:v.precipitation,time:stamp,stored:true};row.feel=deterministicApparent(row);if(finite(row.temp)&&finite(row.feel))rows=[row]}
      if(!rows.length)throw Error('stored NWS observation incomplete');storedCache={at:Date.now(),rows};return rows;
    }finally{clearTimeout(tm)}
  }
  function weightedNws(rows,key){
    let num=0,den=0;for(const r of rows){if(!finite(r[key]))continue;const w=r.station==='KNYC'?1.6:r.station==='KJRB'?1.05:1;num+=Number(r[key])*w;den+=w}return den?num/den:null;
  }
  function paintNwsOfficial(rows){
    if(loc!=='uws'||!rows?.length)return;
    const temp=weightedNws(rows,'temp'),t=document.querySelector('#officialTemp'),s=document.querySelector('#officialStation'),head=officialSection()?.querySelector('.head span'),stored=rows.every(r=>r.stored);
    if(t&&finite(temp)){t.textContent=`${Number(temp).toFixed(1)}°`;t.dataset.owner=stored?'stored-nws-current-fallback':'live-nws-current-fallback'}
    if(s){s.textContent=`NWS ${stored?'stored ':''}station mesh · ${rows.length} station${rows.length===1?'':'s'} · ${rows.map(x=>x.station).join(' / ')}`;s.dataset.owner=stored?'stored-nws-current-fallback':'live-nws-current-fallback'}
    if(head)head.textContent='National Weather Service';
  }
  function pointValuesFromRows(rows,truth){
    if(!rows.length)return[];paintNwsOfficial(rows);const blend={air:weightedNws(rows,'temp'),feel:weightedNws(rows,'feel')},map={"UWS South":'KJRB',"UWS Central":'KNYC',"UWS North":'KLGA'};
    return L.uws.core.map(([name])=>{const r=rows.find(x=>x.station===map[name])||rows.find(x=>x.station==='KNYC')||rows[0];return{name,air:finite(r?.temp)?Number(r.temp):blend.air,feel:finite(r?.feel)?Number(r.feel):blend.feel,station:r?.station||'NWS',truth}}).filter(x=>finite(x.air)&&finite(x.feel));
  }
  async function liveNwsPointValues(){const rows=await nwsRows();return pointValuesFromRows(rows,'nws-observation-current')}
  async function storedNwsPointValues(){const rows=await storedNwsRows();return pointValuesFromRows(rows,'nws-stored-observation-current')}
  async function preferredOfficialPointValues(){
    const live=liveNwsPointValues().then(vals=>{if(!vals.length)throw Error('live NWS unavailable');return{source:'nws-apparent-fallback-current',vals}});
    const stored=sleep(750).then(()=>storedNwsPointValues()).then(vals=>{if(!vals.length)throw Error('stored NWS unavailable');return{source:'nws-stored-observation-steadman-current',vals}});
    return Promise.any([live,stored]);
  }

  function paintCurrent(vals,source){
    if(loc!=='uws'||!vals?.length)return false;
    const fs=vals.map(x=>Number(x.feel)).filter(Number.isFinite),as=vals.map(x=>Number(x.air)).filter(Number.isFinite);if(!fs.length||!as.length)return false;
    const feel=fs.reduce((a,b)=>a+b,0)/fs.length,air=as.reduce((a,b)=>a+b,0)/as.length,f=document.querySelector('#feels'),a=document.querySelector('#actual'),zones=document.querySelector('#zones');
    const provider=source==='provider-apparent-current',stored=source==='nws-stored-observation-steadman-current';
    if(f){f.textContent=`${feel.toFixed(1)}°`;f.dataset.currentSource=provider?'provider-apparent-fast-current':stored?'nws-stored-observation-steadman-current':'nws-apparent-fallback-current';delete f.dataset.engine3RealFeel}
    if(a){a.innerHTML=`Actual <b>${air.toFixed(1)}°</b>`;a.dataset.currentSource=source}
    if(zones)zones.innerHTML=vals.map(x=>`<div class="card" data-current-truth="${provider?'provider-apparent-current':x.truth||'nws-observation-current'}"><small>${x.name}</small><div class="zt">${Number(x.feel).toFixed(1)}°</div><div class="sub" data-owner="live-current-point-truth">Actual ${Number(x.air).toFixed(1)}°${x.station?` · ${x.station}`:''}</div></div>`).join('');
    document.documentElement.dataset.wxRealFeel=provider?'live-current-provider-apparent':'live-current-nws-apparent-fallback';document.documentElement.dataset.wxCurrentActual='live-current-input';
    window.__wxFastCurrent={location:'uws',painted:true,status:'ready',source,timezone:'America/New_York',feel,air,points:vals.length,total_points:L.uws.core.length,point_values:vals};
    window.dispatchEvent(new CustomEvent('wx-fast-current-ready',{detail:window.__wxFastCurrent}));syncUwsChrome();diag('painted',{source,feel,air,points:vals.length});return true;
  }

  async function quickUwsCurrent(){
    if(loc!=='uws')return false;const selected='uws';syncUwsChrome();diag('starting');
    const provider=(async()=>{
      for(let i=0;i<12&&typeof window.WXRefreshFastCurrent!=='function';i++)await sleep(50);
      if(typeof window.WXRefreshFastCurrent!=='function')throw Error('fast-current-unavailable');
      const ok=await window.WXRefreshFastCurrent(),fast=window.__wxFastCurrent;diag('provider-returned',{ok,fast});
      if(!ok||loc!==selected||!fast?.painted||fast.location!=='uws'||fast.source!=='provider-apparent-current'||!Array.isArray(fast.point_values))throw Error(fast?.error||'provider-current-unavailable');
      return{source:'provider-apparent-current',vals:fast.point_values};
    })();
    const official=preferredOfficialPointValues();
    try{
      const first=await Promise.any([provider,official]);if(loc!==selected)return false;paintCurrent(first.vals,first.source);
      if(first.source!=='provider-apparent-current')provider.then(x=>{if(loc===selected)paintCurrent(x.vals,x.source)}).catch(()=>{});
      return true;
    }catch(e){diag('error',{error:String(e?.message||e),aggregate:Array.isArray(e?.errors)?e.errors.map(x=>String(x?.message||x)):[]});return false}
  }

  const priorObs=ecccObservation,priorAlerts=ecccAlerts,priorBacktest=runHistoricalBacktest;
  ecccObservation=async function(){
    if(loc!=='uws')return priorObs();
    let rows=[];try{rows=await Promise.any([nwsRows().then(r=>{if(!r.length)throw Error('live NWS unavailable');return r}),sleep(750).then(()=>storedNwsRows())])}catch{return null}
    if(!rows.length)return null;paintNwsOfficial(rows);const anchor=rows.find(x=>x.station==='KNYC')||rows[0],temp=weightedNws(rows,'temp');return{temp,hour:new Date(anchor.time||Date.now()).getHours(),station:rows.map(x=>x.station).join(' · '),count:rows.length,provider:'NWS',officialStation:'KNYC'};
  };
  ecccAlerts=async function(){
    if(loc!=='uws')return priorAlerts();const ctrl=new AbortController(),tm=setTimeout(()=>ctrl.abort(),4000);
    try{const z=L.uws.core[1],r=await fetch(`https://api.weather.gov/alerts/active?point=${z[1]},${z[2]}`,{cache:'no-store',signal:ctrl.signal,headers:{Accept:'application/geo+json'}});if(!r.ok)throw Error(r.status);const j=await r.json();return(j.features||[]).map(f=>{const p=f.properties||{};return{alert_name_en:p.event||p.headline||'NWS alert',alert_short_name_en:p.event||'NWS alert',feature_name_en:p.areaDesc||'',description:p.description||'',instruction:p.instruction||''}})}catch{return[]}finally{clearTimeout(tm)}
  };
  if(typeof wxPart==='function')wxPart=function(d=new Date()){const h=+new Intl.DateTimeFormat('en-CA',{timeZone:tz(),hour:'2-digit',hour12:false}).format(d);return h<6?'night':h<12?'morning':h<18?'afternoon':'evening'};
  runHistoricalBacktest=async function(days=90){if(loc!=='uws')return priorBacktest(days);const out=document.getElementById('backtestStatus');if(out)out.textContent='Upper West Side learns prospectively from NWS/KNYC outcomes; no Canadian ECCC archive is substituted for New York.';const btn=document.getElementById('backtestBtn');if(btn){btn.disabled=false;btn.textContent='Prospective learning active'}};

  const priorRender=render;
  render=function(base,mods,official,alertData,loading){
    priorRender(base,mods,official,alertData,loading);if(loc!=='uws')return;syncUwsChrome();
    const officialHead=officialSection(),station=document.getElementById('officialStation'),obsline=document.getElementById('obsline');
    if(station&&official)station.textContent=`NWS Central Park KNYC · ${official.station}`;if(obsline&&official)obsline.textContent=`Now corrected with NWS/KNYC observation (${fmt(official.temp)}° · ${official.count} station${official.count===1?'':'s'})`;
    const hs=officialHead?.querySelector('.head span');if(hs)hs.textContent='National Weather Service';const cardSubs=officialHead?.querySelectorAll('.official .sub')||[];if(cardSubs[1]&&/ECCC/i.test(cardSubs[1].textContent))cardSubs[1].textContent=cardSubs[1].textContent.replace(/ECCC/gi,'NWS');
    const footer=[...document.querySelectorAll('.footer')].find(x=>/alerts remain authoritative/i.test(x.textContent||''));if(footer)footer.textContent='Weather Consensus · locally calibrated experimental forecast. NWS alerts remain authoritative for hazardous weather in New York.';
    const upd=document.getElementById('updated');if(upd&&lastUpdated)upd.textContent=`Updated ${new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:tz()}).format(lastUpdated)} · Upper West Side, Manhattan.`;
  };
  if(typeof wxHealth==='function'){const oldHealth=wxHealth;wxHealth=function(){oldHealth();if(loc!=='uws')return;const el=document.getElementById('health');if(el)el.innerHTML=el.innerHTML.replace(/ECCC observation/gi,'NWS observation')}};

  const brand=document.querySelector('.brand h1'),hero=document.querySelector('.hero'),tabs=document.querySelector('#tabs');
  if(brand)new MutationObserver(syncUwsChrome).observe(brand,{childList:true,subtree:true,characterData:true});
  if(hero)new MutationObserver(()=>{if(loc==='uws')queueMicrotask(syncUwsChrome)}).observe(hero,{attributes:true,attributeFilter:['data-location','data-daypart']});
  if(tabs)tabs.addEventListener('click',e=>{const b=e.target.closest('.tab');if(b?.dataset?.k==='uws'||/Upper West Side/i.test(b?.textContent||''))setTimeout(quickUwsCurrent,0)});
  window.WX_LOCATION_TIMEZONE=tz;window.WXRefreshUWSCurrent=quickUwsCurrent;
  nav();syncUwsChrome();if(loc==='uws'){quickUwsCurrent();load().catch(e=>console.warn('UWS reload failed',e))}setInterval(syncUwsChrome,2000);
})();