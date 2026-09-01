import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const url=`${base}${base.includes('?')?'&':'?'}uwsqa=${Date.now()}`;
await fs.mkdir('screenshots',{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
const errors=[],requestFailures=[],badResponses=[];
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
page.on('pageerror',e=>errors.push(String(e)));
page.on('requestfailed',r=>requestFailures.push({url:r.url(),resourceType:r.resourceType(),error:r.failure()?.errorText||'request failed'}));
page.on('response',r=>{if(r.status()>=400)badResponses.push({url:r.url(),resourceType:r.request().resourceType(),status:r.status()})});
let code=0;
const num=t=>{const m=String(t||'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null};
const isAlertRequest=x=>/^https:\/\/api\.weather\.gov\/alerts\/active\?/i.test(String(x?.url||''));
const isNavigationAbort=x=>String(x?.error||'')==='net::ERR_ABORTED';
async function diagnostic(){try{return await page.evaluate(()=>({loc:localStorage.getItem('wx-loc'),pending:sessionStorage.getItem('wx-pending-loc'),active:document.querySelector('#tabs .tab.active')?.dataset?.k||'',place:document.querySelector('#place')?.textContent?.trim()||'',feels:document.querySelector('#feels')?.textContent?.trim()||'',actual:document.querySelector('#actual')?.textContent?.trim()||'',currentSource:document.querySelector('#feels')?.dataset?.currentSource||'',realFeelOwner:document.documentElement.dataset.wxRealFeel||'',actualOwner:document.documentElement.dataset.wxCurrentActual||'',fast:window.__wxFastCurrent||null,uwsQuick:window.__wxUwsQuick||null,refreshFastType:typeof window.WXRefreshFastCurrent,refreshUwsType:typeof window.WXRefreshUWSCurrent,zones:[...document.querySelectorAll('#zones .card small')].map(x=>x.textContent.trim()),warning:document.querySelector('#warn')?.textContent?.trim()||'',requestHealth:window.WX_REQUEST_HEALTH||null,resources:performance.getEntriesByType('resource').map(x=>x.name).filter(x=>/api\.open-meteo\.com|api\.weather\.gov|backgrounds\/generated\/uws|engine-v3\.json/.test(x))}))}catch{return null}}
async function waitUws(){
  await page.waitForFunction(()=>localStorage.getItem('wx-loc')==='uws',null,{timeout:8000});
  await page.waitForFunction(()=>/Upper West Side|Manhattan/i.test(document.querySelector('#place')?.textContent||''),null,{timeout:15000});
  await page.waitForFunction(()=>{const t=document.querySelector('#feels')?.textContent||'';return t&&!t.includes('--')},null,{timeout:15000});
  await page.waitForFunction(()=>document.querySelectorAll('#zones .card').length>=3,null,{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('.hero')?.dataset?.location==='Upper West Side',null,{timeout:8000});
  await page.waitForTimeout(1000);
}
try{
  const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});if(!r?.ok())throw Error(`HTTP ${r?.status()}`);
  await page.waitForFunction(()=>document.querySelector('#tabs .tab.active')?.dataset?.k==='hrm',null,{timeout:8000});
  const defaultState=await page.evaluate(()=>({active:document.querySelector('#tabs .tab.active')?.dataset?.k||'',place:document.querySelector('#place')?.textContent?.trim()||'',firstTab:document.querySelector('#tabs .tab')?.dataset?.k||''}));
  if(defaultState.active!=='hrm'||defaultState.firstTab!=='hrm'||!/Halifax|Bedford|Dartmouth/i.test(defaultState.place))throw Error(`HRM primary/default regressed: ${JSON.stringify(defaultState)}`);
  await page.waitForFunction(()=>[...document.querySelectorAll('#tabs .tab')].some(x=>/Upper West Side/i.test(x.textContent||'')),null,{timeout:8000});
  await page.evaluate(()=>{const b=[...document.querySelectorAll('#tabs .tab')].find(x=>/Upper West Side/i.test(x.textContent||''));b?.click()});
  await waitUws();
  await page.reload({waitUntil:'domcontentloaded',timeout:20000});
  await waitUws();
  const state=await page.evaluate(()=>({
    loc:localStorage.getItem('wx-loc'),pending:sessionStorage.getItem('wx-pending-loc'),place:document.querySelector('#place')?.textContent?.trim()||'',brand:document.querySelector('.brand h1')?.textContent?.trim()||'',feels:document.querySelector('#feels')?.textContent?.trim()||'',actual:document.querySelector('#actual')?.textContent?.trim()||'',
    timezone:typeof window.WX_LOCATION_TIMEZONE==='function'?window.WX_LOCATION_TIMEZONE():'',zones:[...document.querySelectorAll('#zones .card small')].map(x=>x.textContent.trim()),official:document.querySelector('#officialStation')?.textContent?.trim()||'',officialHead:[...document.querySelectorAll('.section')].find(x=>x.querySelector('h2')?.textContent==='Official data')?.querySelector('.head span')?.textContent?.trim()||'',zoneTitle:document.querySelector('#zoneTitle')?.textContent?.trim()||'',microDisplay:getComputedStyle(document.querySelector('#microSection')).display,heroLocation:document.querySelector('.hero')?.dataset?.location||'',daypart:document.querySelector('.hero')?.dataset?.daypart||'',sceneSource:document.querySelector('.hero')?.dataset?.sceneSource||'',realFeelOwner:document.documentElement.dataset.wxRealFeel||'',actualOwner:document.documentElement.dataset.wxCurrentActual||'',fast:window.__wxFastCurrent||null,uwsQuick:window.__wxUwsQuick||null,warning:document.querySelector('#warn')?.textContent?.trim()||'',scrollWidth:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),innerWidth:innerWidth
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
  if(state.sceneSource!=='local-vector-uws')throw Error(`UWS scene source wrong: ${state.sceneSource}`);
  if(state.fast?.painted&&state.fast?.location!=='uws')throw Error(`fast current painted wrong location: ${JSON.stringify(state.fast)}`);
  const heroFeel=num(state.feels),heroAir=num(state.actual);
  if(state.fast?.painted&&Number.isFinite(state.fast.feel)&&Number.isFinite(heroFeel)&&Math.abs(heroFeel-state.fast.feel)>0.6)throw Error(`UWS Real Feel diverged from current truth: hero=${heroFeel} fast=${state.fast.feel}`);
  if(state.fast?.painted&&Number.isFinite(state.fast.air)&&Number.isFinite(heroAir)&&Math.abs(heroAir-state.fast.air)>0.6)throw Error(`UWS Actual diverged from current truth: hero=${heroAir} fast=${state.fast.air}`);
  if(state.fast?.painted&&state.actualOwner!=='live-current-input')throw Error(`UWS Actual ownership regressed: ${state.actualOwner}`);
  if(state.scrollWidth>state.innerWidth+2)throw Error(`horizontal overflow ${state.scrollWidth}>${state.innerWidth}`);
  if(/KNYC|NWS/i.test(state.official)&&/Environment Canada/i.test(state.officialHead))throw Error(`UWS NWS observation still labelled Environment Canada: ${state.officialHead}`);

  // NWS alerts are explicitly best-effort in uws-location-ui.js: a failed
  // alerts request is caught and becomes an empty alert list. Keep that
  // auxiliary transport separate from the UWS location/current contract while
  // preserving strict failure for every other non-aborted request.
  const optionalAlertFailures=requestFailures.filter(isAlertRequest);
  const navigationAborts=requestFailures.filter(isNavigationAbort);
  const fatalRequestFailures=requestFailures.filter(x=>!isNavigationAbort(x)&&!isAlertRequest(x));
  const optionalAlertHttp=badResponses.filter(isAlertRequest);
  const fatalHttp=badResponses.filter(x=>!isAlertRequest(x));
  const expectedAlertConsole=optionalAlertFailures.some(x=>/ERR_HTTP2_PROTOCOL_ERROR/.test(x.error))||optionalAlertHttp.length>0;
  const unexpectedConsoleErrors=errors.filter(e=>{
    if(expectedAlertConsole&&/^Failed to load resource: net::ERR_HTTP2_PROTOCOL_ERROR$/i.test(e))return false;
    if(optionalAlertHttp.length&&/^Failed to load resource: the server responded with a status of \d+/i.test(e))return false;
    return true;
  });
  if(fatalRequestFailures.length)throw Error(`authoritative request failures: ${JSON.stringify(fatalRequestFailures)}`);
  if(fatalHttp.length)throw Error(`authoritative HTTP errors: ${JSON.stringify(fatalHttp)}`);
  if(unexpectedConsoleErrors.length)throw Error(`unexpected console errors: ${unexpectedConsoleErrors.join(' | ')}`);
  if((optionalAlertFailures.length||optionalAlertHttp.length)&&/(unable to load|forecast unavailable|current conditions unavailable|weather data unavailable|alert.*(?:failed|error))/i.test(state.warning))throw Error(`optional NWS alert transport surfaced a false primary warning: ${state.warning}`);

  await page.screenshot({path:'screenshots/uws-location-qa.png',fullPage:true});
  console.log('UWS location QA passed',{defaultState,...state,optionalAlertFailures,navigationAborts,optionalAlertHttp});
}catch(e){code=1;console.error('UWS QA diagnostic',{state:await diagnostic(),requestFailures,badResponses,consoleErrors:errors});console.error(e?.stack||String(e));try{await page.screenshot({path:'screenshots/uws-location-failure.png',fullPage:true})}catch{}}finally{await browser.close().catch(()=>{});process.exit(code)}
