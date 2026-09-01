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

  const state=await page.evaluate(()=>{
    localStorage.setItem('wx-loc','hrm');
    document.querySelector('#hours').innerHTML=`
      <div class="card hour"><small>Now</small><div class="wx">☀️</div><b>20°</b><div class="sub">Actual 20°</div><small>Rain 0%</small></div>
      <div class="card hour"><small>+1h</small><div class="wx">☀️</div><b>19°</b><div class="sub">Actual 19°</div><small>Rain 0%</small></div>
      <div class="card hour"><small>+2h</small><div class="wx">🌧️</div><b>18°</b><div class="sub">Actual 18°</div><small>Rain 70%</small></div>`;
    document.querySelector('#days').innerHTML=`
      <div class="v11Day"><small class="v11DayName">Today</small><div class="v11DayWx">☀️</div></div>
      <div class="v11Day"><small class="v11DayName">Tomorrow</small><div class="v11DayWx">☀️</div></div>
      <div class="v11Day"><small class="v11DayName">Day 3</small><div class="v11DayWx">🌧️</div></div>`;

    const local=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Halifax',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false}).format(new Date()).replace(' ','T');
    const [date,hourS]=local.split('T'),h=Number(hourS);
    const addDate=(n)=>{const [y,m,d]=date.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10)};
    const time=(n)=>`${date}T${String((h+n)%24).padStart(2,'0')}:00`;
    const hourly=[
      {time:time(0),cloud:95,codes:[3,3,3]},
      {time:time(1),cloud:8,codes:[0,1,0]},
      {time:time(2),cloud:95,codes:[61,61,61]}
    ];
    for(let day=0;day<3;day++)for(let hour=9;hour<=17;hour++)hourly.push({time:`${addDate(day)}T${String(hour).padStart(2,'0')}:00`,cloud:day===1?86:day===2?92:35,codes:day===2&&hour===14?[3,61,3]:[day===1?3:1,day===1?3:2,day===1?3:1]});
    const snap={currentCloud:92,currentCode:3,points:3,updatedAt:Date.now(),hourly};
    WXAccuracyV3={consensus:{hrm:{hours:{'1':{cloud_cover:95,cloud_independent_families:5},'3':{cloud_cover:10,cloud_independent_families:5},'24':{cloud_cover:88,cloud_independent_families:5},'48':{cloud_cover:90,cloud_independent_families:5}}}}};
    WXCloudSky.apply(snap);
    const cards=[...document.querySelectorAll('#hours .hour')],days=[...document.querySelectorAll('#days .v11Day')];
    const dryState={owner:document.documentElement.dataset.wxCloudSky,hero:document.querySelector('.hero')?.dataset?.condition||'',heroCloud:document.querySelector('.hero')?.dataset?.cloudCover||'',cards:cards.map(c=>({icon:c.querySelector('.wx')?.textContent||'',sky:c.querySelector('.wx')?.dataset?.cloudSky||'',cloud:c.dataset.cloudConsensus||''})),days:days.map(c=>({icon:c.querySelector('.v11DayWx')?.textContent||'',sky:c.querySelector('.v11DayWx')?.dataset?.cloudSky||'',cloud:c.dataset.cloudConsensus||''}))};

    document.querySelector('.hero').dataset.condition='rain';
    WXCloudSky.apply({...snap,currentCode:61});
    dryState.wetHero={condition:document.querySelector('.hero')?.dataset?.condition||'',sky:document.querySelector('#heroIcon')?.dataset?.cloudSky||'',heroOwner:document.querySelector('.hero')?.dataset?.cloudSky||''};
    return dryState;
  });
  if(state.owner!=='halifax-family-cloud-consensus')throw Error(`wrong cloud owner: ${state.owner}`);
  if(state.hero!=='cloud'||Number(state.heroCloud)<85)throw Error(`hero did not become cloudy: ${JSON.stringify(state)}`);
  if(!state.cards[0]?.sky||Number(state.cards[0].cloud)<70)throw Error(`first dry hourly card not cloud-controlled: ${JSON.stringify(state.cards)}`);
  if(!state.cards[1]?.sky||Number(state.cards[1].cloud)<60)throw Error(`family cloud consensus did not dominate contradictory generic cloud signal: ${JSON.stringify(state.cards[1])}`);
  if(state.cards[2]?.sky)throw Error(`rain hour was incorrectly replaced by cloud consensus: ${JSON.stringify(state.cards[2])}`);
  if(!state.days[1]?.sky||Number(state.days[1].cloud)<70)throw Error(`tomorrow dry-sky daily card not cloud-controlled: ${JSON.stringify(state.days)}`);
  if(state.days[2]?.sky||state.days[2]?.cloud)throw Error(`wet daily card was incorrectly replaced by cloud consensus: ${JSON.stringify(state.days[2])}`);
  if(state.wetHero.condition!=='rain'||state.wetHero.sky||state.wetHero.heroOwner)throw Error(`wet current state retained cloud ownership: ${JSON.stringify(state.wetHero)}`);
  console.log('Halifax cloud sky browser QA passed',state);
}catch(e){code=1;console.error(e?.stack||String(e))}finally{await browser.close().catch(()=>{});process.exit(code)}
