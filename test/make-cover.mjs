// 生成 4:3 作品封面：真实页面（真实 MCP 查询与核价结果）截图 + 一行说明。
// 封面里的门店、餐品与金额都来自本次真实调用；没有额外画出来的功能。
import os from 'node:os';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_CORE || `${os.homedir()}/.workbuddy/binaries/node/workspace/node_modules/playwright-core`;
const chromium = require(pwPath).chromium;
const executablePath = process.env.CHROMIUM_PATH || `${os.homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.BASE || 'http://127.0.0.1:4192';
const OUT = new URL('../outputs/submission/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true, args: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1, locale: 'zh-CN' });
const page = await context.newPage();
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (!(await page.textContent('#statusPill')).includes('已连接')) {
    await page.click('#connectBtn');
    await page.waitForFunction(() => document.querySelector('#statusPill').textContent.includes('已连接'), null, { timeout: 40000 });
  }
  await page.fill('#city', '上海');
  await page.fill('#area', '静安寺');
  await page.click('#queryStoreBtn');
  await page.waitForFunction(() => document.querySelectorAll('#store option').length > 1, null, { timeout: 60000 });
  await page.selectOption('#store', { index: 1 });
  await page.fill('#count', '2');
  await page.locator('#count').dispatchEvent('change');
  await page.fill('#budget', '120');
  await page.fill('.person:nth-child(1) .want', '鸡肉');
  await page.fill('.person:nth-child(1) .avoid', '辣');
  await page.fill('.person:nth-child(2) .want', '牛肉');
  await page.fill('.person:nth-child(2) .avoid', '鱼');
  await page.click('#submitBtn');
  await page.waitForFunction(() => document.querySelectorAll('#planGrid .plan').length >= 4, null, { timeout: 150000 });
  await page.waitForTimeout(1200);

  const meta = (await page.textContent('#resultMeta')).replace(/\s+/g, ' ').trim();
  const prices = await page.locator('.plan .price').allTextContents();

  // 滚动到结果区顶部，让封面展示真实方案卡
  await page.evaluate(() => {
    const r = document.querySelector('#results');
    window.scrollTo({ top: r.getBoundingClientRect().top + window.scrollY - 250, behavior: 'instant' });
  });
  await page.waitForTimeout(900);

  // 封面加一条标题带（constructed stylesheet，页面有 CSP）
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      #__cover{position:fixed;left:0;right:0;top:0;z-index:2147483000;padding:30px 48px 28px;
        background:#0a1c14;border-bottom:2px solid #1d3a29;
        color:#f6fbf4;font-family:"PingFang SC","Hiragino Sans GB",system-ui,sans-serif;pointer-events:none}
      #__cover .t{font-size:50px;font-weight:800;letter-spacing:-.01em;line-height:1.15}
      #__cover .s{font-size:21px;color:#b9d3b6;margin-top:12px;line-height:1.6}
      #__cover .b{display:inline-block;margin-top:18px;padding:7px 14px;border-radius:999px;
        background:#a9d977;color:#12321f;font-weight:700;font-size:16px}
    `);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    const el = document.createElement('div');
    el.id = '__cover';
    el.innerHTML = `<div class="t">麦门会餐 · 饭局谈判官</div>
      <div class="s">1—4 个人一起吃，也能谈得清：谁被照顾、谁在将就、多少钱，官方核价说了算。</div>
      <div class="b">真实门店菜单 · 一人否决就重谈 · 官方价格核对</div>`;
    document.body.appendChild(el);
  });
  await page.waitForTimeout(400);
  const file = `${OUT}cover-1600x1200.png`;
  await page.screenshot({ path: file });
  console.log(JSON.stringify({ file, meta, prices }, null, 2));
} catch (e) {
  console.error('封面生成失败：', e.message);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
