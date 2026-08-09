import { chromium } from 'playwright';

const base=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const url=`${base}${base.includes('?')?'&':'?'}smoke=${Date.now()}`;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
const errors=[];
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
page.on('pageerror',e=>errors.push(String(e)));
const started=Date.now();
const deadline=(ms,label)=>new Promise((_,reject)=>setTimeout(()=>reject(new Error(label)),ms));
let exitCode=0;
try{
  const resp=await Promise.race([page.goto(url,{waitUntil:'domcontentloaded',timeout:12000}),deadline(13000,'DOM startup deadline exceeded')]);
  if(!resp||!resp.ok())throw new Error(`Live app HTTP ${resp?.status()??'no response'}`);
  await Promise.race([
    page.waitForFunction(()=>{const t=document.querySelector('#feels')?.textContent?.trim()||'';return t!==''&&!t.includes('--')},null,{polling:100,timeout:10000}),
    deadline(10500,'Real Feel did not render within 10 seconds')
  ]);
  const state=await Promise.race([page.evaluate(()=>({
    feels:document.querySelector('#feels')?.textContent?.trim()||'',
    actual:document.querySelector('#actual')?.textContent?.trim()||'',
    morning:document.querySelector('#morningFeel')?.textContent?.trim()||'',
    updated:document.querySelector('#updated')?.textContent?.trim()||'',
    modelCount:document.querySelector('#modelCount')?.textContent?.trim()||'',
    warn:document.querySelector('#warn')?.textContent?.trim()||'',
    initialShown:Boolean(window.__wxInitialForecastShown),
    complete:Boolean(window.__wxHasCompleteForecast),
    requestHealth:window.WX_REQUEST_HEALTH||null
  })),deadline(2000,'Could not read live page state')]);
  console.log(JSON.stringify({ok:true,elapsed_ms:Date.now()-started,url,status:resp.status(),...state,console_errors:errors},null,2));
  if(state.feels.includes('--'))throw new Error('Real Feel remained unavailable');
  if(!state.initialShown)throw new Error('Initial forecast render flag was not set');
}catch(err){
  exitCode=1;
  let state=null;
  try{state=await Promise.race([page.evaluate(()=>({
    readyState:document.readyState,
    feels:document.querySelector('#feels')?.textContent?.trim()||'',
    actual:document.querySelector('#actual')?.textContent?.trim()||'',
    updated:document.querySelector('#updated')?.textContent?.trim()||'',
    warn:document.querySelector('#warn')?.textContent?.trim()||'',
    initialShown:Boolean(window.__wxInitialForecastShown),
    complete:Boolean(window.__wxHasCompleteForecast),
    requestHealth:window.WX_REQUEST_HEALTH||null
  })),deadline(1500,'state read timeout')])}catch{}
  console.error(JSON.stringify({ok:false,elapsed_ms:Date.now()-started,error:String(err?.stack||err),url,state,console_errors:errors},null,2));
}finally{
  try{await Promise.race([browser.close(),new Promise(resolve=>setTimeout(resolve,1500))])}catch{}
  process.exit(exitCode);
}
