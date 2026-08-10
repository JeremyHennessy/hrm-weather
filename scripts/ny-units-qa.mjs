import { chromium } from 'playwright';

const base=process.env.WX_ROOT||'https://jeremyhennessy.github.io/hrm-weather/';
const browser=await chromium.launch({headless:true});
let code=0;
try{
  const ctx=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const page=await ctx.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  const r=await page.goto(`${base}ny.html?qa=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:25000});if(!r?.ok())throw Error(`NY shell HTTP ${r?.status()}`);
  const app=page.frameLocator('#nyApp');
  await app.locator('#place').waitFor({state:'visible',timeout:20000});
  await app.locator('#feels').waitFor({state:'visible',timeout:20000});
  await page.waitForFunction(()=>{
    const f=document.querySelector('#nyApp');if(!f?.contentDocument)return false;
    const d=f.contentDocument,w=f.contentWindow;
    return /Upper West Side|Manhattan/i.test(d.querySelector('#place')?.textContent||'')&&d.documentElement.dataset.wxUnits==='us'&&/°F/.test(d.querySelector('#feels')?.textContent||'')&&/°F/.test(d.querySelector('#actual')?.textContent||'');
  },{timeout:25000});
  await page.waitForTimeout(1800);
  const state=await page.evaluate(()=>{const f=document.querySelector('#nyApp'),d=f.contentDocument,w=f.contentWindow;return{
    loc:w.localStorage.getItem('wx-loc'),place:d.querySelector('#place')?.textContent?.trim()||'',units:d.documentElement.dataset.wxUnits||'',feels:d.querySelector('#feels')?.textContent?.trim()||'',actual:d.querySelector('#actual')?.textContent?.trim()||'',official:d.querySelector('#officialTemp')?.textContent?.trim()||'',wind:d.querySelector('#wind')?.textContent?.trim()||'',hour:d.querySelector('#hours .hour b')?.textContent?.trim()||'',day:d.querySelector('#days .v11DayRF')?.textContent?.trim()||'',rainTotal:d.querySelector('#rainTotal')?.textContent?.trim()||'',summary:d.querySelector('#daySummary')?.textContent?.trim()||'',fast:w.__wxFastCurrent||null,serverTruth:d.documentElement.dataset.wxServerTruth||''};});
  if(state.loc!=='uws')throw Error(`NY link did not persist UWS: ${state.loc}`);
  if(!/Upper West Side|Manhattan/i.test(state.place))throw Error(`NY link wrong location: ${state.place}`);
  if(state.units!=='us')throw Error(`US unit mode missing: ${state.units}`);
  for(const [name,value] of [['Real Feel',state.feels],['Actual',state.actual],['official temperature',state.official],['hourly Real Feel',state.hour],['daily Real Feel',state.day]])if(value&&!/°F/.test(value))throw Error(`${name} not Fahrenheit: ${value}`);
  if(state.wind&&state.wind!=='--'&&!/mph/i.test(state.wind))throw Error(`wind not mph: ${state.wind}`);
  if(/\bmm\b|km\/h|°C/.test([state.feels,state.actual,state.official,state.wind,state.hour,state.day,state.rainTotal,state.summary].join(' ')))throw Error(`metric unit leaked into NY primary UI: ${JSON.stringify(state)}`);
  if(errors.some(x=>!/429|favicon/i.test(x)))throw Error(`NY console errors: ${errors.join(' | ')}`);
  await ctx.close();

  const baseCtx=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const basePage=await baseCtx.newPage();await basePage.goto(`${base}app.html?baseqa=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:25000});
  await basePage.waitForFunction(()=>document.querySelector('#tabs .tab')&&document.querySelector('#place'),{timeout:15000});
  const baseline=await basePage.evaluate(()=>({loc:localStorage.getItem('wx-loc')||'hrm',first:document.querySelector('#tabs .tab')?.dataset?.k||'',place:document.querySelector('#place')?.textContent?.trim()||'',units:document.documentElement.dataset.wxUnits||''}));
  if(baseline.loc!=='hrm'||baseline.first!=='hrm'||!/Halifax Peninsula/.test(baseline.place)||baseline.units==='us')throw Error(`base app changed by NY spin: ${JSON.stringify(baseline)}`);
  await baseCtx.close();
  console.log('NY US-units QA passed',state,'base preserved',baseline);
}catch(e){code=1;console.error(e?.stack||String(e))}finally{await browser.close().catch(()=>{});process.exit(code)}
