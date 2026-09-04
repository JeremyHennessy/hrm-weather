import { chromium } from 'playwright';

const url=process.env.WX_URL||'http://127.0.0.1:4173/app.html';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const dry=s=>/[☀🌤⛅🌥☁🌙]/u.test(String(s||''));
const rain=s=>/[🌧🌦]/u.test(String(s||''));
let code=0;
try{
  const r=await page.goto(`${url}${url.includes('?')?'&':'?'}cloudqa=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:20000});
  if(!r?.ok())throw Error(`HTTP ${r?.status()}`);
  await page.waitForFunction(()=>window.WXCloudSky&&typeof window.WXCloudSky.classify==='function',null,{timeout:10000});
  const pure=await page.evaluate(()=>({sun:WXCloudSky.classify(5),mostly:WXCloudSky.classify(32),partly:WXCloudSky.classify(55),cloudy:WXCloudSky.classify(94)}));
  if(pure.sun!=='sunny'||pure.mostly!=='mostly-sunny'||pure.partly!=='partly-cloudy'||pure.cloudy!=='cloudy')throw Error(`cloud thresholds wrong: ${JSON.stringify(pure)}`);

  // Synthetic Halifax solar data makes the sunrise/sunset boundary deterministic.
  // The production layer reads the same daily sunrise/sunset fields captured from
  // the real base forecast and never makes an extra weather request.
  await page.evaluate(()=>{
    localStorage.setItem('wx-loc','uws');
    window.__wxDailyDetailRaw={hrm:{timezone:'America/Halifax',updatedAt:Date.now(),points:{test:{lat:44.6488,lon:-63.5752,capturedAt:Date.now(),data:{
      hourly:{time:['2099-09-04T17:00','2099-09-04T20:00','2099-09-04T23:00']},
      daily:{time:['2099-09-04'],sunrise:['2099-09-04T06:40'],sunset:['2099-09-04T19:46']}
    }}}}};
    const hero=document.querySelector('.hero');hero.dataset.condition='partly';
    const heroIcon=document.querySelector('#heroIcon');heroIcon.removeAttribute('data-wx-raw');heroIcon.textContent='⛅️';
    document.querySelector('#hours').innerHTML=`
      <div class="card hour"><small>5 p.m.</small><div class="wx">☀️</div><b>20°</b><div class="sub">Actual 20°</div><small>Rain 0%</small></div>
      <div class="card hour"><small>8 p.m.</small><div class="wx">☀️</div><b>19°</b><div class="sub">Actual 19°</div><small>Rain 0%</small></div>
      <div class="card hour"><small>11 p.m.</small><div class="wx">🌦️</div><b>18°</b><div class="sub">Actual 18°</div><small>Rain 40%</small></div>`;
    document.querySelector('#days').innerHTML=`
      <div class="v11Day"><small class="v11DayName">Today</small><div class="v11DayWx">☀️</div></div>
      <div class="v11Day"><small class="v11DayName">Tomorrow</small><div class="v11DayWx">☀️</div></div>
      <div class="v11Day"><small class="v11DayName">Day 3</small><div class="v11DayWx">🌧️</div></div>`;
    window.WXAccuracyV3={consensus:{hrm:{hours:{'1':{cloud_cover:10,cloud_independent_families:5},'3':{cloud_cover:10,cloud_independent_families:5},'6':{cloud_cover:35,cloud_independent_families:5},'12':{cloud_cover:45,cloud_independent_families:5},'24':{cloud_cover:88,cloud_independent_families:5},'48':{cloud_cover:90,cloud_independent_families:5},'72':{cloud_cover:30,cloud_independent_families:5}}}}};
  });

  // Weather SVG decoration must preserve the original category so the later
  // cloud/solar owner can tell dry from wet even after emoji text is replaced.
  await page.waitForFunction(()=>{
    const icons=[document.querySelector('#heroIcon'),...document.querySelectorAll('#hours .wx'),...document.querySelectorAll('#days .v11DayWx')];
    return icons.length===7&&icons.every(x=>x?.querySelector('.wcIcon')&&x.dataset.wxRaw);
  },null,{timeout:5000});
  const preserved=await page.evaluate(()=>({hero:document.querySelector('#heroIcon')?.dataset.wxRaw||'',hours:[...document.querySelectorAll('#hours .wx')].map(x=>x.dataset.wxRaw||''),days:[...document.querySelectorAll('#days .v11DayWx')].map(x=>x.dataset.wxRaw||'')}));
  if(!dry(preserved.hero)||!dry(preserved.hours[0])||!dry(preserved.hours[1])||!rain(preserved.hours[2]))throw Error(`SVG renderer lost hourly weather category: ${JSON.stringify(preserved)}`);
  if(!dry(preserved.days[0])||!dry(preserved.days[1])||!rain(preserved.days[2]))throw Error(`SVG renderer lost daily weather category: ${JSON.stringify(preserved)}`);

  const solar=await page.evaluate(()=>({
    before:WXCloudSky.solarForTime('2099-09-04T19:45'),
    at:WXCloudSky.solarForTime('2099-09-04T19:46'),
    eleven:WXCloudSky.solarForTime('2099-09-04T23:00'),
    clearNight:WXCloudSky.nightIconFor(5),partlyNight:WXCloudSky.nightIconFor(55),cloudyNight:WXCloudSky.nightIconFor(94)
  }));
  if(solar.before?.night!==false||solar.at?.night!==true||solar.eleven?.night!==true)throw Error(`sunset boundary wrong: ${JSON.stringify(solar)}`);
  if(solar.clearNight!=='🌙'||solar.partlyNight!=='🌙☁️'||solar.cloudyNight!=='☁️')throw Error(`night icon mapping wrong: ${JSON.stringify(solar)}`);

  const state=await page.evaluate(async()=>{
    localStorage.setItem('wx-loc','hrm');
    WXCloudSky.apply();
    await new Promise(r=>setTimeout(r,100));
    const hero=document.querySelector('.hero'),heroIcon=document.querySelector('#heroIcon'),cards=[...document.querySelectorAll('#hours .hour')],days=[...document.querySelectorAll('#days .v11Day')];
    const out={owner:document.documentElement.dataset.wxCloudSky,hero:hero.dataset.condition||'',heroCloud:hero.dataset.cloudCover||'',cards:cards.map(c=>({raw:c.querySelector('.wx')?.dataset.wxRaw||'',sky:c.querySelector('.wx')?.dataset.cloudSky||'',solar:c.querySelector('.wx')?.dataset.solarPhase||'',cardSolar:c.dataset.solarPhase||'',cloud:c.dataset.cloudConsensus||'',svg:Boolean(c.querySelector('.wx .wcIcon'))})),days:days.map(c=>({raw:c.querySelector('.v11DayWx')?.dataset.wxRaw||'',sky:c.querySelector('.v11DayWx')?.dataset.cloudSky||'',cloud:c.dataset.cloudConsensus||''}))};
    hero.dataset.condition='rain';heroIcon.dataset.wxRaw='🌧️';WXCloudSky.apply();
    out.wetHero={condition:hero.dataset.condition||'',sky:heroIcon.dataset.cloudSky||'',heroOwner:hero.dataset.cloudSky||'',raw:heroIcon.dataset.wxRaw||''};
    return out;
  });
  if(state.owner!=='halifax-family-cloud-consensus')throw Error(`wrong cloud owner: ${state.owner}`);
  if(state.cards[0]?.solar!=='day'||!/☀|🌤/u.test(state.cards[0]?.raw||''))throw Error(`5 p.m. dry hour did not remain daylight: ${JSON.stringify(state.cards[0])}`);
  if(state.cards[1]?.solar!=='night'||!/🌙/u.test(state.cards[1]?.raw||'')||/[☀🌤]/u.test(state.cards[1]?.raw||''))throw Error(`8 p.m. post-sunset dry hour still solar: ${JSON.stringify(state.cards[1])}`);
  if(state.cards[2]?.solar!=='night'||!/🌙/u.test(state.cards[2]?.raw||'')||!/🌧/u.test(state.cards[2]?.raw||'')||state.cards[2]?.sky)throw Error(`11 p.m. showers retained a daytime-sun glyph or cloud owner: ${JSON.stringify(state.cards[2])}`);
  if(!state.cards.every(x=>x.svg))throw Error(`night/day icons were not rendered as SVG: ${JSON.stringify(state.cards)}`);
  if(!state.days[1]?.sky||Number(state.days[1].cloud)<80)throw Error(`tomorrow dry-sky daily card not cloud-controlled: ${JSON.stringify(state.days)}`);
  if(state.days[2]?.sky||state.days[2]?.cloud)throw Error(`wet daily card was incorrectly replaced by cloud consensus: ${JSON.stringify(state.days[2])}`);
  if(state.wetHero.condition!=='rain'||state.wetHero.sky||state.wetHero.heroOwner||!state.wetHero.raw.includes('🌧'))throw Error(`wet current state retained cloud ownership or lost rain type: ${JSON.stringify(state.wetHero)}`);
  console.log('Halifax cloud + solar day/night browser QA passed',{solar,preserved,state});
}catch(e){code=1;console.error(e?.stack||String(e))}finally{await browser.close().catch(()=>{});process.exit(code)}
