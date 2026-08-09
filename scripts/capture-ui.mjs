import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

await fs.mkdir('screenshots',{recursive:true});
const root=path.resolve('.');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const requests=[];let server=null,browser=null,page=null,stage='boot',fatal=null,dataMode='not-started',url='',responseStatus=null;
const errors=[];const sceneChecks=[];

async function writeReport(extra={}){
  let bodyPreview='',title='',pageUrl='',tabs=[],realFeel=null,actual=null,safeArea=null,morning=null,evening=null,daySummary=null;
  try{if(page){bodyPreview=(await page.locator('body').innerText({timeout:1000})).slice(0,1800);title=await page.title();pageUrl=page.url();tabs=(await page.locator('.tabLabel').allTextContents()).map(x=>x.trim());realFeel=await page.locator('#feels').textContent({timeout:500}).catch(()=>null);actual=await page.locator('#actual').textContent({timeout:500}).catch(()=>null);morning=await page.locator('#morningFeel').textContent({timeout:500}).catch(()=>null);evening=await page.locator('#eveningFeel').textContent({timeout:500}).catch(()=>null);daySummary=await page.locator('#daySummary').textContent({timeout:500}).catch(()=>null);safeArea=await page.evaluate(()=>({style:document.getElementById('wx-safe-area')?.textContent||'',paddingTop:document.querySelector('.app')?getComputedStyle(document.querySelector('.app')).paddingTop:null,headerTop:document.querySelector('header')?.getBoundingClientRect().top??null})).catch(()=>null)}}catch{}
  const expected=['HRM Core','Moncton','Shediac','Lunenburg','Wolfville Area'];
  const missingTabs=expected.filter(x=>!tabs.includes(x));
  const forbidden=['Feels Like','feels-like','FEELS HIGH','feels max'];
  const terminologyHits=forbidden.filter(x=>bodyPreview.includes(x));
  const routineReady=morning&&!morning.includes('--')&&evening&&!evening.includes('--')&&daySummary&&!daySummary.includes('Building');
  const sceneLocations=sceneChecks.map(x=>x.location),missingScenes=expected.filter(x=>!sceneLocations.includes(x));
  const uniqueSceneImages=new Set(sceneChecks.map(x=>x.background).filter(Boolean)).size;
  const report={captured_at:new Date().toISOString(),stage,fatal,url,page_url:pageUrl,response_status:responseStatus,title,data_mode:dataMode,console_errors:errors,terminology_hits:terminologyHits,missing_tabs:missingTabs,routine_ready:Boolean(routineReady),morning_real_feel:morning,evening_real_feel:evening,day_summary:daySummary,safe_area:safeArea,real_feel:realFeel,actual,tabs,scene_checks:sceneChecks,missing_scenes:missingScenes,unique_scene_images:uniqueSceneImages,body_preview:bodyPreview,requests:requests.slice(-40),...extra};
  await fs.writeFile('screenshots/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));return report;
}

async function captureLocationScenes(){
  const expected=['HRM Core','Moncton','Shediac','Lunenburg','Wolfville Area'];
  const hero=page.locator('.hero').first();
  for(const name of expected){
    await page.evaluate(location=>{const s=document.querySelector('.locationPicker');if(!s)return;s.value=location;s.dispatchEvent(new Event('change',{bubbles:true}))},name);
    await page.waitForTimeout(2200);
    const info=await page.evaluate(()=>{const h=document.querySelector('.hero'),title=document.querySelector('.brand h1')?.textContent?.trim()||'',style=h?getComputedStyle(h):null;return{location:h?.dataset.location||'',condition:h?.dataset.condition||'',daypart:h?.dataset.daypart||'',background:style?.backgroundImage||'',title}});
    sceneChecks.push(info);
    if(await hero.count())await hero.screenshot({path:`screenshots/scene-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.png`});
  }
  await page.evaluate(()=>{const s=document.querySelector('.locationPicker');if(s){s.value='HRM Core';s.dispatchEvent(new Event('change',{bubbles:true}))}});await page.waitForTimeout(2200);
}

try{
  stage='start-server';let base=process.env.WX_URL;
  if(!base){
    server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://127.0.0.1');let p=decodeURIComponent(u.pathname);if(p==='/'||p==='')p='/app.html';const file=path.resolve(root,'.'+p);requests.push({path:p,file});try{if(!(file===root||file.startsWith(root+path.sep))){res.writeHead(403);return res.end('forbidden')}const data=await fs.readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store','connection':'close'});res.end(data)}catch(e){requests.push({error:String(e),path:p});res.writeHead(404,{'content-type':'text/plain','connection':'close'});res.end('not found')}});
    server.keepAliveTimeout=1000;server.headersTimeout=3000;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});base=`http://127.0.0.1:${server.address().port}/app.html`;
  }
  url=`${base}${base.includes('?')?'&':'?'}shot=${Date.now()}`;
  stage='launch-browser';browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('pageerror',e=>errors.push(String(e)));
  stage='goto';const resp=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});responseStatus=resp?.status()??null;
  stage='verify-dom';if(!(await page.locator('#feels').count()))throw new Error(`App DOM missing #feels (HTTP ${responseStatus}, url ${page.url()})`);
  dataMode='browser-live';stage='wait-weather';
  try{await page.waitForFunction(()=>{const t=document.querySelector('#feels')?.textContent||'',m=document.querySelector('#morningFeel')?.textContent||'';return t&&!t.includes('--')&&m&&!m.includes('--')},{timeout:15000})}
  catch{dataMode='partial-live';errors.push('Timed out waiting for full routine data; captured available UI')}
  stage='capture-iphone';await page.waitForTimeout(500);await page.screenshot({path:'screenshots/live-iphone.png',fullPage:true});
  stage='capture-card';const hero=page.locator('.hero').first();if(await hero.count())await hero.screenshot({path:'screenshots/hero-share-card.png'});const brief=page.locator('.dayBrief').first();if(await brief.count())await brief.screenshot({path:'screenshots/day-brief-card.png'});
  stage='capture-location-scenes';await captureLocationScenes();
  stage='capture-desktop';await page.setViewportSize({width:1365,height:900});await page.waitForTimeout(250);await page.screenshot({path:'screenshots/live-desktop.png',fullPage:true});
  stage='report';const report=await writeReport();if(report.terminology_hits.length||report.missing_tabs.length||report.missing_scenes.length||report.unique_scene_images<5||!report.safe_area?.style?.includes('safe-area-inset-top')||!report.routine_ready){fatal='QA assertion failed';process.exitCode=3}
}catch(e){fatal=String(e?.stack||e);errors.push(fatal);stage='failed';try{if(page)await page.screenshot({path:'screenshots/failure.png',fullPage:true})}catch{}await writeReport();process.exitCode=2}
finally{try{if(browser)await browser.close()}catch{}try{if(server){server.closeAllConnections?.();server.close(()=>{})}}catch{}}
