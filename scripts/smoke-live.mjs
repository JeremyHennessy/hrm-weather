import { chromium } from 'playwright';
// Verify the selected app URL without changing production code.

const base=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const requireFastCurrent=process.env.WX_REQUIRE_FAST_CURRENT==='1';
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
  await page.waitForFunction(()=>document.querySelector('#daySummary')?.dataset?.source==='engine3-summary',{timeout:6000});
  await page.waitForTimeout(500);
  const confidenceSamples=[];
  for(let i=0;i<4;i++){
    confidenceSamples.push(await page.locator('.wxConfidenceStable b').textContent());
    if(i<3)await page.waitForTimeout(1200);
  }
  if(new Set(confidenceSamples).size!==1)throw new Error(`Forecast Confidence changed during one revision: ${confidenceSamples.join(' -> ')}`);
  const state=await Promise.race([page.evaluate(()=>{
    const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    return{
      feels:document.querySelector('#feels')?.textContent?.trim()||'',
      realFeelOwner:document.documentElement.dataset.wxRealFeel||'',
      realFeelDataset:document.querySelector('#feels')?.dataset?.engine3RealFeel||'',
      currentSource:document.querySelector('#feels')?.dataset?.currentSource||'',
      currentFast:window.__wxFastCurrent||null,
      actual:document.querySelector('#actual')?.textContent?.trim()||'',
      morning:document.querySelector('#morningFeel')?.textContent?.trim()||'',
      updated:document.querySelector('#updated')?.textContent?.trim()||'',
      modelCount:document.querySelector('#modelCount')?.textContent?.trim()||'',
      confidence:document.querySelector('.wxConfidenceStable b')?.textContent?.trim()||'',
      confidenceOwner:document.querySelector('.confidenceOrb')?.dataset?.confidenceOwner||'',
      summary:document.querySelector('#daySummary')?.textContent?.trim()||'',
      summaryOwner:document.querySelector('#daySummary')?.dataset?.source||'',
      uvVisible:!document.querySelector('#uvGuidance')?.hidden,
      uvOwner:document.querySelector('#uvGuidance')?.dataset?.owner||'',
      uvText:document.querySelector('#uvGuidance')?.textContent?.trim()||'',
      warn:document.querySelector('#warn')?.textContent?.trim()||'',
      initialShown:Boolean(window.__wxInitialForecastShown),
      complete:Boolean(window.__wxHasCompleteForecast),
      serverConsensusFresh:typeof window.WX_SERVER_CONSENSUS_FRESH==='function'?window.WX_SERVER_CONSENSUS_FRESH():null,
      requestHealth:window.WX_REQUEST_HEALTH||null,
      layout:{hero:rect(document.querySelector('.hero')),summary:rect(document.querySelector('#daySummary')),confidence:rect(document.querySelector('.confidenceOrb')),confidenceParent:document.querySelector('.confidenceOrb')?.parentElement?.className||''}
    }
  }),deadline(2000,'Could not read live page state')]);
  console.log(JSON.stringify({ok:true,elapsed_ms:Date.now()-started,url,status:resp.status(),...state,confidence_samples:confidenceSamples,console_errors:errors},null,2));
  if(state.feels.includes('--'))throw new Error('Real Feel remained unavailable');
  if(!state.initialShown)throw new Error('Initial forecast render flag was not set');
  if(requireFastCurrent&&state.currentFast?.painted!==true)throw new Error(`Lightweight current Real Feel path did not paint: ${JSON.stringify(state.currentFast)}`);
  if(requireFastCurrent&&state.currentFast?.source!=='provider-apparent-current')throw new Error(`Lightweight current Real Feel source changed: ${JSON.stringify(state.currentFast)}`);
  if(state.confidenceOwner!=='engine3-empirical')throw new Error(`Forecast Confidence owner is not empirical Engine 3: ${state.confidenceOwner||'missing'}`);
  if(state.summaryOwner!=='engine3-summary'||!state.summary)throw new Error(`Engine 3 plain-English summary is not active: owner=${state.summaryOwner||'missing'}`);
  if(/forecast confidence is\s+\d+%/i.test(state.summary))throw new Error(`Summary redundantly repeats Forecast Confidence: ${state.summary}`);
  const {hero,summary,confidence,confidenceParent}=state.layout||{};
  if(!hero||!summary||!confidence)throw new Error('Hero layout boxes are unavailable');
  if(!String(confidenceParent).includes('heroTop'))throw new Error(`Confidence status is not anchored in heroTop: ${confidenceParent}`);
  if(confidence.width<80||confidence.width>180||confidence.height<24||confidence.height>45)throw new Error(`Forecast Confidence is not a compact status pill: ${confidence.width}x${confidence.height}`);
  if(confidence.right>hero.right-6||confidence.top<hero.top+6)throw new Error(`Confidence status is not inside top-right hero safe area: ${JSON.stringify({hero,confidence})}`);
  if(summary.left<hero.left+12||summary.right>hero.right-12)throw new Error(`Summary is too close to/cut by hero edges: ${JSON.stringify({hero,summary})}`);
  const overlap=summary.left<confidence.right&&summary.right>confidence.left&&summary.top<confidence.bottom&&summary.bottom>confidence.top;
  if(overlap)throw new Error(`Summary overlaps Forecast Confidence: ${JSON.stringify({summary,confidence})}`);
  if(state.uvVisible&&state.uvOwner!=='forecast-insights')throw new Error(`UV overlay has competing owner: ${state.uvOwner||'missing'}`);
  if(state.uvVisible&&!/SPF 30\+|SPF 50\+/i.test(state.uvText))throw new Error(`Visible UV guidance lacks sunscreen recommendation: ${state.uvText}`);
  if(state.serverConsensusFresh){
    if(state.realFeelOwner!=='live-current-provider-apparent')throw new Error(`Headline Real Feel is not owned by live current inputs: owner=${state.realFeelOwner||'missing'}`);
    if(state.realFeelDataset==='1')throw new Error('Headline Real Feel was overwritten by an Engine 3 forecast row');
    if(!/forecast feeds · Engine 3 server consensus/i.test(state.modelCount))throw new Error(`Server model status is stale: ${state.modelCount}`);
    if(/No live weather feeds responded|model\/location feeds were unavailable|consensus is using the feeds that responded/i.test(state.warn))throw new Error(`Healthy Engine 3 consensus reported as feed failure: ${state.warn}`);
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
    currentSource:document.querySelector('#feels')?.dataset?.currentSource||'',
    currentFast:window.__wxFastCurrent||null,
    actual:document.querySelector('#actual')?.textContent?.trim()||'',
    modelCount:document.querySelector('#modelCount')?.textContent?.trim()||'',
    confidence:document.querySelector('.wxConfidenceStable b')?.textContent?.trim()||'',
    confidenceOwner:document.querySelector('.confidenceOrb')?.dataset?.confidenceOwner||'',
    summary:document.querySelector('#daySummary')?.textContent?.trim()||'',
    summaryOwner:document.querySelector('#daySummary')?.dataset?.source||'',
    uvVisible:!document.querySelector('#uvGuidance')?.hidden,
    uvOwner:document.querySelector('#uvGuidance')?.dataset?.owner||'',
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
