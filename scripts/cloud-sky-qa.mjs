import { chromium } from 'playwright';

const url=process.env.WX_URL||'http://127.0.0.1:4173/app.html';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
let code=0;
try{
  const r=await page.goto(`${url}${url.includes('?')?'&':'?'}cloudqa=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:20000});
  if(!r?.ok())throw Error(`HTTP ${r?.status()}`);
  await page.waitForFunction(()=>window.WXCloudSky&&typeof window.WXCloudSky.classify==='function',{timeout:10000});
  const pure=await page.evaluate(()=>({sun:WXCloudSky.classify(5),mostly:WXCloudSky.classify(32),partly:WXCloudSky.classify(55),cloudy:WXCloudSky.classify(94),wetIcon:WXCloudSky.iconFor(95)}));
  if(pure.sun!=='sunny'||pure.mostly!=='mostly-sunny'||pure.partly!=='partly-cloudy'||pure.cloudy!=='cloudy')throw Error(`cloud thresholds wrong: ${JSON.stringify(pure)}`);

  // Make the test independent of external cloud API timing. Inject a deterministic
  // Halifax cloud snapshot, then verify dry-sky states change while rain stays rain.
  const state=await page.evaluate(()=>{
    localStorage.setItem('wx-loc','hrm');
    const hours=document.querySelector('#hours');
    hours.innerHTML=`
      <div class="card hour"><small>8 p.m.</small><div class="wx">☀️</div><b>20°</b><div class="sub">Actual 20°</div><small>Rain 0%</small></div>
      <div class="card hour"><small>9 p.m.</small><div class="wx">☀️</div><b>19°</b><div class="sub">Actual 19°</div><small>Rain 0%</small></div>
      <div class="card hour"><small>10 p.m.</small><div class="wx">🌧️</div><b>18°</b><div class="sub">Actual 18°</div><small>Rain 70%</small></div>`;
    const now=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Halifax',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false}).format(new Date()).replace(' ','T').slice(0,13);
    const [date,hourS]=now.split('T'),h=Number(hourS);
    const time=n=>`${date}T${String((h+n)%24).padStart(2,'0')}:00`;
    // Expose a test snapshot through the module's own apply contract by mutating the
    // object returned from getSnapshot if present; otherwise refresh/apply functions
    // are still independently covered by server QA.
    const snap={currentCloud:92,currentCode:3,points:3,updatedAt:Date.now(),hourly:[
      {time:time(0),cloud:95,codes:[3,3,3]},
      {time:time(1),cloud:8,codes:[0,1,0]},
      {time:time(2),cloud:95,codes:[61,61,61]}
    ]};
    WXAccuracyV3={consensus:{hrm:{hours:{'1':{cloud_cover:95,cloud_independent_families:5},'3':{cloud_cover:10,cloud_independent_families:5}}}}};
    WXCloudSky.apply(snap);
    const cards=[...document.querySelectorAll('#hours .hour')];
    return{owner:document.documentElement.dataset.wxCloudSky,hero:document.querySelector('.hero')?.dataset?.condition||'',heroCloud:document.querySelector('.hero')?.dataset?.cloudCover||'',cards:cards.map(c=>({icon:c.querySelector('.wx')?.textContent||'',sky:c.querySelector('.wx')?.dataset?.cloudSky||'',cloud:c.dataset.cloudConsensus||''}))};
  });
  if(state.owner!=='halifax-family-cloud-consensus')throw Error(`wrong cloud owner: ${state.owner}`);
  if(state.hero!=='cloud'||Number(state.heroCloud)<85)throw Error(`hero did not become cloudy: ${JSON.stringify(state)}`);
  if(!state.cards[0]?.sky||Number(state.cards[0].cloud)<70)throw Error(`first dry hourly card not cloud-controlled: ${JSON.stringify(state.cards)}`);
  if(state.cards[1]?.sky!=='sunny'&&state.cards[1]?.sky!=='mostly-sunny')throw Error(`sunny transition not represented: ${JSON.stringify(state.cards[1])}`);
  // Wet WMO condition must never be replaced with a dry cloud/sun state.
  if(state.cards[2]?.sky)throw Error(`rain condition was incorrectly replaced by cloud consensus: ${JSON.stringify(state.cards[2])}`);
  console.log('Halifax cloud sky browser QA passed',state);
}catch(e){code=1;console.error(e?.stack||String(e))}finally{await browser.close().catch(()=>{});process.exit(code)}
