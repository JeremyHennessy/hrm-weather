import { chromium } from 'playwright';

const base=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const url=`${base}${base.includes('?')?'&':'?'}summaryqa=${Date.now()}`;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
let code=0;
try{
  const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});if(!r?.ok())throw Error(`HTTP ${r?.status()}`);
  await page.waitForFunction(()=>window.__wxFastCurrent?.painted&&document.querySelectorAll('#hours .hour').length>=8,{timeout:20000});
  await page.waitForFunction(()=>document.querySelector('#daySummary')?.dataset?.source==='live-current-hourly-summary',{timeout:8000});
  const state=await page.evaluate(()=>{
    const summary=document.querySelector('#daySummary');
    const cards=[...document.querySelectorAll('#hours .hour')].slice(0,12).map(card=>{const smalls=[...card.querySelectorAll('small')],txt=smalls.map(x=>x.textContent).join(' '),m=txt.match(/Rain\s+(\d+(?:\.\d+)?)%/i);return{time:smalls[0]?.textContent?.trim()||'',rain:m?Number(m[1]):null}}).filter(x=>Number.isFinite(x.rain));
    const peak=cards.length?cards.reduce((a,b)=>b.rain>a.rain?b:a,cards[0]):null;
    return{text:summary?.textContent?.trim()||'',source:summary?.dataset?.source||'',count:Number(summary?.dataset?.hourlyCount||0),fast:window.__wxFastCurrent,peak};
  });
  if(state.source!=='live-current-hourly-summary')throw Error(`wrong summary owner: ${state.source}`);
  if(state.count<8)throw Error(`summary did not inspect rendered hourly series: ${state.count}`);
  const rf=Math.round(Number(state.fast?.feel));if(!state.text.includes(`${rf}°C`))throw Error(`summary does not use live current Real Feel ${rf}°C: ${state.text}`);
  if(/next 12 hours/i.test(state.text)&&state.count<12)throw Error(`generic 12h wording without 12 displayed hours: ${state.text}`);
  if(state.peak&&state.peak.rain>=20){const p=Math.round(state.peak.rain);if(!state.text.includes(`${p}%`))throw Error(`summary missed displayed peak rain ${p}%: ${state.text}`)}
  if(/undefined|null|NaN/i.test(state.text))throw Error(`invalid missing-value prose: ${state.text}`);
  console.log('Forecast summary QA passed',state);
}catch(e){code=1;console.error(e?.stack||String(e))}finally{await browser.close().catch(()=>{});process.exit(code)}
