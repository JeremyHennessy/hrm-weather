(()=>{
  const CACHE_KEY='wx-engine-v3-startup';
  const LOC_LABELS={hrm:['HRM CORE','Halifax Peninsula · Bedford · Dartmouth'],moncton:['MONCTON NB','Downtown Moncton'],shediac:['SHEDIAC NB','Shediac town centre'],lunenburg:['LUNENBURG NS','Lunenburg'],wolfville:['WOLFVILLE NS','Wolfville · New Minas · Kentville']};
  const CURRENT_POINTS={
    hrm:[[44.6488,-63.5752],[44.7318,-63.6619],[44.6661,-63.5676]],
    moncton:[[46.0878,-64.7782]],shediac:[[46.2198,-64.5411]],lunenburg:[[44.377896,-64.309529]],
    wolfville:[[45.091713,-64.359242],[45.067858,-64.460234],[45.077707,-64.495306]]
  };
  const nativeCurrentFetch=window.fetch.bind(window);
  const $=id=>document.getElementById(id),n=v=>Number.isFinite(Number(v))?Number(v):null,deg=v=>n(v)==null?'--°':`${Math.round(n(v))}°`,pct=v=>n(v)==null?'--%':`${Math.round(n(v))}%`;
  const avg=a=>{a=a.map(n).filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null};
  const put=(id,text)=>{const e=$(id);if(e&&text!=null)e.textContent=text};
  const localKey=()=>localStorage.getItem('wx-loc')||'hrm';
  const nearestHour=c=>{const h=c?.hours||{};return h['1']||h['3']||h['6']||Object.values(h)[0]||null};
  const forecastFeel=x=>n(x?.real_feel_engine?.inputs?.provider_apparent_temperature)??n(x?.real_feel);
  const prettyAge=stamp=>{const d=new Date(stamp);if(Number.isNaN(d))return'';const m=Math.max(0,Math.round((Date.now()-d.getTime())/60000));return m<60?`${m} min old`:`${Math.round(m/60)}h old`};
  const leadRows=c=>[1,3,6,12,24,48,72].map(k=>[k,c?.hours?.[String(k)]]).filter(([,v])=>v&&n(v.temperature_2m)!=null);
  function paint(engine,source='hourly'){
    if(window.__wxHasCompleteForecast)return false;
    const key=localKey(),c=engine?.consensus?.[key],row=nearestHour(c);if(!c||!row)return false;
    const air=n(row.temperature_2m),unc=n(row.v2_uncertainty??row.uncertainty),labels=LOC_LABELS[key]||[key.toUpperCase(),key];
    if(!Number.isFinite(air))return false;
    put('kicker',labels[0]);put('place',labels[1]);
    const currentReady=window.__wxFastCurrent?.painted&&window.__wxFastCurrent?.location===key;
    if(!currentReady){
      put('feels','--°');const actual=$('actual');if(actual)actual.innerHTML='Actual <b>--°</b>';
      put('range','Current Real Feel updating…');put('officialTemp','--°');put('officialStation','Official observation updating…');
      put('obsline',`Forecast loaded from ${source} data${engine?.updated_at?' · '+prettyAge(engine.updated_at):''}; live current conditions are updating`);
    }
    put('fhigh','--°');put('rain','--%');
    put('outside','Current conditions updating…');put('advice','Forecast is ready; live current conditions are loading.');put('modelCount','cached consensus · live updating');put('uncertainty',Number.isFinite(unc)?`±${Math.round(unc*10)/10}°`:'--°');
    put('updated',`Startup forecast loaded${engine?.updated_at?' · '+new Date(engine.updated_at).toLocaleString('en-CA',{timeZone:'America/Halifax'}):''}`);
    const rows=leadRows(c),hours=$('hours');if(hours&&rows.length)hours.innerHTML=rows.filter(([lead])=>lead<=12).map(([lead,x])=>`<div class="hour"><small>+${lead}H</small><div class="wx">⛅️</div><b>${deg(forecastFeel(x))}</b><div class="sub">Real Feel forecast · Rain ${pct(n(x.precipitation_probability))}</div></div>`).join('');
    const days=$('days');if(days&&rows.length)days.innerHTML=rows.filter(([lead])=>lead>=24).map(([lead,x],i)=>`<div class="v11Day"><div class="v11DayName">${i===0?'Tomorrow':`+${Math.round(lead/24)} days`}</div><div class="v11DayWx">⛅️</div><div class="v11DayRF">${deg(forecastFeel(x))}</div><div class="v11DayActual">Consensus temperature ${deg(n(x.temperature_2m))}</div><div class="v11DayRain">Rain ${pct(n(x.precipitation_probability))}</div></div>`).join('');
    const zones=$('zones');if(zones&&!zones.children.length)zones.innerHTML=`<div class="card"><small>${labels[0]}</small><div class="zt">--°</div><div class="sub">Current Real Feel updating · +1h forecast Actual ${deg(air)}</div></div>`;
    if($('alertCount')?.textContent==='--')put('alertCount','0');if($('alertSummary')?.textContent?.includes('checking'))put('alertSummary','Live alert check updating…');
    window.__wxStaticStartupShown=true;window.__wxInitialForecastShown=true;window.__wxStaticStartup={location:key,air:null,feel:null,rain:null,forecastAir:air,updated_at:engine?.updated_at||null,source};return true;
  }
  async function fastCurrent(){
    const key=localKey(),points=CURRENT_POINTS[key]||CURRENT_POINTS.hrm,ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),6000);window.__wxFastCurrent={location:key,painted:false,status:'loading',started_at:Date.now()};
    try{
      const jobs=points.map(async([lat,lon])=>{
        const p=new URLSearchParams({latitude:String(lat),longitude:String(lon),timezone:'America/Halifax',forecast_days:'1',temperature_unit:'celsius',wind_speed_unit:'kmh',current:'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code'});
        const r=await nativeCurrentFetch(`https://api.open-meteo.com/v1/forecast?${p}`,{cache:'no-store',signal:ctrl.signal});if(!r.ok)throw Error(`current ${r.status}`);const d=await r.json();return d?.current||null;
      });
      const settled=await Promise.allSettled(jobs),rows=settled.filter(x=>x.status==='fulfilled'&&x.value&&n(x.value.apparent_temperature)!=null).map(x=>x.value);
      if(localKey()!==key)return false;
      const feel=avg(rows.map(x=>x.apparent_temperature)),air=avg(rows.map(x=>x.temperature_2m)),wind=avg(rows.map(x=>x.wind_speed_10m)),gust=avg(rows.map(x=>x.wind_gusts_10m));
      if(!Number.isFinite(feel))throw Error('current apparent temperature unavailable');
      const feels=$('feels');if(feels){feels.textContent=`${feel.toFixed(1)}°`;feels.dataset.currentSource='provider-apparent-fast-current';delete feels.dataset.engine3RealFeel}
      const actual=$('actual');if(actual&&Number.isFinite(air))actual.innerHTML=`Actual <b>${air.toFixed(1)}°</b>`;
      put('range','Current Real Feel · live inputs');if(Number.isFinite(wind))put('wind',`${Math.round(wind)} / ${Number.isFinite(gust)?Math.round(gust):'--'}`);
      put('obsline',`Live current conditions · ${rows.length}/${points.length} core point${points.length===1?'':'s'}; official observation correction updating`);
      document.documentElement.dataset.wxRealFeel='live-current-provider-apparent';
      window.__wxFastCurrent={location:key,painted:true,status:'ready',source:'provider-apparent-current',feel,air,points:rows.length,total_points:points.length,elapsed_ms:Date.now()-(window.__wxFastCurrent?.started_at||Date.now())};
      return true;
    }catch(e){window.__wxFastCurrent={...(window.__wxFastCurrent||{}),location:key,painted:false,status:'unavailable',error:String(e?.message||e)};return false}finally{clearTimeout(timer)}
  }
  try{const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');if(cached?.engine)paint(cached.engine,'saved Engine 3')}catch{}
  async function boot(){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),3000);
    try{const r=await fetch(`./data/engine-v3.json?startup=${Date.now()}`,{cache:'no-store',signal:ctrl.signal});if(!r.ok)throw Error(`engine ${r.status}`);const engine=await r.json();try{localStorage.setItem(CACHE_KEY,JSON.stringify({saved_at:Date.now(),engine}))}catch{};if(!window.__wxInitialForecastShown)paint(engine,'latest Engine 3')}catch(e){if(!window.__wxInitialForecastShown)console.warn('Static startup fallback unavailable',e)}finally{clearTimeout(timer)}
  }
  window.__wxPaintStaticStartup=boot;fastCurrent();boot();
})();