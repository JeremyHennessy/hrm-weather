import { chromium } from 'playwright';

const base=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const url=`${base}${base.includes('?')?'&':'?'}servertruth=${Date.now()}`;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
const errors=[],responses=[],requestFailures=[];
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(/(?:app\.html|scene-images\.js|server-truth-ui\.js|accuracy-v3\.js|engine-v[23]\.json)(?:\?|$)/.test(r.url()))responses.push({url:r.url(),status:r.status()})});
page.on('requestfailed',r=>{if(/(?:app\.html|scene-images\.js|server-truth-ui\.js|accuracy-v3\.js|engine-v[23]\.json)(?:\?|$)/.test(r.url()))requestFailures.push({url:r.url(),error:r.failure()?.errorText||'request failed'})});
let exitCode=0;
async function diagnostics(){
  return page.evaluate(()=>{
    const fn=typeof window.wxHealth==='function'?Function.prototype.toString.call(window.wxHealth):'';
    const resources=performance.getEntriesByType('resource').map(x=>x.name).filter(x=>/(?:scene-images\.js|server-truth-ui\.js|accuracy-v3\.js|engine-v[23]\.json)(?:\?|$)/.test(x));
    return{
      readyState:document.readyState,
      hasHealth:Boolean(document.querySelector('#health')),
      healthOwner:document.querySelector('#health')?.dataset?.owner||'',
      healthText:document.querySelector('#health')?.textContent?.trim()||'',
      hasServerTruthRefresh:typeof window.WXRefreshServerTruthUI==='function',
      hasServerTruth:Boolean(window.WXServerTruth),
      serverTruthOwner:window.WXServerTruth?.owner||'',
      hasAccuracyV3:Boolean(window.WXAccuracyV3),
      accuracyV3Feeds:Number(window.WXAccuracyV3?.collector?.deterministic_forecasts||0),
      hasServerConsensusFreshFn:typeof window.WX_SERVER_CONSENSUS_FRESH==='function',
      wxHealthType:typeof window.wxHealth,
      wxHealthLooksServerOwned:/engine3-server-truth/.test(fn),
      completeForecast:Boolean(window.__wxHasCompleteForecast),
      resources
    };
  });
}
try{
  const resp=await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});if(!resp?.ok())throw new Error(`App HTTP ${resp?.status()??'no response'}`);
  const healthOwned=await page.waitForFunction(()=>document.querySelector('#health')?.dataset?.owner==='engine3-server-truth',{timeout:15000}).then(()=>true).catch(()=>false);
  const bootstrap=await diagnostics();
  if(!healthOwned)throw new Error(`Server truth bootstrap did not acquire Data Health ownership: ${JSON.stringify({bootstrap,responses,requestFailures})}`);
  await page.waitForFunction(()=>document.querySelector('#scoreRows')?.dataset?.owner==='engine3-server-truth',{timeout:10000});
  await page.waitForFunction(()=>document.querySelector('#chips')?.dataset?.owner==='engine3-server-truth',{timeout:10000});
  await page.waitForFunction(()=>Array.isArray(window.__wxFastCurrent?.point_values)&&window.__wxFastCurrent.point_values.length>0,{timeout:10000});
  await page.waitForFunction(()=>[...document.querySelectorAll('#zones .card')].some(x=>x.dataset.currentTruth==='provider-apparent-current'),{timeout:10000});
  const state=await page.evaluate(()=>{
    const n=t=>{const m=String(t||'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null};
    const loc=localStorage.getItem('wx-loc')||'hrm',engine=window.WXServerTruth?.engine||window.WXAccuracyV3||null,truth=window.WXServerTruth?.truth||engine?.server_truth||null,obs=truth?.observations?.[loc]||null;
    const zones=[...document.querySelectorAll('#zones .card')].map(card=>({name:card.querySelector('small')?.textContent?.trim()||'',feel:card.querySelector('.zt')?.textContent?.trim()||'',actualText:card.querySelector('.sub')?.textContent?.trim()||'',actual:n(card.querySelector('.sub')?.textContent),owner:card.querySelector('.sub')?.dataset?.owner||'',truth:card.dataset.currentTruth||''}));
    return{
      loc,serverConsensusFresh:typeof window.WX_SERVER_CONSENSUS_FRESH==='function'?window.WX_SERVER_CONSENSUS_FRESH():null,
      feeds:Number(engine?.collector?.deterministic_forecasts||0),health:document.querySelector('#health')?.textContent?.trim()||'',healthOwner:document.querySelector('#health')?.dataset?.owner||'',
      officialTemp:document.querySelector('#officialTemp')?.textContent?.trim()||'',officialStation:document.querySelector('#officialStation')?.textContent?.trim()||'',officialOwner:document.querySelector('#officialStation')?.dataset?.owner||'',
      serverObsStations:Number(obs?.station_count||0),verified:document.querySelector('#verifiedCount')?.textContent?.trim()||'',verifiedOwner:document.querySelector('#verifiedCount')?.dataset?.owner||'',
      scorecard:document.querySelector('#scoreRows')?.textContent?.trim()||'',scoreOwner:document.querySelector('#scoreRows')?.dataset?.owner||'',chips:document.querySelector('#chips')?.textContent?.trim()||'',chipsOwner:document.querySelector('#chips')?.dataset?.owner||'',
      realFeelValidation:document.querySelector('#v3RealFeel')?.textContent?.trim()||'',realFeelValidationOwner:document.querySelector('#v3RealFeel')?.dataset?.owner||'',
      pointValues:window.__wxFastCurrent?.point_values||[],zones,consoleErrors:[]
    }
  });
  if(state.serverConsensusFresh&&state.feeds>0){
    if(state.healthOwner!=='engine3-server-truth')throw new Error(`Data Health is not server-owned: ${state.healthOwner||'missing'}`);
    if(/\b0\s*forecast feeds\b|\b0\/13\s+models\b|\b0\s+location feeds\b/i.test(state.health))throw new Error(`Healthy server consensus displayed zero coverage: ${state.health}`);
    if(!new RegExp(`\\b${state.feeds}\\s+forecast feeds\\b`,'i').test(state.health))throw new Error(`Data Health does not expose server feed count ${state.feeds}: ${state.health}`);
  }
  if(state.serverObsStations>0){
    if(/unavailable/i.test(state.officialStation)||/unavailable/i.test(state.health))throw new Error(`Available server ECCC mesh was labelled unavailable: health=${state.health}; official=${state.officialStation}`);
    if(state.officialOwner!=='engine3-server-truth')throw new Error(`Official observation is not server-owned: ${state.officialOwner||'missing'}`);
  }
  for(const p of state.pointValues){
    if(!Number.isFinite(Number(p.air))||Math.abs(Number(p.air))<=8)continue;const card=state.zones.find(z=>z.name===p.name);if(!card)continue;
    if(!Number.isFinite(card.actual)||Math.abs(card.actual)<0.5)throw new Error(`${p.name} current Actual regressed near zero while input air=${p.air}: ${card.actualText}`);
    if(Math.abs(card.actual-Number(p.air))>2.0)throw new Error(`${p.name} current Actual diverges from current input: input=${p.air}; card=${card.actual}`);
  }
  if(state.verifiedOwner!=='engine3-server-truth')throw new Error(`Verified forecast count is not server-owned: ${state.verifiedOwner||'missing'}`);
  if(state.scoreOwner!=='engine3-server-truth'||!/MAE/i.test(state.scorecard))throw new Error(`Model scorecard is not server-owned: owner=${state.scoreOwner}; text=${state.scorecard}`);
  if(state.chipsOwner!=='engine3-server-truth'||!/model spread/i.test(state.chips))throw new Error(`Model spread/coverage is not server-owned: owner=${state.chipsOwner}; text=${state.chips}`);
  if(state.realFeelValidationOwner!=='engine3-independent-replay')throw new Error(`Real Feel validation status is stale: owner=${state.realFeelValidationOwner||'missing'}; text=${state.realFeelValidation}`);
  if(errors.length)throw new Error(`Console errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({ok:true,url,bootstrap,state,responses,requestFailures,console_errors:errors},null,2));
}catch(err){
  exitCode=1;
  const bootstrap=await diagnostics().catch(()=>null);
  console.error(JSON.stringify({ok:false,url,error:String(err?.stack||err),bootstrap,responses,requestFailures,console_errors:errors},null,2));
}finally{await browser.close().catch(()=>{});process.exit(exitCode)}
