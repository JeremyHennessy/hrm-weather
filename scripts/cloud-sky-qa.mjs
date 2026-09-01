import { chromium } from 'playwright';

const url=process.env.WX_URL||'http://127.0.0.1:4173/app.html';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
let code=0;
try{
  const r=await page.goto(`${url}${url.includes('?')?'&':'?'}cloudqa=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:20000});
  if(!r?.ok())throw Error(`HTTP ${r?.status()}`);
  await page.waitForFunction(()=>window.WXCloudSky&&typeof window.WXCloudSky.classify==='function',{timeout:10000});
  const pure=await page.evaluate(()=>({sun:WXCloudSky.classify(5),mostly:WXCloudSky.classify(32),partly:WXCloudSky.classify(55),cloudy:WXCloudSky.classify(94)}));
  if(pure.sun!=='sunny'||pure.mostly!=='mostly-sunny'||pure.partly!=='partly-cloudy'||pure.cloudy!=='cloudy')throw Error(`cloud thresholds wrong: ${JSON.stringify(pure)}`);

  // Reproduce the production import-order race deliberately: render weather
  // icons to SVG while Halifax cloud ownership is disabled. The SVG renderer
  // must preserve the original categorical weather type in data-wx-raw so the
  // Halifax dry-sky controller can safely take ownership afterward.
  await page.evaluate(()=>{
    localStorage.setItem('wx-loc','uws');
    const hero=document.querySelector('.hero');hero.dataset.condition='partly';
    const heroIcon=document.querySelector('#heroIcon');heroIcon.removeAttribute('data-wx-raw');heroIcon.removeAttribute('data-cloud-sky');heroIcon.innerHTML='⛅️';
    document.querySelector('#hours').innerHTML=`
      <div class="card hour"><small>Now</small><div class="wx">☀️</div><b>20°</b><div class="sub">Actual 20°</div><small>Rain 0%</small></div>
      <div class="card hour"><small>+1h</small><div class="wx">☀️</div><b>19°</b><div class="sub">Actual 19°</div><small>Rain 0%</small></div>
      <div class="card hour"><small>+2h</small><div class="wx">🌧️</div><b>18°</b><div class="sub">Actual 18°</div><small>Rain 70%</small></div>`;
    document.querySelector('#days').innerHTML=`
      <div class="v11Day"><small class="v11DayName">Today</small><div class="v11DayWx">☀️</div></div>
      <div class="v11Day"><small class="v11DayName">Tomorrow</small><div class="v11DayWx">☀️</div></div>
      <div class="v11Day"><small class="v11DayName">Day 3</small><div class="v11DayWx">🌧️</div></div>`;
    WXAccuracyV3={consensus:{hrm:{hours:{'1':{cloud_cover:95,cloud_independent_families:5},'3':{cloud_cover:10,cloud_independent_families:5},'6':{cloud_cover:35,cloud_independent_families:5},'12':{cloud_cover:45,cloud_independent_families:5},'24':{cloud_cover:88,cloud_independent_families:5},'48':{cloud_cover:90,cloud_independent_families:5},'72':{cloud_cover:30,cloud_independent_families:5}}}}};
  });

  await page.waitForFunction(()=>{
    const icons=[document.querySelector('#heroIcon'),...document.querySelectorAll('#hours .wx'),...document.querySelectorAll('#days .v11DayWx')];
    return icons.length===7&&icons.every(x=>x?.querySelector('.wcIcon'));
  },{timeout:5000});

  const source=await page.evaluate(()=>({
    hero:document.querySelector('#heroIcon')?.dataset?.wxRaw||'',
    hours:[...document.querySelectorAll('#hours .wx')].map(x=>x.dataset.wxRaw||''),
    days:[...document.querySelectorAll('#days .v11DayWx')].map(x=>x.dataset.wxRaw||'')
  }));
  if(!source.hero.includes('⛅')||!source.hours[0]?.includes('☀')||!source.hours[1]?.includes('☀')||!source.hours[2]?.includes('🌧'))throw Error(`SVG renderer lost hourly weather categories: ${JSON.stringify(source)}`);
  if(!source.days[0]?.includes('☀')||!source.days[1]?.includes('☀')||!source.days[2]?.includes('🌧'))throw Error(`SVG renderer lost daily weather categories: ${JSON.stringify(source)}`);

  const state=await page.evaluate(()=>{
    localStorage.setItem('wx-loc','hrm');
    WXCloudSky.apply();
    const hero=document.querySelector('.hero'),heroIcon=document.querySelector('#heroIcon'),cards=[...document.querySelectorAll('#hours .hour')],days=[...document.querySelectorAll('#days .v11Day')];
    const dryState={owner:document.documentElement.dataset.wxCloudSky,hero:hero.dataset.condition||'',heroCloud:hero.dataset.cloudCover||'',cards:cards.map(c=>({raw:c.querySelector('.wx')?.dataset?.wxRaw||'',sky:c.querySelector('.wx')?.dataset?.cloudSky||'',cloud:c.dataset.cloudConsensus||''})),days:days.map(c=>({raw:c.querySelector('.v11DayWx')?.dataset?.wxRaw||'',sky:c.querySelector('.v11DayWx')?.dataset?.cloudSky||'',cloud:c.dataset.cloudConsensus||''}))};
    hero.dataset.condition='rain';heroIcon.dataset.wxRaw='🌧️';
    WXCloudSky.apply();
    dryState.wetHero={condition:hero.dataset.condition||'',sky:heroIcon.dataset.cloudSky||'',heroOwner:hero.dataset.cloudSky||'',raw:heroIcon.dataset.wxRaw||''};
    return dryState;
  });
  if(state.owner!=='halifax-family-cloud-consensus')throw Error(`wrong cloud owner: ${state.owner}`);
  if(state.hero!=='cloud'||Number(state.heroCloud)<85)throw Error(`hero did not become cloudy: ${JSON.stringify(state)}`);
  if(!state.cards[0]?.sky||Number(state.cards[0].cloud)<85)throw Error(`first dry SVG hourly card not family-cloud-controlled: ${JSON.stringify(state.cards)}`);
  if(!state.cards[1]?.sky||Number(state.cards[1].cloud)<85)throw Error(`second dry SVG hourly card not family-cloud-controlled: ${JSON.stringify(state.cards[1])}`);
  if(state.cards[2]?.sky||!state.cards[2]?.raw.includes('🌧'))throw Error(`rain SVG hour was incorrectly replaced or lost category: ${JSON.stringify(state.cards[2])}`);
  if(!state.days[1]?.sky||Number(state.days[1].cloud)<80)throw Error(`tomorrow dry SVG daily card not cloud-controlled: ${JSON.stringify(state.days)}`);
  if(state.days[2]?.sky||state.days[2]?.cloud||!state.days[2]?.raw.includes('🌧'))throw Error(`wet SVG daily card was incorrectly replaced or lost category: ${JSON.stringify(state.days[2])}`);
  if(state.wetHero.condition!=='rain'||state.wetHero.sky||state.wetHero.heroOwner||!state.wetHero.raw.includes('🌧'))throw Error(`wet current state retained cloud ownership or lost rain type: ${JSON.stringify(state.wetHero)}`);
  console.log('Halifax cloud sky SVG handoff QA passed',state);
}catch(e){code=1;console.error(e?.stack||String(e))}finally{await browser.close().catch(()=>{});process.exit(code)}
