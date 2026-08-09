import { chromium } from 'playwright';

const base=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const url=`${base}${base.includes('?')?'&':'?'}smoke=${Date.now()}`;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
const errors=[];
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
page.on('pageerror',e=>errors.push(String(e)));
const started=Date.now();
const deadline=(ms,label)=>new Promise((_,reject)=>setTimeout(()=>reject(new Error(label)),ms));
let exitCode=0;
try{
  const resp=await Promise.race([page.goto(url,{waitUntil:'domcontentloaded',timeout:12000}),deadline(13000,'DOM startup deadline exceeded')]);
  if(!resp||!resp.ok())throw new Error(`Live app HTTP ${resp?.status()??'no response'}`);
  await Promise.race([
    page.waitForFunction(()=>{const t=document.querySelector('#feels')?.textContent?.trim()||'';return t!==''&&!t.includes('--')},null,{polling:100,timeout:10000}),
    deadline(10500,'Real Feel did not render within 10 seconds')
  ]);
  await page.waitForFunction(()=>{const b=document.querySelector('.wxConfidenceStable b')?.textContent?.trim()||'';return /^\d+%$/.test(b)},{timeout:6000});
  await page.waitForTimeout(500);
  const confidenceSamples=[];
  for(let i=0;i<4;i++){
    confidenceSamples.push(await page.locator('.wxConfidenceStable b').textContent());
    if(i<3)await page.waitForTimeout(1200);
  }
  if(new Set(confidenceSamples).size!==1)throw new Error(`Forecast Confidence changed during one revision: ${confidenceSamples.join(' -> ')}`);
  const state=await Promise.race([page.evaluate(()=>({
    feels:document.querySelector('#feels')?.textContent?.trim()||'',
    realFeelOwner:document.documentElement.dataset.wxRealFeel||'',
    realFeelDataset:document.querySelector('#feels')?.dataset?.engine3RealFeel||'',
    actual:document.querySelector('#actual')?.textContent?.trim()||'',
    morning:document.querySelector('#morningFeel')?.textContent?.trim()||'',
    updated:document.querySelector('#updated')?.textContent?.trim()||'',
    modelCount:document.querySelector('#modelCount')?.textContent?.trim()||'',
    confidence:document.querySelector('.wxConfidenceStable b')?.textContent?.trim()||'',
    confidenceOwner:document.querySelector('.confidenceOrb')?.dataset?.confidenceOwner||'',
    warn:document.querySelector('#warn')?.textContent?.trim()||'',
    initialShown:Boolean(window.__wxInitialForecastShown),
    complete:Boolean(window.__wxHasCompleteForecast),
    serverConsensusFresh:typeof window.WX_SERVER_CONSENSUS_FRESH==='function'?window.WX_SERVER_CONSENSUS_FRESH():null,
    requestHealth:window.WX_REQUEST_HEALTH||null
  })),deadline(2000,'Could not read live page state')]);
  console.log(JSON.stringify({ok:true,elapsed_ms:Date.now()-started,url,status:resp.status(),...state,confidence_samples:confidenceSamples,console_errors:errors},null,2));
  if(state.feels.includes('--'))throw new Error('Real Feel remained unavailable');
  if(!state.initialShown)throw new Error('Initial forecast render flag was not set');
  if(state.confidenceOwner!=='engine3-locked')throw new Error(`Forecast Confidence owner is not locked: ${state.confidenceOwner||'missing'}`);
  if(state.serverConsensusFresh){
    if(state.realFeelOwner!=='engine3-calibrated'||state.realFeelDataset!=='1')throw new Error(`Headline Real Feel is not owned by calibrated Engine 3: owner=${state.realFeelOwner||'missing'} dataset=${state.realFeelDataset||'missing'}`);
    if(!/forecast feeds · Engine 3 server consensus/i.test(state.modelCount))throw new Error(`Server model status is stale: ${state.modelCount}`);
    if(/model\/location feeds were unavailable|consensus is using the feeds that responded/i.test(state.warn))throw new Error(`Intentional server skips reported as failures: ${state.warn}`);
    const air=Number(state.actual.match(/-?\d+(?:\.\d+)?/)?.[0]);
    const feel=Number(state.feels.match(/-?\d+(?:\.\d+)?/)?.[0]);
    if(Number.isFinite(air)&&Number.isFinite(feel)&&Math.abs(air)<0.1&&feel>10)throw new Error(`Bogus Actual temperature survived UI guard: ${state.actual}`);
  }
}catch(err){
  exitCode=1;
  let state=null;
  try{state=await Promise.race([page.evaluate(()=>({
    readyState:document.readyState,
    feels:document.querySelector('#feels')?.textContent?.trim()||'',
    realFeelOwner:document.documentElement.dataset.wxRealFeel||'',
    realFeelDataset:document.querySelector('#feels')?.dataset?.engine3RealFeel||'',
    actual:document.querySelector('#actual')?.textContent?.trim()||'',
    modelCount:document.querySelector('#modelCount')?.textContent?.trim()||'',
    confidence:document.querySelector('.wxConfidenceStable b')?.textContent?.trim()||'',
    confidenceOwner:document.querySelector('.confidenceOrb')?.dataset?.confidenceOwner||'',
    updated:document.querySelector('#updated')?.textContent?.trim()||'',
    warn:document.querySelector('#warn')?.textContent?.trim()||'',
    initialShown:Boolean(window.__wxInitialForecastShown),
    complete:Boolean(window.__wxHasCompleteForecast),
    requestHealth:window.WX_REQUEST_HEALTH||null
  })),deadline(1500,'state read timeout')])}catch{}
  console.error(JSON.stringify({ok:false,elapsed_ms:Date.now()-started,error:String(err?.stack||err),url,state,console_errors:errors},null,2));
}finally{
  try{await Promise.race([browser.close(),new Promise(resolve=>setTimeout(resolve,1500))])}catch{}
  process.exit(exitCode);
}
