import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const url=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const errors=[];
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
page.on('pageerror',e=>errors.push(String(e)));
await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForFunction(()=>document.querySelectorAll('#days .v11Day').length>=2,{timeout:60000});
await page.waitForFunction(()=>{
  const k=localStorage.getItem('wx-loc')||'hrm',b=window.__wxDailyDetailRaw?.[k];
  return b&&Object.keys(b.points||{}).length>=1;
},{timeout:60000});
const cards=page.locator('#days .v11Day');
await cards.nth(1).click();
await page.waitForFunction(()=>{const el=document.getElementById('dayDetail');return el&&!el.hidden&&el.dataset.owner==='daily-detail'},{timeout:15000});
await page.waitForFunction(()=>document.querySelectorAll('#dayDetailHours .dayDetailHour').length>=18,{timeout:15000});
const state=await page.evaluate(()=>({
  title:document.getElementById('dayDetailTitle')?.textContent||'',
  summary:document.getElementById('dayDetailSummary')?.textContent||'',
  hours:document.querySelectorAll('#dayDetailHours .dayDetailHour').length,
  expanded:document.querySelectorAll('#days .v11Day')[1]?.getAttribute('aria-expanded'),
  controls:document.querySelectorAll('#days .v11Day')[1]?.getAttribute('aria-controls'),
  feel:document.querySelector('.dayDetailMetric[data-kind="feel"] strong')?.textContent||'',
  actual:document.querySelector('.dayDetailMetric[data-kind="actual"] strong')?.textContent||'',
  rain:document.querySelector('.dayDetailMetric[data-kind="rain"] strong')?.textContent||'',
  hourlyLabels:[...document.querySelectorAll('#dayDetailHours .dayDetailHour')].slice(0,4).map(x=>x.textContent||''),
  viewport:{inner:innerWidth,scroll:document.documentElement.scrollWidth}
}));
if(!state.title||!/\w/.test(state.title))throw new Error('Day detail title missing');
if(!state.summary||state.summary.includes('still loading'))throw new Error('Day detail summary did not resolve');
if(state.hours<18)throw new Error(`Expected full-day hourly detail, got ${state.hours} hours`);
if(state.expanded!=='true'||state.controls!=='dayDetail')throw new Error('Selected daily card accessibility state missing');
if(!/°/.test(state.feel)||!/°/.test(state.actual)||!/%/.test(state.rain))throw new Error('Day detail headline metrics incomplete');
if(state.hourlyLabels.some(x=>!x.includes('Real Feel')||!x.includes('Actual')||!x.includes('Rain')))throw new Error('Hourly detail lost Real Feel / Actual / Rain hierarchy');
if(state.viewport.scroll>state.viewport.inner+2)throw new Error(`Day detail caused page horizontal overflow: ${state.viewport.scroll} > ${state.viewport.inner}`);
await fs.mkdir('screenshots',{recursive:true});
await page.screenshot({path:'screenshots/daily-detail.png',fullPage:true});
if(errors.length)throw new Error(`Browser errors: ${errors.join(' | ')}`);
console.log('Daily detail QA passed',state);
await browser.close();
