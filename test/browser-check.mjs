// 真实浏览器验证：本机 Chromium（playwright-core）跑一遍完整交互。
// 目的是验证前端脚本可运行、忙碌锁生效、模式切换与导出可用，并核对 0.5.0 红黄主题的
// 计算样式与关键文字对比度；不会下单或支付。
import os from 'node:os';
import { mkdir } from 'node:fs/promises';
// playwright-core 属于本机开发依赖，不进入交付包；可用 PLAYWRIGHT_CORE 指向本机安装路径。
const pw = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const chromium = pw.chromium || pw.default?.chromium;

const executablePath = process.env.CHROMIUM_PATH || `${os.homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.BASE || 'http://127.0.0.1:4192';
const SHOTS = new URL('../outputs/screenshots/', import.meta.url).pathname;
await mkdir(SHOTS, { recursive: true });
const log = [];
const say = (k, v) => { log.push({ [k]: v }); console.log(`${k}: ${JSON.stringify(v)}`); };

/* —— 对比度：按 WCAG 相对亮度计算实际渲染出来的颜色 —— */
const hex = (rgb) => {
  const m = String(rgb).match(/\d+(\.\d+)?/g);
  if (!m) return null;
  return m.slice(0, 3).map(Number);
};
const lum = (rgb) => {
  const [r, g, b] = hex(rgb).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
};

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
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}desktop-01-home.png` });

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
  await page.evaluate(() => document.querySelector('#results').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}desktop-02-plans.png` });

  // 0.5.0 主题：读实际计算样式，核对红黄是否真的落到界面上，并检查关键文字对比度
  const theme = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color, borderColor: s.borderColor };
    };
    return {
      tokens: { red: v('--red'), deep: v('--red-deep'), yellow: v('--yellow'), paper: v('--paper'), ink: v('--ink') },
      body: pick('body'),
      primary: pick('#submitBtn'),
      mark: pick('.mark'),
      tag: pick('.plan-tag'),
      heroEm: pick('.hero h2 em'),
      plan: pick('.plan'),
      featured: pick('.plan.featured'),
      noticeOk: pick('#connectionBanner'),
      chips: pick('.pa-wants em'),
      miss: pick('.pa-wants em.miss'),
      selected: pick('.plan.selected') || null,
      selectedBtn: pick('.plan.selected .select-one') || null,
      footer: pick('.footer-note'),
    };
  });
  say('themeTokens', theme.tokens);
  const pairs = {
    bodyOnPaper: contrast(theme.body.color, theme.body.bg),
    primaryButton: contrast(theme.primary.color, theme.primary.bg),
    planTag: contrast(theme.tag.color, theme.tag.bg),
    heroEmphasis: contrast(theme.heroEm.color, theme.body.bg),
    noticeOk: contrast(theme.noticeOk.color, theme.noticeOk.bg),
    satisfiedChip: contrast(theme.chips.color, theme.chips.bg),
    missedChip: contrast(theme.miss.color, theme.miss.bg),
    footer: contrast(theme.footer.color, theme.body.bg),
  };
  // 角标 M 是 22px 粗体标识字形，按 WCAG 大字号（3:1）判定；其余正文按 4.5:1
  const largeText = { markM: contrast(theme.mark.color, theme.mark.bg) };
  say('contrastRatios', pairs);
  say('contrastLargeTextRatios', largeText);
  say('contrastNormalAllAtLeast4_5', Object.values(pairs).every((x) => x >= 4.5));
  say('contrastLargeTextAllAtLeast3', Object.values(largeText).every((x) => x >= 3));
  say('contrastMinNormal', Math.min(...Object.values(pairs)));
  say('primaryIsMcRed', /rgb\(218,\s*41,\s*28\)/.test(theme.primary.bg));
  say('featuredUsesRedBorder', /218,\s*41,\s*28/.test(theme.featured.borderColor));

  // 同一份真实结果在 390px 手机宽度下的排版（不改动页面状态，只切视口再切回）
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.querySelector('#planGrid').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(600);
  say('mobileResultsOverflowPx', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
  say('mobileCardFits', await page.evaluate(() => {
    const c = document.querySelector('#planGrid .plan').getBoundingClientRect();
    return c.left >= 0 && c.right <= window.innerWidth + 0.5;
  }));
  say('mobileVetoVisible', await page.locator('.plan .veto').first().isVisible());
  await page.screenshot({ path: `${SHOTS}mobile-03-plans.png`, fullPage: false });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);

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
  await page.evaluate(() => document.querySelector('#planGrid').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}desktop-03-plans-detail.png` });
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

  // 手机端：结果页仍在 DOM 里（切换门店已隐藏），重新按真实流程展开一次成本较高；
  // 这里在 390px 下核对首页与表单，再核对禁用/可用状态、焦点可见与按钮不挤压。
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await mobile.waitForTimeout(400);
  const overflowHome = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  say('mobileHomeOverflowPx', overflowHome);
  await mobile.screenshot({ path: `${SHOTS}mobile-01-home.png`, fullPage: false });
  await mobile.fill('#city', '上海');
  await mobile.fill('#area', '静安寺');
  await mobile.evaluate(() => document.querySelector('.form-card').scrollIntoView({ block: 'start' }));
  await mobile.waitForTimeout(300);
  say('mobileFormOverflowPx', await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
  say('mobileButtonsPerRow', await mobile.evaluate(() => {
    const a = document.querySelector('.actions');
    const [x, y] = [...a.children].map((b) => b.getBoundingClientRect());
    return { sameRow: Math.abs(x.top - y.top) < 4, fits: a.getBoundingClientRect().right <= window.innerWidth };
  }));
  say('mobileFocusVisible', await (async () => {
    await mobile.focus('#city');
    return mobile.evaluate(() => {
      const s = getComputedStyle(document.querySelector('#city'));
      return { border: s.borderColor, shadow: s.boxShadow !== 'none' };
    });
  })());
  await mobile.screenshot({ path: `${SHOTS}mobile-02-form.png`, fullPage: false });
  await mobile.close();

  say('pageErrors', errors);
} catch (e) {
  say('fatal', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  const { writeFile } = await import('node:fs/promises');
  await mkdir(new URL('../outputs/', import.meta.url), { recursive: true });
  await writeFile(new URL('../outputs/browser-verification.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), checks: log }, null, 2));
}
