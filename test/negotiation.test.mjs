// 饭局谈判官主流程测试：否决重分配、无解冲突、无偏好者中性、同等满足比价格、加价对比与失败状态。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { recommendPlans, compareUpgrade } from '../lib/recommend.mjs';

const text = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const MENU = {
  p1: { name: '牛肉汉堡', price: 20 },
  p2: { name: '鸡肉汉堡', price: 25 },
  p3: { name: '辣鸡腿堡', price: 18 },
  p4: { name: '牛肉双层堡', price: 15 },
  s1: { name: '薯条', price: 10 },
};

function makeConnect({ failOn = [], only = null } = {}) {
  return {
    callTool: async (name, args) => {
      if (name === 'query-nearby-stores') return text({ data: [{ storeCode: '100', storeName: '模拟门店', address: '模拟地址', businessStatus: true }] });
      if (name === 'query-meals') {
        const codes = only ? Object.keys(MENU).filter((c) => only.includes(c)) : Object.keys(MENU);
        return text({ data: {
          categories: [
            { name: '汉堡', meals: codes.filter((c) => c.startsWith('p')).map((code) => ({ code, tags: [] })) },
            { name: '小食', meals: codes.filter((c) => c.startsWith('s')).map((code) => ({ code, tags: [] })) },
          ],
          meals: Object.fromEntries(codes.map((c) => [c, { name: MENU[c].name, currentPrice: MENU[c].price.toFixed(2) }])),
        } });
      }
      if (name === 'query-store-coupons') return text({ data: [] });
      if (name === 'query-meal-detail') return text({ data: { code: args.code, name: MENU[args.code]?.name ?? '未知', rounds: [] } });
      if (name === 'calculate-price') {
        if (args.items.some((i) => failOn.includes(i.productCode))) return text({ code: 500, message: '上游内部错误 不应被透出' });
        const total = args.items.reduce((s, i) => s + MENU[i.productCode].price * i.quantity * 100, 0);
        return text({ data: { price: total, productList: args.items.map((i) => ({ productCode: i.productCode, quantity: i.quantity })) } });
      }
      throw new Error('unexpected tool ' + name);
    },
  };
}

async function boot(opts) {
  const s = createApp({ credentialLoader: async () => ({ token: 'synthetic', source: 'test' }), connect: async () => makeConnect(opts) });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return s;
}
async function req(s, path, body, cookie = '') {
  const base = `http://127.0.0.1:${s.address().port}`;
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body ?? {}) });
  return { status: r.status, d: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] || cookie };
}
async function setup(s, people, budget) {
  let x = await req(s, '/api/query', { city: '上海', businessArea: '静安寺' });
  const ck = x.cookie;
  x = await req(s, '/api/menu', { storeHandle: x.d.stores[0].storeHandle }, ck);
  const menuHandle = x.d.menuHandle;
  x = await req(s, '/api/recommend', { menuHandle, people, budget, diningMode: '堂食' }, ck);
  return { ck, menuHandle, result: x.d };
}
const byKey = (r, key) => r.plans.find((p) => p.key === key);
const namesFor = (plan, personIndex) => plan.peopleAllocations[personIndex].items.map((x) => x.name);

test('四人匿名需求卡：每人都有逐人分配与可解释的满足清单，无偏好者标记为中性', async () => {
  const s = await boot();
  try {
    const { result } = await setup(s, [
      { wants: '牛肉', avoids: '' }, { wants: '鸡肉', avoids: '辣' }, { wants: '', avoids: '' }, { wants: '薯条', avoids: '' },
    ], 200);
    assert.equal(result.plans.length, 4);
    assert.deepEqual(result.plans.map((p) => p.key), ['taste', 'budget', 'balanced', 'fair']);
    assert.deepEqual(result.people.map((p) => p.name), ['匿名 A', '匿名 B', '匿名 C', '匿名 D']);
    for (const plan of result.plans) {
      assert.equal(plan.peopleAllocations.length, 4);
      for (const a of plan.peopleAllocations) {
        assert.ok(a.person.startsWith('匿名 '));
        assert.ok(Array.isArray(a.satisfaction.met) && Array.isArray(a.satisfaction.missed));
      }
      // 无偏好者是中性：比例为 null，不会被当成 0% 满足
      assert.equal(plan.satisfaction[2].ratio, null);
    }
  } finally { await new Promise((r) => s.close(r)); }
});

test('忌口是硬约束：即使更便宜，也不把含辣主食分给不吃辣的人', async () => {
  const s = await boot();
  try {
    const { result } = await setup(s, [{ wants: '鸡肉', avoids: '辣' }], 100);
    for (const plan of result.plans) {
      const items = plan.peopleAllocations[0].items;
      assert.ok(!items.some((x) => x.name.includes('辣')), '不得分配含辣餐品');
    }
  } finally { await new Promise((r) => s.close(r)); }
});

test('某人点“这份我不接受”后重新分配并重新试算，服务端句柄可用', async () => {
  const s = await boot();
  try {
    const { ck, result } = await setup(s, [{ wants: '牛肉', avoids: '' }, { wants: '鸡肉', avoids: '辣' }], 100);
    const plan = byKey(result, 'taste');
    const before = namesFor(plan, 1);
    assert.deepEqual(before, ['鸡肉汉堡']);
    // 第 2 人否决自己分到的那份（用索引，服务端解析，浏览器不接触商品编码）
    const veto = await req(s, '/api/veto', { planHandle: plan.planHandle, personIndex: 1, itemIndex: 0 }, ck);
    assert.equal(veto.status, 200, JSON.stringify(veto.d));
    assert.equal(veto.d.veto.person, '匿名 B');
    assert.equal(veto.d.veto.itemName, '鸡肉汉堡');
    const after = byKey(veto.d, 'taste');
    assert.ok(!namesFor(after, 1).includes('鸡肉汉堡'), '被否决的餐品不能再分给该人');
    assert.ok(after.peopleAllocations[1].items.length > 0, '仍然给出可吃的一份');
    assert.equal(after.priceVerified, true, '重排后要重新完成官方试算');
    assert.ok(after.priceQueriedAt);
    // 否决记录随会话保存
    assert.deepEqual(veto.d.vetoes[1].rejected, ['鸡肉汉堡']);
  } finally { await new Promise((r) => s.close(r)); }
});

test('无解时不自动放宽硬约束，给出具体冲突并保留该人的否决项', async () => {
  // 该门店只有一份不含辣的主食：牛肉汉堡；否决后无解
  const s = await boot({ only: ['p1', 'p3', 's1'] });
  try {
    // 只有不含辣的 p1 可吃；否决后无解
    const { ck, result } = await setup(s, [{ wants: '牛肉', avoids: '辣' }], 100);
    const plan = byKey(result, 'budget');
    assert.deepEqual(namesFor(plan, 0), ['牛肉汉堡']);
    const veto = await req(s, '/api/veto', { planHandle: plan.planHandle, personIndex: 0, itemIndex: 0 }, ck);
    assert.equal(veto.status, 200);
    assert.equal(veto.d.plans.length, 0, '无解时不能硬凑方案');
    assert.equal(veto.d.conflicts.length, 1);
    assert.match(veto.d.conflicts[0].message, /匿名 A/);
    assert.match(veto.d.conflicts[0].message, /不会自动放宽/);
    assert.equal(veto.d.vetoes[0].rejected[0], '牛肉汉堡');
  } finally { await new Promise((r) => s.close(r)); }
});

test('同等满足时比较价格：“照顾最难满足的人”不会选更贵的同分方案', async () => {
  const s = await boot();
  try {
    // 牛肉汉堡 20 与 牛肉双层堡 15 都能满足“牛肉”，应选便宜的
    const { result } = await setup(s, [{ wants: '牛肉', avoids: '' }], 100);
    for (const plan of result.plans) {
      const items = plan.peopleAllocations[0].items;
      assert.deepEqual(items.map((x) => x.name), ['牛肉双层堡']);
      assert.equal(plan.satisfaction[0].ratio, 1);
      assert.equal(plan.verifiedPrice, 15);
    }
  } finally { await new Promise((r) => s.close(r)); }
});

test('多 10 元对比：两端都完成官方试算才给出增量、新增餐品和受益的人', async () => {
  const s = await boot();
  try {
    // 主食最低合计 33 元；40 元时薯条(10)加不进来，50 元时能加
    const { ck, result } = await setup(s, [{ wants: '牛肉', avoids: '' }, { wants: '鸡肉 薯条', avoids: '' }], 40);
    const plan = byKey(result, 'taste');
    assert.equal(plan.priceVerified, true);
    assert.equal(plan.verifiedPrice, 33);
    const up = await req(s, '/api/upgrade', { planHandle: plan.planHandle }, ck);
    assert.equal(up.status, 200, JSON.stringify(up.d));
    assert.equal(up.d.comparable, true);
    assert.equal(up.d.budget, 50);
    assert.equal(up.d.verifiedPrice, 43);
    assert.equal(up.d.delta, 10);
    assert.deepEqual(up.d.added, [{ name: '薯条', quantity: 1 }]);
    assert.equal(up.d.beneficiaries[0].person, '匿名 B');
    assert.deepEqual(up.d.beneficiaries[0].gained, ['薯条']);
    assert.deepEqual(up.d.beneficiaries[0].added, [{ name: '薯条', quantity: 1 }], '受益项要能说清多拿到了什么');
    // 结果缓存，避免重复请求官方接口
    const again = await req(s, '/api/upgrade', { planHandle: plan.planHandle }, ck);
    assert.deepEqual(again.d, up.d);
  } finally { await new Promise((r) => s.close(r)); }
});

test('加价候选试算失败时不给精确增量，如实说明原因', async () => {
  const s = await boot({ failOn: ['s1'] });
  try {
    const { ck, result } = await setup(s, [{ wants: '牛肉', avoids: '' }, { wants: '鸡肉 薯条', avoids: '' }], 40);
    const plan = byKey(result, 'taste');
    const up = await req(s, '/api/upgrade', { planHandle: plan.planHandle }, ck);
    assert.equal(up.status, 200);
    assert.equal(up.d.comparable, false);
    assert.equal(up.d.delta, undefined, '未验证时不能给出精确多花多少');
    assert.match(up.d.reason, /未完成官方价格核对/);
    assert.equal(JSON.stringify(up.d).includes('上游内部错误'), false, '不得透传上游原文');
  } finally { await new Promise((r) => s.close(r)); }
});

test('原方案未验证价格、演示方案都不做加价对比', async () => {
  const s = await boot({ failOn: ['p1', 'p2', 'p3', 'p4', 's1'] });
  try {
    const { ck, result } = await setup(s, [{ wants: '牛肉', avoids: '' }], 100);
    const plan = result.plans[0];
    assert.equal(plan.priceVerified, false);
    const up = await req(s, '/api/upgrade', { planHandle: plan.planHandle }, ck);
    assert.equal(up.status, 409);
    assert.match(up.d.message, /官方价格核对/);
  } finally { await new Promise((r) => s.close(r)); }

  const s2 = await boot();
  try {
    const demo = await req(s2, '/api/demo', {});
    const r = await req(s2, '/api/recommend', { menuHandle: demo.d.menuHandle, people: [{ wants: '鸡肉', avoids: '' }], budget: 200, diningMode: '堂食' }, demo.cookie);
    const plan = r.d.plans[0];
    assert.equal(plan.priceVerified, false, '演示方案不能标记为已验证价格');
    const up = await req(s2, '/api/upgrade', { planHandle: plan.planHandle }, demo.cookie);
    assert.equal(up.status, 409);
    assert.match(up.d.message, /演示/);
  } finally { await new Promise((r) => s2.close(r)); }
});

test('导出只含匿名分配与官方价格时间，不含口味原文或商品编码', async () => {
  const s = await boot();
  try {
    const { ck, result } = await setup(s, [{ wants: '牛肉', avoids: '辣' }, { wants: '鸡肉', avoids: '' }], 120);
    const plan = byKey(result, 'fair');
    const ex = await req(s, '/api/export', { planHandle: plan.planHandle }, ck);
    assert.equal(ex.status, 200);
    assert.equal(ex.d.allocations.length, 2);
    assert.ok(ex.d.allocations[0].person.startsWith('匿名 '));
    assert.equal(typeof ex.d.allocations[0].metCount, 'number');
    assert.ok(ex.d.priceQueriedAt);
    const blob = JSON.stringify(ex.d);
    assert.equal(blob.includes('"wants"'), false, '不得导出口味原文');
    assert.equal(blob.includes('avoids'), false);
    assert.equal(blob.includes('productCode'), false);
    assert.equal(blob.includes('p1'), false);
    assert.equal('planHandle' in ex.d, false);
  } finally { await new Promise((r) => s.close(r)); }
});

test('加价后只多分到同类餐品、没有新增关键词满足时，也如实列出多拿到的餐品', () => {
  const menu = [{ id: 'm1', name: '鸡肉汉堡', price: 20, category: '主食' }, { id: 'm2', name: '鸡块', price: 8, category: '小食', tags: ['鸡肉'] }];
  const base = recommendPlans({ menu, people: [{ wants: '鸡肉', avoids: '' }], budget: 20, keys: ['taste'] }).plans[0];
  base.priceVerified = true; base.verifiedPrice = 20;
  const next = recommendPlans({ menu, people: [{ wants: '鸡肉', avoids: '' }], budget: 30, keys: ['taste'] }).plans[0];
  next.priceVerified = true; next.verifiedPrice = 28;
  const r = compareUpgrade(base, next, 10);
  assert.equal(r.comparable, true);
  assert.equal(r.changed, true);
  assert.deepEqual(r.beneficiaries[0].gained, [], '口味关键词已经满足，不重复计为新增满足');
  assert.deepEqual(r.beneficiaries[0].added, [{ name: '鸡块', quantity: 1 }], '多拿到的餐品必须如实列出');
  assert.equal(r.delta, 8);
});
