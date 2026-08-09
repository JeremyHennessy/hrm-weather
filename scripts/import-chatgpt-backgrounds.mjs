import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const targets = [
  ['halifax','https://chatgpt.com/s/m_6a77de5f90b48191a1f31813fca80188'],
  ['moncton','https://chatgpt.com/s/m_6a77de7bfe3c819184c9bff17bcb343e'],
  ['shediac','https://chatgpt.com/s/m_6a77de9196e88191be18683389abd9fa'],
  ['wolfville','https://chatgpt.com/s/m_6a77def71c108191ae0c865b21bcb15c'],
  ['lunenburg','https://chatgpt.com/s/m_6a77df5c5d188191aa40f25344a039bd'],
];

await fs.mkdir('backgrounds/generated',{recursive:true});
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1440,height:1000},userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36'});

for (const [name,url] of targets) {
  const page = await context.newPage();
  const seen = new Map();
  page.on('response', async r => {
    try {
      const ct=(await r.headerValue('content-type'))||'';
      if (!ct.startsWith('image/')) return;
      const len=Number((await r.headerValue('content-length'))||0);
      seen.set(r.url(),{url:r.url(),len,ct});
    } catch {}
  });
  console.log(`Opening ${name}: ${url}`);
  await page.goto(url,{waitUntil:'networkidle',timeout:90000}).catch(async()=>{await page.waitForTimeout(12000)});
  await page.waitForTimeout(5000);

  const dom = await page.evaluate(() => {
    const rows=[];
    for(const img of document.images){
      const r=img.getBoundingClientRect();
      rows.push({url:img.currentSrc||img.src,w:img.naturalWidth||r.width,h:img.naturalHeight||r.height,area:(img.naturalWidth||r.width)*(img.naturalHeight||r.height)});
    }
    for(const el of document.querySelectorAll('*')){
      const bg=getComputedStyle(el).backgroundImage;
      const m=bg&&bg.match(/url\(["']?(.*?)["']?\)/);
      if(m){const r=el.getBoundingClientRect();rows.push({url:m[1],w:r.width,h:r.height,area:r.width*r.height});}
    }
    return rows;
  });

  let candidates=dom.filter(x=>x.url&&/^https?:/.test(x.url)&&x.w>=700&&x.h>=400).sort((a,b)=>b.area-a.area);
  for(const x of seen.values()) if(x.len>250000) candidates.push({url:x.url,w:0,h:0,area:x.len});
  const uniq=[];const urls=new Set();for(const c of candidates.sort((a,b)=>b.area-a.area)){if(!urls.has(c.url)){urls.add(c.url);uniq.push(c)}}
  let saved=false;
  for(const c of uniq.slice(0,15)){
    try{
      const res=await context.request.get(c.url,{timeout:45000,headers:{referer:url}});
      if(!res.ok())continue;
      const buf=await res.body();
      if(buf.length<120000)continue;
      const meta=await sharp(buf).metadata();
      if((meta.width||0)<700||(meta.height||0)<400)continue;
      const out=path.join('backgrounds','generated',`${name}.webp`);
      await sharp(buf).rotate().resize(1600,1000,{fit:'cover',position:'centre'}).webp({quality:72,effort:6}).toFile(out);
      console.log(`Saved ${out} from ${c.url} (${meta.width}x${meta.height}, ${buf.length} bytes)`);
      saved=true;break;
    }catch(e){console.log(`Candidate failed: ${String(e).slice(0,180)}`)}
  }
  if(!saved){
    await page.screenshot({path:`backgrounds/generated/${name}-debug.png`,fullPage:true});
    throw new Error(`Could not locate generated background for ${name}`);
  }
  await page.close();
}
await browser.close();
