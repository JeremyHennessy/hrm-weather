(()=>{
/* Startup/render + bounded weather networking. This file loads before v5b.js. */
function installStableRenderer(){
  if(window.__wxAtomicRenderInstalled)return;
  if(typeof window.render!=='function'){setTimeout(installStableRenderer,0);return}
  window.__wxAtomicRenderInstalled=true;
  const original=window.render;
  let hasComplete=false,initialPartialShown=Boolean(window.__wxStaticStartupShown);
  function patchProbabilities(base){
    if(typeof window.WXCalibratedPop!=='function'||!Array.isArray(base))return;
    for(const x of base){const d=x?.d;if(!d?.hourly?.time)continue;let start=0;try{start=typeof idx==='function'?idx(d):0}catch{}const pops=d.hourly.precipitation_probability;if(Array.isArray(pops))for(let i=start;i<pops.length;i++){const cal=window.WXCalibratedPop(i-start,pops[i]);if(Number.isFinite(cal))pops[i]=cal}const daily=d.daily?.precipitation_probability_max;if(Array.isArray(daily))for(let i=0;i<daily.length;i++){const cal=window.WXCalibratedPop(i===0?12:(i+1)*24,daily[i]);if(Number.isFinite(cal))daily[i]=cal}}
  }
  window.render=function(base,mods,official,alerts,loading){
    if(loading===true){if(hasComplete||initialPartialShown||window.__wxStaticStartupShown)return;initialPartialShown=true;const out=original(base,mods,official,alerts,true);window.__wxInitialForecastShown=true;return out}
    patchProbabilities(base);const out=original(base,mods,official,alerts,false);hasComplete=true;window.__wxHasCompleteForecast=true;return out;
  };
}
installStableRenderer();

const nativeFetch=window.fetch.bind(window);
const state=window.WX_REQUEST_HEALTH={started:0,success:0,failed:0,retries:0,rateLimited:0,cacheHits:0,queued:0,active:0,timeouts:0,serverModelSkips:0,clientModelFallbacks:0};
const cache=new Map(),pending=new Map(),queue=[];const MAX_ACTIVE=4,CACHE_MS=5*60*1000,MIN_GAP_MS=100;let active=0,lastStart=0;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function requestKind(input){try{const h=new URL(typeof input==='string'?input:input.url,location.href).hostname;if(h==='api.open-meteo.com')return'openmeteo';if(h==='api.weather.gc.ca')return'eccc'}catch{}return null}
function isClientModelRequest(input){try{const u=new URL(typeof input==='string'?input:input.url,location.href);return u.hostname==='api.open-meteo.com'&&u.searchParams.has('models')}catch{return false}}
function serverConsensusFresh(){
  let e=window.WXAccuracyV3;
  if(!e)try{e=JSON.parse(localStorage.getItem('wx-engine-v3-startup')||'null')?.engine||null}catch{}
  const t=e?.updated_at?Date.parse(e.updated_at):0;
  return !!t&&Date.now()-t<3*60*60*1000&&Number(e?.collector?.deterministic_forecasts||0)>=20;
}
const snapToResponse=s=>new Response(s.body.slice(0),{status:s.status,statusText:s.statusText,headers:s.headers});async function snapshot(r){return{body:await r.arrayBuffer(),status:r.status,statusText:r.statusText,headers:[...r.headers.entries()]}}
function pump(){while(active<MAX_ACTIVE&&queue.length){const job=queue.shift();state.queued=queue.length;if(job.signal?.aborted){job.cleanup?.();job.reject(new DOMException('Aborted','AbortError'));continue}active++;state.active=active;job.started=true;job.cleanup?.();const wait=Math.max(0,MIN_GAP_MS-(Date.now()-lastStart));sleep(wait).then(()=>{lastStart=Date.now();return job.run()}).then(job.resolve,job.reject).finally(()=>{active--;state.active=active;pump()})}}
function schedule(run,signal){return new Promise((resolve,reject)=>{const job={run,signal,resolve,reject,started:false,cleanup:null};if(signal){const abort=()=>{if(job.started)return;const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);state.queued=queue.length;reject(new DOMException('Aborted','AbortError'))};signal.addEventListener('abort',abort,{once:true});job.cleanup=()=>signal.removeEventListener('abort',abort)}queue.push(job);state.queued=queue.length;pump()})}
async function timedNativeFetch(input,init,timeoutMs){const controller=new AbortController(),upstream=init?.signal,onAbort=()=>controller.abort();if(upstream){if(upstream.aborted)controller.abort();else upstream.addEventListener('abort',onAbort,{once:true})}const timer=setTimeout(()=>{state.timeouts++;controller.abort()},timeoutMs);try{return await nativeFetch(input,{...init,signal:controller.signal,cache:'no-store'})}finally{clearTimeout(timer);if(upstream)upstream.removeEventListener?.('abort',onAbort)}}
async function runRequest(input,init,key,kind){const signal=init?.signal,maxAttempts=1,timeoutMs=kind==='eccc'?4000:7000;for(let attempt=0;attempt<maxAttempts;attempt++){if(signal?.aborted)throw new DOMException('Aborted','AbortError');try{const execute=async()=>{state.started++;const r=await timedNativeFetch(input,init,timeoutMs);if(r.status===429)state.rateLimited++;return snapshot(r)};const snap=kind==='openmeteo'?await schedule(execute,signal):await execute();if(snap.status>=200&&snap.status<300){state.success++;cache.set(key,{at:Date.now(),snap})}else state.failed++;return snap}catch(err){if(signal?.aborted)throw err;state.failed++;throw err}}}
window.fetch=async function(input,init={}){
  const kind=requestKind(input);if(!kind||(init.method||'GET').toUpperCase()!=='GET')return nativeFetch(input,init);
  if(isClientModelRequest(input)&&serverConsensusFresh()){state.serverModelSkips++;return new Response('{"server_consensus":true}',{status:503,headers:{'content-type':'application/json','x-weather-consensus':'server-v3'}})}
  if(isClientModelRequest(input))state.clientModelFallbacks++;
  const key=typeof input==='string'?input:input.url,hit=cache.get(key);if(hit&&Date.now()-hit.at<CACHE_MS){state.cacheHits++;return snapToResponse(hit.snap)}let p=pending.get(key);if(!p){p=runRequest(input,init,key,kind).finally(()=>pending.delete(key));pending.set(key,p)}return snapToResponse(await p)
};
function ensureTomorrowClass(){document.getElementById('tomorrowRoutine')?.classList.add('tomorrowRoutine')}
document.addEventListener('DOMContentLoaded',()=>{ensureTomorrowClass();setInterval(ensureTomorrowClass,3000)});
window.WX_SERVER_CONSENSUS_FRESH=serverConsensusFresh;
})();
