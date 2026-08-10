(()=>{
  const CACHE_KEY='wx-engine-v3-startup';
  const LOC_LABELS={hrm:['HRM CORE','Halifax Peninsula · Bedford · Dartmouth'],moncton:['MONCTON NB','Downtown Moncton'],shediac:['SHEDIAC NB','Shediac town centre'],lunenburg:['LUNENBURG NS','Lunenburg'],wolfville:['WOLFVILLE NS','Wolfville · New Minas · Kentville']};
  const $=id=>document.getElementById(id),n=v=>Number.isFinite(Number(v))?Number(v):null,deg=v=>n(v)==null?'--°':`${Math.round(n(v))}°`,pct=v=>n(v)==null?'--%':`${Math.round(n(v))}%`;
  const put=(id,text)=>{const e=$(id);if(e&&text!=null)e.textContent=text};
  const localKey=()=>localStorage.getItem('wx-loc')||'hrm';
  const nearestHour=c=>{const h=c?.hours||{};return h['1']||h['3']||h['6']||Object.values(h)[0]||null};
  const forecastFeel=x=>n(x?.real_feel_engine?.inputs?.provider_apparent_temperature)??n(x?.real_feel);
  const prettyAge=stamp=>{const d=new Date(stamp);if(Number.isNaN(d))return'';const m=Math.max(0,Math.round((Date.now()-d.getTime())/60000));return m<60?`${m} min old`:`${Math.round(m/60)}h old`};
  const leadRows=c=>[1,3,6,12,24,48,72].map(k=>[k,c?.hours?.[String(k)]]).filter(([,v])=>v&&n(v.temperature_2m)!=null);
  function paint(engine,source='hourly'){
    if(window.__wxHasCompleteForecast)return false;
    const key=localKey(),c=engine?.consensus?.[key],row=nearestHour(c);if(!c||!row)return false;
    const air=n(row.temperature_2m),rain=n(row.precipitation_probability),unc=n(row.v2_uncertainty??row.uncertainty),labels=LOC_LABELS[key]||[key.toUpperCase(),key];
    if(!Number.isFinite(air))return false;
    put('kicker',labels[0]);put('place',labels[1]);put('feels','--°');
    const actual=$('actual');if(actual)actual.innerHTML=`Actual <b>${deg(air)}</b>`;
    put('range','Current Real Feel updating…');put('fhigh','--°');put('rain',pct(rain));
    put('officialTemp',deg(air));put('officialStation','Weather Consensus collected forecast data');put('obsline',`Forecast loaded from ${source} data${engine?.updated_at?' · '+prettyAge(engine.updated_at):''}; live current conditions are updating`);
    put('outside','Current conditions updating…');put('advice','Forecast is ready; live current conditions are loading.');put('modelCount','cached consensus · live updating');put('uncertainty',Number.isFinite(unc)?`±${Math.round(unc*10)/10}°`:'--°');
    put('updated',`Startup forecast loaded${engine?.updated_at?' · '+new Date(engine.updated_at).toLocaleString('en-CA',{timeZone:'America/Halifax'}):''}`);
    const rows=leadRows(c),hours=$('hours');if(hours&&rows.length)hours.innerHTML=rows.filter(([lead])=>lead<=12).map(([lead,x])=>`<div class="hour"><small>+${lead}H</small><div class="wx">⛅️</div><b>${deg(forecastFeel(x))}</b><div class="sub">Real Feel forecast · Rain ${pct(n(x.precipitation_probability))}</div></div>`).join('');
    const days=$('days');if(days&&rows.length)days.innerHTML=rows.filter(([lead])=>lead>=24).map(([lead,x],i)=>`<div class="v11Day"><div class="v11DayName">${i===0?'Tomorrow':`+${Math.round(lead/24)} days`}</div><div class="v11DayWx">⛅️</div><div class="v11DayRF">${deg(forecastFeel(x))}</div><div class="v11DayActual">Consensus temperature ${deg(n(x.temperature_2m))}</div><div class="v11DayRain">Rain ${pct(n(x.precipitation_probability))}</div></div>`).join('');
    const zones=$('zones');if(zones&&!zones.children.length)zones.innerHTML=`<div class="card"><small>${labels[0]}</small><div class="zt">--°</div><div class="sub">Current Real Feel updating · forecast Actual ${deg(air)}</div></div>`;
    if($('alertCount')?.textContent==='--')put('alertCount','0');if($('alertSummary')?.textContent?.includes('checking'))put('alertSummary','Live alert check updating…');
    window.__wxStaticStartupShown=true;window.__wxStaticStartup={location:key,air,feel:null,rain,updated_at:engine?.updated_at||null,source};return true;
  }
  try{const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');if(cached?.engine)paint(cached.engine,'saved Engine 3')}catch{}
  async function boot(){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),3000);
    try{const r=await fetch(`./data/engine-v3.json?startup=${Date.now()}`,{cache:'no-store',signal:ctrl.signal});if(!r.ok)throw Error(`engine ${r.status}`);const engine=await r.json();try{localStorage.setItem(CACHE_KEY,JSON.stringify({saved_at:Date.now(),engine}))}catch{};if(!window.__wxInitialForecastShown)paint(engine,'latest Engine 3')}catch(e){if(!window.__wxInitialForecastShown)console.warn('Static startup fallback unavailable',e)}finally{clearTimeout(timer)}
  }
  window.__wxPaintStaticStartup=boot;boot();
})();