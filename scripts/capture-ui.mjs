import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base = process.env.WX_URL || 'https://jeremyhennessy.github.io/hrm-weather/app.html';
const url = `${base}${base.includes('?') ? '&' : '?'}shot=${Date.now()}`;
await fs.mkdir('screenshots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', err => errors.push(String(err)));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#feels', { timeout: 30000 });
let dataMode = 'browser-live';
try {
  await page.waitForFunction(() => {
    const t = document.querySelector('#feels')?.textContent || '';
    return t && !t.includes('--');
  }, { timeout: 25000 });
} catch {
  dataMode = 'node-live-fallback';
  try {
    const q = new URLSearchParams({
      latitude: '44.6822', longitude: '-63.6012', timezone: 'America/Halifax',
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code',
      hourly: 'precipitation_probability,uv_index', forecast_days: '1', temperature_unit: 'celsius', wind_speed_unit: 'kmh'
    });
    const r = await fetch('https://api.open-meteo.com/v1/forecast?' + q);
    const j = await r.json();
    const i = Math.max(0, (j.hourly?.time || []).findIndex(t => t.slice(0,13) >= new Date().toISOString().slice(0,13)));
    await page.evaluate(({air,feel,rain,wind,gust,uv}) => {
      const set=(id,text)=>{const e=document.getElementById(id);if(e)e.textContent=text};
      set('feels', `${feel.toFixed(1)}°`);
      const a=document.getElementById('actual');if(a)a.innerHTML=`Actual <b>${air.toFixed(1)}°</b>`;
      set('range', `Real Feel range ${Math.round(feel-1)}–${Math.round(feel+1)}°`);
      set('rain', `${Math.round(rain ?? 0)}%`);
      set('wind', `${Math.round(wind ?? 0)} / ${Math.round(gust ?? 0)}`);
      set('uv', Number.isFinite(uv)?uv.toFixed(1):'--');
      const p=document.getElementById('place');if(p)p.textContent='Halifax Peninsula · Bedford · Dartmouth';
    }, {air:j.current.temperature_2m,feel:j.current.apparent_temperature,rain:j.hourly?.precipitation_probability?.[i],wind:j.current.wind_speed_10m,gust:j.current.wind_gusts_10m,uv:j.hourly?.uv_index?.[i]});
  } catch (e) {
    errors.push('Fallback weather injection failed: '+String(e));
    dataMode = 'ui-shell-only';
  }
}
await page.waitForTimeout(2500);

await page.screenshot({ path: 'screenshots/live-iphone.png', fullPage: true });
const hero = page.locator('.hero').first();
if (await hero.count()) await hero.screenshot({ path: 'screenshots/hero-share-card.png' });

await page.setViewportSize({ width: 1365, height: 900 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'screenshots/live-desktop.png', fullPage: true });

const bodyText = await page.locator('body').innerText();
const forbidden = ['Feels Like', 'feels-like', 'FEELS HIGH', 'feels max'];
const terminologyHits = forbidden.filter(x => bodyText.includes(x));

const report = {
  captured_at: new Date().toISOString(),
  url,
  data_mode: dataMode,
  console_errors: errors,
  terminology_hits: terminologyHits,
  real_feel: await page.locator('#feels').textContent(),
  actual: await page.locator('#actual').textContent(),
  tabs: await page.locator('.tab').allTextContents(),
};
await fs.writeFile('screenshots/report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

await browser.close();
if (terminologyHits.length) process.exitCode = 3;
