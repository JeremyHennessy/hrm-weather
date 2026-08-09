(()=>{
  const LOC_LABELS={
    hrm:['HRM CORE','Halifax Peninsula · Bedford · Dartmouth'],
    moncton:['MONCTON NB','Downtown Moncton'],
    shediac:['SHEDIAC NB','Shediac town centre'],
    lunenburg:['LUNENBURG NS','Lunenburg'],
    wolfville:['WOLFVILLE NS','Wolfville · New Minas · Kentville']
  };
  const $=id=>document.getElementById(id);
  const n=v=>Number.isFinite(Number(v))?Number(v):null;
  const deg=v=>n(v)==null?'--°':`${Math.round(n(v))}°`;
  const pct=v=>n(v)==null?'--%':`${Math.round(n(v))}%`;
  const put=(id,text)=>{const e=$(id);if(e&&text!=null)e.textContent=text};
  const localKey=()=>localStorage.getItem('wx-loc')||'hrm';
  const humidityFromObs=o=>n(o?.relative_humidity_2m??o?.relative_humidity??o?.rh??o?.humidity);
  const tempFromObs=o=>n(o?.temp??o?.temperature_2m??o?.temperature);
  function humidex(t,rh){
    if(!Number.isFinite(t)||!Number.isFinite(rh)||t<18)return t;
    const a=17.27,b=237.7,alpha=(a*t)/(b+t)+Math.log(Math.max(.01,rh/100));
    const dew=(b*alpha)/(a-alpha);
    const e=6.11*Math.exp(5417.7530*(1/273.16-1/(273.15+dew)));
    return t+(5/9)*(e-10);
  }
  function nearestHour(consensus){
    const h=consensus?.hours||{};
    return h['1']||h['3']||h['6']||Object.values(h)[0]||null;
  }
  function prettyAge(stamp){
    const d=new Date(stamp);if(Number.isNaN(d))return'';
    const m=Math.max(0,Math.round((Date.now()-d.getTime())/60000));
    return m<60?`${m} min old`:`${Math.round(m/60)}h old`;
  }
  function leadRows(consensus){
    const h=consensus?.hours||{};
    return [1,3,6,12,24,48,72].map(k=>[k,h[String(k)]]).filter(([,v])=>v&&n(v.temperature_2m)!=null);
  }
  function paint(engine,skill){
    const key=localKey(),c=engine?.consensus?.[key];if(!c)return false;
    const row=nearestHour(c);if(!row)return false;
    const obs=skill?.observations?.[key]||engine?.observations?.[key]||{};
    const air=tempFromObs(obs)??n(row.temperature_2m);
    const rh=humidityFromObs(obs);
    const feel=humidex(air,rh);
    const rain=n(row.precipitation_probability);
    const uncertainty=n(row.v2_uncertainty??row.uncertainty);
    const labels=LOC_LABELS[key]||[key.toUpperCase(),key];
    put('kicker',labels[0]);put('place',labels[1]);
    put('feels',deg(feel));
    const actual=$('actual');if(actual)actual.innerHTML=`Actual <b>${deg(air)}</b>`;
    put('range',Number.isFinite(uncertainty)?`Real Feel range ${deg(feel-uncertainty)}–${deg(feel+uncertainty)}`:'Real Feel from latest consensus');
    put('fhigh',deg(feel));put('rain',pct(rain));
    if(Number.isFinite(rh))put('humidity',pct(rh));
    put('officialTemp',deg(air));
    const station=obs?.station||obs?.stations?.map?.(x=>x.station).filter(Boolean).slice(0,2).join(' · ')||'Latest collected observation';
    put('officialStation',station);
    put('obsline',`Loaded from collected weather data${engine?.updated_at?' · '+prettyAge(engine.updated_at):''}`);
    put('outside',Number.isFinite(feel)?(feel>=31?'Hot outside':feel>=25?'Warm outside':feel>=10?'Comfortable outside':'Cool outside'):'Forecast available');
    put('advice','Latest collected forecast is shown now; live sources are updating in the background.');
    put('modelCount','cached consensus · live updating');
    put('uncertainty',Number.isFinite(uncertainty)?deg(uncertainty):'--°');
    put('updated',`Startup forecast loaded from Weather Consensus hourly data${engine?.updated_at?' · '+new Date(engine.updated_at).toLocaleString('en-CA',{timeZone:'America/Halifax'}):''}`);
    const rows=leadRows(c);
    const hours=$('hours');
    if(hours&&rows.length){hours.innerHTML=rows.filter(([lead])=>lead<=12).map(([lead,x])=>`<div class="hour"><small>+${lead}H</small><div class="wx">⛅️</div><b>${deg(n(x.temperature_2m))}</b><div class="sub">Actual · rain ${pct(n(x.precipitation_probability))}</div></div>`).join('')}
    const days=$('days');
    if(days&&rows.length){days.innerHTML=rows.filter(([lead])=>lead>=24).map(([lead,x],i)=>`<div class="v11Day"><div class="v11DayName">${i===0?'Tomorrow':`+${Math.round(lead/24)} days`}</div><div class="v11DayWx">⛅️</div><div class="v11DayRF">${deg(n(x.temperature_2m))}</div><div class="v11DayActual">Consensus temperature</div><div class="v11DayRain">Rain ${pct(n(x.precipitation_probability))}</div></div>`).join('')}
    const zones=$('zones');if(zones&&!zones.children.length)zones.innerHTML=`<div class="card"><small>${labels[0]}</small><div class="zt">${deg(feel)}</div><div class="sub">Real Feel · Actual ${deg(air)}</div></div>`;
    if($('alertCount')?.textContent==='--')put('alertCount','0');
    if($('alertSummary')?.textContent?.includes('checking'))put('alertSummary','Live alert check updating…');
    window.__wxInitialForecastShown=true;
    window.__wxStaticStartupShown=true;
    window.__wxStaticStartup={location:key,air,feel,rain,updated_at:engine?.updated_at||null};
    return true;
  }
  async function boot(){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),3500);
    try{
      const [er,sr]=await Promise.all([
        fetch(`./data/engine-v3.json?startup=${Date.now()}`,{cache:'no-store',signal:ctrl.signal}),
        fetch(`./data/skill.json?startup=${Date.now()}`,{cache:'no-store',signal:ctrl.signal})
      ]);
      if(!er.ok)throw Error(`engine ${er.status}`);
      const engine=await er.json();
      const skill=sr.ok?await sr.json():{};
      paint(engine,skill);
    }catch(e){console.warn('Static startup fallback unavailable',e)}finally{clearTimeout(timer)}
  }
  window.__wxPaintStaticStartup=boot;
  boot();
})();
