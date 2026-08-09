import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base=process.env.WX_URL||'https://jeremyhennessy.github.io/hrm-weather/app.html';
const devices=[
  {name:'iphone-se-1',width:320,height:568},
  {name:'iphone-8-se2',width:375,height:667},
  {name:'compact-android',width:360,height:800},
  {name:'iphone-12-14',width:390,height:844},
  {name:'iphone-15-16',width:393,height:852},
  {name:'iphone-pro-max',width:430,height:932},
  {name:'landscape-phone',width:844,height:390},
];
await fs.mkdir('screenshots',{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const page=await context.newPage();
const consoleErrors=[];page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});page.on('pageerror',e=>consoleErrors.push(String(e)));
const url=`${base}${base.includes('?')?'&':'?'}layoutqa=${Date.now()}`;
const resp=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
if(!resp?.ok())throw new Error(`UI QA HTTP ${resp?.status()??'no response'}`);
await page.waitForFunction(()=>{const t=document.querySelector('#feels')?.textContent||'';return t&&!t.includes('--')},{timeout:15000});
await page.waitForFunction(()=>document.querySelector('#daySummary')?.dataset?.source==='engine3-summary',{timeout:8000});

async function inspect(device){
  await page.setViewportSize({width:device.width,height:device.height});await page.waitForTimeout(350);
  const result=await page.evaluate(({name,width,height})=>{
    const r=el=>{if(!el)return null;const x=el.getBoundingClientRect();return{left:x.left,right:x.right,top:x.top,bottom:x.bottom,width:x.width,height:x.height}};
    const intersects=(a,b,pad=1)=>a&&b&&a.left<b.right-pad&&a.right>b.left+pad&&a.top<b.bottom-pad&&a.bottom>b.top+pad;
    const visible=el=>{if(!el)return false;const s=getComputedStyle(el),x=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&x.width>1&&x.height>1};
    const issues=[];const html=document.documentElement,body=document.body,app=document.querySelector('.app');
    if(Math.max(html.scrollWidth,body.scrollWidth)>innerWidth+2)issues.push(`document horizontal overflow ${Math.max(html.scrollWidth,body.scrollWidth)}>${innerWidth}`);
    for(const el of document.querySelectorAll('.app>header,.locationNav,.hero,.dayBrief,.section,.footer')){
      if(!visible(el))continue;const x=r(el);if(x.left<-2||x.right>innerWidth+2)issues.push(`viewport escape ${el.className||el.tagName} ${JSON.stringify(x)}`);
    }
    const heroEl=document.querySelector('.hero'),hero=r(heroEl),summary=r(document.querySelector('#daySummary')),orb=r(document.querySelector('.confidenceOrb')),place=r(document.querySelector('#place')),icon=r(document.querySelector('#heroIcon')),temp=r(document.querySelector('.heroTemp')),metricsEl=document.querySelector('.metrics'),metrics=r(metricsEl),uvEl=document.querySelector('#uvGuidance'),uv=visible(uvEl)?r(uvEl):null;
    if(!hero||!summary||!orb)issues.push('missing hero/summary/confidence geometry');
    else{
      if(orb.width<104||orb.height<104)issues.push(`confidence shrunk ${orb.width}x${orb.height}`);
      if(orb.right>hero.right-4||orb.top<hero.top+4)issues.push('confidence outside hero safe edge');
      if(intersects(summary,orb))issues.push('summary overlaps confidence');
      if(intersects(place,orb))issues.push('place overlaps confidence');
      if(intersects(icon,orb,3))issues.push('weather icon overlaps confidence');
      if(summary.left<hero.left+10||summary.right>hero.right-10)issues.push('summary edge clipping');
      if(temp&&temp.right>hero.right-8)issues.push('hero temperature escapes card');
      if(uv&&metrics&&intersects(uv,metrics,4))issues.push('UV guidance overlaps hero metrics');
      if(uv&&(uv.left<hero.left+10||uv.right>hero.right-10))issues.push('UV guidance edge clipping');
      if(uv&&metrics&&metrics.top<uv.bottom+8)issues.push(`hero metrics not below UV guidance ${metrics.top}<${uv.bottom+8}`);
      if(uv&&metrics&&hero.bottom<metrics.bottom+10)issues.push('hero does not contain UV guidance and metrics');
      if(uv){
        const title=uvEl.querySelector('b'),detail=uvEl.querySelector('span'),tr=r(title),dr=r(detail),ts=title?getComputedStyle(title):null,ds=detail?getComputedStyle(detail):null;
        if(!title||!detail)issues.push('UV guidance missing title/detail structure');
        else{
          if(ts.display!=='block'||ds.display!=='block')issues.push(`UV title/detail not block formatted ${ts.display}/${ds.display}`);
          if(tr&&dr&&dr.top<tr.bottom)issues.push('UV detail collides with title');
          if(parseFloat(ts.fontSize)>14)issues.push(`UV title font too large ${ts.fontSize}`);
          if(parseFloat(ds.fontSize)>11.5)issues.push(`UV detail font too large ${ds.fontSize}`);
          if(detail.scrollWidth>detail.clientWidth+3)issues.push('UV detail text horizontally clipped');
        }
      }
    }
    const top=r(document.querySelector('.topbar')),nav=r(document.querySelector('.locationNav'));if(intersects(top,nav))issues.push('header overlaps location nav');
    const buttons=[...document.querySelectorAll('.locationNav button,.topbar button')].filter(visible).map(el=>({name:el.id||el.textContent.trim(),box:r(el)}));
    for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++)if(intersects(buttons[i].box,buttons[j].box,2))issues.push(`controls overlap ${buttons[i].name}/${buttons[j].name}`);
    const cards=[...document.querySelectorAll('.routineGrid>.routineCard,.zones>.card,.accuracy>.stat,.micro>.card')].filter(visible);
    for(const card of cards){const x=r(card);if(x.width<70)issues.push(`card too narrow ${card.className} ${x.width}`);if(x.left<-2||x.right>innerWidth+2)issues.push(`card escapes viewport ${card.className}`)}
    const clipped=[];
    for(const el of document.querySelectorAll('h1,h2,.place,.actual,.range,.outside,.obsline,.callout,.uvGuidance,.routineTitle b,.routineVerdict,.zt,.sub,.stat b,.metric b,.metric small')){
      if(!visible(el))continue;const s=getComputedStyle(el);if(['auto','scroll'].includes(s.overflowX))continue;if(el.closest('#hours,#days,#models,.chips,.tabs'))continue;
      if(el.scrollWidth>el.clientWidth+3&&s.whiteSpace!=='nowrap')clipped.push(`${el.className||el.id||el.tagName}:${el.scrollWidth}>${el.clientWidth}`);
    }
    if(clipped.length)issues.push(`text clipping ${clipped.slice(0,8).join(', ')}`);
    const routine=[...document.querySelectorAll('.routineGrid>.routineCard')].filter(visible).map(r);for(let i=0;i<routine.length;i++)for(let j=i+1;j++)if(intersects(routine[i],routine[j],2))issues.push(`routine cards overlap ${i}/${j}`);
    return{name,width,height,innerWidth,scrollWidth:Math.max(html.scrollWidth,body.scrollWidth),app:r(app),hero,summary,orb,place,icon,uv,metrics,issues};
  },device);
  await page.screenshot({path:`screenshots/layout-${device.name}-${device.width}x${device.height}.png`,fullPage:true});return result;
}

const results=[];for(const d of devices)results.push(await inspect(d));
await fs.writeFile('screenshots/layout-report.json',JSON.stringify({captured_at:new Date().toISOString(),url,results,console_errors:consoleErrors},null,2)+'\n');
console.log(JSON.stringify({results,console_errors:consoleErrors},null,2));
const failures=results.filter(x=>x.issues.length);await browser.close();
if(failures.length)throw new Error(`Layout QA failed: ${failures.map(x=>`${x.name}: ${x.issues.join('; ')}`).join(' | ')}`);
