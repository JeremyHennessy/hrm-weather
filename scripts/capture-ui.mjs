import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base = process.env.WX_URL || 'https://jeremyhennessy.github.io/hrm-weather/';
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
await page.waitForFunction(() => {
  const t = document.querySelector('#feels')?.textContent || '';
  return t && !t.includes('--');
}, { timeout: 45000 });
await page.waitForTimeout(3500);

await page.screenshot({ path: 'screenshots/live-iphone.png', fullPage: true });
const hero = page.locator('.hero').first();
if (await hero.count()) await hero.screenshot({ path: 'screenshots/hero-share-card.png' });

await page.setViewportSize({ width: 1365, height: 900 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'screenshots/live-desktop.png', fullPage: true });

const bodyText = await page.locator('body').innerText();
const forbidden = ['Feels Like', 'feels-like', 'FEELS HIGH', 'feels max', ' air '];
const terminologyHits = forbidden.filter(x => bodyText.includes(x));

const report = {
  captured_at: new Date().toISOString(),
  url,
  console_errors: errors,
  terminology_hits: terminologyHits,
  real_feel: await page.locator('#feels').textContent(),
  actual: await page.locator('#actual').textContent(),
};
await fs.writeFile('screenshots/report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

await browser.close();
if (errors.length) process.exitCode = 2;
if (terminologyHits.length) process.exitCode = 3;
