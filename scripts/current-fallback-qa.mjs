import { chromium } from 'playwright';

const base=process.env.WX_URL||'http://127.0.0.1:4173/app.html';
const url=`${base}${base.includes('?')?'&':'?'}officialfallback=${Date.now()}`;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
// Reproduce the production failure mode: the provider current/model endpoint is
// unavailable, while same-origin published official observations remain usable.
await page.route('https://api.open-meteo.com/**',route=>route.abort('failed'));
let code=0;
try{
  const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});if(!r?.ok())throw Error(`HTTP ${r?.status()}`);
  await page.waitForFunction(()=>window.__wxFastCurrent?.painted===true&&window.__wxFastCurrent?.location==='hrm',{timeout:7000});
  await page.waitForFunction(()=>document.documentElement.dataset.wxCurrentActual==='live-current-input',{timeout:5000});
  await page.waitForTimeout(500);
  const state=await page.evaluate(()=>({
    loc:localStorage.getItem('wx-loc')||'hrm',place:document.querySelector('#place')?.textContent?.trim()||'',feels:document.querySelector('#feels')?.textContent?.trim()||'',actual:document.querySelector('#actual')?.textContent?.trim()||'',source:window.__wxFastCurrent?.source||'',fast:window.__wxFastCurrent||null,realFeelOwner:document.documentElement.dataset.wxRealFeel||'',actualOwner:document.documentElement.dataset.wxCurrentActual||'',official:document.querySelector('#officialStation')?.textContent?.trim()||'',obsline:document.querySelector('#obsline')?.textContent?.trim()||''
  }));
  if(state.loc!=='hrm'||!/Halifax|Bedford|Dartmouth/i.test(state.place))throw Error(`HRM primary/default regressed: ${JSON.stringify(state)}`);
  if(state.source!=='official-observation-steadman-current')throw Error(`official fallback did not own current: ${JSON.stringify(state.fast)}`);
  if(state.realFeelOwner!=='live-current-official-observation-fallback')throw Error(`wrong fallback Real Feel owner: ${state.realFeelOwner}`);
  if(state.actualOwner!=='live-current-input')throw Error(`wrong fallback Actual owner: ${state.actualOwner}`);
  if(state.feels.includes('--')||state.actual.includes('--'))throw Error(`official fallback did not paint hero: ${state.feels} / ${state.actual}`);
  if(!/ECCC/i.test(state.official+state.obsline))throw Error(`official fallback provenance not visible: ${state.official} / ${state.obsline}`);
  const stamp=Date.parse(state.fast?.official_time||'');if(!Number.isFinite(stamp)||Date.now()-stamp>2*60*60*1000)throw Error(`fallback observation is not fresh: ${state.fast?.official_time}`);
  if(errors.length)throw Error(`page errors: ${errors.join(' | ')}`);
  console.log('Official current fallback QA passed',state);
}catch(e){code=1;console.error(e?.stack||String(e))}finally{await browser.close().catch(()=>{});process.exit(code)}
