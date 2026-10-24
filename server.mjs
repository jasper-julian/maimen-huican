import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { loadCredential, connectMcp, McpError } from './lib/mcp-client.mjs';
import { SCENE, unwrap, parseStores, parseMenu, parseCoupons, priceArgs, parsePrice, detailRequiresChoice } from './lib/mcd-adapter.mjs';
import { demoMenu, demoOffers, demoStore } from './lib/demo-data.mjs';
import { recommendPlans, exportCard, compareUpgrade } from './lib/recommend.mjs';
const ROOT=fileURLToPath(new URL('.',import.meta.url));
class UserError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const safeError=e=>e instanceof UserError?e.message:e instanceof McpError?({auth:'认证失效，请在本机更新 Token 后重连。',timeout:'官方服务超时，请稍后重试。',network:'官方服务暂不可达，请稍后重试。',policy:'本版本禁止此操作。',tool:'官方查询或试算未成功；未将其当作有效结果。',protocol:'官方返回与契约不匹配，未使用该结果。'}[e.kind]||'官方服务调用失败。'):'请求未完成，请重试。';
// 失败阶段与脱敏原因：只保留本项目自建的说明或通用分类，绝不透传上游原文。
const STAGE={detail:'查询餐品详情',price:'官方价格试算',coupon:'优惠价格试算'};
function failureReason(stage,e){
  let reason;
  if(e instanceof UserError)reason=e.message;
  else if(e instanceof McpError)reason=e.kind==='protocol'?e.message:'auth'===e.kind?'认证失效，无法完成官方试算。':'timeout'===e.kind?'官方服务超时。':'network'===e.kind?'官方服务暂不可达。':'官方工具未返回可用结果。';
  else reason='处理过程中出现异常。';
  return {stage:STAGE[stage]||STAGE.price,reason};
}
export function createApp({connect=connectMcp,credentialLoader=()=>loadCredential(process.env,undefined,ROOT),now=()=>Date.now()}={}) {
  let connection=null,pending=null,hasCredential=false,credentialSource=null,lastError=null,probe=null;const sessions=new Map();const audit=[];
  const event=(tool,status)=>{audit.push({tool,status,at:new Date(now()).toISOString()});if(audit.length>200)audit.shift();};
  /** 只探测「是否配置了凭据」和来源，绝不把 Token 本身带出这个闭包。 */
  function probeCredential(){
    if(!probe)probe=(async()=>{try{const c=await credentialLoader();hasCredential=!!c?.token;credentialSource=c?.token?(c.source||'本机配置'):null;return c||{token:null,source:null};}catch{hasCredential=false;credentialSource=null;return {token:null,source:null};}})();
    return probe;
  }
  const status=()=>({connected:!!connection,hasCredential,credentialSource,status:connection?'已连接':'未连接',message:connection?'官方 MCP 已连接；只查询和试算。':lastError||'未连接；请在本机配置 Token 后检查连接，或主动选择演示。'});
  async function ensure(){if(connection)return connection;if(!pending)pending=(async()=>{const c=await probeCredential();if(!c.token)throw new UserError('未配置麦当劳 Token，请在本机配置后重试。',409);connection=await connect(c.token);return connection;})().catch(e=>{lastError=safeError(e);throw e;}).finally(()=>{pending=null;});return pending;}
  async function call(name,args){try{const c=await ensure();const out=unwrap(await c.callTool(name,args));event(name,'success');return out;}catch(e){event(name,'failed');if(e.kind==='auth'){connection=null;lastError=safeError(e);}throw e;}}
  const handle=()=>randomBytes(18).toString('hex');
  function put(session,kind,value){const id=handle();session.records.set(id,{kind,value,expires:now()+5*60*1000});return id;}
  function get(session,id,kind){const r=session.records.get(id);if(!r||r.kind!==kind||r.expires<now())throw new UserError('数据已过期或不属于当前会话，请重新查询。',410);return r.value;}
  /** 取（并缓存）餐品详情；失败不缓存，避免把网络错误误判为不可试算。 */
  async function detailOf(menu,id){
    if(menu.details.has(id))return menu.details.get(id);
    const d=await call('query-meal-detail',{storeCode:menu.store.code,...SCENE,code:id});
    if(d&&typeof d.code==='string'&&d.code!==id)throw new McpError('protocol','官方餐品详情编码与菜单不一致，未使用该餐品。');
    menu.details.set(id,d);return d;
  }
  /** 排除需要套餐选配的餐品后重新推荐，最多重算 3 轮；不替用户擅自选配。 */
  async function recommendValid(menu,args){
    const keys=args.keys;
    let result=recommendPlans({...menu,people:args.people,budget:args.budget,exclude:[...menu.excluded],keys});
    for(let round=0;round<3;round++){
      const ids=[...new Set(result.plans.flatMap(p=>p.items.map(x=>x.id)))];
      const bad=[];
      for(const id of ids){
        if(menu.choiceRequired.has(id)){bad.push(id);continue;}
        try{const d=await detailOf(menu,id);if(detailRequiresChoice(d)){menu.choiceRequired.add(id);bad.push(id);}}
        catch(e){menu.detailErrors.set(id,failureReason('detail',e));}
      }
      if(!bad.length)break;
      for(const id of bad)menu.excluded.add(id);
      menu.notes=menu.notes.filter(n=>!n.startsWith('已排除'));
      menu.notes.push(`已排除 ${menu.excluded.size} 个需要套餐选配或组合的餐品，避免替用户擅自选配。`);
      result=recommendPlans({...menu,people:args.people,budget:args.budget,exclude:[...menu.excluded],keys});
    }
    return result;
  }
  /** 统一的方案生成：带上本会话的否决项，逐方案做官方价格核对，并为方案分配服务端句柄。 */
  async function buildPlans(session,menu,people,budget,diningMode,keys){
    const withRejects=people.map((p,i)=>({...p,rejects:[...(menu.rejects?.get(i)||[])]}));
    const result=menu.source==='demo'
      ? recommendPlans({...menu,people:withRejects,budget,keys})
      : await recommendValid(menu,{people:withRejects,budget,keys});
    result.store={name:menu.store.name};result.notes.push(...menu.notes);result.diningMode=diningMode;
    result.vetoes=people.map((p,i)=>({person:`匿名 ${'ABCD'[i]}`,rejected:[...(menu.rejects?.get(i)||[])].map(id=>menu.menu.find(x=>x.id===id)?.name).filter(Boolean)}));
    for(const plan of result.plans){
      plan.store={name:menu.store.name};
      plan.planHandle=put(session,'plan',{plan,menu,people,budget,diningMode,peopleCount:people.length});
      await verify(plan,menu);
    }
    return result;
  }
  async function verify(plan,menu){
    if(plan.source==='demo'){plan.priceStatus='演示估算 · 未验证价格';plan.priceFailure=null;return plan;}
    Object.assign(plan,{priceVerified:false,verifiedPrice:null,priceStatus:'未验证价格',priceFailure:null});
    try{
      // 再次确认所有推荐单品无需套餐选配；详情来自本次门店会话缓存。
      const prefailed=plan.items.map(x=>menu.detailErrors.get(x.id)).find(Boolean);
      if(prefailed){plan.priceStatus=`未验证价格 · ${prefailed.stage}未成功`;plan.priceFailure=prefailed;plan.unmet.push(`未能完成${prefailed.stage}（${prefailed.reason}）；不能保证预算内。`);return plan;}
      for(const x of plan.items){const d=await detailOf(menu,x.id);if(detailRequiresChoice(d))throw new McpError('protocol','该餐品需要套餐选配，未擅自补选，也未试算。');}
      const base=parsePrice(await call('calculate-price',priceArgs(menu.store,plan.items)),plan.items);
      let best={...base,offerTitle:'官方当前售价 / 自动适用优惠',offerCondition:'该门店、到店自取、当前餐品数量；未主动使用卡券'};
      const applicable=menu.coupons.filter(c=>c.products.length&&plan.items.some(x=>c.products.includes(x.id))).slice(0,3);
      let tested=0,failed=0;
      for(const coupon of applicable){try{const p=parsePrice(await call('calculate-price',priceArgs(menu.store,plan.items,coupon)),plan.items);tested++;if(p.verifiedPrice<best.verifiedPrice)best={...p,offerTitle:coupon.title,offerCondition:`${coupon.condition}；仅适用本方案关联餐品，以本次官方试算为准`};}catch{failed++;}}
      Object.assign(plan,best,{priceVerified:true,priceStatus:'官方实付试算 · 未下单',withinBudget:Math.round(best.verifiedPrice*100)<=Math.round(plan.budget*100),offers:[{title:best.offerTitle,condition:best.offerCondition,status:'本次官方试算采用的价格来源'}],couponCoverage:`单券试算 ${tested} 项，失败 ${failed} 项；最多覆盖 3 个匹配优惠，不承诺最低价`});
      if(!plan.withinBudget)plan.unmet.push('官方试算超出预算：请提高预算、调整口味或换门店。');
    }catch(e){
      const f=failureReason('price',e);plan.priceFailure=f;plan.priceStatus=`未验证价格 · ${f.stage}未成功`;
      plan.unmet.push(`未能完成${f.stage}（${f.reason}）；不能保证预算内。`);
    }
    return plan;
  }
  function publicMenu(m,id){return {menuHandle:id,source:m.source,store:{name:m.store.name},queriedAt:m.queriedAt,menuCount:m.menu.length,couponCount:m.coupons.length,notes:m.notes};}
  const server=http.createServer(async(req,res)=>{
    const send=(code,value,extra={})=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(JSON.stringify(value));};
    try{
      const host=req.headers.host||'';
      if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))throw new UserError('仅允许本机访问。',403);
      if(req.headers.origin&&req.headers.origin!==`http://${host}`)throw new UserError('禁止跨站请求。',403);
      if(req.headers['sec-fetch-site']==='cross-site')throw new UserError('禁止跨站请求。',403);
      const url=new URL(req.url,`http://${host}`);
      if(!url.pathname.startsWith('/api/')){
        const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/demo.html':'demo.html'};const file=files[url.pathname];if(req.method!=='GET'||!file)return send(404,{message:'未找到页面'});
        const content=await readFile(new URL(`./public/${file}`,import.meta.url));res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff'});return res.end(content);
      }
      for(const [id,s]of sessions)if(s.expires<now())sessions.delete(id);
      let sid=/\bmm_session=([a-f0-9]{36})/.exec(req.headers.cookie||'')?.[1];let session=sessions.get(sid);if(!session){if(sessions.size>=100)throw new UserError('本机会话过多，请稍后重试。',429);sid=handle();session={records:new Map(),expires:now()+3600000};sessions.set(sid,session);res.setHeader('Set-Cookie',`mm_session=${sid}; HttpOnly; SameSite=Strict; Path=/`);}session.expires=now()+3600000;
      for(const [id,r]of session.records)if(r.expires<now())session.records.delete(id);
      if(session.records.size>300)throw new UserError('会话数据过多，请刷新会话。',429);
      if(req.method==='GET'&&url.pathname==='/api/status'){await probeCredential();return send(200,status());}
      if(req.method==='GET'&&url.pathname==='/api/evidence')return send(200,{events:audit,policy:'仅工具名称、状态和时间；不保存参数或原始响应'});
      if(req.method!=='POST')throw new UserError('接口不存在。',404);
      if(!(req.headers['content-type']||'').startsWith('application/json'))throw new UserError('需要 JSON 请求。',415);
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>32000)throw new UserError('请求过大。',413);}let b;try{b=JSON.parse(raw);}catch{throw new UserError('请求 JSON 无效。');}if(!b||Array.isArray(b)||typeof b!=='object')throw new UserError('请求需为对象。');
      const strict=keys=>{if(Object.keys(b).some(k=>!keys.includes(k)))throw new UserError('请求含禁止或未声明字段。');};
      if(url.pathname==='/api/connect'){strict([]);connection=null;probe=null;await probeCredential();await ensure();return send(200,status());}
      if(url.pathname==='/api/query'){
        strict(['city','businessArea']);if(typeof b.city!=='string'||typeof b.businessArea!=='string'||!b.city.trim()||!b.businessArea.trim()||b.city.length>50||b.businessArea.length>100)throw new UserError('请填写城市和公开商圈。');
        const stores=parseStores(await call('query-nearby-stores',{beType:1,searchType:2,city:b.city.trim(),keyword:b.businessArea.trim()}));
        return send(200,{source:'real',stores:stores.map(s=>({storeHandle:put(session,'store',s),name:s.name,address:s.address,open:s.open,hours:s.hours})),queriedAt:new Date(now()).toISOString()});
      }
      if(url.pathname==='/api/demo'){
        strict([]);const menu={source:'demo',store:{code:demoStore.id,name:demoStore.name},menu:demoMenu,coupons:[],offers:demoOffers,queriedAt:new Date(now()).toISOString(),notes:['演示餐品、优惠和价格均为虚构；不会发起任何官方试算。'],details:new Map(),excluded:new Set(),choiceRequired:new Set(),detailErrors:new Map(),rejects:new Map()};const id=put(session,'menu',menu);return send(200,publicMenu(menu,id));
      }
      if(url.pathname==='/api/menu'){
        strict(['storeHandle']);const store=get(session,b.storeHandle,'store');if(!store.open)throw new UserError('门店当前暂停营业，请选择其他门店。');
        const args={storeCode:store.code,...SCENE};const data=await call('query-meals',args);const notes=[];let coupons=[];
        try{coupons=parseCoupons(await call('query-store-coupons',args));}catch{notes.push('优惠查询不可用：仅比较官方当前售价，不将任何优惠视为可用。');}
        const menu={source:'real',store,menu:parseMenu(data),coupons,offers:coupons.map((c,i)=>({id:`offer-${i}`,title:c.title,condition:c.condition})),queriedAt:new Date(now()).toISOString(),details:new Map(),excluded:new Set(),choiceRequired:new Set(),detailErrors:new Map(),rejects:new Map(),notes};
        const id=put(session,'menu',menu);return send(200,publicMenu(menu,id));
      }
      if(url.pathname==='/api/recommend'){
        strict(['menuHandle','people','budget','diningMode']);const menu=get(session,b.menuHandle,'menu');
        if(!['堂食','外带'].includes(b.diningMode))throw new UserError('请选择堂食或外带。');
        if(!Array.isArray(b.people)||!b.people.length||b.people.length>4||b.people.some(p=>!p||typeof p!=='object'||Object.keys(p).some(k=>!['wants','avoids'].includes(k))||['wants','avoids'].some(k=>typeof p[k]!=='string'||p[k].length>100)))throw new UserError('口味格式无效。');
        if(!Number.isFinite(Number(b.budget))||Number(b.budget)<=0||Number(b.budget)>10000)throw new UserError('总预算须大于 0 且不超过 10000 元。');
        let result;try{result=await buildPlans(session,menu,b.people,Number(b.budget),b.diningMode);}catch(e){throw e instanceof UserError?e:new UserError(e.message&&!e.kind?e.message:'推荐未完成，请重试。');}
        return send(200,result);
      }
      if(url.pathname==='/api/veto'){
        strict(['planHandle','personIndex','itemIndex']);const entry=get(session,b.planHandle,'plan');
        if(!Number.isInteger(b.personIndex)||!Number.isInteger(b.itemIndex))throw new UserError('参数无效。');
        const alloc=entry.plan.peopleAllocations?.[b.personIndex];const item=alloc?.items?.[b.itemIndex];
        if(!item)throw new UserError('该餐品不属于这个方案，请重新生成方案后再试。');
        if(!entry.menu.rejects)entry.menu.rejects=new Map();
        const set=entry.menu.rejects.get(b.personIndex)||new Set();
        if(set.has(item.id))throw new UserError('这项已经在排除列表里了。');
        set.add(item.id);entry.menu.rejects.set(b.personIndex,set);
        const result=await buildPlans(session,entry.menu,entry.people,entry.budget,entry.diningMode);
        result.veto={person:alloc.person,itemName:item.name};
        return send(200,result);
      }
      if(url.pathname==='/api/upgrade'){
        strict(['planHandle']);const entry=get(session,b.planHandle,'plan');
        if(entry.plan.source==='demo')throw new UserError('演示数据不做预算对比；请先查询真实门店。',409);
        if(entry.plan.upgrade)return send(200,entry.plan.upgrade);
        if(!entry.plan.priceVerified)throw new UserError('原方案还没有完成官方价格核对，不能给出精确的加价对比。',409);
        const extra=10;if(entry.budget+extra>10000)throw new UserError('预算已达上限，无法再增加 10 元。');
        const next=(await buildPlans(session,entry.menu,entry.people,entry.budget+extra,entry.diningMode,[entry.plan.key])).plans[0];
        if(!next){const r={comparable:false,reason:'提高预算后没有产生新的可用方案。'};entry.plan.upgrade=r;return send(200,r);}
        const payload={...compareUpgrade(entry.plan,next,extra),planHandle:next.planHandle,title:next.title,budget:entry.budget+extra,priceVerified:next.priceVerified,verifiedPrice:next.verifiedPrice,items:next.items.map(x=>({name:x.name,quantity:x.quantity}))};
        entry.plan.upgrade=payload;
        return send(200,payload);
      }
      if(url.pathname==='/api/price'){
        strict(['planHandle']);const entry=get(session,b.planHandle,'plan');await verify(entry.plan,entry.menu);return send(200,entry.plan);
      }
      if(url.pathname==='/api/export'){
        strict(['planHandle']);const entry=get(session,b.planHandle,'plan');return send(200,exportCard(entry.plan,entry.peopleCount,entry.diningMode));
      }
      throw new UserError('接口不存在。',404);
    }catch(e){send(e instanceof UserError?e.status:e.kind==='auth'?401:502,{message:safeError(e),priceStatus:'未验证价格'});}
  });
  server.requestTimeout=120000;probeCredential();return server;
}
export const server=createApp();
if(process.argv[1]===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT||4192);server.listen(port,'127.0.0.1',()=>console.log(`麦门会餐 http://127.0.0.1:${port}`));}
