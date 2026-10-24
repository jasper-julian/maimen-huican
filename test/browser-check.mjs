// 真实浏览器验证：本机 Chromium（playwright-core）跑一遍完整交互。
// 目的是验证前端脚本可运行、忙碌锁生效、模式切换与导出可用，不会下单或支付。
import os from 'node:os';
// playwright-core 属于本机开发依赖，不进入交付包；可用 PLAYWRIGHT_CORE 指向本机安装路径。
const pw = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const chromium = pw.chromium || pw.default?.chromium;

const executablePath = process.env.CHROMIUM_PATH || `${os.homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.BASE || 'http://127.0.0.1:4192';
const log = [];
const say = (k, v) => { log.push({ [k]: v }); console.log(`${k}: ${JSON.stringify(v)}`); };

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, locale: 'zh-CN' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const recommendCalls = [];
page.on('request', (r) => { if (r.url().includes('/api/recommend')) recommendCalls.push(r.url()); });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  say('title', await page.title());
  say('banner', (await page.textContent('#bannerText'))?.slice(0, 40));
  say('bannerMentionsLocalConfig', (await page.textContent('#bannerText')).includes('已检测到本机配置'));
  say('jargonOnPage', (await page.content()).includes('calculate-price') || (await page.content()).includes('inputSchema'));

  // 连接设置弹窗（本项目独立配置入口）
  await page.click('#configBtn');
  say('configDialogOpen', await page.isVisible('#configDialog'));
  say('cfgSource', await page.textContent('#cfgSource'));
  await page.click('#configClose');

  // 连接
  await page.click('#connectBtn');
  await page.waitForFunction(() => document.querySelector('#statusPill').textContent.includes('已连接'), null, { timeout: 30000 });
  say('connected', true);

  // 填需求
  await page.fill('#city', '上海');
  await page.fill('#area', '静安寺');
  await page.fill('#count', '2');
  await page.locator('#count').dispatchEvent('change');
  await page.fill('#budget', '120');
  await page.waitForTimeout(120);
  await page.fill('.person:nth-child(1) .want', '鸡肉');
  await page.fill('.person:nth-child(1) .avoid', '辣');
  await page.fill('.person:nth-child(2) .want', '牛肉');
  await page.fill('.person:nth-child(2) .avoid', '鱼');

  // 提交（含重复点击保护检查）
  await page.click('#submitBtn');
  say('submitDisabledDuringRun', await page.isDisabled('#submitBtn'));
  await page.click('#submitBtn', { force: true }).catch(() => {});
  await page.waitForSelector('#results:not(.hidden)', { timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll('#planGrid .plan').length >= 3, null, { timeout: 90000 });
  say('recommendRequests', recommendCalls.length);
  say('plans', await page.locator('#planGrid .plan').count());
  say('hasAllocations', await page.locator('.person-alloc').count());
  say('hasTimes', (await page.locator('.time-row').first().textContent()).replace(/\s+/g, ' '));
  say('verifiedPrices', await page.locator('.plan .price').allTextContents());
  say('statuses', await page.locator('.plan .status').allTextContents());
  say('satisfactionChips', await page.locator('.pa-wants em').count());

  // 第 2 人的第一份说“不接受” → 服务端重排并重新核对价格
  const firstCard = page.locator('#planGrid .plan').first();
  await firstCard.locator('.person-alloc').nth(1).locator('.veto').first().click();
  await page.waitForFunction(() => document.querySelector('#resultMeta')?.textContent.includes('不接受'), null, { timeout: 120000 });
  say('vetoEcho', (await page.textContent('#resultMeta')).replace(/\s+/g, ' ').slice(0, 110));
  say('plansAfterVeto', await page.locator('#planGrid .plan').count());
  say('conflictShown', (await page.textContent('#resultNotes'))?.includes('不会自动放宽') || false);

  // “多 10 元能换来什么” → 真实加价对比
  if (await page.locator('.plan').count()) {
    await page.locator('.plan').nth(1).locator('.upgrade-one').click();
    await page.waitForSelector('.upgrade-box.show', { timeout: 120000 });
    say('upgradeBox', (await page.locator('.upgrade-box.show').first().textContent()).replace(/\s+/g, ' ').slice(0, 120));
  }

  // 选择一张并导出（显式选择，不默认导出）
  const selectedBefore = await page.textContent('#selectedHint');
  await page.locator('.plan').nth(1).locator('.select-one').click();
  say('selectedHintBefore', selectedBefore);
  say('selectedHintAfter', await page.textContent('#selectedHint'));
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#exportSelected')]);
  say('downloadName', download.suggestedFilename());

  // 切换门店后旧结果作废
  const firstHandle = await page.locator('#store option').nth(1).getAttribute('value');
  await page.selectOption('#store', firstHandle);
  say('resultsHiddenAfterStoreChange', await page.locator('#results').evaluate((el) => el.classList.contains('hidden')));

  // 演示模式必须主动加载
  await page.click('#demoBtn');
  await page.waitForFunction(() => document.querySelector('#modePill').textContent.includes('演示'), null, { timeout: 30000 });
  say('demoMode', await page.textContent('#modePill'));
  await page.click('#exitDemoBtn');
  say('exitDemoMode', await page.textContent('#modePill'));

  // 移动端排版
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  say('mobileHorizontalOverflowPx', overflow);
  await mobile.close();

  say('pageErrors', errors);
} catch (e) {
  say('fatal', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(new URL('../outputs/', import.meta.url), { recursive: true });
  await writeFile(new URL('../outputs/browser-verification.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), checks: log }, null, 2));
}
