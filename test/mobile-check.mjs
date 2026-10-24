// 390px 手机视口的真实浏览器验收：真实查询门店、生成四种方案，核对排版与可读性。
// 与 browser-check.mjs 共用同一套判断标准，但独立跑一遍真实链路，截图取 2× 清晰度。
// 只读：不下单、不支付、不领券；不改动任何服务端状态。
import os from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || `${os.homedir()}/.workbuddy/binaries/node/workspace/node_modules/playwright-core`);
const executablePath = process.env.CHROMIUM_PATH || `${os.homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.BASE || 'http://127.0.0.1:4192';
const SHOTS = new URL('../outputs/screenshots/', import.meta.url).pathname;
await mkdir(SHOTS, { recursive: true });
const log = [];
const say = (k, v) => { log.push({ [k]: v }); console.log(`${k}: ${JSON.stringify(v)}`); };

const browser = await chromium.launch({ executablePath, headless: true, args: ['--hide-scrollbars'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  say('overflowHomePx', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
  say('headerFits', await page.evaluate(() => document.querySelector('.top').getBoundingClientRect().right <= window.innerWidth + 0.5));
  await page.screenshot({ path: `${SHOTS}mobile-01-home.png` });

  if (!(await page.textContent('#statusPill')).includes('已连接')) {
    await page.click('#connectBtn');
    await page.waitForFunction(() => document.querySelector('#statusPill').textContent.includes('已连接'), null, { timeout: 40000 });
  }
  say('connected', true);

  await page.fill('#city', '上海');
  await page.fill('#area', '静安寺');
  await page.fill('#count', '2');
  await page.locator('#count').dispatchEvent('change');
  await page.fill('#budget', '120');
  await page.fill('.person:nth-child(1) .want', '鸡肉');
  await page.fill('.person:nth-child(1) .avoid', '辣');
  await page.fill('.person:nth-child(2) .want', '牛肉');
  await page.fill('.person:nth-child(2) .avoid', '鱼');
  await page.focus('#city');
  say('focusStyle', await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('#city'));
    return { border: s.borderColor, hasRing: s.boxShadow !== 'none' };
  }));
  await page.evaluate(() => document.querySelector('.form-card').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  say('overflowFormPx', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
  say('submitButtonsSameRow', await page.evaluate(() => {
    const a = document.querySelector('.actions');
    const [x, y] = [...a.children].map((b) => b.getBoundingClientRect());
    return Math.abs(x.top - y.top) < 4 && a.getBoundingClientRect().right <= window.innerWidth;
  }));
  await page.screenshot({ path: `${SHOTS}mobile-02-form.png` });

  await page.click('#submitBtn');
  await page.waitForSelector('#results:not(.hidden)', { timeout: 180000 });
  await page.waitForFunction(() => document.querySelectorAll('#planGrid .plan').length >= 4, null, { timeout: 180000 });
  await page.waitForTimeout(600);
  say('plans', await page.locator('#planGrid .plan').count());
  say('prices', await page.locator('.plan .price').allTextContents());
  // 等轻提示自动消失再截图，避免遮住方案卡按钮（提示本身不是页面内容）
  await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('show'), null, { timeout: 9000 }).catch(() => {});
  await page.evaluate(() => document.querySelector('#planGrid').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
  say('overflowResultsPx', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
  say('cardFits', await page.evaluate(() => {
    const c = document.querySelector('#planGrid .plan').getBoundingClientRect();
    return c.left >= 0 && c.right <= window.innerWidth + 0.5;
  }));
  say('planActionsTwoPerRow', await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#planGrid .plan')[0].querySelectorAll('.plan-actions button')];
    const tops = btns.map((b) => Math.round(b.getBoundingClientRect().top));
    return new Set(tops).size === 2 && btns.every((b) => b.getBoundingClientRect().right <= window.innerWidth + 0.5);
  }));
  say('vetoReadable', await page.evaluate(() => {
    const v = document.querySelector('.plan .veto');
    const s = getComputedStyle(v);
    return { fontSize: s.fontSize, whiteSpace: s.whiteSpace, visible: v.getBoundingClientRect().width > 0 };
  }));
  await page.screenshot({ path: `${SHOTS}mobile-03-plans.png` });

  await page.click('#configBtn');
  say('dialogFits', await page.evaluate(() => {
    const d = document.querySelector('#configDialog').getBoundingClientRect();
    return d.left >= 0 && d.right <= window.innerWidth;
  }));
  await page.click('#configClose');
  say('pageErrors', errors);
} catch (e) {
  say('fatal', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(new URL('../outputs/mobile-verification.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), viewport: '390x844@2x', checks: log }, null, 2));
}
