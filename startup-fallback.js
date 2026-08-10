(()=>{
  const CACHE_KEY='wx-engine-v3-startup',OFFICIAL_GRACE_MS=1200,OFFICIAL_MAX_AGE_MS=2*60*60*1000;
  // v5b's legacy location table is constructed later in the page. Preserve a
  // hard-refreshed UWS selection through startup, but temporarily give that
  // legacy loader HRM until the UWS adapter has registered the new location.
  try{if(localStorage.getItem('wx-loc')==='uws'){sessionStorage.setItem('wx-pending-loc','uws');localStorage.setItem('wx-loc','hrm')}}catch{}
  const LOC_LABELS={hrm:['HRM CORE','Halifax Peninsula · Bedford · Dartmouth'],moncton:['MONCTON NB','Downtown Moncton'],shediac:['SHEDIAC NB','Shediac town centre'],lunenburg:['LUNENBURG NS','Lunenburg'],wolfville:['WOLFVILLE NS','Wolfville · New Minas · Kentville'],uws:['UPPER WEST SIDE NY','Upper West Side · Manhattan']};
  const LOC_TZ={uws:'America/New_York'};
  const CURRENT_POINTS={
    hrm:[['Halifax Peninsula',44.6488,-63.5752],['Bedford',44.7318,-63.6619],['Dartmouth',44.6661,-63.5676]],
    moncton:[['Moncton',46.0878,-64.7782]],shediac:[['Shediac',46.2198,-64.5411]],lunenburg:[['Lunenburg',44.377896,-64.309529]],
    wolfville:[['Wolfville',45.091713,-64.359242],['Wolfville Core',45.067858,-64.460234],['Wolfville West',45.077707,-64.495306]],
    uws:[['UWS South',40.7745,-73.9840],['UWS Central',40.7870,-73.9754],['UWS North',40.7950,-73.9705]]
  };
  const nativeCurrentFetch=window.fetch.bind(window);
  const $=id=>document.getElementById(id),n=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null,deg=v=>n(v)==null?'--°':`${Math.round(n(v))}°`,pct=v=>n(v)==null?'--%':`${Math.round(n(v))}%`,sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const avg=a=>{a=a.map(n).filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null};
  const put=(id,text)=>{const e=$(id);if(e&&text!=null)e.textContent=text};
  const localKey=()=>{try{return sessionStorage.getItem('wx-pending-loc')||localStorage.getItem('wx-loc')||'hrm'}catch{return'hrm'}};
  const timezone=key=>LOC_TZ[key]||'America/Halifax';
  const nearestHour=c=>{const h=c?.hours||{};return h['1']||h['3']||h['6']||Object.values(h)[0]||null};
  const forecastFeel=x=>n(x?.real_feel_engine?.inputs?.provider_apparent_temperature)??n(x?.real_feel);
  const prettyAge=stamp=>{const d=new Date(stamp);if(Number.isNaN(d))return'';const m=Math.max(0,Math.round((Date.now()-d.getTime())/60000));return m<60?`${m} min old`:`${Math.round(m/60)}h old`};
  const leadRows=c=>[1,3,6,12,24,48,72].map(k=>[k,c?.hours?.[String(k)]]).filter(([,v])=>v&&n(v.temperature_2m)!=null);
  const vapour=(t,rh)=>rh/100*6.105*Math.exp(17.27*t/(237.7+t));
  function observedApparent(t,rh,wind){
    t=n(t);rh=n(rh);wind=n(wind);if(t==null)return null;
    if(t<=10&&wind!=null&&wind>=4.8)return 13.12+0.6215*t-11.37*Math.pow(wind,.16)+0.3965*t*Math.pow(wind,.16);
    if(t<=10)return t;
    if(rh==null||wind==null)return t;
    return t+0.33*vapour(t,rh)-0.70*(wind/3.6)-4.0;
  }
  function paint(engine,source='hourly'){
    if(window.__wxHasCompleteForecast)return false;
    const key=localKey(),c=engine?.consensus?.[key],row=nearestHour(c);if(!c||!row)return false;
    const air=n(row.temperature_2m),unc=n(row.v2_uncertainty??row.uncertainty),labels=LOC_LABELS[key]||[key.toUpperCase(),key];
    if(!Number.isFinite(air))return false;
    put('kicker',labels[0]);put('place',labels[1]);
    const currentReady=window.__wxFastCurrent?.painted&&window.__wxFastCurrent?.location===key;
    if(!currentReady){put('feels','--°');const actual=$('actual');if(actual)actual.innerHTML='Actual <b>--°</b>';put('range','Current Real Feel updating…');put('officialTemp','--°');put('officialStation','Official observation updating…');put('obsline',`Forecast loaded from ${source} data${engine?.updated_at?' · '+prettyAge(engine.updated_at):''}; live current conditions are updating`)}
    put('fhigh','--°');put('rain','--%');put('outside','Current conditions updating…');put('advice','Forecast is ready; live current conditions are loading.');put('modelCount','cached consensus · live updating');put('uncertainty',Number.isFinite(unc)?`±${Math.round(unc*10)/10}°`:'--°');
    put('updated',`Startup forecast loaded${engine?.updated_at?' · '+new Date(engine.updated_at).toLocaleString('en-CA',{timeZone:timezone(key)}):''}`);
    const rows=leadRows(c),hours=$('hours');if(hours&&rows.length)hours.innerHTML=rows.filter(([lead])=>lead<=12).map(([lead,x])=>`<div class="hour"><small>+${lead}H</small><div class="wx">⛅️</div><b>${deg(forecastFeel(x))}</b><div class="sub">Real Feel forecast · Rain ${pct(n(x.precipitation_probability))}</div></div>`).join('');
    const days=$('days');if(days&&rows.length)days.innerHTML=rows.filter(([lead])=>lead>=24).map(([lead,x],i)=>`<div class="v11Day"><div class="v11DayName">${i===0?'Tomorrow':`+${Math.round(lead/24)} days`}</div><div class="v11DayWx">⛅️</div><div class="v11DayRF">${deg(forecastFeel(x))}</div><div class="v11DayActual">Consensus temperature ${deg(n(x.temperature_2m))}</div><div class="v11DayRain">Rain ${pct(n(x.precipitation_probability))}</div></div>`).join('');
    const zones=$('zones');if(zones&&!zones.children.length)zones.innerHTML=`<div class="card"><small>${labels[0]}</small><div class="zt">--°</div><div class="sub">Current Real Feel updating · +1h forecast Actual ${deg(air)}</div></div>`;
    if($('alertCount')?.textContent==='--')put('alertCount','0');if($('alertSummary')?.textContent?.includes('checking'))put('alertSummary','Live alert check updating…');
    window.__wxStaticStartupShown=true;window.__wxInitialForecastShown=true;window.__wxStaticStartup={location:key,air:null,feel:null,rain:null,forecastAir:air,updated_at:engine?.updated_at||null,source};return true;
  }
  async function providerCurrentCandidate(key,points,tz){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),6000);
    try{
      const jobs=points.map(async([name,lat,lon])=>{const p=new URLSearchParams({latitude:String(lat),longitude:String(lon),timezone:tz,forecast_days:'1',temperature_unit:'celsius',wind_speed_unit:'kmh',current:'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code'});const r=await nativeCurrentFetch(`https://api.open-meteo.com/v1/forecast?${p}`,{cache:'no-store',signal:ctrl.signal});if(!r.ok)throw Error(`current ${r.status}`);const d=await r.json();return{name,current:d?.current||null}});
      const settled=await Promise.allSettled(jobs),rows=settled.filter(x=>x.status==='fulfilled'&&x.value?.current&&n(x.value.current.apparent_temperature)!=null&&n(x.value.current.temperature_2m)!=null).map(x=>x.value);
      const feel=avg(rows.map(x=>x.current.apparent_temperature)),air=avg(rows.map(x=>x.current.temperature_2m)),wind=avg(rows.map(x=>x.current.wind_speed_10m)),gust=avg(rows.map(x=>x.current.wind_gusts_10m));if(!Number.isFinite(feel)||!Number.isFinite(air))throw Error('current apparent temperature unavailable');
      return{source:'provider-apparent-current',timezone:tz,feel,air,wind,gust,points:rows.length,total_points:points.length,point_values:rows.map(x=>({name:x.name,feel:n(x.current.apparent_temperature),air:n(x.current.temperature_2m),humidity:n(x.current.relative_humidity_2m),wind:n(x.current.wind_speed_10m),gust:n(x.current.wind_gusts_10m)}))};
    }finally{clearTimeout(timer)}
  }
  async function officialCurrentCandidate(key,tz){
    // UWS has its own NWS/KNYC browser fallback in uws-location-ui.js.
    if(key==='uws')throw Error('UWS official fallback owned by NWS adapter');
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),2500);
    try{
      const r=await nativeCurrentFetch(`./data/skill.json?current=${Date.now()}`,{cache:'no-store',signal:ctrl.signal});if(!r.ok)throw Error(`official current ${r.status}`);const skill=await r.json(),obs=skill?.observations?.[key],v=obs?.values||{};
      const stamp=obs?.time||obs?.stations?.[0]?.time,ts=stamp?Date.parse(stamp):NaN,age=Number.isFinite(ts)?Date.now()-ts:Infinity;if(age < -30*60*1000||age>OFFICIAL_MAX_AGE_MS)throw Error('official current observation stale');
      const air=n(v.temperature_2m??obs?.temp),humidity=n(v.relative_humidity_2m),wind=n(v.wind_speed_10m),gust=n(v.wind_gusts_10m),feel=observedApparent(air,humidity,wind);if(!Number.isFinite(air)||!Number.isFinite(feel))throw Error('official current observation incomplete');
      const stationCount=Math.max(1,Number(obs?.station_count)||1),label=(LOC_LABELS[key]||[key.toUpperCase()])[0];
      return{source:'official-observation-steadman-current',timezone:tz,feel,air,wind,gust,humidity,points:stationCount,total_points:stationCount,official_station:obs?.station||'',official_time:stamp,point_values:[{name:`${label} official mesh`,feel,air,humidity,wind,gust,truth:'official-observation-current'}]};
    }finally{clearTimeout(timer)}
  }
  function paintCurrentCandidate(key,candidate,startedAt){
    if(localKey()!==key||!candidate||!Number.isFinite(candidate.feel)||!Number.isFinite(candidate.air))return false;
    const provider=candidate.source==='provider-apparent-current',feels=$('feels'),actual=$('actual');
    if(feels){feels.textContent=`${candidate.feel.toFixed(1)}°`;feels.dataset.currentSource=provider?'provider-apparent-fast-current':'official-observation-steadman-current';delete feels.dataset.engine3RealFeel}
    if(actual){actual.innerHTML=`Actual <b>${candidate.air.toFixed(1)}°</b>`;actual.dataset.currentSource=candidate.source}
    put('range',provider?'Current Real Feel · live inputs':'Current Real Feel · official observation fallback');if(Number.isFinite(candidate.wind))put('wind',`${Math.round(candidate.wind)} / ${Number.isFinite(candidate.gust)?Math.round(candidate.gust):'--'}`);
    if(provider)put('obsline',`Live current conditions · ${candidate.points}/${candidate.total_points} core point${candidate.total_points===1?'':'s'}; official observation correction updating`);
    else{put('officialTemp',`${candidate.air.toFixed(1)}°`);put('officialStation',candidate.official_station?`ECCC mesh · ${candidate.official_station}`:'ECCC official observation mesh');put('obsline',`Current conditions from fresh official observation mesh${candidate.official_time?' · '+prettyAge(candidate.official_time):''}; provider apparent temperature is still updating`)}
    document.documentElement.dataset.wxRealFeel=provider?'live-current-provider-apparent':'live-current-official-observation-fallback';document.documentElement.dataset.wxCurrentActual='live-current-input';
    window.__wxFastCurrent={location:key,painted:true,status:'ready',...candidate,elapsed_ms:Date.now()-startedAt};window.dispatchEvent(new CustomEvent('wx-fast-current-ready',{detail:window.__wxFastCurrent}));return true;
  }
  async function fastCurrent(){
    const key=localKey(),points=CURRENT_POINTS[key]||CURRENT_POINTS.hrm,tz=timezone(key),startedAt=Date.now();window.__wxFastCurrent={location:key,painted:false,status:'loading',started_at:startedAt};
    const provider=providerCurrentCandidate(key,points,tz),official=sleep(OFFICIAL_GRACE_MS).then(()=>officialCurrentCandidate(key,tz));
    try{
      const first=await Promise.any([provider,official]);if(!paintCurrentCandidate(key,first,startedAt))return false;
      // Provider apparent remains champion. A fresh official observation only
      // bridges provider latency/outage and is replaced if provider current arrives.
      if(first.source!=='provider-apparent-current')provider.then(x=>paintCurrentCandidate(key,x,startedAt)).catch(()=>{});
      return true;
    }catch(e){if(localKey()===key)window.__wxFastCurrent={...(window.__wxFastCurrent||{}),location:key,painted:false,status:'unavailable',error:String(e?.message||e)};return false}
  }
  try{const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');if(cached?.engine)paint(cached.engine,'saved Engine 3')}catch{}
  async function boot(){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),3000);try{const r=await fetch(`./data/engine-v3.json?startup=${Date.now()}`,{cache:'no-store',signal:ctrl.signal});if(!r.ok)throw Error(`engine ${r.status}`);const engine=await r.json();try{localStorage.setItem(CACHE_KEY,JSON.stringify({saved_at:Date.now(),engine}))}catch{};if(!window.__wxInitialForecastShown)paint(engine,'latest Engine 3')}catch(e){if(!window.__wxInitialForecastShown)console.warn('Static startup fallback unavailable',e)}finally{clearTimeout(timer)}}
  window.__wxPaintStaticStartup=boot;window.WXRefreshFastCurrent=fastCurrent;fastCurrent();boot();
})();