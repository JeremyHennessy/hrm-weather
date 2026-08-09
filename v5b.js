const L={
  hrm:{n:'HRM Core',k:'HRM CORE',s:'Halifax Peninsula · Bedford · Dartmouth',
    core:[['Halifax Peninsula',44.6488,-63.5752],['Bedford',44.7318,-63.6619],['Dartmouth',44.6661,-63.5676]],
    micro:[['Clayton Park',44.6718,-63.6530],['Lower Sackville',44.7757,-63.6786],['Eastern Passage',44.6109,-63.4820]],
    bbox:[-63.80,44.48,-63.42,44.84]},
  moncton:{n:'Moncton',k:'MONCTON NB',s:'Downtown Moncton',
    core:[['Moncton',46.0878,-64.7782]],micro:[],bbox:[-64.95,45.98,-64.62,46.20]},
  shediac:{n:'Shediac',k:'SHEDIAC NB',s:'Shediac town centre',
    core:[['Shediac',46.2198,-64.5411]],micro:[],bbox:[-64.68,46.10,-64.40,46.34]}
};
const M=[
 ['gem_hrdps_continental','HRDPS','ECCC',1.22],['gem_regional','GEM Regional','ECCC',1.12],['gem_seamless','GEM','ECCC',1.08],
 ['ecmwf_ifs025','ECMWF IFS','ECMWF',1.08],['ecmwf_aifs025_single','ECMWF AIFS','ECMWF AI',1.04],
 ['gfs_seamless','GFS','NOAA',1.00],['icon_seamless','ICON','DWD',.99],['ukmo_seamless','UKMO','UK Met',1.01],
 ['meteofrance_seamless','Météo-France','France',.94],['jma_seamless','JMA','Japan',.90],['kma_seamless','KMA','Korea',.90],
 ['bom_access_global','ACCESS-G','BOM',.86],['cma_grapes_global','GRAPES','CMA',.84]
];
let loc=localStorage.getItem('wx-loc')||'hrm';
let token=0,lastUpdated=null;

const avg=a=>{a=a.filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null};
const med=a=>{a=a.filter(Number.isFinite).sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:null};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const fmt=(x,d=1)=>Number.isFinite(x)?x.toFixed(d):'--';
function robust(a){a=a.filter(Number.isFinite);if(!a.length)return null;if(a.length<4)return avg(a);const m=med(a),mad=med(a.map(x=>Math.abs(x-m)))||.5;const keep=a.filter(x=>Math.abs(x-m)<=Math.max(1.4,3*mad));return avg(keep.length?keep:a)}
function icon(c){if(c===0)return'☀️';if([1,2].includes(c))return'🌤️';if(c===3)return'☁️';if([45,48].includes(c))return'🌫️';if(c>=51&&c<=67)return'🌧️';if(c>=71&&c<=77)return'🌨️';if(c>=80&&c<=82)return'🌦️';if(c>=95)return'⛈️';return'⛅️'}
function idx(d){const n=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Halifax',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false}).format(new Date()).replace(' ','T').slice(0,13);const i=d.hourly.time.findIndex(t=>t.slice(0,13)>=n);return i<0?0:i}
function hourName(t){return new Intl.DateTimeFormat('en-CA',{hour:'numeric',timeZone:'America/Halifax'}).format(new Date(t+':00-03:00'))}
function dayName(d){return new Intl.DateTimeFormat('en-CA',{weekday:'short',timeZone:'America/Halifax'}).format(new Date(d+'T12:00:00-03:00'))}
function clock(t){if(!t)return'--';return new Intl.DateTimeFormat('en-CA',{hour:'numeric',minute:'2-digit',timeZone:'America/Halifax'}).format(new Date(t+':00-03:00'))}
function nav(){tabs.innerHTML=Object.entries(L).map(([k,v])=>`<button class="tab ${k===loc?'active':''}" data-k="${k}">${v.n}</button>`).join('');tabs.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{loc=b.dataset.k;localStorage.setItem('wx-loc',loc);nav();load()})}

function getSkills(){try{return JSON.parse(localStorage.getItem('wx-skills')||'{}')}catch{return{}}}
function saveSkills(x){try{localStorage.setItem('wx-skills',JSON.stringify(x))}catch{}}
function getLedger(){try{return JSON.parse(localStorage.getItem('wx-ledger-v3')||'[]')}catch{return[]}}
function saveLedger(x){try{localStorage.setItem('wx-ledger-v3',JSON.stringify(x.slice(-1200)))}catch{}}
function skillFactor(id,lead=6){const skills=getSkills();const s=skills[`${loc}:${id}:${lead}`]||skills[`${loc}:${id}:all`];if(!s||s.n<3)return 1;return clamp(1.35/(.75+s.mae),.62,1.30)}
function regimeFactor(id,lead,windDir){let f=1;if(id==='gem_hrdps_continental'&&lead<=12)f*=1.10;if(id==='ecmwf_ifs025'&&lead>=24)f*=1.06;if((loc==='hrm'||loc==='shediac')&&Number.isFinite(windDir)&&windDir>=60&&windDir<=190&&id==='gem_hrdps_continental')f*=1.08;return f}
function weightOf(m,lead,windDir){return m[3]*skillFactor(m[0],lead)*regimeFactor(m[0],lead,windDir)}
function weightedModel(mods,zname,getter,lead=0,windDir=null){let n=0,d=0;for(const x of mods.filter(x=>x.z[0]===zname)){const v=getter(x);if(!Number.isFinite(v))continue;const w=weightOf(x.m,lead,windDir);n+=v*w;d+=w}return d?n/d:null}
function modelSpread(mods,zname,getter){const a=mods.filter(x=>x.z[0]===zname).map(getter).filter(Number.isFinite);return a.length?Math.max(...a)-Math.min(...a):null}

async function baseQ(z){
  const p=new URLSearchParams({latitude:z[1],longitude:z[2],timezone:'America/Halifax',forecast_days:7,temperature_unit:'celsius',wind_speed_unit:'kmh',
   current:'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code',
   hourly:'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index',
   daily:'temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max,precipitation_sum,weather_code,sunrise,sunset,uv_index_max'});
  const r=await fetch('https://api.open-meteo.com/v1/forecast?'+p,{cache:'no-store'});if(!r.ok)throw Error(r.status);return{z,d:await r.json()}
}
async function modelQ(z,m){
  const p=new URLSearchParams({latitude:z[1],longitude:z[2],timezone:'America/Halifax',forecast_days:7,temperature_unit:'celsius',current:'temperature_2m',hourly:'temperature_2m,precipitation',daily:'temperature_2m_max,temperature_2m_min',models:m[0]});
  const c=new AbortController(),tm=setTimeout(()=>c.abort(),15000);
  try{const r=await fetch('https://api.open-meteo.com/v1/forecast?'+p,{signal:c.signal,cache:'no-store'});if(!r.ok)throw Error(r.status);const d=await r.json();if(!d.hourly)throw Error('incomplete');return{z,m,d}}finally{clearTimeout(tm)}
}
async function ecccObservation(){
  const C=L[loc],b=C.bbox,now=new Date();
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Halifax',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(now).reduce((o,p)=>(o[p.type]=p.value,o),{});
  const filter=`properties.LOCAL_YEAR=${parts.year} AND properties.LOCAL_MONTH=${parts.month} AND properties.LOCAL_DAY=${parts.day}`;
  const url=`https://api.weather.gc.ca/collections/climate-hourly/items?bbox=${b.join(',')}&limit=200&filter=${encodeURIComponent(filter)}&f=json`;
  try{
    const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error(r.status);const j=await r.json();
    const fs=(j.features||[]).filter(x=>Number.isFinite(Number(x.properties?.TEMP)));
    fs.sort((a,b)=>Number(b.properties?.LOCAL_HOUR??-1)-Number(a.properties?.LOCAL_HOUR??-1));
    if(!fs.length)return null;
    const latest=Number(fs[0].properties.LOCAL_HOUR);
    const same=fs.filter(x=>Number(x.properties.LOCAL_HOUR)===latest).slice(0,8);
    return{temp:robust(same.map(x=>Number(x.properties.TEMP)).filter(Number.isFinite)),hour:latest,station:same.map(x=>x.properties.STATION_NAME).filter(Boolean).slice(0,3).join(' · '),count:same.length};
  }catch{return null}
}
async function ecccAlerts(){
  const b=L[loc].bbox,url=`https://api.weather.gc.ca/collections/weather-alerts/items?bbox=${b.join(',')}&limit=50&f=json`;
  try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error(r.status);const j=await r.json(),seen=new Map();for(const f of(j.features||[])){const p=f.properties||{},key=(p.alert_name_en||p.alert_short_name_en||p.id||'alert')+'|'+(p.feature_name_en||'');if(!seen.has(key))seen.set(key,p)}return[...seen.values()]}catch{return[]}
}
function scoreDueForecasts(obsTemp,fallbackTemp){
  const actual=Number.isFinite(obsTemp)?obsTemp:fallbackTemp;if(!Number.isFinite(actual))return;
  const ledger=getLedger(),skills=getSkills(),now=Date.now();let changed=false;
  for(const e of ledger){
    if(e.scored||e.loc!==loc||e.target>now+15*60*1000||now-e.target>5*60*60*1000)continue;
    const err=Math.abs(e.pred-actual);
    for(const k of[`${loc}:${e.model}:${e.lead}`,`${loc}:${e.model}:all`]){
      const s=skills[k]||{n:0,mae:0};s.mae=(s.mae*s.n+err)/(s.n+1);s.n++;skills[k]=s;
    }
    e.scored=true;e.err=err;changed=true;
  }
  if(changed){saveSkills(skills);saveLedger(ledger)}
}
function saveForecastTargets(mods,windDir){
  const ledger=getLedger(),now=Date.now(),stamp=Math.floor(now/3600000)*3600000,seen=new Set(ledger.map(e=>`${e.loc}|${e.model}|${e.lead}|${e.issued}`));
  for(const m of M){
    const rows=mods.filter(x=>x.m[0]===m[0]);if(!rows.length)continue;
    for(const lead of[3,6,12,24]){
      const preds=[];
      for(const x of rows){const s=idx(x.d),v=x.d.hourly.temperature_2m?.[s+lead];if(Number.isFinite(v))preds.push(v)}
      const pred=avg(preds),key=`${loc}|${m[0]}|${lead}|${stamp}`;
      if(Number.isFinite(pred)&&!seen.has(key))ledger.push({loc,model:m[0],lead,issued:stamp,target:stamp+lead*3600000,pred,scored:false,windDir});
    }
  }
  saveLedger(ledger.filter(e=>Date.now()-e.issued<10*86400000));
}
function comfort(feel,hum,rain,uv,wind){
  let score=100;
  if(Number.isFinite(feel)){if(feel>31)score-=Math.min(45,(feel-31)*7);else if(feel>26)score-=Math.min(18,(feel-26)*3);else if(feel<8)score-=Math.min(30,(8-feel)*3)}
  if(hum>75&&feel>24)score-=10;if(rain>55)score-=20;else if(rain>30)score-=8;if(uv>7)score-=12;if(wind>35)score-=10;score=clamp(score,0,100);
  if(score>=78)return['Great outside',score,'var(--green)'];if(score>=58)return['Pretty good outside',score,'var(--green)'];if(score>=38)return['A bit uncomfortable',score,'var(--amber)'];return['Rough outside',score,'var(--red)'];
}
function laterAdvice(base){
  const b=base[0]?.d;if(!b)return'No guidance available yet.';const s=idx(b),a=[];
  for(let k=s;k<Math.min(s+12,b.hourly.time.length);k++){
    const feel=avg(base.map(x=>x.d.hourly.apparent_temperature?.[k])),rain=avg(base.map(x=>x.d.hourly.precipitation_probability?.[k])),uv=avg(base.map(x=>x.d.hourly.uv_index?.[k])),wind=avg(base.map(x=>x.d.hourly.wind_speed_10m?.[k])),hum=avg(base.map(x=>x.d.hourly.relative_humidity_2m?.[k])),c=comfort(feel,hum,rain,uv,wind);
    a.push({score:c[1],feel,rain,time:b.hourly.time[k]});
  }
  if(!a.length)return'No short-range guidance available.';
  const now=a[0],best=[...a].sort((x,y)=>y.score-x.score)[0];
  if(best.score>now.score+12)return`Better around ${hourName(best.time)} — feels near ${fmt(best.feel,0)}° with rain chance around ${fmt(best.rain,0)}%.`;
  if(now.rain>=45){const dry=a.find(x=>x.rain<25);if(dry)return`Rain risk drops after about ${hourName(dry.time)}.`}
  return'Conditions stay fairly similar over the next several hours.';
}
function renderAlerts(a){
  alertCount.textContent=a.length;alertSummary.textContent=a.length?(a[0].alert_name_en||a[0].alert_short_name_en||'Weather alert'):'No active alerts found';
  if(a.length){alerts.style.display='block';alerts.innerHTML=`<b>${a[0].alert_name_en||a[0].alert_short_name_en||'Environment Canada alert'}</b>${a[0].feature_name_en||''}${a.length>1?` · +${a.length-1} more`:''}`;}else alerts.style.display='none';
}
function render(base,mods,official,alertData,loading){
  if(!base.length)return;
  const C=L[loc],coreNames=new Set(C.core.map(z=>z[0])),coreBase=base.filter(x=>coreNames.has(x.z[0])),windDir=avg(coreBase.map(x=>x.d.current?.wind_direction_10m));
  const zs=C.core.map(z=>{
    const b=base.find(x=>x.z[0]===z[0]),i=b?idx(b.d):0;
    let air=weightedModel(mods,z[0],x=>x.d.current?.temperature_2m,0,windDir);if(!Number.isFinite(air))air=b?.d.current?.temperature_2m;
    return{z,b,air,spread:modelSpread(mods,z[0],x=>x.d.current?.temperature_2m),feel:b?.d.current?.apparent_temperature,hum:b?.d.current?.relative_humidity_2m,wind:b?.d.current?.wind_speed_10m,gust:b?.d.current?.wind_gusts_10m,rain:b?.d.hourly?.precipitation_probability?.[i],uv:b?.d.hourly?.uv_index?.[i],fhigh:b?.d.daily?.apparent_temperature_max?.[0]};
  });
  const modelAir=avg(zs.map(x=>x.air)),obs=official?.temp,bias=(Number.isFinite(obs)&&Number.isFinite(modelAir))?clamp(obs-modelAir,-3,3):0,obsAirWeight=Number.isFinite(obs)?0.55:0,obsFeelWeight=Number.isFinite(obs)?0.45:0;
  const air=modelAir+obsAirWeight*bias,feel=avg(zs.map(x=>x.feel))+obsFeelWeight*bias,hum=avg(zs.map(x=>x.hum)),windV=avg(zs.map(x=>x.wind)),gust=avg(zs.map(x=>x.gust)),rainV=avg(zs.map(x=>x.rain)),uvV=avg(zs.map(x=>x.uv)),fhi=avg(zs.map(x=>x.fhigh));
  const spread=avg(zs.map(x=>x.spread).filter(Number.isFinite))||0,skills=getSkills(),skillErr=avg(Object.entries(skills).filter(([k,v])=>k.startsWith(loc+':')&&k.endsWith(':all')&&v.n>=3).map(([k,v])=>v.mae)),unc=Math.max(.8,spread/2+(Number.isFinite(skillErr)?skillErr*.45:.5));
  kicker.textContent=C.k;place.textContent=C.s;zoneTitle.textContent=C.core.length>1?'Across HRM':C.n;feels.textContent=fmt(feel)+'°';actual.innerHTML=`Actual <b>${fmt(air)}°</b>`;range.textContent=`Likely feels-like range ${fmt(feel-unc,0)}–${fmt(feel+unc,0)}°`;fhigh.textContent=fmt(fhi)+'°';rain.textContent=fmt(rainV,0)+'%';wind.textContent=`${fmt(windV,0)} / ${fmt(gust,0)}`;uv.textContent=fmt(uvV,1);heroIcon.textContent=icon(zs[0]?.b?.d.current?.weather_code);
  const c=comfort(feel,hum,rainV,uvV,windV);outside.textContent=c[0];odot.style.background=c[2];advice.textContent=laterAdvice(coreBase);
  obsline.textContent=official?`Now corrected with ECCC observation (${fmt(official.temp)}° · ${official.count} station record${official.count===1?'':'s'})`:'Official observation unavailable — using model consensus';
  officialTemp.textContent=official?fmt(official.temp)+'°':'--°';officialStation.textContent=official?.station||'No nearby ECCC hourly observation returned';renderAlerts(alertData||[]);
  zones.innerHTML=zs.map(x=>`<div class="card"><small>${x.z[0]}</small><div class="zt">${fmt(x.feel+obsFeelWeight*bias)}°</div><div class="sub">actual ${fmt(x.air+obsAirWeight*bias)}° · rain ${fmt(x.rain,0)}%</div></div>`).join('');
  const micros=base.filter(x=>!coreNames.has(x.z[0]));microSection.style.display=loc==='hrm'?'block':'none';microZones.innerHTML=micros.map(x=>`<div class="card"><small>${x.z[0]}</small><div class="zt">${fmt(x.d.current?.apparent_temperature)}°</div><div class="sub">air ${fmt(x.d.current?.temperature_2m)}°</div></div>`).join('');
  const b0=zs[0].b.d,s=idx(b0),hr=[];
  for(let k=s;k<Math.min(s+12,b0.hourly.time.length);k++){
    const lead=k-s,feelH=avg(coreBase.map(x=>x.d.hourly.apparent_temperature?.[k]))+(Number.isFinite(obs)?0.25:0)*bias;
    const airParts=C.core.map(z=>weightedModel(mods,z[0],x=>x.d.hourly.temperature_2m?.[k],lead,windDir)).filter(Number.isFinite),airH=avg(airParts);
    const rp=avg(coreBase.map(x=>x.d.hourly.precipitation_probability?.[k])),mm=avg(coreBase.map(x=>x.d.hourly.precipitation?.[k]));
    const wetModels=mods.map(x=>x.d.hourly.precipitation?.[idx(x.d)+lead]).filter(Number.isFinite),agree=wetModels.length?100*wetModels.filter(v=>v>=.1).length/wetModels.length:null;
    hr.push({t:b0.hourly.time[k],feel:feelH,air:airH,rain:rp,mm,agree,code:b0.hourly.weather_code?.[k]});
  }
  hours.innerHTML=hr.map(x=>`<div class="card hour"><small>${hourName(x.t)}</small><div class="wx">${icon(x.code)}</div><b>${fmt(x.feel,0)}°</b><div class="sub">air ${fmt(x.air,0)}°</div><small>Rain ${fmt(x.rain,0)}% · Amount ${Number.isFinite(x.mm)&&x.mm>0&&x.mm<.1?'trace':fmt(x.mm,1)+' mm'}</small><div class="rainagree">${Number.isFinite(x.agree)?fmt(x.agree,0)+'% models wet':'agreement --'}</div></div>`).join('');
  days.innerHTML=b0.daily.time.slice(0,7).map((d,i)=>{const fh=avg(coreBase.map(x=>x.d.daily.apparent_temperature_max?.[i])),hiA=avg(coreBase.map(x=>x.d.daily.temperature_2m_max?.[i])),loA=avg(coreBase.map(x=>x.d.daily.temperature_2m_min?.[i])),rp=avg(coreBase.map(x=>x.d.daily.precipitation_probability_max?.[i])),mm=avg(coreBase.map(x=>x.d.daily.precipitation_sum?.[i]));return`<div class="day"><b>${dayName(d)}</b><div class="dayMain">${icon(b0.daily.weather_code?.[i])} feels max <b>${fmt(fh,0)}°</b> · ☂ ${fmt(rp,0)}% · ${fmt(mm,1)}mm</div><div class="dayTemps"><strong>${fmt(hiA,0)}°</strong><small>${fmt(loA,0)}° actual</small></div></div>`}).join('');
  rainTotal.textContent=fmt(avg(coreBase.map(x=>x.d.daily.precipitation_sum?.[0])),1)+' mm';const wet=hr.find(x=>x.rain>=40||x.mm>=.2),dry=wet?hr.find(x=>x.t>wet.t&&x.rain<25):null;rainTiming.textContent=wet?`Rain signal near ${hourName(wet.t)}${dry?`; easing by ${hourName(dry.t)}`:''}`:'No significant rain signal in next 12h';sun.textContent=`${clock(b0.daily.sunrise?.[0])} / ${clock(b0.daily.sunset?.[0])}`;humidity.textContent=fmt(hum,0)+'%';comfort.textContent=c[0];
  const rows=M.map(m=>{const a=mods.filter(x=>x.m?.[0]===m[0]&&coreNames.has(x.z[0]));if(!a.length)return null;const all=skills[`${loc}:${m[0]}:all`];return{m,val:avg(a.map(x=>x.d.current?.temperature_2m)),n:a.length,sf:skillFactor(m[0],6),mae:all?.mae,count:all?.n||0}}).filter(Boolean);
  modelCount.textContent=`${rows.length} models · ${mods.length} feeds`;const best=[...rows].filter(x=>Number.isFinite(x.mae)&&x.count>=3).sort((a,b)=>a.mae-b.mae)[0],verified=Object.entries(skills).filter(([k])=>k.startsWith(loc+':')&&k.endsWith(':all')).reduce((sum,[k,v])=>sum+(v.n||0),0);
  verifiedCount.textContent=verified;bestSkill.textContent=best?best.m[1]:'learning';uncertainty.textContent='±'+fmt(unc,1)+'°';skillNote.textContent=best?`${best.m[1]} currently has ${fmt(best.mae,1)}° learned MAE from ${best.count} verifications. Weights also adjust by lead time and coastal/onshore regime.`:'Accuracy engine is collecting +3h/+6h/+12h/+24h forecasts. Learned weights activate after 3 verified samples.';
  chips.innerHTML=`<span class="chip">model spread ${fmt(spread,1)}°</span><span class="chip">${official?'ECCC observation correction on':'model-only now'}</span><span class="chip">regime weighting on</span><span class="chip">${loading?'loading more':'loaded'}</span>`;
  models.innerHTML=rows.map(x=>`<div class="card model"><div><b>${x.m[1]}</b><br><small>${x.m[2]} · ${x.n}/${C.core.length} core zones</small><br><small>${x.count>=3?`learned MAE ${fmt(x.mae,1)}° · weight ×${fmt(x.sf,2)}`:'learning skill'}</small></div><div class="val">${fmt(x.val)}°</div></div>`).join('');
  lastUpdated=new Date();updated.textContent=`Updated ${new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Halifax'}).format(lastUpdated)}. HRM headline remains Peninsula + Bedford + Dartmouth.`;
  scoreDueForecasts(official?.temp,air);saveForecastTargets(mods,windDir);
}
async function load(){
  const my=++token,C=L[loc];refresh.disabled=true;refresh.textContent='Updating…';warn.style.display='none';alerts.style.display='none';
  const allZones=[...C.core,...C.micro];
  const [B,O,A]=await Promise.all([Promise.allSettled(allZones.map(baseQ)),ecccObservation(),ecccAlerts()]);
  const base=B.filter(x=>x.status==='fulfilled').map(x=>x.value);if(my!==token)return;
  if(base.length)render(base,[],O,A,true);
  const tasks=[];for(const m of M)for(const z of C.core)tasks.push(modelQ(z,m));
  const R=await Promise.allSettled(tasks),mods=R.filter(x=>x.status==='fulfilled').map(x=>x.value);if(my!==token)return;
  if(base.length)render(base,mods,O,A,false);else{warn.style.display='block';warn.textContent='No live weather feeds responded. Try Refresh.'}
  const failed=C.core.length*M.length-mods.length;if(failed&&base.length){warn.style.display='block';warn.textContent=`${failed} model/location feeds were unavailable; consensus is using the feeds that responded.`}
  refresh.disabled=false;refresh.textContent='Refresh';
}
refresh.onclick=load;nav();load();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&(!lastUpdated||Date.now()-lastUpdated>15*60*1000))load()});
setInterval(()=>{if(lastUpdated)updated.textContent=`Updated ${Math.max(0,Math.round((Date.now()-lastUpdated)/60000))} min ago · ${L[loc].n} · forecast skill continues learning on this phone.`},60000);