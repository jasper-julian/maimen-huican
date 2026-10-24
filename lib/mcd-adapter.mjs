// 官方接口契约：以当前连接 tools/list 的 inputSchema 做最后一道校验。
import { McpError } from './mcp-client.mjs';
export const SCENE = Object.freeze({ orderType: 1, beType: 1 });
export function unwrap(result) {
  let data = result?.structuredContent;
  if (!data) {
    const texts = result?.content?.filter(x => x.type === 'text') || [];
    for (const x of texts) { try { data = JSON.parse(x.text); break; } catch {} }
  }
  if (!data || typeof data !== 'object') throw new McpError('protocol', '官方返回结构无法识别，未使用该结果。');
  if (data.code != null && ![0,200,'0','200'].includes(data.code)) throw new McpError('tool', '官方业务查询未成功，未使用该结果。');
  if (!('data' in data) || data.data == null) throw new McpError('tool', '官方未返回可用业务数据，请重试或更换门店。');
  return data.data;
}
export function parseStores(data) {
  if (!Array.isArray(data)) throw new McpError('protocol', '官方门店结构暂不兼容。');
  return data.filter(x=>typeof x.storeCode==='string').map(x=>({code:x.storeCode,name:String(x.storeName||'麦当劳门店'),address:String(x.address||''),open:x.businessStatus===true,hours:[x.businessStartTime,x.businessEndTime].filter(Boolean).join(' — ')}));
}
function category(name) {
  if(/汉堡|卷|麦满分|帕尼尼|堡/.test(name)&&!/套餐|组合|双人|三人|分享/.test(name))return '主食';
  if(/薯条|鸡块|鸡翅|小食/.test(name))return '小食';
  if(/可乐|咖啡|奶茶|果汁|饮料|牛奶|茶|豆浆/.test(name))return '饮品';
  return '其他';
}
export function parseMenu(data) {
  if(!data || !Array.isArray(data.categories) || !data.meals || typeof data.meals!=='object')throw new McpError('protocol','官方菜单结构暂不兼容。');
  const result=new Map();
  for(const cat of data.categories)for(const ref of cat.meals||[]){
    const raw=data.meals[ref.code];if(!raw||!raw.name)continue;
    // 菜单 currentPrice 为官方展示字符串（元）；calculate-price 的 price 为整数分。
    const value=String(raw.currentPrice??'').replace(/[¥￥元\s]/g,'');
    const price=/^\d+(\.\d{1,2})?$/.test(value)?Number(value):NaN;
    if(!Number.isFinite(price)||price<0)continue;
    const name=String(raw.name);
    // 排除组合/套餐与随单购：本版只推荐可独立试算的单品，不擅自替用户选择套餐子项。
    if(/套餐|组合|双人|三人|四人|分享|随单|会员|卡$|随心选|任选|专享|学生|买.{0,3}送|加价购/.test(name)||raw.withOrder)continue;
    // 分类标签可能同时包含“鸡/鱼/牛”多种食材，只用单品名称和单品专属标签匹配口味。
    const tags=[...(ref.tags||[]).filter(x=>typeof x==='string')];
    for(const [tag,re]of [['鸡肉',/鸡/],['牛肉',/牛肉|巨无霸|吉士汉堡/],['鱼',/鱼/],['辣',/辣/],['薯条',/薯条/],['无糖',/零度|无糖/]])if(re.test(name))tags.push(tag);
    result.set(ref.code,{id:ref.code,name,price,category:category(name),tags,available:raw.available!==false&&raw.isAvailable!==false&&raw.soldOut!==true&&raw.stock!==0,stock:typeof raw.stock==='number'?raw.stock:null});
  }
  return [...result.values()];
}
export function parseCoupons(data) {
  if(!Array.isArray(data))throw new McpError('protocol','官方优惠结构暂不兼容。');
  // code/id 仅留在服务端，浏览器和导出永不包含卡包凭证。
  return data.filter(x=>typeof x.couponCode==='string'&&typeof x.couponId==='string').map(x=>({code:x.couponCode,id:x.couponId,title:String(x.title||'门店优惠'),condition:String(x.tradeDateTime||'有效期未返回；需试算验证'),products:(x.products||[]).map(p=>p.productCode).filter(Boolean)}));
}
export function priceArgs(store,items,coupon){
  if(!store||typeof store.code!=='string'||!Array.isArray(items))throw new McpError('protocol','试算输入不完整。');
  return {storeCode:store.code,...SCENE,items:items.map(x=>({productCode:x.id,quantity:x.quantity,...(coupon&&coupon.products.includes(x.id)?{couponCode:coupon.code,couponId:coupon.id}:{})}))};
}
/** 商品详情是否包含必选配置轮次（套餐/选配）。有轮次的单品不能在不替用户选择的前提下试算。 */
export function detailRequiresChoice(detail) {
  const rounds = Array.isArray(detail?.rounds) ? detail.rounds : [];
  return rounds.some(r => Number(r?.minQuantity) > 0 || Number(r?.quantity) > 0);
}
export function parsePrice(data,items) {
  if(!data||!Number.isInteger(data.price)||data.price<0||!Array.isArray(data.productList))throw new McpError('protocol','官方试算缺少明确总价或商品明细，仍为未验证价格。');
  const actual=new Map();for(const p of data.productList){if(typeof p.productCode!=='string'||!Number.isInteger(p.quantity)||p.quantity<1)throw new McpError('protocol','官方试算商品数量无法核对。');actual.set(p.productCode,(actual.get(p.productCode)||0)+p.quantity);}
  if(actual.size!==items.length||items.some(x=>actual.get(x.id)!==x.quantity))throw new McpError('protocol','官方试算商品与方案不一致，仍为未验证价格。');
  const money=k=>Number.isInteger(data[k])?data[k]/100:null;
  return {verifiedPrice:data.price/100,originalPrice:money('originalPrice'),discount:money('discount'),packingPrice:money('packingPrice'),deliveryPrice:money('deliveryPrice'),tablewarePrice:money('tablewarePrice'),priceQueriedAt:new Date().toISOString()};
}
