import { chromium } from 'playwright';

const base=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const url=`${base}${base.includes('?')?'&':'?'}summaryqa=${Date.now()}`;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
let code=0;
try{
  const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});if(!r?.ok())throw Error(`HTTP ${r?.status()}`);
  await page.waitForFunction(()=>window.__wxFastCurrent?.painted&&window.__wxFastCurrent?.location==='hrm',{timeout:15000});
  await page.waitForFunction(()=>window.__wxDailyDetailRaw?.hrm&&Object.keys(window.__wxDailyDetailRaw.hrm.points||{}).length>0,{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#daySummary')?.dataset?.truth==='live-current-hourly',{timeout:10000});

  const before=await page.evaluate(()=>({fast:window.__wxFastCurrent,summary:document.querySelector('#daySummary')?.textContent||'',source:document.querySelector('#daySummary')?.dataset?.source||'',truth:document.querySelector('#daySummary')?.dataset?.truth||''}));
  if(!before.fast?.painted)throw Error('fast current missing');
  if(before.source!=='engine3-summary'||before.truth!=='live-current-hourly')throw Error(`summary identity/truth contract wrong: ${JSON.stringify(before)}`);
  const rf=Math.round(Number(before.fast.feel)),air=Math.round(Number(before.fast.air));
  if(!before.summary.includes(`${rf}°C`)||!before.summary.includes(`${air}°C`))throw Error(`summary is not using live current values: ${before.summary}`);

  const result=await page.evaluate(()=>{
    const e=window.WXAccuracyV3,loc='hrm';
    if(e?.consensus?.[loc]?.hours?.['1']){e.consensus[loc].hours['1'].real_feel=99;e.consensus[loc].hours['1'].temperature_2m=98;e.consensus[loc].hours['1'].precipitation_probability=1}
    const bucket=window.__wxDailyDetailRaw?.[loc];const points=Object.values(bucket?.points||{});if(!points.length)throw Error('no hourly capture');
    for(const p of points){const h=p.data?.hourly;if(!h?.time?.length)continue;const start=typeof idx==='function'?idx(p.data):0;for(let j=0;j<12;j++){const i=start+j;if(Array.isArray(h.precipitation_probability)&&i<h.precipitation_probability.length)h.precipitation_probability[i]=5}const spike=start+4;if(Array.isArray(h.precipitation_probability)&&spike<h.precipitation_probability.length)h.precipitation_probability[spike]=80}
    window.WXRefreshForecastInsights?.();
    const el=document.querySelector('#daySummary');return{summary:el?.textContent||'',source:el?.dataset?.source||'',truth:el?.dataset?.truth||'',fast:window.__wxFastCurrent};
  });
  if(result.source!=='engine3-summary'||result.truth!=='live-current-hourly')throw Error(`wrong summary identity/truth: ${JSON.stringify(result)}`);
  if(/99°C|98°C/.test(result.summary))throw Error(`summary leaked Engine +1h into current wording: ${result.summary}`);
  if(!/80%/.test(result.summary)||!/Rain is likely|meaningful shower chance/i.test(result.summary))throw Error(`summary missed intermediate hourly rain spike: ${result.summary}`);
  if(/NaN|undefined|null/i.test(result.summary))throw Error(`invalid numeric text leaked into summary: ${result.summary}`);
  console.log('Forecast live-current/full-hourly summary QA passed',result.summary);
}catch(e){code=1;console.error(e?.stack||String(e))}finally{await browser.close().catch(()=>{});process.exit(code)}
