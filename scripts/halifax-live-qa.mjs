import { chromium } from 'playwright';
import fs from 'node:fs/promises';

await fs.mkdir('screenshots',{recursive:true});
const base=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const url=`${base}${base.includes('?')?'&':'?'}halifax-live=${Date.now()}`;
const browser=await chromium.launch({headless:true});
let exitCode=0;

const wet=/[⛈🌧🌦🌨❄🌫]/u;
const dry=/[☀🌤⛅🌥☁]/u;
const iconText=el=>`${el?.dataset?.wxRaw||''} ${el?.textContent||''}`.trim();

try{
  const ctx=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  await ctx.addInitScript(()=>localStorage.setItem('wx-loc','hrm'));
  const page=await ctx.newPage();
  const consoleErrors=[];
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
  page.on('pageerror',e=>consoleErrors.push(String(e)));

  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
  if(!response?.ok())throw new Error(`Halifax app HTTP ${response?.status()??'no response'}`);

  await page.waitForFunction(()=>window.WXCloudSky&&window.WXAccuracyV3,{timeout:20000});
  await page.waitForFunction(()=>{
    const e=window.WXAccuracyV3;
    return document.documentElement.dataset.wxCloudSky==='halifax-family-cloud-consensus'&&
      e?.cloud_sky?.owner==='accuracy-engine-3-family-cloud-consensus'&&
      Object.keys(e?.consensus?.hrm?.hours||{}).length>0;
  },{timeout:20000});
  await page.waitForFunction(()=>document.querySelector('#heroIcon')&&document.querySelectorAll('#hours .hour').length>0&&document.querySelectorAll('#days .v11Day').length>0,{timeout:20000});
  await page.waitForTimeout(900);

  const state=await page.evaluate(()=>{
    const iconText=el=>`${el?.dataset?.wxRaw||''} ${el?.textContent||''}`.trim();
    const e=window.WXAccuracyV3||{};
    const hero=document.querySelector('.hero'),heroIcon=document.querySelector('#heroIcon');
    const hours=[...document.querySelectorAll('#hours .hour')].slice(0,12).map((card,i)=>{const el=card.querySelector('.wx');return{index:i,label:card.querySelector('small')?.textContent?.trim()||'',icon:iconText(el),sky:el?.dataset?.cloudSky||'',cloud:el?.dataset?.cloudCover||'',owner:card.dataset.cloudConsensus||''}});
    const days=[...document.querySelectorAll('#days .v11Day')].slice(0,7).map((card,i)=>{const el=card.querySelector('.v11DayWx');return{index:i,label:card.querySelector('.v11DayName')?.textContent?.trim()||'',icon:iconText(el),sky:el?.dataset?.cloudSky||'',cloud:el?.dataset?.cloudCover||'',owner:card.dataset.cloudConsensus||'',rain:card.querySelector('.v11DayRain')?.textContent?.trim()||''}});
    const hrmHours=Object.entries(e?.consensus?.hrm?.hours||{}).map(([lead,row])=>({lead:Number(lead),cloud:Number(row?.cloud_cover??row?.cloud_consensus?.cloud_cover),families:Number(row?.cloud_independent_families??row?.cloud_consensus?.independent_families??0),sky:row?.sky_condition||row?.cloud_consensus?.sky_condition||''}));
    return{
      url:location.href,
      loc:localStorage.getItem('wx-loc')||'hrm',
      documentOwner:document.documentElement.dataset.wxCloudSky||'',
      engineOwner:e?.cloud_sky?.owner||'',
      engineStatus:e?.cloud_sky?.status||'',
      engineReady:Number(e?.cloud_sky?.forecast_points_ready||0),
      generatedAt:e?.generated_at||e?.updated_at||e?.timestamp||'',
      collectorFeeds:Number(e?.collector?.deterministic_forecasts||0),
      hero:{condition:hero?.dataset?.condition||'',icon:iconText(heroIcon),sky:heroIcon?.dataset?.cloudSky||'',cloud:heroIcon?.dataset?.cloudCover||'',heroOwner:hero?.dataset?.cloudSky||'',heroCloud:hero?.dataset?.cloudCover||''},
      hours,days,hrmHours
    };
  });

  if(state.loc!=='hrm')throw new Error(`Halifax live QA opened wrong location: ${state.loc}`);
  if(state.documentOwner!=='halifax-family-cloud-consensus')throw new Error(`Halifax cloud document owner missing: ${state.documentOwner||'none'}`);
  if(state.engineOwner!=='accuracy-engine-3-family-cloud-consensus')throw new Error(`Engine 3 cloud owner missing: ${state.engineOwner||'none'}`);
  if(state.engineReady<1||!state.hrmHours.some(x=>Number.isFinite(x.cloud)))throw new Error(`No live Engine 3 Halifax cloud consensus: ${JSON.stringify(state.hrmHours)}`);

  const heroWet=wet.test(state.hero.icon)||['rain','storm','snow','fog'].includes(state.hero.condition);
  if(heroWet){
    if(state.hero.sky||state.hero.heroOwner)throw new Error(`Wet Halifax hero retained dry-sky ownership: ${JSON.stringify(state.hero)}`);
  }else if(dry.test(state.hero.icon)){
    if(!state.hero.sky||state.hero.heroOwner!=='engine3-family-cloud-consensus')throw new Error(`Dry Halifax hero is not cloud-consensus-owned: ${JSON.stringify(state.hero)}`);
  }

  let dryHours=0;
  for(const row of state.hours){
    if(wet.test(row.icon)){
      if(row.sky||row.owner)throw new Error(`Wet hourly state was overwritten by cloud consensus: ${JSON.stringify(row)}`);
    }else if(dry.test(row.icon)){
      dryHours++;
      if(!row.sky||!row.owner)throw new Error(`Dry hourly state lacks cloud consensus ownership: ${JSON.stringify(row)}`);
    }
  }

  let dryDays=0;
  for(const row of state.days.slice(0,4)){
    if(wet.test(row.icon)){
      if(row.sky||row.owner)throw new Error(`Wet daily state was overwritten by cloud consensus: ${JSON.stringify(row)}`);
    }else if(dry.test(row.icon)){
      dryDays++;
      if(!row.sky||!row.owner)throw new Error(`Dry daily state lacks cloud consensus ownership: ${JSON.stringify(row)}`);
    }
  }
  if(dryHours===0&&dryDays===0&&!heroWet)throw new Error('No dry Halifax state was available to verify cloud-consensus ownership');

  await page.screenshot({path:'screenshots/halifax-live-iphone.png',fullPage:true});
  await page.setViewportSize({width:1365,height:900});
  await page.waitForTimeout(400);
  await page.screenshot({path:'screenshots/halifax-live-desktop.png',fullPage:true});

  const report={captured_at:new Date().toISOString(),ok:true,state,console_errors:consoleErrors};
  await fs.writeFile('screenshots/halifax-live-report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  await ctx.close();
}catch(err){
  exitCode=1;
  const report={captured_at:new Date().toISOString(),ok:false,url,error:String(err?.stack||err)};
  await fs.writeFile('screenshots/halifax-live-report.json',JSON.stringify(report,null,2)+'\n').catch(()=>{});
  console.error(JSON.stringify(report,null,2));
}finally{
  await browser.close().catch(()=>{});
  process.exit(exitCode);
}
