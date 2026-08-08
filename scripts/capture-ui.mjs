import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

await fs.mkdir('screenshots',{recursive:true});
const root=path.resolve('.');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const requests=[];let server=null,browser=null,page=null,stage='boot',fatal=null,dataMode='not-started',url='',responseStatus=null;
const errors=[];

async function writeReport(extra={}){
  let bodyPreview='',title='',pageUrl='',tabs=[],realFeel=null,actual=null,safeArea=null;
  try{if(page){bodyPreview=(await page.locator('body').innerText({timeout:1000})).slice(0,1000);title=await page.title();pageUrl=page.url();tabs=(await page.locator('.tab').allTextContents()).map(x=>x.trim());realFeel=await page.locator('#feels').textContent({timeout:500}).catch(()=>null);actual=await page.locator('#actual').textContent({timeout:500}).catch(()=>null);safeArea=await page.evaluate(()=>({style:document.getElementById('wx-safe-area')?.textContent||'',paddingTop:document.querySelector('.app')?getComputedStyle(document.querySelector('.app')).paddingTop:null,headerTop:document.querySelector('header')?.getBoundingClientRect().top??null})).catch(()=>null)}}catch{}
  const expected=['HRM Core','Moncton','Shediac','Lunenburg','Wolfville Area'];
  const missingTabs=expected.filter(x=>!tabs.includes(x));
  const forbidden=['Feels Like','feels-like','FEELS HIGH','feels max'];
  const terminologyHits=forbidden.filter(x=>bodyPreview.includes(x));
  const report={captured_at:new Date().toISOString(),stage,fatal,url,page_url:pageUrl,response_status:responseStatus,title,data_mode:dataMode,console_errors:errors,terminology_hits:terminologyHits,missing_tabs:missingTabs,safe_area:safeArea,real_feel:realFeel,actual,tabs,body_preview:bodyPreview,requests:requests.slice(-40),...extra};
  await fs.writeFile('screenshots/report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  return report;
}

try{
  stage='start-server';
  let base=process.env.WX_URL;
  if(!base){
    server=http.createServer(async(req,res)=>{
      const u=new URL(req.url,'http://127.0.0.1');let p=decodeURIComponent(u.pathname);if(p==='/'||p==='')p='/app.html';
      const file=path.resolve(root,'.'+p);requests.push({path:p,file});
      try{
        if(!(file===root||file.startsWith(root+path.sep))){res.writeHead(403);return res.end('forbidden')}
        const data=await fs.readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(data);
      }catch(e){requests.push({error:String(e),path:p});res.writeHead(404,{'content-type':'text/plain'});res.end('not found')}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
    base=`http://127.0.0.1:${server.address().port}/app.html`;
  }
  url=`${base}${base.includes('?')?'&':'?'}shot=${Date.now()}`;

  stage='launch-browser';browser=await chromium.launch({headless:true});
  page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('pageerror',e=>errors.push(String(e)));

  stage='goto';const resp=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});responseStatus=resp?.status()??null;
  stage='verify-dom';const feelsCount=await page.locator('#feels').count();
  if(!feelsCount)throw new Error(`App DOM missing #feels (HTTP ${responseStatus}, url ${page.url()})`);

  dataMode='browser-live';stage='wait-weather';
  try{await page.waitForFunction(()=>{const t=document.querySelector('#feels')?.textContent||'';return t&&!t.includes('--')},{timeout:12000})}
  catch{
    dataMode='node-live-fallback';stage='fallback-weather';
    try{
      const q=new URLSearchParams({latitude:'44.6822',longitude:'-63.6012',timezone:'America/Halifax',current:'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code',hourly:'precipitation_probability,uv_index',forecast_days:'1',temperature_unit:'celsius',wind_speed_unit:'kmh'});
      const r=await fetch('https://api.open-meteo.com/v1/forecast?'+q,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('Open-Meteo '+r.status);const j=await r.json();
      const i=Math.max(0,(j.hourly?.time||[]).findIndex(t=>t.slice(0,13)>=new Date().toISOString().slice(0,13)));
      await page.evaluate(({air,feel,rain,wind,gust,uv})=>{const set=(id,text)=>{const e=document.getElementById(id);if(e)e.textContent=text};set('feels',Number.isFinite(feel)?`${feel.toFixed(1)}°`:'--°');const a=document.getElementById('actual');if(a)a.innerHTML=`Actual <b>${Number.isFinite(air)?air.toFixed(1):'--'}°</b>`;set('range',Number.isFinite(feel)?`Real Feel range ${Math.round(feel-1)}–${Math.round(feel+1)}°`:'Real Feel range --');set('rain',`${Math.round(rain??0)}%`);set('wind',`${Math.round(wind??0)} / ${Math.round(gust??0)}`);set('uv',Number.isFinite(uv)?uv.toFixed(1):'--')},{air:j.current?.temperature_2m,feel:j.current?.apparent_temperature,rain:j.hourly?.precipitation_probability?.[i],wind:j.current?.wind_speed_10m,gust:j.current?.wind_gusts_10m,uv:j.hourly?.uv_index?.[i]});
    }catch(e){errors.push('Fallback weather injection failed: '+String(e));dataMode='ui-shell-only'}
  }

  stage='capture-iphone';await page.waitForTimeout(500);await page.screenshot({path:'screenshots/live-iphone.png',fullPage:true});
  stage='capture-card';const hero=page.locator('.hero').first();if(await hero.count())await hero.screenshot({path:'screenshots/hero-share-card.png'});
  stage='capture-desktop';await page.setViewportSize({width:1365,height:900});await page.waitForTimeout(250);await page.screenshot({path:'screenshots/live-desktop.png',fullPage:true});
  stage='report';const report=await writeReport();
  if(report.terminology_hits.length||report.missing_tabs.length||!report.safe_area?.style?.includes('safe-area-inset-top')){fatal='QA assertion failed';process.exitCode=3}
}catch(e){
  fatal=String(e?.stack||e);errors.push(fatal);stage='failed';
  try{if(page)await page.screenshot({path:'screenshots/failure.png',fullPage:true})}catch{}
  await writeReport();process.exitCode=2;
}finally{
  try{if(browser)await browser.close()}catch{}
  try{if(server)await new Promise(r=>server.close(r))}catch{}
}
