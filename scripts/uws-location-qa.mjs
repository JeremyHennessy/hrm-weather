import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const url=`${base}${base.includes('?')?'&':'?'}uwsqa=${Date.now()}`;
await fs.mkdir('screenshots',{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('pageerror',e=>errors.push(String(e)));
let code=0;
const num=t=>{const m=String(t||'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null};
async function diagnostic(){try{return await page.evaluate(()=>({loc:localStorage.getItem('wx-loc'),pending:sessionStorage.getItem('wx-pending-loc'),active:document.querySelector('#tabs .tab.active')?.dataset?.k||'',place:document.querySelector('#place')?.textContent?.trim()||'',feels:document.querySelector('#feels')?.textContent?.trim()||'',currentSource:document.querySelector('#feels')?.dataset?.currentSource||'',realFeelOwner:document.documentElement.dataset.wxRealFeel||'',fast:window.__wxFastCurrent||null,uwsQuick:window.__wxUwsQuick||null,refreshFastType:typeof window.WXRefreshFastCurrent,refreshUwsType:typeof window.WXRefreshUWSCurrent,zones:[...document.querySelectorAll('#zones .card small')].map(x=>x.textContent.trim()),requestHealth:window.WX_REQUEST_HEALTH||null}))}catch{return null}}
async function waitUws(){
  await page.waitForFunction(()=>localStorage.getItem('wx-loc')==='uws',{timeout:8000});
  await page.waitForFunction(()=>/Upper West Side|Manhattan/i.test(document.querySelector('#place')?.textContent||''),{timeout:15000});
  await page.waitForFunction(()=>{const t=document.querySelector('#feels')?.textContent||'';return t&&!t.includes('--')},{timeout:15000});
  await page.waitForFunction(()=>document.querySelectorAll('#zones .card').length>=3,{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('.hero')?.dataset?.location==='Upper West Side',{timeout:8000});
  await page.waitForTimeout(1000);
}
try{
  const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});if(!r?.ok())throw Error(`HTTP ${r?.status()}`);
  // Clean browser sessions must remain Halifax/HRM-first. UWS is additive.
  await page.waitForFunction(()=>document.querySelector('#tabs .tab.active')?.dataset?.k==='hrm',{timeout:8000});
  const defaultState=await page.evaluate(()=>({active:document.querySelector('#tabs .tab.active')?.dataset?.k||'',place:document.querySelector('#place')?.textContent?.trim()||'',firstTab:document.querySelector('#tabs .tab')?.dataset?.k||''}));
  if(defaultState.active!=='hrm'||defaultState.firstTab!=='hrm'||!/Halifax|Bedford|Dartmouth/i.test(defaultState.place))throw Error(`HRM primary/default regressed: ${JSON.stringify(defaultState)}`);
  await page.waitForFunction(()=>[...document.querySelectorAll('#tabs .tab')].some(x=>/Upper West Side/i.test(x.textContent||'')),{timeout:8000});
  await page.evaluate(()=>{const b=[...document.querySelectorAll('#tabs .tab')].find(x=>/Upper West Side/i.test(x.textContent||''));b?.click()});
  await waitUws();
  // A location is not production-ready if it works only after clicking it.
  await page.reload({waitUntil:'domcontentloaded',timeout:20000});
  await waitUws();
  const state=await page.evaluate(()=>({
    loc:localStorage.getItem('wx-loc'),pending:sessionStorage.getItem('wx-pending-loc'),place:document.querySelector('#place')?.textContent?.trim()||'',brand:document.querySelector('.brand h1')?.textContent?.trim()||'',feels:document.querySelector('#feels')?.textContent?.trim()||'',actual:document.querySelector('#actual')?.textContent?.trim()||'',
    timezone:typeof window.WX_LOCATION_TIMEZONE==='function'?window.WX_LOCATION_TIMEZONE():'',zones:[...document.querySelectorAll('#zones .card small')].map(x=>x.textContent.trim()),official:document.querySelector('#officialStation')?.textContent?.trim()||'',officialHead:[...document.querySelectorAll('.section')].find(x=>x.querySelector('h2')?.textContent==='Official data')?.querySelector('.head span')?.textContent?.trim()||'',zoneTitle:document.querySelector('#zoneTitle')?.textContent?.trim()||'',microDisplay:getComputedStyle(document.querySelector('#microSection')).display,heroLocation:document.querySelector('.hero')?.dataset?.location||'',daypart:document.querySelector('.hero')?.dataset?.daypart||'',sceneSource:document.querySelector('.hero')?.dataset?.sceneSource||'',fast:window.__wxFastCurrent||null,uwsQuick:window.__wxUwsQuick||null,scrollWidth:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),innerWidth:innerWidth
  }));
  if(state.loc!=='uws'||state.pending)throw Error(`location persistence failed: loc=${state.loc} pending=${state.pending}`);
  if(!/Upper West Side|Manhattan/i.test(state.place))throw Error(`wrong place label: ${state.place}`);
  if(state.brand!=='Upper West Side, NY')throw Error(`wrong UWS header: ${state.brand}`);
  if(state.timezone!=='America/New_York')throw Error(`wrong timezone: ${state.timezone}`);
  if(!['dawn','day','dusk','night'].includes(state.daypart))throw Error(`wrong UWS daypart: ${state.daypart}`);
  if(state.zones.length<3||!state.zones.some(x=>/UWS Central/i.test(x)))throw Error(`UWS three-point core missing: ${state.zones.join(',')}`);
  if(state.zoneTitle!=='Across the Upper West Side')throw Error(`UWS zone title regressed: ${state.zoneTitle}`);
  if(state.microDisplay!=='none')throw Error(`HRM microclimates remain visible in UWS: ${state.microDisplay}`);
  if(state.officialHead!=='National Weather Service')throw Error(`UWS official source header regressed: ${state.officialHead}`);
  if(state.heroLocation!=='Upper West Side')throw Error(`hero location not UWS: ${state.heroLocation}`);
  if(state.sceneSource!=='wikimedia-commons')throw Error(`UWS scene source wrong: ${state.sceneSource}`);
  if(state.fast?.painted&&state.fast?.location!=='uws')throw Error(`fast current painted wrong location: ${JSON.stringify(state.fast)}`);
  const heroFeel=num(state.feels),heroAir=num(state.actual);if(state.fast?.painted&&Number.isFinite(state.fast.feel)&&Number.isFinite(heroFeel)&&Math.abs(heroFeel-state.fast.feel)>8)throw Error(`UWS Real Feel diverged from current truth: hero=${heroFeel} fast=${state.fast.feel}`);if(state.fast?.painted&&Number.isFinite(state.fast.air)&&Number.isFinite(heroAir)&&Math.abs(heroAir-state.fast.air)>8)throw Error(`UWS Actual diverged from current truth: hero=${heroAir} fast=${state.fast.air}`);
  if(state.scrollWidth>state.innerWidth+2)throw Error(`horizontal overflow ${state.scrollWidth}>${state.innerWidth}`);
  if(/KNYC|NWS/i.test(state.official)&&/Environment Canada/i.test(state.officialHead))throw Error(`UWS NWS observation still labelled Environment Canada: ${state.officialHead}`);
  if(errors.length)throw Error(`console errors: ${errors.join(' | ')}`);
  await page.screenshot({path:'screenshots/uws-location-qa.png',fullPage:true});console.log('UWS location QA passed',{defaultState,...state});
}catch(e){code=1;console.error('UWS QA diagnostic',await diagnostic());console.error(e?.stack||String(e));try{await page.screenshot({path:'screenshots/uws-location-failure.png',fullPage:true})}catch{}}finally{await browser.close().catch(()=>{});process.exit(code)}