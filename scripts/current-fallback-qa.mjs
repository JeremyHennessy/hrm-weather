import { chromium } from 'playwright';

const base=process.env.WX_URL||'http://127.0.0.1:4173/app.html';
const url=`${base}${base.includes('?')?'&':'?'}officialfallback=${Date.now()}`;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
const errors=[],responses=[],requestFailures=[],forcedProviderFailures=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(/(?:app\.html|startup-fallback\.js|data\/skill\.json|data\/engine-v3\.json)(?:\?|$)/.test(r.url()))responses.push({url:r.url(),status:r.status()})});
page.on('requestfailed',r=>{
  const entry={url:r.url(),error:r.failure()?.errorText||'request failed'};
  if(r.url().startsWith('https://api.open-meteo.com/'))forcedProviderFailures.push(entry);
  else if(/(?:app\.html|startup-fallback\.js|data\/skill\.json|data\/engine-v3\.json)(?:\?|$)/.test(r.url()))requestFailures.push(entry);
});
// Reproduce the production failure mode: the provider current/model endpoint is
// unavailable, while same-origin published official observations remain usable.
await page.route('https://api.open-meteo.com/**',route=>route.abort('failed'));
let code=0;
async function diagnostic(){
  return page.evaluate(()=>({
    readyState:document.readyState,
    loc:localStorage.getItem('wx-loc')||'hrm',
    place:document.querySelector('#place')?.textContent?.trim()||'',
    feels:document.querySelector('#feels')?.textContent?.trim()||'',
    actual:document.querySelector('#actual')?.textContent?.trim()||'',
    fast:window.__wxFastCurrent||null,
    refreshFastType:typeof window.WXRefreshFastCurrent,
    realFeelOwner:document.documentElement.dataset.wxRealFeel||'',
    actualOwner:document.documentElement.dataset.wxCurrentActual||'',
    official:document.querySelector('#officialStation')?.textContent?.trim()||'',
    obsline:document.querySelector('#obsline')?.textContent?.trim()||'',
    resources:performance.getEntriesByType('resource').map(x=>x.name).filter(x=>/(?:startup-fallback\.js|data\/skill\.json|data\/engine-v3\.json)(?:\?|$)/.test(x))
  }));
}
try{
  const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});if(!r?.ok())throw Error(`HTTP ${r?.status()}`);
  const painted=await page.waitForFunction(()=>window.__wxFastCurrent?.painted===true&&window.__wxFastCurrent?.location==='hrm',null,{timeout:8000}).then(()=>true).catch(()=>false);
  const pre=await diagnostic();
  if(!painted)throw Error(`official fallback did not become ready: ${JSON.stringify({pre,responses,requestFailures,forcedProviderFailures})}`);
  await page.waitForFunction(()=>document.documentElement.dataset.wxCurrentActual==='live-current-input',null,{timeout:5000});
  await page.waitForTimeout(500);
  const state=await diagnostic();
  if(state.loc!=='hrm'||!/Halifax|Bedford|Dartmouth/i.test(state.place))throw Error(`HRM primary/default regressed: ${JSON.stringify(state)}`);
  if(state.fast?.source!=='official-observation-steadman-current')throw Error(`official fallback did not own current: ${JSON.stringify(state.fast)}`);
  if(state.realFeelOwner!=='live-current-official-observation-fallback')throw Error(`wrong fallback Real Feel owner: ${state.realFeelOwner}`);
  if(state.actualOwner!=='live-current-input')throw Error(`wrong fallback Actual owner: ${state.actualOwner}`);
  if(state.feels.includes('--')||state.actual.includes('--'))throw Error(`official fallback did not paint hero: ${state.feels} / ${state.actual}`);
  if(!/ECCC/i.test(state.official+state.obsline))throw Error(`official fallback provenance not visible: ${state.official} / ${state.obsline}`);
  const stamp=Date.parse(state.fast?.official_time||'');if(!Number.isFinite(stamp)||Date.now()-stamp>2*60*60*1000)throw Error(`fallback observation is not fresh: ${state.fast?.official_time}`);
  if(requestFailures.length)throw Error(`same-origin fallback requests failed: ${JSON.stringify(requestFailures)}`);
  if(errors.length)throw Error(`page errors: ${errors.join(' | ')}`);
  console.log('Official current fallback QA passed',{state,responses,forcedProviderFailures});
}catch(e){code=1;console.error(JSON.stringify({ok:false,error:String(e?.stack||e),diagnostic:await diagnostic().catch(()=>null),responses,requestFailures,forcedProviderFailures,pageErrors:errors},null,2))}finally{await browser.close().catch(()=>{});process.exit(code)}
