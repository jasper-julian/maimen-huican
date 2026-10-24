// 针对本轮修复的回归测试：选配餐品排除、失败阶段脱敏、句柄有效期、价格核对时间。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

const text = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });

function makeConnect(overrides = {}) {
  return {
    callTool: async (name, args) => {
      if (overrides[name]) return overrides[name](args);
      if (name === 'query-nearby-stores') return text({ data: [{ storeCode: '100', storeName: '模拟门店', address: '模拟地址', businessStatus: true }] });
      if (name === 'query-meals') return text({ data: {
        categories: [{ name: '汉堡', meals: [{ code: 'p1', tags: [] }] }],
        meals: { p1: { name: '模拟牛肉汉堡', currentPrice: '20.00' } },
      } });
      if (name === 'query-store-coupons') return text({ data: [] });
      if (name === 'query-meal-detail') throw new Error('detail 应由用例覆盖');
      if (name === 'calculate-price') throw new Error('price 应由用例覆盖');
      throw new Error('unexpected tool ' + name);
    },
  };
}

async function boot(overrides, options = {}) {
  const s = createApp({ credentialLoader: async () => ({ token: 'synthetic', source: 'test' }), connect: async () => makeConnect(overrides), ...options });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return s;
}
async function req(s, path, body, cookie = '') {
  const base = `http://127.0.0.1:${s.address().port}`;
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, d: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] || cookie };
}

test('需要套餐选配的餐品被排除后重新推荐，且所有策略都完成官方试算', async () => {
  const s = await boot({
    'query-meals': () => text({ data: {
      categories: [{ name: '汉堡', meals: [{ code: 'p1', tags: [] }, { code: 'p2', tags: [] }] }],
      meals: { p1: { name: '模拟牛肉汉堡', currentPrice: '20.00' }, p2: { name: '牛肉单品精选', currentPrice: '10.00' } },
    } }),
    // p2 更便宜，若不排除一定被选中；官方详情显示它有必选轮次。
    'query-meal-detail': (args) => args.code === 'p2'
      ? text({ data: { code: 'p2', name: '牛肉单品精选', rounds: [{ id: 'r1', name: '选择主食', quantity: 1, minQuantity: 1, choices: [{ code: 'x' }] }] } })
      : text({ data: { code: args.code, name: '模拟牛肉汉堡', rounds: [] } }),
    'calculate-price': () => text({ data: { price: 2000, productList: [{ productCode: 'p1', quantity: 1 }] } }),
  });
  try {
    let x = await req(s, '/api/query', { city: '上海', businessArea: '静安寺' });
    const ck = x.cookie;
    // p1 详情需要 p1 编码；用同一个 mock 时编码不一致会被拒绝，这里换成按 code 返回
    const menu = await req(s, '/api/menu', { storeHandle: x.d.stores[0].storeHandle }, ck);
    assert.equal(menu.d.menuCount, 2);
    const r = await req(s, '/api/recommend', { menuHandle: menu.d.menuHandle, people: [{ wants: '牛肉', avoids: '' }], budget: 60, diningMode: '堂食' }, ck);
    assert.equal(r.status, 200, JSON.stringify(r.d));
    assert.equal(r.d.plans.length, 4);
    for (const plan of r.d.plans) {
      assert.ok(!plan.items.some((it) => it.id === 'p2'), 'p2 需要选配，不能进入方案');
      assert.equal(plan.priceVerified, true);
      assert.equal(plan.verifiedPrice, 20);
      assert.ok(plan.priceQueriedAt, '价格核对时间必须存在');
      assert.ok(plan.queriedAt, '菜单查询时间必须存在');
    }
    assert.ok(r.d.notes.some((n) => n.includes('选配')), '需说明已排除需要选配的餐品');
  } finally { await new Promise((r) => s.close(r)); }
});

test('官方试算失败时记录失败阶段与脱敏原因，不透传上游原文', async () => {
  const s = await boot({
    'query-meal-detail': () => text({ data: { code: 'p1', name: '模拟牛肉汉堡', rounds: [] } }),
    // 业务失败：上游 message 含疑似个人信息，不能被透传
    'calculate-price': () => text({ code: 500, message: '内部错误 联系人13800000000 地址XX路1号' }),
  });
  try {
    let x = await req(s, '/api/query', { city: '上海', businessArea: '静安寺' });
    const ck = x.cookie;
    const menu = await req(s, '/api/menu', { storeHandle: x.d.stores[0].storeHandle }, ck);
    const r = await req(s, '/api/recommend', { menuHandle: menu.d.menuHandle, people: [{ wants: '牛肉', avoids: '' }], budget: 60, diningMode: '堂食' }, ck);
    const plan = r.d.plans[0];
    assert.equal(plan.priceVerified, false);
    assert.equal(plan.verifiedPrice, null);
    assert.equal(plan.priceFailure.stage, '官方价格试算');
    assert.ok(plan.priceFailure.reason.length > 0);
    const blob = JSON.stringify(r.d);
    assert.equal(blob.includes('13800000000'), false, '不得出现上游原文中的疑似个人信息');
    assert.equal(blob.includes('XX路'), false);
    assert.match(plan.priceStatus, /未验证价格/);
  } finally { await new Promise((r) => s.close(r)); }
});

test('句柄具有有效期：过期后不能继续用旧门店查询菜单', async () => {
  let clock = 1_700_000_000_000;
  const s = await boot({}, { now: () => clock });
  try {
    let x = await req(s, '/api/query', { city: '上海', businessArea: '静安寺' });
    const ck = x.cookie;
    const storeHandle = x.d.stores[0].storeHandle;
    clock += 6 * 60 * 1000; // 超过 5 分钟有效期
    x = await req(s, '/api/menu', { storeHandle }, ck);
    assert.equal(x.status, 410);
    assert.match(x.d.message, /过期|不属于当前会话/);
  } finally { await new Promise((r) => s.close(r)); }
});

test('未连接时返回明确的未配置状态，不会自动给出演示方案', async () => {
  const s = createApp({ credentialLoader: async () => ({ token: null, source: null }), connect: async () => { throw new Error('不应调用'); } });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  try {
    const st = await req(s, '/api/status');
    assert.equal(st.d.connected, false);
    assert.equal(st.d.hasCredential, false);
    const q = await req(s, '/api/query', { city: '上海', businessArea: '静安寺' });
    assert.notEqual(q.status, 200);
    assert.match(q.d.message, /Token|未配置/);
    // 演示只能显式请求，且必须标注虚构
    const demo = await req(s, '/api/demo', {});
    assert.equal(demo.status, 200);
    assert.equal(demo.d.source, 'demo');
    assert.ok(demo.d.notes.some((n) => n.includes('虚构')));
  } finally { await new Promise((r) => s.close(r)); }
});
