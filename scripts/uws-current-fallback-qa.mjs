import { chromium } from 'playwright';

const base=process.env.WX_URL||'http://127.0.0.1:4173/app.html';
const url=`${base}${base.includes('?')?'&':'?'}uwsstoredfallback=${Date.now()}`;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.route('https://api.open-meteo.com/**',route=>route.abort('failed'));
await page.route('https://api.weather.gov/**',route=>route.abort('failed'));
let code=0;
const number=text=>Number(String(text||'').match(/-?\d+(?:\.\d+)?/)?.[0]);
try{
  const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});if(!r?.ok())throw Error(`HTTP ${r?.status()}`);
  await page.waitForFunction(()=>[...document.querySelectorAll('#tabs .tab')].some(x=>/Upper West Side/i.test(x.textContent||'')),{timeout:8000});
  await page.evaluate(()=>[...document.querySelectorAll('#tabs .tab')].find(x=>/Upper West Side/i.test(x.textContent||''))?.click());
  await page.waitForFunction(()=>window.__wxFastCurrent?.painted===true&&window.__wxFastCurrent?.location==='uws'&&window.__wxFastCurrent?.source==='nws-stored-observation-steadman-current',{timeout:9000});
  await page.waitForFunction(()=>document.documentElement.dataset.wxCurrentActual==='live-current-input',{timeout:3000});
  await page.waitForTimeout(500);
  const state=await page.evaluate(async()=>{
    const skill=await fetch(`./data/skill.json?qa=${Date.now()}`,{cache:'no-store'}).then(r=>r.json());
    return{loc:localStorage.getItem('wx-loc'),place:document.querySelector('#place')?.textContent?.trim()||'',feels:document.querySelector('#feels')?.textContent?.trim()||'',actual:document.querySelector('#actual')?.textContent?.trim()||'',source:window.__wxFastCurrent?.source||'',fast:window.__wxFastCurrent||null,realFeelOwner:document.documentElement.dataset.wxRealFeel||'',actualOwner:document.documentElement.dataset.wxCurrentActual||'',official:document.querySelector('#officialStation')?.textContent?.trim()||'',officialHead:[...document.querySelectorAll('.section')].find(x=>x.querySelector('h2')?.textContent==='Official data')?.querySelector('.head span')?.textContent?.trim()||'',obs:skill?.observations?.uws||null};
  });
  if(state.loc!=='uws'||!/Upper West Side|Manhattan/i.test(state.place))throw Error(`UWS selection failed: ${JSON.stringify(state)}`);
  if(state.source!=='nws-stored-observation-steadman-current')throw Error(`stored NWS fallback did not own current: ${JSON.stringify(state.fast)}`);
  if(state.realFeelOwner!=='live-current-nws-apparent-fallback')throw Error(`wrong stored NWS Real Feel owner: ${state.realFeelOwner}`);
  if(state.actualOwner!=='live-current-input')throw Error(`wrong stored NWS Actual owner: ${state.actualOwner}`);
  if(state.feels.includes('--')||state.actual.includes('--'))throw Error(`stored NWS fallback did not paint hero: ${state.feels} / ${state.actual}`);
  if(state.officialHead!=='National Weather Service'||!/NWS/i.test(state.official))throw Error(`stored NWS provenance not visible: ${state.officialHead} / ${state.official}`);
  if(!state.obs||state.obs.provider!=='NWS'||state.obs.official_station!=='KNYC')throw Error(`stored NWS source contract invalid: ${JSON.stringify(state.obs)}`);
  const stamp=Date.parse(state.obs.time||'');if(!Number.isFinite(stamp)||Date.now()-stamp>2*60*60*1000)throw Error(`stored NWS observation is not fresh: ${state.obs.time}`);
  const shownFeel=number(state.feels),shownAir=number(state.actual);if(!Number.isFinite(shownFeel)||!Number.isFinite(shownAir))throw Error('stored NWS hero values not numeric');
  if(Math.abs(shownFeel-state.fast.feel)>0.6||Math.abs(shownAir-state.fast.air)>0.6)throw Error(`stored NWS hero drifted from current truth: ${shownFeel}/${shownAir} vs ${state.fast.feel}/${state.fast.air}`);
  if(errors.length)throw Error(`page errors: ${errors.join(' | ')}`);
  console.log('UWS stored NWS current fallback QA passed',state);
}catch(e){code=1;console.error(e?.stack||String(e))}finally{await browser.close().catch(()=>{});process.exit(code)}
