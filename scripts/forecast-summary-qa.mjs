import { chromium } from 'playwright';

const base=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const url=`${base}${base.includes('?')?'&':'?'}summaryqa=${Date.now()}`;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
let code=0;
try{
  const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});if(!r?.ok())throw Error(`HTTP ${r?.status()}`);
  await page.waitForFunction(()=>document.querySelector('#daySummary')&&document.querySelector('#hours')&&typeof window.WXRefreshForecastSummary==='function',{timeout:15000});
  const state=await page.evaluate(()=>{
    localStorage.setItem('wx-loc','hrm');
    window.__wxFastCurrent={location:'hrm',painted:true,status:'ready',source:'qa-current',feel:23,air:20,points:3,total_points:3,point_values:[]};
    const rain=[5,10,15,20,65,40,25,10,5,5,5,5];
    const feels=[23,23,22,22,21,21,21,20,20,20,20,19];
    const hours=document.querySelector('#hours');
    hours.innerHTML=rain.map((p,i)=>`<div class="card hour"><small>${i+1} p.m.</small><b>${feels[i]}°</b><div class="sub">Actual ${feels[i]-2}°</div><small>Rain ${p}% · Amount 0.0 mm</small></div>`).join('');
    window.WXRefreshForecastSummary();
    const s=document.querySelector('#daySummary');
    return{text:s.textContent.trim(),source:s.dataset.source,count:Number(s.dataset.hourlyCount||0)};
  });
  if(state.source!=='live-current-hourly-summary')throw Error(`wrong summary owner: ${state.source}`);
  if(state.count!==12)throw Error(`summary did not inspect all 12 rendered hours: ${state.count}`);
  if(!state.text.includes('23°C'))throw Error(`summary did not use live current Real Feel: ${state.text}`);
  if(!state.text.includes('65%')||!state.text.includes('5 p.m.'))throw Error(`summary missed displayed rain peak/timing: ${state.text}`);
  if(/undefined|null|NaN/i.test(state.text))throw Error(`invalid missing-value prose: ${state.text}`);
  console.log('Forecast summary QA passed',state);
}catch(e){code=1;console.error(e?.stack||String(e))}finally{await browser.close().catch(()=>{});process.exit(code)}
