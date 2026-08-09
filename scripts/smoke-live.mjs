import { chromium } from 'playwright';

const base=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const url=`${base}${base.includes('?')?'&':'?'}smoke=${Date.now()}`;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
const errors=[];
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
page.on('pageerror',e=>errors.push(String(e)));
const started=Date.now();
try{
  const resp=await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});
  if(!resp||!resp.ok())throw new Error(`Live app HTTP ${resp?.status()??'no response'}`);
  await page.waitForSelector('#feels',{timeout:3000});
  await page.waitForFunction(()=>{const t=document.querySelector('#feels')?.textContent?.trim()||'';return t!==''&&!t.includes('--')},null,{timeout:12000});
  const state=await page.evaluate(()=>({
    feels:document.querySelector('#feels')?.textContent?.trim()||'',
    actual:document.querySelector('#actual')?.textContent?.trim()||'',
    morning:document.querySelector('#morningFeel')?.textContent?.trim()||'',
    updated:document.querySelector('#updated')?.textContent?.trim()||'',
    modelCount:document.querySelector('#modelCount')?.textContent?.trim()||'',
    warn:document.querySelector('#warn')?.textContent?.trim()||'',
    initialShown:Boolean(window.__wxInitialForecastShown),
    complete:Boolean(window.__wxHasCompleteForecast),
    requestHealth:window.WX_REQUEST_HEALTH||null
  }));
  const elapsed=Date.now()-started;
  console.log(JSON.stringify({ok:true,elapsed_ms:elapsed,url,status:resp.status(),...state,console_errors:errors},null,2));
  if(state.feels.includes('--'))throw new Error('Real Feel remained unavailable');
  if(!state.initialShown)throw new Error('Initial forecast render flag was not set');
} finally {
  await browser.close();
}
