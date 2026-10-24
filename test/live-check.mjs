// 用户明确授权：上海·静安寺，只读真实验证。
// 覆盖完整谈判闭环：查询 → 四种方案 → 某人否决重排 → 多 10 元对比 → 脱敏导出。
// 只输出脱敏业务摘要，不输出 Token、券码、地址或原始响应。
import { createApp } from '../server.mjs';
import { writeFile } from 'node:fs/promises';

const server = createApp();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = '';
async function post(path, body) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  cookie = r.headers.get('set-cookie')?.split(';')[0] || cookie;
  const d = await r.json();
  if (!r.ok) throw new Error(`${path}: ${d.message}`);
  return d;
}
const planBrief = p => ({
  title: p.title, strategy: p.key,
  items: p.items.map(x => ({ name: x.name, quantity: x.quantity })),
  allocations: p.peopleAllocations.map(a => ({
    person: a.person,
    items: a.items.map(x => x.name),
    met: a.satisfaction.met,
    missed: a.satisfaction.missed,
    ratio: a.satisfaction.ratio,
  })),
  menuEstimate: p.subtotalEstimate,
  priceVerified: p.priceVerified,
  verifiedPrice: p.verifiedPrice,
  priceStatus: p.priceStatus,
  withinBudget: p.withinBudget,
  discount: p.discount,
  couponCoverage: p.couponCoverage,
  priceQueriedAt: p.priceQueriedAt || null,
  unmet: p.unmet,
  failure: p.priceFailure || null,
});

try {
  const connected = await post('/api/connect', {});
  console.log(JSON.stringify({ stage: 'connect', connected: connected.connected }));

  const query = await post('/api/query', { city: '上海', businessArea: '静安寺' });
  console.log(JSON.stringify({ stage: 'stores', count: query.stores.length, openCount: query.stores.filter(x => x.open).length }));
  const store = query.stores.find(x => x.open);
  if (!store) throw new Error('没有营业门店');

  const menu = await post('/api/menu', { storeHandle: store.storeHandle });
  console.log(JSON.stringify({ stage: 'menu', store: store.name, count: menu.menuCount, couponCount: menu.couponCount, notes: menu.notes }));

  const people = [{ wants: '鸡肉', avoids: '辣' }, { wants: '牛肉', avoids: '鱼' }];
  const first = await post('/api/recommend', { menuHandle: menu.menuHandle, people, budget: 120, diningMode: '堂食' });
  const brief = first.plans.map(planBrief);
  console.log(JSON.stringify({ stage: 'recommend', plans: brief.map(p => ({ title: p.title, price: p.verifiedPrice, verified: p.priceVerified })) }, null, 1));

  // 第 2 人对口味方案里自己那份说「不接受」，触发重排与重新试算
  const taste = first.plans.find(p => p.key === 'taste');
  const vetoed = taste.peopleAllocations[1].items[0];
  const afterVeto = await post('/api/veto', { planHandle: taste.planHandle, personIndex: 1, itemIndex: 0 });
  const vetoBrief = {
    person: afterVeto.veto.person, item: afterVeto.veto.itemName,
    vetoes: afterVeto.vetoes,
    plans: afterVeto.plans.map(planBrief),
    conflicts: afterVeto.conflicts.map(c => ({ person: c.person, message: c.message })),
  };
  console.log(JSON.stringify({ stage: 'veto', person: vetoBrief.person, item: vetoBrief.item, verified: afterVeto.plans.map(p => p.priceVerified), prices: afterVeto.plans.map(p => p.verifiedPrice) }));

  // 多 10 元对比：用「折中推荐」（该方案还有加餐空间）
  const upgradePlan = afterVeto.plans.find(p => p.key === 'balanced' && p.priceVerified) || afterVeto.plans.find(p => p.priceVerified);
  let upgrade = null;
  if (upgradePlan) upgrade = await post('/api/upgrade', { planHandle: upgradePlan.planHandle });
  console.log(JSON.stringify({ stage: 'upgrade', ...upgrade }));

  // 第二段：预算收紧到 55 元，演示“多 10 元确实换到了东西”的真实对比
  const tight = await post('/api/recommend', { menuHandle: menu.menuHandle, people, budget: 55, diningMode: '堂食' });
  const tightTaste = tight.plans.find(p => p.key === 'taste');
  const tightUpgrade = tightTaste ? await post('/api/upgrade', { planHandle: tightTaste.planHandle }) : null;
  const tightBrief = { budget: 55, plans: tight.plans.map(planBrief), conflicts: tight.conflicts.map(c => c.message), upgrade: tightUpgrade };
  console.log(JSON.stringify({ stage: 'tight-budget', budget: 55, prices: tight.plans.map(p => p.verifiedPrice), upgrade: tightUpgrade }));

  // 导出用户最终选择的方案（这里选已核对且预算内的一张）
  const chosen = afterVeto.plans.find(p => p.priceVerified) || afterVeto.plans[0];
  const card = await post('/api/export', { planHandle: chosen.planHandle });

  const evidence = await (await fetch(base + '/api/evidence', { headers: { cookie } })).json();

  const summary = {
    checkedAt: new Date().toISOString(),
    area: '上海 静安寺',
    store: store.name,
    menuCount: menu.menuCount,
    couponCount: menu.couponCount,
    people: 2,
    vetoedItem: vetoed.name,
    plans: brief,
    veto: vetoBrief,
    upgrade,
    tightBudget: tightBrief,
    exported: card,
    notes: first.notes,
    policy: '只读；未下单、未支付、未领券、未兑换、未抽奖',
    events: evidence.events,
  };
  await writeFile(new URL('../outputs/live-verification.json', import.meta.url), JSON.stringify(summary, null, 2));
  await writeFile(new URL('../outputs/真实验证-脱敏方案卡.json', import.meta.url), JSON.stringify(card, null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await new Promise(r => server.close(r));
}
