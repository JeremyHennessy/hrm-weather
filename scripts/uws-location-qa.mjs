import { chromium } from 'playwright';

const base=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const url=`${base}${base.includes('?')?'&':'?'}uwsqa=${Date.now()}`;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('pageerror',e=>errors.push(String(e)));
let code=0;
try{
  const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});if(!r?.ok())throw Error(`HTTP ${r?.status()}`);
  await page.waitForFunction(()=>[...document.querySelectorAll('#tabs .tab')].some(x=>/Upper West Side/i.test(x.textContent||'')),{timeout:8000});
  await page.evaluate(()=>{const b=[...document.querySelectorAll('#tabs .tab')].find(x=>/Upper West Side/i.test(x.textContent||''));b?.click()});
  await page.waitForFunction(()=>localStorage.getItem('wx-loc')==='uws',{timeout:4000});
  await page.waitForFunction(()=>/Upper West Side|Manhattan/i.test(document.querySelector('#place')?.textContent||''),{timeout:12000});
  await page.waitForFunction(()=>{const t=document.querySelector('#feels')?.textContent||'';return t&&!t.includes('--')},{timeout:15000});
  await page.waitForFunction(()=>document.querySelectorAll('#zones .card').length>=3,{timeout:15000});
  await page.waitForTimeout(1200);
  const state=await page.evaluate(()=>({
    loc:localStorage.getItem('wx-loc'),place:document.querySelector('#place')?.textContent?.trim()||'',feels:document.querySelector('#feels')?.textContent?.trim()||'',actual:document.querySelector('#actual')?.textContent?.trim()||'',
    timezone:typeof window.WX_LOCATION_TIMEZONE==='function'?window.WX_LOCATION_TIMEZONE():'',
    zones:[...document.querySelectorAll('#zones .card small')].map(x=>x.textContent.trim()),
    official:document.querySelector('#officialStation')?.textContent?.trim()||'',officialHead:[...document.querySelectorAll('.section')].find(x=>x.querySelector('h2')?.textContent==='Official data')?.querySelector('.head span')?.textContent?.trim()||'',
    heroLocation:document.querySelector('.hero')?.dataset?.location||'',sceneSource:document.querySelector('.hero')?.dataset?.sceneSource||'',modelLabels:[...document.querySelectorAll('#models .model b')].map(x=>x.textContent.trim()),
    scrollWidth:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),innerWidth:innerWidth
  }));
  if(state.loc!=='uws')throw Error(`location key not uws: ${state.loc}`);
  if(!/Upper West Side|Manhattan/i.test(state.place))throw Error(`wrong place label: ${state.place}`);
  if(state.timezone!=='America/New_York')throw Error(`wrong timezone: ${state.timezone}`);
  if(state.zones.length<3||!state.zones.some(x=>/UWS Central/i.test(x)))throw Error(`UWS three-point core missing: ${state.zones.join(',')}`);
  if(state.heroLocation!=='Upper West Side')throw Error(`hero location not UWS: ${state.heroLocation}`);
  if(state.sceneSource!=='wikimedia-commons')throw Error(`UWS scene source wrong: ${state.sceneSource}`);
  if(state.scrollWidth>state.innerWidth+2)throw Error(`horizontal overflow ${state.scrollWidth}>${state.innerWidth}`);
  // NWS may be temporarily unavailable on a PR runner, but it must never claim
  // a successful UWS official observation is ECCC-owned.
  if(/KNYC|NWS/i.test(state.official)&&/Environment Canada/i.test(state.officialHead))throw Error(`UWS NWS observation still labelled Environment Canada: ${state.officialHead}`);
  if(errors.length)throw Error(`console errors: ${errors.join(' | ')}`);
  console.log('UWS location QA passed',state);
}catch(e){code=1;console.error(e?.stack||String(e))}finally{await browser.close().catch(()=>{});process.exit(code)}
