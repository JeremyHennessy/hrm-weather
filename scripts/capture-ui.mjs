import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

await fs.mkdir('screenshots', { recursive: true });

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
let server=null;
let base=process.env.WX_URL;
if(!base){
  server=http.createServer(async(req,res)=>{
    try{
      const u=new URL(req.url,'http://127.0.0.1');
      let p=decodeURIComponent(u.pathname);
      if(p==='/'||p==='')p='/app.html';
      const file=path.resolve('.'+p);
      if(!file.startsWith(path.resolve('.'))){res.writeHead(403);return res.end('forbidden')}
      const data=await fs.readFile(file);
      res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(data);
    }catch{res.writeHead(404);res.end('not found')}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const addr=server.address();
  base=`http://127.0.0.1:${addr.port}/app.html`;
}
const url=`${base}${base.includes('?')?'&':'?'}shot=${Date.now()}`;

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
const errors=[];
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
page.on('pageerror',e=>errors.push(String(e)));

try{
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForSelector('#feels',{timeout:15000});
  let dataMode='browser-live';
  try{
    await page.waitForFunction(()=>{const t=document.querySelector('#feels')?.textContent||'';return t&&!t.includes('--')},{timeout:18000});
  }catch{
    dataMode='node-live-fallback';
    try{
      const q=new URLSearchParams({latitude:'44.6822',longitude:'-63.6012',timezone:'America/Halifax',current:'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code',hourly:'precipitation_probability,uv_index',forecast_days:'1',temperature_unit:'celsius',wind_speed_unit:'kmh'});
      const r=await fetch('https://api.open-meteo.com/v1/forecast?'+q,{signal:AbortSignal.timeout(12000)});const j=await r.json();
      const i=Math.max(0,(j.hourly?.time||[]).findIndex(t=>t.slice(0,13)>=new Date().toISOString().slice(0,13)));
      await page.evaluate(({air,feel,rain,wind,gust,uv})=>{const set=(id,text)=>{const e=document.getElementById(id);if(e)e.textContent=text};set('feels',`${feel.toFixed(1)}°`);const a=document.getElementById('actual');if(a)a.innerHTML=`Actual <b>${air.toFixed(1)}°</b>`;set('range',`Real Feel range ${Math.round(feel-1)}–${Math.round(feel+1)}°`);set('rain',`${Math.round(rain??0)}%`);set('wind',`${Math.round(wind??0)} / ${Math.round(gust??0)}`);set('uv',Number.isFinite(uv)?uv.toFixed(1):'--')},{air:j.current.temperature_2m,feel:j.current.apparent_temperature,rain:j.hourly?.precipitation_probability?.[i],wind:j.current.wind_speed_10m,gust:j.current.wind_gusts_10m,uv:j.hourly?.uv_index?.[i]});
    }catch(e){errors.push('Fallback weather injection failed: '+String(e));dataMode='ui-shell-only'}
  }
  await page.waitForTimeout(1200);

  const tabs=(await page.locator('.tab').allTextContents()).map(x=>x.trim());
  const expected=['HRM Core','Moncton','Shediac','Lunenburg','Wolfville Area'];
  const missingTabs=expected.filter(x=>!tabs.includes(x));
  const safeArea=await page.evaluate(()=>({style:document.getElementById('wx-safe-area')?.textContent||'',paddingTop:getComputedStyle(document.querySelector('.app')).paddingTop,headerTop:document.querySelector('header')?.getBoundingClientRect().top??0}));

  await page.screenshot({path:'screenshots/live-iphone.png',fullPage:true});
  const hero=page.locator('.hero').first();if(await hero.count())await hero.screenshot({path:'screenshots/hero-share-card.png'});
  await page.setViewportSize({width:1365,height:900});await page.waitForTimeout(500);await page.screenshot({path:'screenshots/live-desktop.png',fullPage:true});

  const bodyText=await page.locator('body').innerText();
  const forbidden=['Feels Like','feels-like','FEELS HIGH','feels max'];
  const terminologyHits=forbidden.filter(x=>bodyText.includes(x));
  const report={captured_at:new Date().toISOString(),url,data_mode:dataMode,console_errors:errors,terminology_hits:terminologyHits,missing_tabs:missingTabs,safe_area:safeArea,real_feel:await page.locator('#feels').textContent(),actual:await page.locator('#actual').textContent(),tabs};
  await fs.writeFile('screenshots/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  if(terminologyHits.length||missingTabs.length||!safeArea.style.includes('safe-area-inset-top'))process.exitCode=3;
}finally{
  await browser.close();
  if(server)await new Promise(r=>server.close(r));
}
