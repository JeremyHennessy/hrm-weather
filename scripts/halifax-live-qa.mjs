import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const evidenceDir='halifax-live-evidence';
await fs.rm(evidenceDir,{recursive:true,force:true});
await fs.mkdir(evidenceDir,{recursive:true});
const base=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const url=`${base}${base.includes('?')?'&':'?'}halifax-live=${Date.now()}`;
const browser=await chromium.launch({headless:true});
let exitCode=0,ctx=null,page=null,state=null;
const consoleErrors=[];

const wet=/[⛈🌧🌦🌨❄🌫]/u;
const dry=/[☀🌤⛅🌥☁]/u;

async function saveReport(ok,error=null){
  const report={captured_at:new Date().toISOString(),ok,url,error,state,console_errors:consoleErrors};
  await fs.writeFile(`${evidenceDir}/halifax-live-report.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}

try{
  ctx=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  await ctx.addInitScript(()=>localStorage.setItem('wx-loc','hrm'));
  page=await ctx.newPage();
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

  state=await page.evaluate(()=>{
    const iconText=el=>`${el?.dataset?.wxRaw||''} ${el?.textContent||''}`.trim();
    const e=window.WXAccuracyV3||{};
    const hero=document.querySelector('.hero'),heroIcon=document.querySelector('#heroIcon');
    const hours=[...document.querySelectorAll('#hours .hour')].slice(0,12).map((card,i)=>{const el=card.querySelector('.wx'),smalls=[...card.querySelectorAll('small')].map(x=>x.textContent?.trim()||'');return{index:i,label:smalls[0]||'',icon:iconText(el),sky:el?.dataset?.cloudSky||'',cloud:el?.dataset?.cloudCover||'',owner:card.dataset.cloudConsensus||'',rain:smalls.find(x=>/Rain/i.test(x))||''}});
    const days=[...document.querySelectorAll('#days .v11Day')].slice(0,7).map((card,i)=>{const el=card.querySelector('.v11DayWx');return{index:i,label:card.querySelector('.v11DayName')?.textContent?.trim()||'',icon:iconText(el),sky:el?.dataset?.cloudSky||'',cloud:el?.dataset?.cloudCover||'',owner:card.dataset.cloudConsensus||'',rain:card.querySelector('.v11DayRain')?.textContent?.trim()||''}});
    const hrmHours=Object.entries(e?.consensus?.hrm?.hours||{}).map(([lead,row])=>({lead:Number(lead),cloud:Number(row?.cloud_cover??row?.cloud_consensus?.cloud_cover),families:Number(row?.cloud_independent_families??row?.cloud_consensus?.independent_families??0),sky:row?.sky_condition||row?.cloud_consensus?.sky_condition||'',pop:Number(row?.precipitation_probability),rawPop:Number(row?.raw_precipitation_probability)}));
    return{
      url:location.href,
      loc:localStorage.getItem('wx-loc')||'hrm',
      place:document.querySelector('#place')?.textContent?.trim()||'',
      actual:document.querySelector('#actual')?.textContent?.trim()||'',
      realFeel:document.querySelector('#feels')?.textContent?.trim()||'',
      rainNow:document.querySelector('#rainNow')?.textContent?.trim()||'',
      rainTiming:document.querySelector('#rainTiming')?.textContent?.trim()||'',
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

  // Capture evidence before assertions so every failure is diagnosable.
  await page.screenshot({path:`${evidenceDir}/halifax-live-iphone.png`,fullPage:true});
  await page.setViewportSize({width:1365,height:900});
  await page.waitForTimeout(400);
  await page.screenshot({path:`${evidenceDir}/halifax-live-desktop.png`,fullPage:true});
  await saveReport(false,'assertions pending');

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

  await saveReport(true,null);
  await ctx.close();ctx=null;
}catch(err){
  exitCode=1;
  await saveReport(false,String(err?.stack||err)).catch(()=>{});
  console.error(String(err?.stack||err));
}finally{
  if(ctx)await ctx.close().catch(()=>{});
  await browser.close().catch(()=>{});
  process.exit(exitCode);
}
