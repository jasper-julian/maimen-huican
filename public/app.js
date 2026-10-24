const $=s=>document.querySelector(s);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n).toFixed(2);
const when=iso=>iso?new Date(iso).toLocaleString('zh-CN',{hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const LABELS=['A','B','C','D'];
const state={source:null,menuHandle:null,storeHandle:null,connected:false,hasCredential:false,cards:null,selectedPlan:null,busy:false};

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),3600)}
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>({message:'服务端返回无法解析'}));if(!r.ok)throw Object.assign(new Error(d.message||'请求失败'),{data:d,status:r.status});return d}

/* 忙碌锁：生成、否决重排、加价对比、导出期间统一禁用，避免重复请求官方接口 */
function setBusy(on,label){
  state.busy=on;
  const btn=$('#submitBtn');
  btn.disabled=on;btn.innerHTML=on?`${esc(label||'处理中…')} <span class="spin">◌</span>`:'生成四种方案 <span>→</span>';
  ['#queryStoreBtn','#demoBtn','#connectBtn','#exitDemoBtn'].forEach(s=>{const el=$(s);if(el)el.disabled=on;});
  document.querySelectorAll('#planGrid button').forEach(b=>{b.disabled=on;});
  document.body.classList.toggle('busy',on);
}

function peopleFields(){
  const n=Math.min(4,Math.max(1,Number($('#count').value)||1));
  const old=[...document.querySelectorAll('.person')].map(x=>({w:x.querySelector('.want')?.value||'',a:x.querySelector('.avoid')?.value||''}));
  $('#peopleFields').innerHTML=Array.from({length:n},(_,i)=>`<div class="person"><div class="person-number">${LABELS[i]}<small>匿名</small></div><label>想吃<input class="want" placeholder="例如：鸡肉、薯条" value="${esc(old[i]?.w||'')}"></label><label>不想吃<input class="avoid" placeholder="例如：辣、鱼" value="${esc(old[i]?.a||'')}"></label></div>`).join('');
  $('#receiptCount').textContent=n;
  $('#receiptBudget').textContent=`people / ¥ ${Number($('#budget').value)||0}`;
}
function formData(){return{city:$('#city').value.trim(),businessArea:$('#area').value.trim(),people:[...document.querySelectorAll('.person')].map(x=>({wants:x.querySelector('.want').value,avoids:x.querySelector('.avoid').value})),budget:Number($('#budget').value),diningMode:document.querySelector('[name=diningMode]:checked')?.value||'堂食'}}

/* 结果失效：只清空结果与选择；菜单句柄只在换门店/商圈/城市时作废，避免重复查询并保留本轮的“不接受”记录 */
function invalidate(reason){
  state.cards=null;state.selectedPlan=null;
  $('#results').classList.add('hidden');$('#planGrid').innerHTML='';$('#resultNotes').innerHTML='';
  $('#selectedHint').textContent='未选择方案';$('#exportSelected').disabled=true;
  if(reason)toast(reason);
}
function invalidateMenu(reason){
  invalidate(reason);state.menuHandle=null;
}
function setSource(source){
  state.source=source;
  const pill=$('#modePill'),hint=$('#modeHint'),receipt=$('#receiptMode');
  if(source==='demo'){
    pill.textContent='演示模式 · 数据虚构';pill.className='mode-pill demo';
    hint.textContent='当前方案使用虚构餐品与价格，不会发起任何官方查询或试算；导出卡会标注「演示」。';
    receipt.textContent='演示 · 虚构数据';$('#demoBtn').classList.add('hidden');$('#exitDemoBtn').classList.remove('hidden');
  }else if(source==='real'){
    pill.textContent='真实模式 · 官方查询';pill.className='mode-pill real';
    hint.textContent='门店、菜单与优惠来自官方接口；实付价格以官方核对结果为准。';
    receipt.textContent='真实 · 官方数据';$('#demoBtn').classList.remove('hidden');$('#exitDemoBtn').classList.add('hidden');
  }else{
    pill.textContent='未选择数据来源';pill.className='mode-pill';
    hint.textContent='真实模式需要先查询官方门店与菜单；演示数据必须由你主动加载。';
    receipt.textContent=state.connected?'真实模式待查询':'未连接官方服务';
    $('#demoBtn').classList.remove('hidden');$('#exitDemoBtn').classList.add('hidden');
  }
}

async function status(){
  try{
    const d=await api('/api/status');
    state.connected=d.connected;state.hasCredential=!!d.hasCredential;
    const p=$('#statusPill');p.classList.toggle('ok',d.connected);p.innerHTML=`<i></i>${esc(d.status)}`;
    const b=$('#connectionBanner');
    if(d.connected){
      b.className='notice notice-ok';$('#bannerTitle').textContent='麦当劳官方服务已连接';
      $('#bannerText').textContent='可以查询真实门店、菜单与优惠；只有官方价格核对成功后，才会标记「已验证价格」。';
    }else{
      b.className='notice notice-warn';$('#bannerTitle').textContent='麦当劳官方服务未连接';
      $('#bannerText').textContent=d.hasCredential?'已检测到本机配置，但尚未连通；可点击「重新检查连接」。':'尚未检测到本机配置；可打开「连接设置」查看本项目的配置方式，或主动加载演示数据。';
    }
    $('#cfgStatus').textContent=d.connected?'已连接':'未连接';
    $('#cfgSource').textContent=d.hasCredential?`已检测到凭据（${d.credentialSource||'本机配置'}）`:'未读取到凭据';
    if(!state.source)setSource(null);
  }catch{
    $('#statusPill').innerHTML='<i></i>本地服务未响应';$('#cfgStatus').textContent='本地服务未响应';
    toast('本地服务未启动，请运行 npm start');
  }
}

async function connect(){
  if(state.busy)return;
  setBusy(true,'检查连接…');
  try{const d=await api('/api/connect',{});toast(d.connected?'已连接官方服务，可以查询实时门店':'仍未连接：请先在「连接设置」中配置 Token')}
  catch(e){toast(e.message)}
  finally{setBusy(false);status()}
}

function renderStores(stores){
  $('#store').innerHTML='<option value="">请选择门店</option>'+stores.map((x,i)=>`<option value="${esc(x.storeHandle)}">${esc(x.name||'门店 '+(i+1))}${x.address?' · '+esc(x.address):''}${x.open?'':'（暂停营业）'}</option>`).join('');
}
async function queryStores(){
  const f=formData();
  if(!f.city||!f.businessArea)throw new Error('请先填写城市和商圈。');
  if(!state.connected)throw new Error('未连接官方服务。请打开「连接设置」配置 Token，或主动加载演示数据。');
  const q=await api('/api/query',{city:f.city,businessArea:f.businessArea});
  invalidateMenu();renderStores(q.stores);
  if(!q.stores.length)throw new Error('该商圈没有查到门店，请换一个公开商圈。');
  toast(`已找到 ${q.stores.length} 家门店，请选择一家`);
  return q.stores;
}

async function loadDemo(){
  if(state.busy)return;
  setBusy(true,'加载演示数据…');
  try{
    const q=await api('/api/demo',{});
    invalidateMenu();state.menuHandle=q.menuHandle;setSource('demo');
    $('#store').innerHTML='<option value="demo">示例商圈店 · 演示（虚构）</option>';
    toast('已加载演示数据：餐品与价格均为虚构，不会发起官方查询');
  }catch(e){toast(e.message)}
  finally{setBusy(false)}
}
function exitDemo(){invalidateMenu();setSource(null);$('#store').innerHTML='<option value="">先填写城市和商圈并查询</option>';toast('已退出演示模式；查询真实门店需要先连接官方服务')}

async function ensureMenu(){
  if(state.menuHandle)return state.menuHandle;
  if(state.source==='demo')throw new Error('演示数据未加载，请重新点击「加载演示数据」。');
  let handle=$('#store').value;
  if(!handle){
    const stores=await queryStores();
    const pick=stores.find(x=>x.open);
    if(!pick)throw new Error('该商圈门店均暂停营业，请换一个商圈。');
    $('#store').value=pick.storeHandle;handle=pick.storeHandle;
  }
  const menu=await api('/api/menu',{storeHandle:handle});
  state.menuHandle=menu.menuHandle;setSource('real');
  toast(`已查询 ${menu.menuCount} 个可用餐品、${menu.couponCount} 个门店优惠`);
  return menu.menuHandle;
}

async function makePlans(){
  if(state.busy)return;
  const f=formData();
  if(!f.people.length)return;
  if(!f.city||!f.businessArea)return toast('请先填写城市和商圈。');
  if(!Number.isFinite(f.budget)||f.budget<=0)return toast('请填写总预算（元）。');
  setBusy(true,'查询与试算中…');
  try{
    const menuHandle=await ensureMenu();
    const r=await api('/api/recommend',{menuHandle,people:f.people,budget:f.budget,diningMode:f.diningMode});
    state.cards=r;state.selectedPlan=null;renderResults(r,f);
  }catch(e){toast(e.message||'生成方案未完成')}  // 真实失败只报错，绝不自动换成演示数据
  finally{setBusy(false)}
}

function satisfactionLine(s){
  if(!s)return '';
  if(s.ratio===null)return '<span class="neutral">没有偏好，按中性处理</span>';
  const met=s.met.map(t=>`<em class="hit">✓ ${esc(t)}</em>`).join('');
  const miss=s.missed.map(t=>`<em class="miss">✗ ${esc(t)}</em>`).join('');
  return `${met}${miss}`;
}
function allocBlock(plan,pi){
  const a=plan.peopleAllocations[pi];
  const s=plan.satisfaction?.[pi];
  const ratio=s&&s.ratio!==null?`满足 ${s.met.length}/${plan.satisfaction[pi].wants.length}`:'无偏好';
  return `<div class="person-alloc">
    <div class="pa-head"><b>${esc(a.person)}</b><span class="pa-ratio">${esc(ratio)}</span></div>
    <div class="pa-wants">${satisfactionLine(s)}</div>
    <div class="pa-items">${a.items.map((it,ii)=>`<div class="pa-item"><span>${esc(it.name)} × ${it.quantity}</span><button class="veto" data-p="${pi}" data-i="${ii}" type="button">这份我不接受</button></div>`).join('')}</div>
  </div>`;
}

function planCard(p,i){
  const selected=state.selectedPlan===p.planHandle;
  const price=p.priceVerified?money(p.verifiedPrice):money(p.subtotalEstimate);
  const priceLabel=p.priceVerified?'官方实付（已核对商品与数量）':'菜单估算（未验证，不代表实付）';
  const offers=(p.offers||[]).length?`<div class="offer-box"><b>优惠依据</b>${p.offers.map(o=>`<p>${esc(o.title)}<small>${esc(o.condition)} · ${esc(o.status)}</small></p>`).join('')}${p.couponCoverage?`<small class="cov">${esc(p.couponCoverage)}</small>`:''}</div>`:'';
  const fail=p.priceFailure?`<div class="unmet"><b>${esc(p.priceFailure.stage)}未成功</b><br>${esc(p.priceFailure.reason)}</div>`:'';
  return `<article class="plan ${i===3?'featured':''} ${selected?'selected':''}" data-plan="${esc(p.planHandle||'')}">
    ${i===3?'<div class="plan-tag">最照顾吃亏的人</div>':''}
    <span class="step">0${i+1} / STRATEGY</span><h3>${esc(p.title)}</h3><p class="plan-desc">${esc(p.description)}</p>
    <div class="price">¥${price} <small>${esc(priceLabel)}</small></div>
    <div class="status ${p.priceVerified?'ok':'warn'}">${esc(p.priceStatus)}</div>
    <div class="alloc-box"><b>逐人分配与满足情况</b>${p.peopleAllocations.map((_,pi)=>allocBlock(p,pi)).join('')}</div>
    ${offers}${fail}
    ${p.unmet?.length?`<div class="unmet">${p.unmet.map(esc).join('<br>')}</div>`:''}
    <div class="time-row"><span>菜单查询：${when(p.queriedAt)}</span><span>价格核对：${when(p.priceQueriedAt)}</span></div>
    <div class="plan-actions">
      <button class="secondary select-one" type="button">${selected?'已选择这张':'选择这张'}</button>
      <button class="secondary upgrade-one" type="button">多 10 元能换来什么</button>
      <button class="secondary export-one" type="button">导出</button>
      <button class="secondary verify-one" type="button">${p.priceVerified?'重新核对价格':'核对官方价格'}</button>
    </div>
    <div class="upgrade-box" data-upgrade></div></article>`;
}

function renderResults(r,f){
  $('#results').classList.remove('hidden');
  const vetoText=(r.vetoes||[]).filter(v=>v.rejected.length).map(v=>`${v.person} 不接受：${v.rejected.join('、')}`).join('；');
  $('#resultMeta').textContent=`${f.people.length} 人 · ¥${f.budget} 总预算 · ${f.diningMode} · ${r.source==='demo'?'演示数据（虚构）':'官方实时查询'} · 门店：${r.store?.name||'—'}${vetoText?` · ${vetoText}`:''}`;
  const notes=[...(r.notes||[])];
  if(r.conflicts?.length)notes.unshift(...r.conflicts.map(c=>c.message));
  $('#resultNotes').innerHTML=notes.length?`<div class="notes">${notes.map(esc).join('<br>')}</div>`:'';
  $('#planGrid').innerHTML=(r.plans||[]).map(planCard).join('')||'<div class="empty-state"><b>当前条件下没有可接受方案</b><p>已保留每人的「不接受」记录，不会自动放宽硬度更大的忌口或否决项。可以换门店、提高预算，或与本人确认是否调整。</p></div>';
  $('#selectedHint').textContent='未选择方案';$('#exportSelected').disabled=true;
  bindPlanButtons();
  window.scrollTo({top:$('#results').offsetTop-20,behavior:'smooth'});
}
function bindPlanButtons(){
  document.querySelectorAll('.plan').forEach((card,i)=>{
    const plan=state.cards.plans[i];if(!plan)return;
    card.querySelector('.select-one')?.addEventListener('click',()=>{state.selectedPlan=plan.planHandle||null;markSelected();});
    card.querySelector('.export-one')?.addEventListener('click',()=>downloadCard(plan));
    card.querySelector('.verify-one')?.addEventListener('click',e=>verifyPrice(plan,e.currentTarget));
    card.querySelector('.upgrade-one')?.addEventListener('click',e=>compareUpgrade(plan,e.currentTarget,card.querySelector('[data-upgrade]')));
  });
  document.querySelectorAll('.veto').forEach(btn=>btn.addEventListener('click',()=>vetoItem(btn)));
}
function markSelected(){
  document.querySelectorAll('.plan').forEach((card,i)=>{
    const plan=state.cards.plans[i];const on=!!plan&&plan.planHandle===state.selectedPlan;
    card.classList.toggle('selected',on);
    const b=card.querySelector('.select-one');if(b)b.textContent=on?'已选择这张':'选择这张';
  });
  const idx=state.cards.plans.findIndex(p=>p.planHandle===state.selectedPlan);
  $('#selectedHint').textContent=idx>=0?`已选：${state.cards.plans[idx].title}`:'未选择方案';
  $('#exportSelected').disabled=idx<0;
}

async function vetoItem(btn){
  if(state.busy)return;
  const card=btn.closest('.plan');
  const plan=state.cards.plans[[...document.querySelectorAll('.plan')].indexOf(card)];
  const pi=Number(btn.dataset.p),ii=Number(btn.dataset.i);
  const person=plan?.peopleAllocations?.[pi]?.person||'该成员';
  setBusy(true,'重新协商中…');
  try{
    const r=await api('/api/veto',{planHandle:plan.planHandle,personIndex:pi,itemIndex:ii});
    state.cards=r;state.selectedPlan=null;renderResults(r,formData());
    toast(`${person} 已记录「不接受 ${r.veto?.itemName||''}」，方案已重新推荐并重新核对价格`);
  }catch(e){toast(e.message)}
  finally{setBusy(false)}
}

async function compareUpgrade(plan,btn,box){
  if(state.busy)return;
  if(!plan.planHandle)return toast('该方案没有服务端句柄，无法对比');
  setBusy(true,'对比中…');
  try{
    const r=await api('/api/upgrade',{planHandle:plan.planHandle});
    if(!r.comparable){
      box.className='upgrade-box show';
      box.innerHTML=`<b>多 10 元：暂不给出精确结论</b><p>${esc(r.reason)}</p>`;
      return;
    }
    const add=(r.added||[]).map(x=>`${esc(x.name)} × ${x.quantity}`).join('、')||'无新增餐品';
    const who=(r.beneficiaries||[]).map(b=>{
      const parts=[];
      if(b.gained?.length)parts.push(`多满足「${esc(b.gained.join('、'))}」`);
      if(b.added?.length)parts.push(`多拿到 ${b.added.map(x=>`${esc(x.name)} × ${x.quantity}`).join('、')}`);
      return `${esc(b.person)} ${parts.join('，')}`;
    }).join('；')||'没有人多拿到餐品';
    box.className='upgrade-box show';
    box.innerHTML=r.changed===false
      ? `<b>多 10 元：方案没有变化</b><p>${esc(r.note)}</p>`
      : `<b>多花 ¥${money(r.delta)}：${esc(add)}</b><p>${esc(who)}</p><p class="up-time">新预算方案官方实付 ¥${money(r.verifiedPrice)} · ${esc(r.note||'')}</p>`;
  }catch(e){toast(e.message)}
  finally{setBusy(false)}
}

async function verifyPrice(plan,btn){
  if(state.busy)return;
  if(!plan.planHandle)return toast('该方案没有服务端句柄，无法核对价格');
  setBusy(true,'核对官方价格…');btn.textContent='核对中…';
  try{
    const p=await api('/api/price',{planHandle:plan.planHandle});
    state.cards.plans=state.cards.plans.map(x=>x.planHandle===p.planHandle?p:x);
    renderResults(state.cards,formData());
    toast(p.priceVerified?'官方价格核对成功':'官方价格仍未验证：'+(p.priceFailure?.reason||'请稍后重试'));
  }catch(e){toast(e.message+'；仍标记为未验证价格')}
  finally{setBusy(false)}
}

async function downloadCard(plan){
  if(!plan.planHandle)return toast('该方案没有服务端句柄，无法导出');
  if(state.busy)return;
  setBusy(true,'导出中…');
  try{
    const card=await api('/api/export',{planHandle:plan.planHandle});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([JSON.stringify(card,null,2)],{type:'application/json'}));
    a.download=`麦门会餐-${plan.title}-脱敏方案卡.json`;a.click();URL.revokeObjectURL(a.href);
    toast('已在本机导出所选方案的脱敏方案卡，未发送给他人');
  }catch(e){toast(e.message)}
  finally{setBusy(false)}
}

$('#count').onchange=()=>{peopleFields();invalidate('人数已变化，请重新生成方案')};
$('#budget').oninput=()=>$('#receiptBudget').textContent=`people / ¥ ${Number($('#budget').value)||0}`;
$('#budget').onchange=()=>invalidate();
$('#resetPeople').onclick=()=>{peopleFields();invalidate('已重置口味，请重新生成方案')};
$('#city').oninput=()=>{if(state.source!=='demo'){invalidateMenu();$('#store').innerHTML='<option value="">先填写城市和商圈并查询</option>';setSource(null);}};
$('#area').oninput=()=>{if(state.source!=='demo'){invalidateMenu();$('#store').innerHTML='<option value="">先填写城市和商圈并查询</option>';setSource(null);}};
$('#store').onchange=()=>{if(state.source!=='demo'){invalidateMenu('已切换门店，请重新生成方案');}};
$('#connectBtn').onclick=connect;
$('#cfgCheck').onclick=connect;
$('#configBtn').onclick=()=>$('#configDialog').showModal();
$('#configClose').onclick=()=>$('#configDialog').close();
$('#demoBtn').onclick=loadDemo;
$('#exitDemoBtn').onclick=exitDemo;
$('#queryStoreBtn').onclick=async()=>{if(state.busy)return;setBusy(true,'查询门店…');try{await queryStores()}catch(e){toast(e.message)}finally{setBusy(false)}};
$('#mealForm').onsubmit=e=>{e.preventDefault();makePlans()};
$('#exportSelected').onclick=()=>{
  const plan=state.cards?.plans?.find(p=>p.planHandle===state.selectedPlan);
  if(!plan)return toast('请先选择要导出的方案');
  downloadCard(plan);
};
peopleFields();setSource(null);status();
