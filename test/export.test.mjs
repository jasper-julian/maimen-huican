// 导出统计回归：来源是真实的每人口味数量，不是常数，也不能依赖被剥离的偏好原文。
// 覆盖：0 项偏好、单项满足、多项部分满足、否决重排后的计数、页面/内部/导出三方一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { exportCard, recommendPlans } from '../lib/recommend.mjs';

const text = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const MENU = {
  p1: { name: '牛肉汉堡', price: 20 },
  p2: { name: '鸡肉汉堡', price: 25 },
  p3: { name: '辣鸡腿堡', price: 18 },
  p4: { name: '牛肉双层堡', price: 15 },
  s1: { name: '薯条', price: 10 },
};

function makeConnect() {
  return {
    callTool: async (name, args) => {
      if (name === 'query-nearby-stores') return text({ data: [{ storeCode: '100', storeName: '模拟门店', address: '模拟地址', businessStatus: true }] });
      if (name === 'query-meals') {
        const codes = Object.keys(MENU);
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
        const total = args.items.reduce((s, i) => s + MENU[i.productCode].price * i.quantity * 100, 0);
        return text({ data: { price: total, productList: args.items.map((i) => ({ productCode: i.productCode, quantity: i.quantity })) } });
      }
      throw new Error('unexpected tool ' + name);
    },
  };
}

async function boot() {
  const s = createApp({ credentialLoader: async () => ({ token: 'synthetic', source: 'test' }), connect: async () => makeConnect() });
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
  return { ck, result: x.d };
}

/** 三处口径必须一致：页面用的 satisfaction、方案里分配上的计数、导出的 metCount/wantCount。 */
function assertConsistent(exported, plan) {
  exported.allocations.forEach((a, i) => {
    const pageMet = plan.satisfaction[i].met.length;
    const pageWant = plan.satisfaction[i].wants.length;
    assert.equal(a.metCount, pageMet, `第 ${i + 1} 人导出 metCount 与页面不一致`);
    assert.equal(a.wantCount, pageWant, `第 ${i + 1} 人导出 wantCount 与页面不一致`);
    assert.equal(a.missedCount, plan.satisfaction[i].missed.length, `第 ${i + 1} 人 missedCount 不一致`);
    assert.ok(a.metCount >= 0 && a.metCount <= a.wantCount, `第 ${i + 1} 人 metCount 越界`);
    assert.equal(a.metCount + a.missedCount, a.wantCount, `第 ${i + 1} 人 满足+未满足 应等于总需求`);
    assert.equal(plan.peopleAllocations[i].satisfaction.wantCount, a.wantCount);
    assert.equal(plan.peopleAllocations[i].satisfaction.metCount, a.metCount);
  });
}

test('没有填写想吃的人：wantCount 为 0，不虚报满足数', async () => {
  const s = await boot();
  try {
    const { ck, result } = await setup(s, [{ wants: '', avoids: '' }], 100);
    const plan = result.plans.find((p) => p.key === 'budget');
    const ex = await req(s, '/api/export', { planHandle: plan.planHandle }, ck);
    assert.equal(ex.status, 200);
    assert.deepEqual(
      { met: ex.d.allocations[0].metCount, missed: ex.d.allocations[0].missedCount, want: ex.d.allocations[0].wantCount },
      { met: 0, missed: 0, want: 0 },
    );
    assertConsistent(ex.d, plan);
  } finally { await new Promise((r) => s.close(r)); }
});

test('单项偏好被满足：导出 metCount=1、wantCount=1', async () => {
  const s = await boot();
  try {
    const { ck, result } = await setup(s, [{ wants: '牛肉', avoids: '' }, { wants: '鸡肉', avoids: '' }], 120);
    const plan = result.plans.find((p) => p.key === 'taste');
    const ex = await req(s, '/api/export', { planHandle: plan.planHandle }, ck);
    assert.deepEqual(ex.d.allocations.map((a) => [a.metCount, a.wantCount]), [[1, 1], [1, 1]]);
    assertConsistent(ex.d, plan);
  } finally { await new Promise((r) => s.close(r)); }
});

test('多项偏好且只能部分满足：wantCount 保留真实总数，未满足数与之一致', async () => {
  const s = await boot();
  try {
    // 预算 15 元只够一份最便宜主食，薯条加不进来：牛肉满足、薯条未满足
    const { ck, result } = await setup(s, [{ wants: '牛肉 薯条', avoids: '' }], 15);
    const plan = result.plans.find((p) => p.key === 'taste');
    assert.equal(plan.satisfaction[0].wants.length, 2);
    assert.equal(plan.satisfaction[0].met.length, 1);
    const ex = await req(s, '/api/export', { planHandle: plan.planHandle }, ck);
    assert.deepEqual(
      { met: ex.d.allocations[0].metCount, missed: ex.d.allocations[0].missedCount, want: ex.d.allocations[0].wantCount },
      { met: 1, missed: 1, want: 2 },
    );
    assertConsistent(ex.d, plan);
  } finally { await new Promise((r) => s.close(r)); }
});

test('否决重排后导出计数随重新推荐更新，不留上一轮的满足数', async () => {
  const s = await boot();
  try {
    // B 不吃辣，所以先分到的是鸡肉汉堡；否决它之后 B 只能吃牛肉，满足数应变成 0
    const { ck, result } = await setup(s, [{ wants: '牛肉', avoids: '' }, { wants: '鸡肉', avoids: '辣' }], 120);
    const plan = result.plans.find((p) => p.key === 'taste');
    assert.deepEqual(plan.peopleAllocations[1].items.map((x) => x.name), ['鸡肉汉堡']);
    const beforeEx = await req(s, '/api/export', { planHandle: plan.planHandle }, ck);
    assert.equal(beforeEx.d.allocations[1].metCount, 1);

    const veto = await req(s, '/api/veto', { planHandle: plan.planHandle, personIndex: 1, itemIndex: 0 }, ck);
    assert.equal(veto.status, 200, JSON.stringify(veto.d));
    const after = veto.d.plans.find((p) => p.key === 'taste');
    assert.equal(after.peopleAllocations[1].items.some((x) => x.name === '鸡肉汉堡'), false, '被否决的餐品不能再分给该人');

    const afterEx = await req(s, '/api/export', { planHandle: after.planHandle }, ck);
    const b = afterEx.d.allocations[1];
    assert.equal(b.wantCount, 1, '总需求不因否决而消失');
    assert.equal(b.metCount, 0, '原来那项已不可能满足');
    assert.equal(b.missedCount, 1);
    assertConsistent(afterEx.d, after);
  } finally { await new Promise((r) => s.close(r)); }
});

test('所有策略、所有人、所有人数都满足 0 <= met <= want 且导出不含偏好原文', async () => {
  const s = await boot();
  try {
    const { ck, result } = await setup(s, [
      { wants: '牛肉 薯条', avoids: '' },
      { wants: '鸡肉', avoids: '辣' },
      { wants: '', avoids: '' },
      { wants: '牛肉 鸡肉 薯条', avoids: '鱼' },
    ], 200);
    for (const plan of result.plans) {
      const ex = await req(s, '/api/export', { planHandle: plan.planHandle }, ck);
      assert.equal(ex.status, 200);
      assertConsistent(ex.d, plan);
      const blob = JSON.stringify(ex.d);
      // 只检查“偏好原文/内部编码”这类不该出现的东西；餐品名本身当然会出现在分配里。
      for (const word of ['"wants"', '"avoids"', '牛肉 薯条', '牛肉 鸡肉 薯条', 'productCode', 'planHandle', 'mm_session']) {
        assert.equal(blob.includes(word), false, `导出不得包含 ${word}`);
      }
    }
  } finally { await new Promise((r) => s.close(r)); }
});

test('exportCard 直接调用：计数来自分配的满足清单，不读已被剥离的 wants 数组', () => {
  const plan = recommendPlans({
    menu: [{ id: 'a', name: '牛肉汉堡', price: 20, category: '主食' }, { id: 'b', name: '薯条', price: 10, category: '小食' }],
    people: [{ wants: '牛肉 薯条', avoids: '' }], budget: 20, keys: ['taste'], source: 'demo',
  }).plans[0];
  assert.equal(plan.peopleAllocations[0].satisfaction.wants, undefined, '分配上不应再挂偏好原文');
  const card = exportCard(plan, 1, '堂食');
  assert.equal(card.allocations[0].wantCount, 2);
  assert.equal(card.allocations[0].metCount, 1);
  assert.equal(card.allocations[0].missedCount, 1);
});
