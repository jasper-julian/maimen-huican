// 只读诊断：定位每套方案在官方试算的失败阶段。
// 只输出结构信息（字段名、错误码、业务提示是否为空），不输出凭据、卡包原文、地址或手机号。
import { connectMcp, loadCredential, McpError } from '../lib/mcp-client.mjs';
import { SCENE, unwrap, parseStores, parseMenu, priceArgs } from '../lib/mcd-adapter.mjs';
import { recommendPlans } from '../lib/recommend.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const cred = await loadCredential(process.env, undefined, ROOT);
if (!cred.token) { console.error('未配置 Token'); process.exit(1); }

const c = await connectMcp(cred.token);
const stores = parseStores(unwrap(await c.callTool('query-nearby-stores', { beType: 1, searchType: 2, city: '上海', keyword: '静安寺' })));
const store = stores.find((s) => s.open) || stores[0];
const menu = parseMenu(unwrap(await c.callTool('query-meals', { storeCode: store.code, ...SCENE })));
const plans = recommendPlans({ menu, offers: [], people: [{ wants: '鸡肉', avoids: '辣' }, { wants: '牛肉', avoids: '鱼' }], budget: 120, source: 'real' });

for (const plan of plans.plans) {
  console.log(`\n=== ${plan.title} | 估算 ${plan.subtotalEstimate} ===`);
  for (const item of plan.items) {
    console.log(`- ${item.name} x${item.quantity} id=${item.id} 菜单价=${item.price} 库存=${item.stock}`);
    try {
      const d = unwrap(await c.callTool('query-meal-detail', { storeCode: store.code, ...SCENE, code: item.id }));
      console.log('  detail keys:', Object.keys(d).join(','));
      const rounds = Array.isArray(d.rounds) ? d.rounds : [];
      console.log('  rounds:', JSON.stringify(rounds.slice(0, 2).map((r) => ({ keys: Object.keys(r), minQuantity: r.minQuantity, quantity: r.quantity, itemCount: Array.isArray(r.comboItemList) ? r.comboItemList.length : null }))));
      console.log('  detail.code === id:', d.code === item.id, '| detail.name === name:', d.name === item.name);
    } catch (e) {
      console.log('  detail FAILED:', e.kind || 'error', e.message);
    }
  }
  try {
    const args = priceArgs(store, plan.items);
    const raw = unwrap(await c.callTool('calculate-price', args)).valueOf();
    console.log('  price keys:', Object.keys(raw).join(','));
    console.log('  price:', raw.price, '| productList:', JSON.stringify((raw.productList || []).map((p) => ({ productCode: p.productCode, quantity: p.quantity }))));
    console.log('  请求:', JSON.stringify(args.items));
  } catch (e) {
    console.log('  price FAILED:', e.kind || 'error', e.message, e.detail ? JSON.stringify(e.detail) : '');
  }
}
