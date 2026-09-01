/* Halifax cloud/sun condition owner.
   Temperature, Real Feel, precipitation and hazardous-weather types are untouched.
   Dry-sky icons use the Engine 3 family-aware cloud consensus already published
   by the hourly collector. This layer deliberately makes no weather API calls. */
(()=>{
  if(window.__wxCloudSkyInstalled)return;window.__wxCloudSkyInstalled=true;
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const dryKinds=new Set(['sun','partly','cloud']);
  const wetKindIcon={rain:'🌧️',storm:'⛈️',snow:'🌨️',fog:'🌫️'};
  const classify=c=>{c=Number(c);if(!Number.isFinite(c))return null;if(c<=18)return'sunny';if(c<=42)return'mostly-sunny';if(c<=68)return'partly-cloudy';if(c<=88)return'mostly-cloudy';return'cloudy'};
  const iconFor=c=>{const s=classify(c);return s==='sunny'?'☀️':s==='mostly-sunny'?'🌤️':s==='partly-cloudy'?'⛅️':'☁️'};
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
  function clearCloud(el){if(!el)return;delete el.dataset.cloudSky;delete el.dataset.cloudCover}
  function rawIcon(el){return `${el?.dataset?.wxRaw||''} ${el?.textContent||''}`}
  function isDryIcon(el){const raw=rawIcon(el);if(/[⛈🌧🌦🌨❄🌫]/u.test(raw))return false;return /[☀🌤⛅🌥☁]/u.test(raw)||Boolean(el?.dataset?.cloudSky)}
  function setIcon(el,cloud,label){
    if(!el||!finite(cloud))return false;
    const sky=classify(cloud),rounded=Math.round(Number(cloud)),expected=iconFor(cloud),aria=`${label||'Sky'}: ${sky?.replace('-',' ')||'mixed'}, ${rounded}% cloud`;
    const already=el.dataset.cloudSky===sky&&Number(el.dataset.cloudCover)===rounded&&(el.dataset.wxRaw===expected||el.textContent.includes(expected));
    if(!already){el.textContent=expected;el.dataset.wxRaw=expected;el.dataset.cloudSky=sky||'';el.dataset.cloudCover=rounded}
    if(el.getAttribute('aria-label')!==aria)el.setAttribute('aria-label',aria);
    return true;
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
      if(setIcon(icon,cloud,`Daytime sky for ${card.querySelector('.v11DayName')?.textContent?.trim()||`day ${i+1}`}`))card.dataset.cloudConsensus=String(Math.round(cloud));
    });
  }
  function apply(){
    if(loc()!=='hrm'){delete document.documentElement.dataset.wxCloudSky;return false}
    const hero=document.querySelector('#heroIcon'),heroEl=document.querySelector('.hero'),kind=heroEl?.dataset?.condition||'';
    if(dryKinds.has(kind)){
      const cloud=engineCloud(1);
      if(setIcon(hero,cloud,'Current sky')&&heroEl){heroEl.dataset.condition=heroCondition(cloud);heroEl.dataset.cloudSky='engine3-family-cloud-consensus';heroEl.dataset.cloudCover=Math.round(Number(cloud))}
    }else relinquishHero(heroEl,hero);

    const cards=[...document.querySelectorAll('#hours .hour')].slice(0,12);
    cards.forEach((card,j)=>{const icon=card.querySelector('.wx');if(!isDryIcon(icon)){clearCloud(icon);delete card.dataset.cloudConsensus;return}const lead=Math.max(1,j),cloud=engineCloud(lead);if(setIcon(icon,cloud,`Sky at ${card.querySelector('small')?.textContent?.trim()||`+${lead}h`}`))card.dataset.cloudConsensus=String(Math.round(cloud))});
    applyDays();document.documentElement.dataset.wxCloudSky='halifax-family-cloud-consensus';return true;
  }
  function start(){
    apply();window.addEventListener('wx-v3-ready',()=>setTimeout(apply,80));window.addEventListener('wx-daily-detail-data',()=>setTimeout(applyDays,40));
    document.querySelector('#tabs')?.addEventListener('click',()=>setTimeout(apply,100));
    const hours=document.querySelector('#hours');if(hours)new MutationObserver(()=>queueMicrotask(apply)).observe(hours,{childList:true,subtree:true});
    const days=document.querySelector('#days');if(days)new MutationObserver(()=>queueMicrotask(applyDays)).observe(days,{childList:true,subtree:true});
    setInterval(apply,30000);
  }
  window.WXCloudSky={classify,iconFor,engineCloud,apply,applyDays};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
