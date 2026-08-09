(()=>{
const nativeFetch=window.fetch.bind(window);
const state=window.WX_REQUEST_HEALTH={started:0,success:0,failed:0,retries:0,rateLimited:0,cacheHits:0,queued:0,active:0};
const cache=new Map(),pending=new Map(),queue=[];
const MAX_ACTIVE=6,CACHE_MS=5*60*1000,MIN_GAP_MS=65;
let active=0,lastStart=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const managed=input=>{try{return new URL(typeof input==='string'?input:input.url,location.href).hostname==='api.open-meteo.com'}catch{return false}};
const snapToResponse=s=>new Response(s.body.slice(0),{status:s.status,statusText:s.statusText,headers:s.headers});
async function snapshot(r){return{body:await r.arrayBuffer(),status:r.status,statusText:r.statusText,headers:[...r.headers.entries()]}}
function pump(){
  while(active<MAX_ACTIVE&&queue.length){
    const job=queue.shift();state.queued=queue.length;
    if(job.signal?.aborted){job.reject(new DOMException('Aborted','AbortError'));continue}
    active++;state.active=active;
    const wait=Math.max(0,MIN_GAP_MS-(Date.now()-lastStart));
    sleep(wait).then(()=>{lastStart=Date.now();return job.run()}).then(job.resolve,job.reject).finally(()=>{active--;state.active=active;pump()});
  }
}
const schedule=(run,signal)=>new Promise((resolve,reject)=>{queue.push({run,signal,resolve,reject});state.queued=queue.length;pump()});
async function request(input,init,key){
  const signal=init?.signal;
  for(let attempt=0;attempt<3;attempt++){
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    const snap=await schedule(async()=>{
      state.started++;
      const r=await nativeFetch(input,{...init,cache:'no-store'});
      if(r.status===429)state.rateLimited++;
      return snapshot(r);
    },signal);
    if(snap.status!==429&&snap.status<500){
      if(snap.status>=200&&snap.status<300){state.success++;cache.set(key,{at:Date.now(),snap})}
      else state.failed++;
      return snap;
    }
    if(attempt<2){state.retries++;await sleep(attempt?1200:450);continue}
    state.failed++;return snap;
  }
}
window.fetch=async function(input,init={}){
  if(!managed(input))return nativeFetch(input,init);
  const method=(init.method||'GET').toUpperCase();
  if(method!=='GET')return nativeFetch(input,init);
  const key=typeof input==='string'?input:input.url;
  const hit=cache.get(key);
  if(hit&&Date.now()-hit.at<CACHE_MS){state.cacheHits++;return snapToResponse(hit.snap)}
  let p=pending.get(key);
  if(!p){p=request(input,init,key).finally(()=>pending.delete(key));pending.set(key,p)}
  return snapToResponse(await p);
};

function expectedFeeds(){
  const active=document.querySelector('.tab.active')?.textContent||'';
  return /HRM Core/i.test(active)?39:13;
}
function applyConfidence(){
  const orb=document.querySelector('.confidenceOrb');if(!orb)return;
  const u=parseFloat((document.querySelector('#uncertainty')?.textContent||'').replace(/[^0-9.]/g,''));
  let base=86;if(Number.isFinite(u))base=u<=.6?95:u<=1?92:u<=1.5?88:u<=2.2?82:74;
  const mc=document.querySelector('#modelCount')?.textContent||'';
  const loaded=Number(mc.match(/·\s*(\d+)\s*feeds/i)?.[1]||0),expected=expectedFeeds();
  const coverage=loaded?Math.min(1,loaded/expected):0;
  const obs=(document.querySelector('#obsline')?.textContent||'').toLowerCase();
  const official=obs&&!obs.includes('unavailable')&&!obs.includes('checking');
  if(!loaded){orb.querySelector('strong').textContent='--%';orb.querySelector('small').textContent='loading data';return}
  const requestPenalty=state.failed?Math.min(5,state.failed):0;
  const score=Math.max(55,Math.min(99,Math.round(base-(1-coverage)*25-(official?0:4)-requestPenalty)));
  orb.querySelector('strong').textContent=score+'%';
  const quality=score>=90?'High':score>=80?'Good':score>=70?'Moderate':'Limited';
  orb.querySelector('span').textContent='Forecast Confidence';
  orb.querySelector('small').textContent=`${quality} · ${loaded}/${expected} feeds${official?' · ECCC':' · model-only'}`;
  orb.dataset.healthAdjusted='true';
}
function ensureTomorrowClass(){const c=document.getElementById('tomorrowRoutine');if(c)c.classList.add('tomorrowRoutine')}
document.addEventListener('DOMContentLoaded',()=>{ensureTomorrowClass();setInterval(()=>{ensureTomorrowClass();applyConfidence()},700)});
})();