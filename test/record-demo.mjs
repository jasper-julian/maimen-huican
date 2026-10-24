// 真实浏览器录屏：驱动本机 4192 的真实页面（真实麦当劳 MCP 查询与试算），
// 用 Playwright 的 recordVideo 录制，不合成画面、不 mock 接口。
// 字幕用 constructed stylesheet 叠加（页面有 CSP，不能写内联样式），属于录屏说明，不是产品功能。
// 用法：BASE=http://127.0.0.1:4192 node test/record-demo.mjs
import os from 'node:os';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_CORE || `${os.homedir()}/.workbuddy/binaries/node/workspace/node_modules/playwright-core`;
const chromium = require(pwPath).chromium;
const executablePath = process.env.CHROMIUM_PATH || `${os.homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.BASE || 'http://127.0.0.1:4192';
const OUT = new URL('../outputs/recording/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OVERLAY_CSS = `
#__cap{position:fixed;left:0;right:0;bottom:0;z-index:2147483640;padding:11px 30px 13px;
  background:linear-gradient(to top,rgba(7,19,13,.95),rgba(7,19,13,.72) 62%,rgba(7,19,13,0));
  color:#f8fcf7;font:600 19px/1.45 "PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  text-align:center;letter-spacing:.01em;text-shadow:0 2px 10px rgba(0,0,0,.6);pointer-events:none;margin:0}
#__cap.__empty{display:none}
#__chip{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483641;padding:5px 11px;border-radius:999px;
  background:rgba(255,255,255,.92);color:#1b4a33;font:600 12px/1.4 "PingFang SC",system-ui,sans-serif;
  letter-spacing:.02em;box-shadow:0 1px 6px rgba(0,0,0,.2);pointer-events:none}
`;

/** 在页面叠加字幕与「自动操作录制」角标；用 adoptedStyleSheets 绕过页面 CSP。 */
async function caption(page, text, ms = 0) {
  await page.evaluate((args) => {
    if (!document.getElementById('__cap')) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(args.css);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      const cap = document.createElement('div');
      cap.id = '__cap';
      cap.textContent = args.text;
      document.body.appendChild(cap);
    }
    const el = document.getElementById('__cap');
    el.textContent = args.text || '';
    el.classList.toggle('__empty', !args.text);
  }, { css: OVERLAY_CSS, text });
  if (ms) await sleep(ms);
}

/** 卡片页（标题/结尾/导出核对）：setContent 之后再用构造样式表注入样式，避免继承页面 CSP。 */
async function card(page, html, ms) {
  await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>麦门会餐</title></head><body><div class="wrap">${html}</div></body></html>`);
  await page.evaluate((args) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(args.css);
    document.adoptedStyleSheets = [sheet];
  }, { css: `
    html,body{margin:0;height:100%;background:#0b1d15;color:#f4faf3;
      font-family:"PingFang SC","Hiragino Sans GB",system-ui,sans-serif;overflow:hidden}
    .wrap{height:100vh;display:flex;flex-direction:column;justify-content:center;padding:0 88px;box-sizing:border-box}
    .k{font:600 14px/1 "SF Mono",Menlo,monospace;letter-spacing:.22em;color:#a9d977;margin-bottom:26px}
    h1{font-size:50px;line-height:1.26;margin:0 0 22px;font-weight:800;letter-spacing:-.01em}
    p{font-size:20px;line-height:1.75;color:#bfd1c3;margin:0;max-width:1000px}
    .rule{width:64px;height:3px;background:#a9d977;margin:30px 0 26px;border-radius:2px}
    h1.h1s{font-size:32px;margin-bottom:14px}
    p.note{margin-top:16px;font-size:18px}
    pre{font:500 13.5px/1.7 "SF Mono",Menlo,monospace;color:#dcecd9;background:#122a1e;border:1px solid #22412e;
      border-radius:12px;padding:16px 20px;margin:0;max-height:360px;overflow:hidden;white-space:pre-wrap}
  ` });
  await sleep(ms);
}

const browser = await chromium.launch({ executablePath, headless: true, args: ['--force-device-scale-factor=1', '--hide-scrollbars'] });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  acceptDownloads: true,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
});
const page = await context.newPage();
const videoHandle = page.video();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const steps = [];
const mark = (name, extra = {}) => { steps.push({ name, at: new Date().toISOString(), ...extra }); console.log('·', name, JSON.stringify(extra)); };

try {
  // 0. 片头：一句话问题
  await card(page, `<div class="k">麦门会餐 · 饭局谈判官</div>
    <h1>两个人一起吃，<br>便宜不等于谁都能接受。</h1><div class="rule"></div>
    <p>匿名需求卡 → 四种策略 → 看清谁被照顾、谁在将就 → 一人否决就重谈 → 官方重新核价。<br>
    以下画面为<strong>浏览器自动操作录制</strong>的真实页面，门店与价格来自麦当劳官方服务。</p>`, 9000);
  mark('intro');

  // 1. 真实页面
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await caption(page, '这是真实页面，不是演示稿；门店、菜单和价格都来自麦当劳官方服务。', 5000);
  mark('home', { title: await page.title() });

  // 2. 连接
  if (!(await page.textContent('#statusPill')).includes('已连接')) {
    await page.click('#connectBtn');
    await page.waitForFunction(() => document.querySelector('#statusPill').textContent.includes('已连接'), null, { timeout: 40000 });
  }
  await caption(page, '已连接官方服务。凭据只在本机服务进程里读取，不会出现在页面上，也不进导出卡。', 4200);
  await page.click('#configBtn');
  await caption(page, '右上角是本项目独立的连接设置：只显示凭据来源与连接状态，不显示 Token 本身。', 4200);
  await page.click('#configClose');
  mark('connected');

  // 3. 公开商圈查门店
  await page.fill('#city', '上海');
  await page.fill('#area', '静安寺');
  await caption(page, '用公开商圈查询：上海 · 静安寺。不读取任何收货地址，也不碰历史订单。', 2200);
  await page.click('#queryStoreBtn');
  await page.waitForFunction(() => document.querySelectorAll('#store option').length > 1, null, { timeout: 60000 });
  const storeCount = await page.locator('#store option').count();
  await caption(page, `查到 ${storeCount - 1} 家门店。选一家营业中的门店，读它当天的菜单和门店优惠。`, 3800);
  await page.selectOption('#store', { index: 1 });
  mark('stores', { storeCount: storeCount - 1 });

  // 4. 两张匿名需求卡
  await page.fill('#count', '2');
  await page.locator('#count').dispatchEvent('change');
  await page.fill('#budget', '120');
  await page.fill('.person:nth-child(1) .want', '鸡肉');
  await page.fill('.person:nth-child(1) .avoid', '辣');
  await page.fill('.person:nth-child(2) .want', '牛肉');
  await page.fill('.person:nth-child(2) .avoid', '鱼');
  await caption(page, '两张匿名需求卡：A 想吃鸡肉、不吃辣；B 想吃牛肉、不吃鱼。', 3200);
  await caption(page, '想吃的算偏好，做不到就解释；不想吃的算硬约束，程序不会为了凑单违反它。', 4200);
  await page.fill('#count', '4');
  await page.locator('#count').dispatchEvent('change');
  await caption(page, '最多支持 4 个人，每人一张匿名卡，可以在同一台设备上依次填写。', 4000);
  await page.fill('#count', '2');
  await page.locator('#count').dispatchEvent('change');
  await page.waitForTimeout(900);
  mark('form');

  // 5. 真实生成（保留真实等待）
  await page.click('#submitBtn');
  await page.waitForTimeout(900);
  const busy = await page.isDisabled('#submitBtn');
  await caption(page, busy ? '正在查询菜单、查询优惠并逐套做官方价格核对——这里的等待是真实的。' : '正在生成方案…');
  await page.waitForSelector('#results:not(.hidden)', { timeout: 150000 });
  await page.waitForFunction(() => document.querySelectorAll('#planGrid .plan').length >= 4, null, { timeout: 150000 });
  const planCount = await page.locator('#planGrid .plan').count();
  const prices = await page.locator('.plan .price').allTextContents();
  await caption(page, `四种策略都出来了，共 ${planCount} 套。价格是官方核对后的实付，不是菜单价相加。`, 6000);
  mark('plans', { planCount, prices });

  // 6. 逐人分配与“照顾最难满足的人”
  await page.evaluate(() => document.querySelector('#planGrid').scrollIntoView({ block: 'start' }));
  await caption(page, '每一套都写清：谁分到什么、满足了哪几项、还差哪一项，不给模糊的满意度百分比。', 6200);
  await page.evaluate(() => document.querySelectorAll('.plan')[3].scrollIntoView({ block: 'center' }));
  await caption(page, '“照顾最难满足的人”：先抬高满足比例最低那位的比例，再比较其他人，最后才看价格。', 7500);
  mark('fair');

  // 7. 现场否决
  await page.evaluate(() => document.querySelectorAll('.plan')[0].scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(800);
  const vetoText = (await page.locator('.plan').nth(0).locator('.person-alloc').nth(1).locator('.pa-item span').first().textContent()).replace(/\s+/g, ' ').trim();
  await caption(page, `B 分到了「${vetoText}」。他不接受这一份，就点这一行的「这份我不接受」。`, 4200);
  await page.locator('.plan').nth(0).locator('.person-alloc').nth(1).locator('.veto').first().click();
  await caption(page, '重新谈判：这项从此不再分给 B，其他人不受影响；重排之后重新向官方核价。');
  await page.waitForFunction(() => document.querySelector('#resultMeta')?.textContent.includes('不接受'), null, { timeout: 150000 });
  await page.waitForFunction(() => document.querySelectorAll('#planGrid .plan').length >= 3, null, { timeout: 150000 });
  await page.evaluate(() => document.querySelector('#resultMeta').scrollIntoView({ block: 'start' }));
  await caption(page, '页面回显：B 不接受这项。方案重新给出，价格也重新核过；如果无解，会直接说冲突在哪。', 4000);
  await page.evaluate(() => document.querySelectorAll('.plan')[0].scrollIntoView({ block: 'center' }));
  await caption(page, '注意 B 那一行已经换成了别的餐品，A 的分配不受影响——这就是“重谈”，不是让所有人一起让步。', 6500);
  mark('veto', { vetoed: vetoText });

  // 8. 收紧预算 + 多 10 元对比
  await page.evaluate(() => document.querySelector('.form-card').scrollIntoView({ block: 'start' }));
  await page.fill('#budget', '55');
  await page.locator('#budget').dispatchEvent('change');
  await page.waitForTimeout(600);
  await page.click('#submitBtn');
  await caption(page, '把预算收紧到 55 元，再问一次：多 10 元能换来什么？', 0);
  await page.waitForSelector('#results:not(.hidden)', { timeout: 150000 });
  await page.waitForFunction(() => document.querySelectorAll('#planGrid .plan').length >= 2, null, { timeout: 150000 });
  await page.waitForTimeout(2500);
  await page.locator('.plan').first().locator('.upgrade-one').click();
  await page.waitForSelector('.upgrade-box.show', { timeout: 150000 });
  const upgrade = (await page.locator('.upgrade-box.show').first().textContent()).replace(/\s+/g, ' ').trim();
  await page.evaluate(() => document.querySelector('.upgrade-box.show')?.scrollIntoView({ block: 'center' }));
  await caption(page, '预算上限 +10 元，两端都重新核价；实付差多少就算多少，没变化也照实说。', 8500);
  mark('upgrade', { text: upgrade.slice(0, 200) });

  // 9. 选择并导出
  await page.locator('.plan').first().locator('.select-one').click();
  await page.waitForTimeout(900);
  await caption(page, '选定这一套，导出脱敏方案卡；没有选择时导出按钮是禁用的。', 3000);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#exportSelected')]);
  const savedPath = `${OUT}export-card.json`;
  await download.saveAs(savedPath);
  await caption(page, '导出的是一份本地 JSON：匿名分配、金额和时间；不含口味原文、凭据或商品编码。', 3800);
  mark('export', { file: download.suggestedFilename() });

  // 10. 打开导出的文件核对
  const json = JSON.parse(await readFile(savedPath, 'utf8'));
  const pretty = JSON.stringify(json, null, 2).split('\n').slice(0, 20).join('\n');
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  await card(page, `<div class="k">打开下载的文件核对</div>
    <h1 class="h1s">${esc(json.store)} · ${esc(json.strategy)}</h1>
    <pre>${esc(pretty)}</pre>
    <p class="note">每人 metCount / missedCount / wantCount 与页面逐人一致；官方金额 ¥${json.verifiedPrice ?? '未验证'}，核对时间
    ${json.priceQueriedAt ? new Date(json.priceQueriedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}；文件里没有口味原文和凭据。</p>`, 13000);
  mark('export-open', { allocations: json.allocations, verifiedPrice: json.verifiedPrice });

  // 11. 收尾
  await card(page, `<div class="k">边界</div><h1>只查询、只试算，<br>不会替任何人下单。</h1><div class="rule"></div>
    <p>不下单 · 不支付 · 不领券 · 不兑换积分 · 不读收货地址。<br>
    方案只覆盖当前候选，不承诺全局最低价；忌口按名称和标签匹配，不是过敏原保证。</p>`, 9000);
  mark('outro');
} catch (e) {
  console.error('录屏流程失败：', e.message);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
  const video = await videoHandle?.path?.().catch(() => null);
  if (video) {
    await copyFile(video, `${OUT}raw.webm`);
    console.log('RAW_VIDEO', `${OUT}raw.webm`);
  }
  await writeFile(`${OUT}recording-log.json`, JSON.stringify({ recordedAt: new Date().toISOString(), base: BASE, viewport: '1280x720', steps, errors }, null, 2));
  console.log('ERRORS', JSON.stringify(errors));
}
