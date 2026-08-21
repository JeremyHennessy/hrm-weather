/* Halifax cloud/sun condition owner.
   Temperature, Real Feel, precipitation and hazardous-weather types are untouched.
   Dry-sky icons use Engine 3 family-aware cloud consensus blended with a fresh
   high-frequency cloud-only forecast across Halifax Peninsula/Bedford/Dartmouth. */
(()=>{
  if(window.__wxCloudSkyInstalled)return;window.__wxCloudSkyInstalled=true;
  const POINTS=[['Halifax Peninsula',44.6488,-63.5752],['Bedford',44.7318,-63.6619],['Dartmouth',44.6661,-63.5676]];
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const avg=a=>{const v=a.filter(finite).map(Number);return v.length?v.reduce((x,y)=>x+y,0)/v.length:null};
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const dryCode=c=>[0,1,2,3].includes(Number(c));
  const classify=c=>{c=Number(c);if(!Number.isFinite(c))return null;if(c<=18)return'sunny';if(c<=42)return'mostly-sunny';if(c<=68)return'partly-cloudy';if(c<=88)return'mostly-cloudy';return'cloudy'};
  const iconFor=c=>{const s=classify(c);return s==='sunny'?'☀️':s==='mostly-sunny'?'🌤️':s==='partly-cloudy'?'⛅️':'☁️'};
  const heroCondition=c=>{const s=classify(c);return s==='sunny'||s==='mostly-sunny'?'sun':s==='partly-cloudy'?'partly':'cloud'};
  const loc=()=>{try{return localStorage.getItem('wx-loc')||'hrm'}catch{return'hrm'}};
  const engine=()=>window.WXAccuracyV3||(()=>{try{return JSON.parse(localStorage.getItem('wx-engine-v3-startup')||'null')?.engine||null}catch{return null}})();
  const localHourKey=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Halifax',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false}).format(new Date()).replace(' ','T').slice(0,13);
  let snapshot=null,pending=null,lastFetch=0;

  function enginePoints(){
    const hours=engine()?.consensus?.hrm?.hours||{};return Object.entries(hours).map(([lead,h])=>({lead:Number(lead),cloud:finite(h?.cloud_cover)?Number(h.cloud_cover):finite(h?.cloud_consensus?.cloud_cover)?Number(h.cloud_consensus.cloud_cover):null,families:Number(h?.cloud_independent_families||h?.cloud_consensus?.independent_families||0)})).filter(x=>Number.isFinite(x.lead)&&finite(x.cloud)).sort((a,b)=>a.lead-b.lead);
  }
  function engineCloud(lead){
    const pts=enginePoints();if(!pts.length)return null;if(lead<=pts[0].lead)return pts[0].cloud;if(lead>=pts[pts.length-1].lead)return pts[pts.length-1].cloud;
    for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];if(lead<=b.lead){const f=(lead-a.lead)/(b.lead-a.lead);return a.cloud+(b.cloud-a.cloud)*f}}
    return null;
  }
  async function fetchPoint([name,lat,lon]){
    const p=new URLSearchParams({latitude:String(lat),longitude:String(lon),timezone:'America/Halifax',forecast_days:'7',current:'cloud_cover,weather_code',hourly:'cloud_cover,weather_code'}),ctrl=new AbortController(),tm=setTimeout(()=>ctrl.abort(),7000);
    try{const r=await fetch(`https://api.open-meteo.com/v1/forecast?${p}`,{cache:'no-store',signal:ctrl.signal});if(!r.ok)throw Error(r.status);return{name,data:await r.json()}}finally{clearTimeout(tm)}
  }
  async function refreshData(force=false){
    if(loc()!=='hrm')return null;if(!force&&snapshot&&Date.now()-lastFetch<8*60*1000)return snapshot;if(pending)return pending;
    pending=Promise.allSettled(POINTS.map(fetchPoint)).then(settled=>{
      const rows=settled.filter(x=>x.status==='fulfilled'&&x.value?.data?.hourly?.time?.length).map(x=>x.value);if(!rows.length)throw Error('cloud-only forecast unavailable');
      const times=rows[0].data.hourly.time||[],currentCloud=avg(rows.map(x=>x.data.current?.cloud_cover)),currentCode=rows.map(x=>x.data.current?.weather_code).find(dryCode)??rows[0].data.current?.weather_code;
      const hourly=times.map((time,i)=>({time,cloud:avg(rows.map(x=>x.data.hourly?.cloud_cover?.[i])),codes:rows.map(x=>x.data.hourly?.weather_code?.[i]).filter(finite).map(Number)}));
      snapshot={currentCloud,currentCode,hourly,points:rows.length,updatedAt:Date.now()};lastFetch=Date.now();return snapshot;
    }).finally(()=>pending=null);return pending;
  }
  function blended(baseCloud,lead){
    const ec=engineCloud(lead);if(!finite(ec))return finite(baseCloud)?Number(baseCloud):null;if(!finite(baseCloud))return Number(ec);
    // Engine family consensus dominates from +1h onward; base cloud provides the
    // hourly timing resolution absent from the sparse Engine 3 lead grid.
    const ew=lead<=12?.72:.62;return clamp(Number(ec)*ew+Number(baseCloud)*(1-ew),0,100);
  }
  function setIcon(el,cloud,code,label){
    if(!el||!finite(cloud)||!dryCode(code))return false;const sky=classify(cloud);el.textContent=iconFor(cloud);el.dataset.cloudSky=sky||'';el.dataset.cloudCover=Math.round(Number(cloud));el.setAttribute('aria-label',`${label||'Sky'}: ${sky?.replace('-',' ')||'mixed'}, ${Math.round(Number(cloud))}% cloud`);return true;
  }
  function apply(s=snapshot){
    if(loc()!=='hrm'||!s)return false;const nowKey=localHourKey(),start=s.hourly.findIndex(x=>String(x.time).slice(0,13)>=nowKey),i0=start<0?0:start;
    const hero=document.querySelector('#heroIcon'),heroCloud=s.currentCloud;
    if(setIcon(hero,heroCloud,s.currentCode,'Current sky')){const h=document.querySelector('.hero');if(h){h.dataset.condition=heroCondition(heroCloud);h.dataset.cloudSky='family-aware-plus-hourly';h.dataset.cloudCover=Math.round(Number(heroCloud))}}
    const cards=[...document.querySelectorAll('#hours .hour')].slice(0,12);cards.forEach((card,j)=>{const row=s.hourly[i0+j];if(!row)return;const code=row.codes.find(c=>!dryCode(c))??row.codes[0];const cloud=blended(row.cloud,j);setIcon(card.querySelector('.wx'),cloud,code,`Sky at ${card.querySelector('small')?.textContent?.trim()||row.time}`);card.dataset.cloudConsensus=finite(cloud)?String(Math.round(cloud)):''});
    document.documentElement.dataset.wxCloudSky='halifax-family-cloud-consensus';return true;
  }
  async function refresh(force=false){try{const s=await refreshData(force);return apply(s)}catch(e){console.warn('Halifax cloud consensus unavailable',e);return false}}
  function start(){refresh();window.addEventListener('wx-v3-ready',()=>setTimeout(()=>refresh(true),80));window.addEventListener('wx-daily-detail-data',()=>setTimeout(()=>apply(),40));document.querySelector('#tabs')?.addEventListener('click',()=>setTimeout(()=>{if(loc()==='hrm')refresh(true)},100));const hours=document.querySelector('#hours');if(hours)new MutationObserver(()=>queueMicrotask(()=>apply())).observe(hours,{childList:true,subtree:true});setInterval(()=>{if(loc()==='hrm')refresh(true)},10*60*1000)}
  window.WXCloudSky={classify,iconFor,engineCloud,blended,refresh,apply,getSnapshot:()=>snapshot};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
