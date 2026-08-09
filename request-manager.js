document.write('<script src="./startup-fallback.js?v=2" data-wx-static-startup="1"><\/script>');
(()=>{
/* Startup/render + bounded weather networking. This file loads before v5b.js. */
function installStableRenderer(){
  if(window.__wxAtomicRenderInstalled)return;
  if(typeof window.render!=='function'){setTimeout(installStableRenderer,0);return}
  window.__wxAtomicRenderInstalled=true;
  const original=window.render;
  let hasComplete=false,initialPartialShown=false;
  function patchProbabilities(base){
    if(typeof window.WXCalibratedPop!=='function'||!Array.isArray(base))return;
    for(const x of base){
      const d=x?.d;if(!d?.hourly?.time)continue;
      let start=0;try{start=typeof idx==='function'?idx(d):0}catch{}
      const pops=d.hourly.precipitation_probability;
      if(Array.isArray(pops))for(let i=start;i<pops.length;i++){
        const cal=window.WXCalibratedPop(i-start,pops[i]);if(Number.isFinite(cal))pops[i]=cal;
      }
      const daily=d.daily?.precipitation_probability_max;
      if(Array.isArray(daily))for(let i=0;i<daily.length;i++){
        const cal=window.WXCalibratedPop(i===0?12:(i+1)*24,daily[i]);if(Number.isFinite(cal))daily[i]=cal;
      }
    }
  }
  window.render=function(base,mods,official,alerts,loading){
    if(loading===true){
      if(hasComplete||initialPartialShown)return;
      initialPartialShown=true;
      const out=original(base,mods,official,alerts,true);
      window.__wxInitialForecastShown=true;
      return out;
    }
    patchProbabilities(base);
    const out=original(base,mods,official,alerts,false);
    hasComplete=true;window.__wxHasCompleteForecast=true;
    return out;
  };
}
installStableRenderer();

const nativeFetch=window.fetch.bind(window);
const state=window.WX_REQUEST_HEALTH={started:0,success:0,failed:0,retries:0,rateLimited:0,cacheHits:0,queued:0,active:0,timeouts:0};
const cache=new Map(),pending=new Map(),queue=[];
const MAX_ACTIVE=6,CACHE_MS=5*60*1000,MIN_GAP_MS=65;
let active=0,lastStart=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function requestKind(input){
  try{
    const h=new URL(typeof input==='string'?input:input.url,location.href).hostname;
    if(h==='api.open-meteo.com')return'openmeteo';
    if(h==='api.weather.gc.ca')return'eccc';
  }catch{}
  return null;
}
const snapToResponse=s=>new Response(s.body.slice(0),{status:s.status,statusText:s.statusText,headers:s.headers});
async function snapshot(r){return{body:await r.arrayBuffer(),status:r.status,statusText:r.statusText,headers:[...r.headers.entries()]}}
function pump(){
  while(active<MAX_ACTIVE&&queue.length){
    const job=queue.shift();state.queued=queue.length;
    if(job.signal?.aborted){job.cleanup?.();job.reject(new DOMException('Aborted','AbortError'));continue}
    active++;state.active=active;job.started=true;job.cleanup?.();
    const wait=Math.max(0,MIN_GAP_MS-(Date.now()-lastStart));
    sleep(wait).then(()=>{lastStart=Date.now();return job.run()}).then(job.resolve,job.reject).finally(()=>{active--;state.active=active;pump()});
  }
}
function schedule(run,signal){
  return new Promise((resolve,reject)=>{
    const job={run,signal,resolve,reject,started:false,cleanup:null};
    if(signal){
      const abort=()=>{
        if(job.started)return;
        const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);
        state.queued=queue.length;reject(new DOMException('Aborted','AbortError'));
      };
      signal.addEventListener('abort',abort,{once:true});job.cleanup=()=>signal.removeEventListener('abort',abort);
    }
    queue.push(job);state.queued=queue.length;pump();
  });
}
async function timedNativeFetch(input,init,timeoutMs){
  const controller=new AbortController(),upstream=init?.signal;
  const onAbort=()=>controller.abort();
  if(upstream){if(upstream.aborted)controller.abort();else upstream.addEventListener('abort',onAbort,{once:true})}
  const timer=setTimeout(()=>{state.timeouts++;controller.abort()},timeoutMs);
  try{return await nativeFetch(input,{...init,signal:controller.signal,cache:'no-store'})}
  finally{clearTimeout(timer);if(upstream)upstream.removeEventListener?.('abort',onAbort)}
}
async function runRequest(input,init,key,kind){
  const signal=init?.signal,maxAttempts=kind==='eccc'?1:2,timeoutMs=kind==='eccc'?4000:10000;
  for(let attempt=0;attempt<maxAttempts;attempt++){
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    try{
      const execute=async()=>{state.started++;const r=await timedNativeFetch(input,init,timeoutMs);if(r.status===429)state.rateLimited++;return snapshot(r)};
      const snap=kind==='openmeteo'?await schedule(execute,signal):await execute();
      if(snap.status!==429&&snap.status<500){
        if(snap.status>=200&&snap.status<300){state.success++;cache.set(key,{at:Date.now(),snap})}else state.failed++;
        return snap;
      }
      if(attempt+1<maxAttempts){state.retries++;await sleep(450);continue}
      state.failed++;return snap;
    }catch(err){
      if(signal?.aborted)throw err;
      if(attempt+1<maxAttempts){state.retries++;await sleep(450);continue}
      state.failed++;throw err;
    }
  }
}
window.fetch=async function(input,init={}){
  const kind=requestKind(input);
  if(!kind||(init.method||'GET').toUpperCase()!=='GET')return nativeFetch(input,init);
  const key=typeof input==='string'?input:input.url,hit=cache.get(key);
  if(hit&&Date.now()-hit.at<CACHE_MS){state.cacheHits++;return snapToResponse(hit.snap)}
  let p=pending.get(key);
  if(!p){p=runRequest(input,init,key,kind).finally(()=>pending.delete(key));pending.set(key,p)}
  return snapToResponse(await p);
};

function expectedFeeds(){const t=document.querySelector('.tab.active')?.textContent||'';return/HRM Core/i.test(t)?39:13}
function applyConfidence(){
  const orb=document.querySelector('.confidenceOrb');if(!orb)return;
  const strong=orb.querySelector('strong'),small=orb.querySelector('small'),span=orb.querySelector('span');if(!strong||!small||!span)return;
  const u=parseFloat((document.querySelector('#uncertainty')?.textContent||'').replace(/[^0-9.]/g,''));
  let base=86;if(Number.isFinite(u))base=u<=.6?95:u<=1?92:u<=1.5?88:u<=2.2?82:74;
  const mc=document.querySelector('#modelCount')?.textContent||'',loaded=Number(mc.match(/·\s*(\d+)\s*feeds/i)?.[1]||0),expected=expectedFeeds();
  const obs=(document.querySelector('#obsline')?.textContent||'').toLowerCase(),official=obs&&!obs.includes('unavailable')&&!obs.includes('checking');
  if(!loaded){strong.textContent='--%';small.textContent=window.__wxInitialForecastShown?'building consensus':'loading data';return}
  const score=Math.max(55,Math.min(99,Math.round(base-(1-Math.min(1,loaded/expected))*25-(official?0:4)-Math.min(5,state.failed))));
  strong.textContent=score+'%';span.textContent='Forecast Confidence';small.textContent=`${score>=90?'High':score>=80?'Good':score>=70?'Moderate':'Limited'} · ${loaded}/${expected} feeds${official?' · ECCC':' · model-only'}`;
  orb.dataset.healthAdjusted='true';
}
function ensureTomorrowClass(){document.getElementById('tomorrowRoutine')?.classList.add('tomorrowRoutine')}
document.addEventListener('DOMContentLoaded',()=>{ensureTomorrowClass();setInterval(()=>{ensureTomorrowClass();applyConfidence()},700)});
})();
