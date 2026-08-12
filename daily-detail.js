/* Tappable 7-day drill-down. Captures the same Open-Meteo base responses that
   feed the compact daily cards, then expands a selected day without issuing a
   second forecast request or changing the forecast engine. */
(()=>{
  if(window.__wxDailyDetailInstalled)return;
  window.__wxDailyDetailInstalled=true;

  const STORE=window.__wxDailyDetailRaw=window.__wxDailyDetailRaw||{};
  const CORE={
    hrm:[[44.6488,-63.5752],[44.7318,-63.6619],[44.6661,-63.5676]],
    moncton:[[46.0878,-64.7782]],
    shediac:[[46.2198,-64.5411]],
    lunenburg:[[44.377896,-64.309529]],
    wolfville:[[45.091713,-64.359242],[45.067858,-64.460234],[45.077707,-64.495306]],
    uws:[[40.7745,-73.9840],[40.7870,-73.9754],[40.7950,-73.9705]]
  };
  const LOC_LABEL={hrm:'Halifax',moncton:'Moncton',shediac:'Shediac',lunenburg:'Lunenburg',wolfville:'Wolfville Area',uws:'Upper West Side'};
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const num=v=>finite(v)?Number(v):null;
  const avg=a=>{const v=a.filter(finite).map(Number);return v.length?v.reduce((x,y)=>x+y,0)/v.length:null};
  const max=a=>{const v=a.filter(finite).map(Number);return v.length?Math.max(...v):null};
  const fmt=(v,d=0)=>finite(v)?Number(v).toFixed(d):'--';
  const loc=()=>{try{return localStorage.getItem('wx-loc')||'hrm'}catch{return'hrm'}};
  const key=(lat,lon)=>`${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
  const close=(a,b,t=.0025)=>Math.abs(Number(a)-Number(b))<=t;

  function requestUrl(input){
    try{return new URL(typeof input==='string'?input:input?.url||String(input),location.href)}catch{return null}
  }
  function shouldCapture(u){
    if(!u||u.hostname!=='api.open-meteo.com'||!u.pathname.includes('/v1/forecast'))return false;
    return !u.searchParams.has('models')&&u.searchParams.get('forecast_days')==='7'&&u.searchParams.has('hourly')&&u.searchParams.has('daily');
  }
  const priorFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const u=requestUrl(input),locAtRequest=loc(),capture=shouldCapture(u);
    const response=await priorFetch(input,init);
    if(capture&&response.ok){
      const clone=response.clone();
      clone.json().then(data=>{
        if(!data?.hourly?.time?.length||!data?.daily?.time?.length)return;
        const lat=num(u.searchParams.get('latitude')),lon=num(u.searchParams.get('longitude'));
        if(lat===null||lon===null)return;
        const bucket=STORE[locAtRequest]||(STORE[locAtRequest]={points:{},timezone:u.searchParams.get('timezone')||data.timezone||'America/Halifax',updatedAt:0});
        bucket.timezone=u.searchParams.get('timezone')||data.timezone||bucket.timezone;
        bucket.points[key(lat,lon)]={lat,lon,data,capturedAt:Date.now()};
        bucket.updatedAt=Date.now();
        window.dispatchEvent(new CustomEvent('wx-daily-detail-data',{detail:{loc:locAtRequest,lat,lon}}));
      }).catch(()=>{});
    }
    return response;
  };

  function corePayloads(k=loc()){
    const bucket=STORE[k],wanted=CORE[k]||[];if(!bucket?.points)return[];
    const pts=Object.values(bucket.points);
    const matched=wanted.map(([lat,lon])=>pts.find(p=>close(p.lat,lat)&&close(p.lon,lon))).filter(Boolean);
    return matched.length?matched:pts;
  }
  function firstData(k=loc()){return corePayloads(k)[0]?.data||null}
  function dayDates(k=loc()){return firstData(k)?.daily?.time?.slice(0,7)||[]}
  function valueAt(data,group,name,i){const a=data?.[group]?.[name];return Array.isArray(a)?a[i]:null}
  function dailyAggregate(date,k=loc()){
    const pts=corePayloads(k);if(!pts.length)return null;
    const indices=pts.map(p=>p.data?.daily?.time?.indexOf(date)??-1);
    const pull=name=>avg(pts.map((p,n)=>indices[n]>=0?valueAt(p.data,'daily',name,indices[n]):null));
    const first=pts.find((p,n)=>indices[n]>=0),fi=first?first.data.daily.time.indexOf(date):-1;
    return{
      date,
      feelHigh:pull('apparent_temperature_max'),
      actualHigh:pull('temperature_2m_max'),
      actualLow:pull('temperature_2m_min'),
      rainMax:pull('precipitation_probability_max'),
      rainTotal:pull('precipitation_sum'),
      uvMax:pull('uv_index_max'),
      sunrise:fi>=0?valueAt(first.data,'daily','sunrise',fi):null,
      sunset:fi>=0?valueAt(first.data,'daily','sunset',fi):null,
      code:fi>=0?valueAt(first.data,'daily','weather_code',fi):null,
      pointCount:pts.length
    };
  }
  function hourlyAggregate(date,k=loc()){
    const pts=corePayloads(k);if(!pts.length)return[];
    const times=[...new Set(pts.flatMap(p=>(p.data?.hourly?.time||[]).filter(t=>String(t).startsWith(date))))].sort();
    return times.map(t=>{
      const vals=(name)=>pts.map(p=>{const i=p.data?.hourly?.time?.indexOf(t)??-1;return i>=0?valueAt(p.data,'hourly',name,i):null});
      const codes=vals('weather_code').filter(finite).map(Number),code=codes.length?codes[Math.floor(codes.length/2)]:null;
      return{time:t,feel:avg(vals('apparent_temperature')),air:avg(vals('temperature_2m')),rain:avg(vals('precipitation_probability')),mm:avg(vals('precipitation')),wind:avg(vals('wind_speed_10m')),gust:avg(vals('wind_gusts_10m')),humidity:avg(vals('relative_humidity_2m')),uv:avg(vals('uv_index')),code};
    });
  }
  function localToday(tz){
    try{return new Intl.DateTimeFormat('sv-SE',{timeZone:tz||'America/Halifax',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}catch{return new Date().toISOString().slice(0,10)}
  }
  function localHour(tz){
    try{return Number(new Intl.DateTimeFormat('en-CA',{timeZone:tz||'America/Halifax',hour:'2-digit',hour12:false}).format(new Date()))}catch{return new Date().getHours()}
  }
  function hourLabel(t){
    const h=Number(String(t||'').slice(11,13)),m=String(t||'').slice(14,16)||'00';if(!Number.isFinite(h))return'--';
    const ap=h>=12?'p.m.':'a.m.',hh=h%12||12;return m==='00'?`${hh} ${ap}`:`${hh}:${m} ${ap}`;
  }
  function dayLabel(date){
    try{return new Intl.DateTimeFormat('en-CA',{weekday:'long',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`))}catch{return date}
  }
  function icon(code){
    code=Number(code);if(code===0)return'☀️';if([1,2].includes(code))return'🌤️';if(code===3)return'☁️';if([45,48].includes(code))return'🌫️';if(code>=51&&code<=67)return'🌧️';if(code>=71&&code<=77)return'🌨️';if(code>=80&&code<=82)return'🌦️';if(code>=95)return'⛈️';return'⛅️';
  }
  function precipText(mm){if(!finite(mm))return'--';const v=Number(mm);return v>0&&v<.1?'trace':`${v.toFixed(1)} mm`}

  let activeDate=null,activeLoc=null,pendingIndex=null;
  function panel(){
    let el=document.getElementById('dayDetail');if(el)return el;
    const days=document.getElementById('days');if(!days)return null;
    el=document.createElement('div');el.id='dayDetail';el.className='dayDetail';el.hidden=true;el.dataset.owner='daily-detail';
    el.innerHTML=`<div class="dayDetailHead"><button class="dayDetailNav" data-day-nav="prev" aria-label="Previous day">‹</button><div><small>DAY DETAILS</small><h3 id="dayDetailTitle">Forecast details</h3><span id="dayDetailSource"></span></div><button class="dayDetailNav" data-day-nav="next" aria-label="Next day">›</button><button class="dayDetailClose" type="button" aria-label="Close day details">×</button></div><p id="dayDetailSummary" class="dayDetailSummary"></p><div id="dayDetailMetrics" class="dayDetailMetrics"></div><div class="dayDetailHourlyHead"><b>Hourly</b><span>Real Feel first · swipe for the full day</span></div><div id="dayDetailHours" class="dayDetailHours" aria-label="Selected day hourly forecast"></div><div id="dayDetailMeta" class="dayDetailMeta"></div>`;
    days.insertAdjacentElement('afterend',el);
    el.querySelector('.dayDetailClose')?.addEventListener('click',closePanel);
    el.querySelector('[data-day-nav="prev"]')?.addEventListener('click',()=>moveDay(-1));
    el.querySelector('[data-day-nav="next"]')?.addEventListener('click',()=>moveDay(1));
    return el;
  }
  function addStyles(){
    if(document.getElementById('daily-detail-style'))return;
    const st=document.createElement('style');st.id='daily-detail-style';st.textContent=`
      #days .v11Day{cursor:pointer;position:relative;transition:background .14s ease,box-shadow .14s ease}
      #days .v11Day:hover,#days .v11Day:focus-visible{background:rgba(139,220,255,.055)!important;outline:none;box-shadow:inset 0 0 0 1px rgba(139,220,255,.28)}
      #days .v11Day[aria-expanded="true"]{background:rgba(139,220,255,.08)!important;box-shadow:inset 0 -2px 0 #8bdcff}
      .dayDetail{margin-top:10px;padding:13px 12px 14px;border-top:1px solid rgba(255,255,255,.10);background:rgba(4,27,44,.32);border-radius:0 0 16px 16px}
      .dayDetail[hidden]{display:none!important}.dayDetailHead{display:grid;grid-template-columns:34px minmax(0,1fr) 34px 32px;gap:5px;align-items:center}.dayDetailHead>div{text-align:center;min-width:0}.dayDetailHead small{display:block;font-size:7px;letter-spacing:.09em;color:#8bdcff}.dayDetailHead h3{font-size:15px;margin:2px 0 0;color:#f4fbff}.dayDetailHead span{display:block;font-size:8px;color:#8fa9b8;margin-top:2px}.dayDetailNav,.dayDetailClose{border:1px solid rgba(255,255,255,.10);background:rgba(8,37,56,.64);color:#dff4ff;border-radius:10px;height:32px;font:inherit;font-size:18px}.dayDetailNav:disabled{opacity:.28}.dayDetailClose{font-size:17px}.dayDetailSummary{margin:12px 2px 10px;font-size:11px;line-height:1.45;color:#d7e8f1}.dayDetailMetrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.dayDetailMetric{padding:8px 6px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(8,37,56,.52);text-align:center;min-width:0}.dayDetailMetric small{display:block;font-size:7px;color:#89a6b6;white-space:nowrap}.dayDetailMetric strong{display:block;font-size:18px;line-height:1.05;margin-top:4px;color:#f5fbff}.dayDetailMetric[data-kind="feel"] strong{font-size:21px;color:#fff}.dayDetailMetric span{display:block;font-size:7px;color:#a8c1ce;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dayDetailHourlyHead{display:flex;align-items:end;justify-content:space-between;gap:8px;margin:14px 2px 7px}.dayDetailHourlyHead b{font-size:11px}.dayDetailHourlyHead span{font-size:8px;color:#8ea8b7;text-align:right}.dayDetailHours{display:flex;gap:6px;overflow-x:auto;scroll-snap-type:x proximity;padding:1px 1px 6px;scrollbar-width:none}.dayDetailHours::-webkit-scrollbar{display:none}.dayDetailHour{flex:0 0 78px;scroll-snap-align:start;padding:8px 7px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(7,33,51,.52);text-align:center}.dayDetailHour>small:first-child{font-size:8px;color:#b9ced8}.dayDetailHour .wx{font-size:21px;margin:5px 0 3px}.dayDetailHour strong{display:block;font-size:19px;line-height:1;color:#fff}.dayDetailHour .rfLabel{display:block;font-size:6.5px;text-transform:uppercase;letter-spacing:.05em;color:#8bdcff;margin-top:2px}.dayDetailHour .actual{display:block;font-size:8px;color:#b5c9d3;margin-top:6px}.dayDetailHour .rain{display:block;font-size:7.5px;color:#cbe0ea;margin-top:5px;line-height:1.3}.dayDetailMeta{margin:8px 2px 0;font-size:8px;color:#8fa9b8;line-height:1.45}
      @media(max-width:390px){.dayDetail{padding-left:8px;padding-right:8px}.dayDetailMetrics{grid-template-columns:repeat(2,minmax(0,1fr))}.dayDetailHour{flex-basis:74px}}
    `;document.head.appendChild(st);
  }
  function metric(kind,label,value,detail=''){return`<div class="dayDetailMetric" data-kind="${kind}"><small>${label}</small><strong>${value}</strong>${detail?`<span>${detail}</span>`:''}</div>`}
  function bestSummary(d,rows){
    if(!d||!rows.length)return'Detailed hourly forecast is loading.';
    const peakFeel=[...rows].filter(x=>finite(x.feel)).sort((a,b)=>b.feel-a.feel)[0],lowFeel=[...rows].filter(x=>finite(x.feel)).sort((a,b)=>a.feel-b.feel)[0],rain=[...rows].filter(x=>finite(x.rain)).sort((a,b)=>b.rain-a.rain)[0],gust=max(rows.map(x=>x.gust));
    const parts=[];
    if(peakFeel&&lowFeel)parts.push(`Real Feel ranges from about ${Math.round(lowFeel.feel)}° to ${Math.round(peakFeel.feel)}°, peaking around ${hourLabel(peakFeel.time)}.`);
    if(rain){const p=Math.round(rain.rain);parts.push(p>=60?`Rain is most likely around ${hourLabel(rain.time)} (${p}%).`:p>=30?`The best shower signal is around ${hourLabel(rain.time)} (${p}%).`:`Rain risk stays low, peaking near ${p}%.`)}
    if(finite(gust)&&gust>=25)parts.push(`Gusts could reach about ${Math.round(gust)} km/h.`);
    return parts.join(' ');
  }
  function render(date,k=loc(),scroll=true){
    const el=panel();if(!el)return false;
    const d=dailyAggregate(date,k),bucket=STORE[k],tz=bucket?.timezone||'America/Halifax';let rows=hourlyAggregate(date,k);
    if(!d||!rows.length){el.hidden=false;document.getElementById('dayDetailTitle').textContent=dayLabel(date||'');document.getElementById('dayDetailSummary').textContent='Detailed hourly forecast is still loading for this location.';document.getElementById('dayDetailMetrics').innerHTML='';document.getElementById('dayDetailHours').innerHTML='';return false}
    if(date===localToday(tz)){const h=localHour(tz);rows=rows.filter(x=>Number(String(x.time).slice(11,13))>=h)}
    activeDate=date;activeLoc=k;
    const dates=dayDates(k),pos=dates.indexOf(date);
    el.hidden=false;el.dataset.date=date;el.dataset.loc=k;
    el.querySelector('#dayDetailTitle').textContent=dayLabel(date);
    el.querySelector('#dayDetailSource').textContent=`${LOC_LABEL[k]||k} · ${d.pointCount} core point${d.pointCount===1?'':'s'}`;
    el.querySelector('#dayDetailSummary').textContent=bestSummary(d,rows);
    el.querySelector('#dayDetailMetrics').innerHTML=[
      metric('feel','REAL FEEL HIGH',`${fmt(d.feelHigh,0)}°`,'daily maximum'),
      metric('actual','ACTUAL',`${fmt(d.actualHigh,0)}° / ${fmt(d.actualLow,0)}°`,'high / low'),
      metric('rain','RAIN',`${fmt(d.rainMax,0)}%`,`${precipText(d.rainTotal)} total`),
      metric('wind','UV MAX',fmt(d.uvMax,1),'daylight peak')
    ].join('');
    el.querySelector('#dayDetailHours').innerHTML=rows.map(x=>`<div class="dayDetailHour"><small>${hourLabel(x.time)}</small><div class="wx">${icon(x.code)}</div><strong>${fmt(x.feel,0)}°</strong><span class="rfLabel">Real Feel</span><span class="actual">Actual ${fmt(x.air,0)}°</span><span class="rain">Rain ${fmt(x.rain,0)}%<br>${precipText(x.mm)} · ${fmt(x.wind,0)} km/h</span></div>`).join('');
    const peakWind=max(rows.map(x=>x.wind)),peakGust=max(rows.map(x=>x.gust)),humidity=avg(rows.map(x=>x.humidity));
    el.querySelector('#dayDetailMeta').textContent=`Sunrise ${hourLabel(d.sunrise)} · sunset ${hourLabel(d.sunset)} · average humidity ${fmt(humidity,0)}% · peak wind ${fmt(peakWind,0)} km/h${finite(peakGust)?` · peak gust ${fmt(peakGust,0)} km/h`:''}.`;
    el.querySelector('[data-day-nav="prev"]').disabled=pos<=0;el.querySelector('[data-day-nav="next"]').disabled=pos<0||pos>=dates.length-1;
    document.querySelectorAll('#days .v11Day').forEach((card,i)=>card.setAttribute('aria-expanded',String(dates[i]===date)));
    if(scroll)requestAnimationFrame(()=>el.scrollIntoView({behavior:'smooth',block:'nearest'}));
    return true;
  }
  function closePanel(){const el=document.getElementById('dayDetail');if(el)el.hidden=true;activeDate=null;activeLoc=null;document.querySelectorAll('#days .v11Day').forEach(c=>c.setAttribute('aria-expanded','false'))}
  function moveDay(delta){const k=activeLoc||loc(),dates=dayDates(k),i=dates.indexOf(activeDate);if(i<0)return;const next=dates[i+delta];if(next)render(next,k,false)}
  function bindCards(){
    addStyles();const cards=[...document.querySelectorAll('#days .v11Day')],dates=dayDates(loc());if(!cards.length)return;
    cards.forEach((card,i)=>{
      card.dataset.dayDetailIndex=String(i);card.setAttribute('role','button');card.setAttribute('tabindex','0');card.setAttribute('aria-controls','dayDetail');card.setAttribute('aria-expanded',String(dates[i]===activeDate&&activeLoc===loc()));
      if(card.dataset.dayDetailBound==='1')return;card.dataset.dayDetailBound='1';
      const open=()=>{const k=loc(),ds=dayDates(k),date=ds[Number(card.dataset.dayDetailIndex)];if(date){pendingIndex=null;render(date,k,true)}else{pendingIndex=Number(card.dataset.dayDetailIndex);const el=panel();if(el){el.hidden=false;el.querySelector('#dayDetailTitle').textContent=card.querySelector('.v11DayName')?.textContent||'Forecast details';el.querySelector('#dayDetailSummary').textContent='Detailed hourly forecast is still loading for this location.'}}};
      card.addEventListener('click',open);card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}});
    });
  }
  let queued=false;function scheduleBind(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;bindCards()})}
  function start(){
    addStyles();panel();bindCards();const days=document.getElementById('days');if(days)new MutationObserver(scheduleBind).observe(days,{childList:true,subtree:true});
    document.getElementById('tabs')?.addEventListener('click',()=>{closePanel();setTimeout(scheduleBind,80)});document.querySelector('.locationPicker')?.addEventListener('change',()=>{closePanel();setTimeout(scheduleBind,80)});
    window.addEventListener('wx-daily-detail-data',e=>{if(e.detail?.loc!==loc())return;scheduleBind();if(pendingIndex!==null){const date=dayDates(loc())[pendingIndex];if(date){pendingIndex=null;render(date,loc(),false)}}else if(activeDate&&activeLoc===loc())render(activeDate,activeLoc,false)});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.getElementById('dayDetail')?.hidden)closePanel()});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
