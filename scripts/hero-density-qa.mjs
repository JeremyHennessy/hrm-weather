import { chromium } from 'playwright';
import fs from 'node:fs';
const url=process.env.WX_URL||'http://127.0.0.1:4173/app.html';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
const fail=m=>{throw new Error(m)};
try{
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForSelector('.hero',{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('.confidenceOrb .wxConfidenceStable')?.textContent?.includes('%'),null,{timeout:30000});
  await page.waitForTimeout(2500);
  const q=await page.evaluate(()=>{
    const hero=document.querySelector('.hero'),orb=document.querySelector('.confidenceOrb'),stable=orb?.querySelector('.wxConfidenceStable');
    const hourly=[...document.querySelectorAll('.section')].find(s=>s.querySelector('h2')?.textContent.trim()==='Next 12 hours');
    const uv=document.querySelector('#uvGuidance'),details=uv?.querySelector('details'),summary=details?.querySelector('summary');
    const feels=document.querySelector('#feels'),actual=document.querySelector('#actual');
    const fs=feels?parseFloat(getComputedStyle(feels).fontSize):0,as=actual?parseFloat(getComputedStyle(actual).fontSize):0;
    return{orbWidth:orb?.getBoundingClientRect().width||0,orbHeight:orb?.getBoundingClientRect().height||0,orbText:stable?.textContent||'',hourlyImmediatelyAfterHero:hero?.nextElementSibling===hourly,uvVisible:Boolean(uv&&!uv.hidden),uvHasDetails:Boolean(details),uvOpen:Boolean(details?.open),uvSummary:summary?.textContent||'',feelFont:fs,actualFont:as,hourCards:hourly?.querySelectorAll('.hour').length||0};
  });
  if(q.orbWidth>180||q.orbHeight>45)fail(`Forecast Confidence is not compact: ${q.orbWidth}x${q.orbHeight}`);
  if(!/Confidence/.test(q.orbText))fail(`Compact confidence status missing: ${q.orbText}`);
  if(!q.hourlyImmediatelyAfterHero)fail('Next 12 hours is not directly below the hero');
  if(q.hourCards<3)fail(`Hourly cards missing: ${q.hourCards}`);
  if(q.uvVisible&&(!q.uvHasDetails||q.uvOpen||!q.uvSummary.trim()))fail(`UV guidance is not a collapsed one-line details control: ${JSON.stringify(q)}`);
  if(!(q.feelFont>q.actualFont*2))fail(`Real Feel hierarchy regressed: ${q.feelFont}px vs actual ${q.actualFont}px`);
  fs.mkdirSync('screenshots',{recursive:true});await page.screenshot({path:'screenshots/hero-density-qa.png',fullPage:true});
  console.log('Hero density QA passed',q);
}finally{await browser.close()}
