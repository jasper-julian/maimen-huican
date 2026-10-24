// 有界枚举：每人一份主食；忌口与本人否决是硬约束，预算以整数分计算。
// 输出可解释的逐人满足情况（计数 + 清单），不使用任何“满意度百分比”话术。
const cents = n => Math.round(n * 100);
const LABELS = ['A', 'B', 'C', 'D'];
export const STRATEGIES = ['taste', 'budget', 'balanced', 'fair'];
const TITLES = { taste: '优先满足口味', budget: '优先节省预算', balanced: '折中推荐', fair: '照顾最难满足的人' };
const DESCRIPTIONS = {
  taste: '先照顾想吃，再控制菜单估算预算。',
  budget: '先避开忌口与本人否决项，再选择较低菜单标价。',
  balanced: '平衡口味匹配和菜单标价，全桌最多补一份共享加餐。',
  fair: '先抬高满足比例最低那位的比例，再比较其他人，最后才看价格。',
};

export function normalizeMenu(menu) {
  return (Array.isArray(menu) ? menu : []).filter(x => x && typeof x.id === 'string' && typeof x.name === 'string' && Number.isFinite(x.price) && x.price >= 0)
    .map(x => ({ id: x.id, name: x.name, price: x.price, category: x.category || '', tags: Array.isArray(x.tags) ? x.tags : [], available: x.available !== false, stock: x.stock ?? null }));
}
export function normalizeOffers(offers) {
  return (Array.isArray(offers) ? offers : []).filter(x => x && x.available !== false)
    .map(x => ({ id: String(x.id), title: String(x.title || '优惠'), condition: String(x.condition || '条件待官方确认'), status: '仅查询到，未确认可用；以官方试算为准' }));
}
const terms = v => (Array.isArray(v) ? v : String(v || '').split(/[,，、\s]+/)).map(x => String(x).trim()).filter(Boolean);
const matches = (x, t) => `${x.name} ${x.tags.join(' ')}`.toLowerCase().includes(String(t).toLowerCase());
const score = (item, p) => p.wants.filter(t => matches(item, t)).length;

/** 某人在这组餐品上的可解释满足情况：满足/未满足清单 + 比例；无偏好者为中性（ratio=null）。 */
export function satisfactionOf(person, items) {
  const met = person.wants.filter(t => items.some(x => matches(x, t)));
  const missed = person.wants.filter(t => !met.includes(t));
  return { met, missed, ratio: person.wants.length ? met.length / person.wants.length : null };
}

export function recommendPlans({ menu = [], offers = [], availability = {}, people = [], budget, exclude = [], keys = STRATEGIES, source = 'demo', queriedAt = new Date().toISOString(), store = {} }) {
  if (!Array.isArray(people) || people.length < 1 || people.length > 4) throw new Error('人数须为 1—4 人');
  if (!Number.isFinite(Number(budget)) || Number(budget) <= 0 || Number(budget) > 10000) throw new Error('总预算须大于 0 且不超过 10000 元');
  const participants = people.map((p, i) => ({
    index: i, name: `匿名 ${LABELS[i]}`, wants: terms(p.wants), avoids: terms(p.avoids),
    rejects: new Set(Array.isArray(p.rejects) ? p.rejects.filter(x => typeof x === 'string') : []),
  }));
  const skip = new Set(exclude);
  const active = normalizeMenu(menu).filter(x => !skip.has(x.id)).filter(x => x.available && x.stock !== 0 && availability[x.id] !== 0 && availability[x.id] !== false);
  const mains = active.filter(x => x.category === '主食');
  const nameById = new Map(normalizeMenu(menu).map(x => [x.id, x.name]));
  const budgetCents = cents(Number(budget));
  const out = {
    source, queriedAt, store, budget: Number(budget), people: participants.map(p => ({ index: p.index, name: p.name, wants: p.wants.length, avoids: p.avoids.length, rejects: p.rejects.size })), plans: [], notes: [], adjustments: [], conflicts: [],
    coverage: '每人一份主食；每人最多 20 个主食候选，束搜索最多 600 个中间组合；比较仅覆盖当前候选，不是全局最优。',
  };
  if (!mains.length) {
    out.notes.push('当前无可售主食；不能用饮品或小食冒充一餐。');
    out.adjustments.push('换门店或稍后重试');
    return out;
  }

  // 硬约束：忌口 + 本人明确否决，任何策略都不能覆盖。
  const choices = participants.map(p => mains
    .filter(x => !p.rejects.has(x.id))
    .filter(x => !p.avoids.some(t => matches(x, t)))
    .sort((a, b) => score(b, p) - score(a, p) || a.price - b.price));
  const blocked = choices.findIndex(x => !x.length);
  if (blocked >= 0) {
    const p = participants[blocked];
    const rejectedNames = [...p.rejects].map(id => nameById.get(id)).filter(Boolean);
    const remaining = mains.filter(x => !p.rejects.has(x.id));
    const conflict = rejectedNames.length
      ? `${p.name} 已否决 ${rejectedNames.join('、')}；剩余 ${remaining.length} 个主食中，没有能满足「不想吃 ${p.avoids.join('、') || '（无）'}」的选择。不会自动放宽忌口或否决。`
      : `${p.name} 的「不想吃 ${p.avoids.join('、')}」排除了全部主食，不会推荐违反忌口的餐品。`;
    out.conflicts.push({ person: p.name, personIndex: blocked, rejected: rejectedNames, message: conflict });
    out.notes.push(conflict);
    out.adjustments.push('换门店、减少人数，或由本人确认是否调整忌口/否决项');
    return out;
  }

  const min = choices.reduce((s, c) => s + Math.min(...c.map(x => cents(x.price))), 0);
  if (min > budgetCents) {
    out.notes.push(`每人一份主食的最低菜单标价合计为 ¥${(min / 100).toFixed(2)}，高于预算；优惠可能改变实付，未验证前不承诺可行。`);
    out.adjustments.push(`把预算提高到至少 ¥${(min / 100).toFixed(2)}`, '减少人数、换门店或等待真实优惠试算');
    return out;
  }

  // 保留最高匹配与最低价候选，避免截断时丢掉便宜餐品。
  const pools = choices.map(c => [...new Map([...c.slice(0, 12), ...c.slice().sort((a, b) => a.price - b.price).slice(0, 8)].map(x => [x.id, x])).values()]);

  for (const key of keys) {
    const rank = s => {
      if (key === 'budget') return -s.cost + s.fit * 0.01;
      if (key === 'taste') return s.fit * 100000 - s.cost;
      if (key === 'balanced') return s.fit * 1500 - s.cost;
      // fair：先最大化“比例最低者”，再比较其他人，最后才是价格。
      const rs = s.assigned.map((x, i) => satisfactionOf(participants[i], [x]).ratio).filter(r => r !== null);
      const worst = rs.length ? Math.min(...rs) : 0;
      const sum = rs.reduce((a, b) => a + b, 0);
      const full = rs.filter(r => r === 1).length;
      return worst * 1e7 + sum * 1e5 + full * 1e3 - s.cost * 0.01;
    };
    let states = [{ assigned: [], cost: 0, fit: 0 }];
    pools.forEach((pool, i) => {
      states = states.flatMap(s => pool.filter(x => s.assigned.filter(a => a.id === x.id).length < (x.stock ?? Infinity))
        .map(x => ({ assigned: [...s.assigned, x], cost: s.cost + cents(x.price), fit: s.fit + score(x, participants[i]) })))
        .filter(s => s.cost <= budgetCents).sort((a, b) => rank(b) - rank(a)).slice(0, 600);
    });
    if (!states.length) { out.notes.push('库存或预算不足，无法给每个人分配一份主食。'); continue; }
    const best = states[0];
    const allocations = best.assigned.map((x, i) => ({ person: participants[i].name, personIndex: i, items: [{ ...x, quantity: 1 }] }));
    let total = best.cost;

    // 加餐：口味优先每人最多一份；折中全桌一份；反正义策略优先补给满足比例最低的人。
    let added = 0;
    const maxExtras = key === 'taste' ? participants.length : key === 'balanced' ? 1 : key === 'fair' ? participants.length : 0;
    if (maxExtras) {
      const order = key === 'fair'
        ? participants.map((p) => p.index).sort((a, b) => {
          const ra = satisfactionOf(participants[a], allocations[a].items).ratio;
          const rb = satisfactionOf(participants[b], allocations[b].items).ratio;
          return (ra === null ? 2 : ra) - (rb === null ? 2 : rb);
        })
        : participants.map(p => p.index);
      for (const i of order) {
        if (added >= maxExtras) break;
        const p = participants[i];
        const extras = active.filter(x => x.category !== '主食' && !p.rejects.has(x.id) && !p.avoids.some(t => matches(x, t)) && p.wants.some(t => matches(x, t)))
          .sort((a, b) => score(b, p) - score(a, p) || a.price - b.price);
        const extra = extras.find(x => total + cents(x.price) <= budgetCents && allocations.flatMap(a => a.items).filter(y => y.id === x.id).reduce((s, y) => s + y.quantity, 0) < (x.stock ?? Infinity));
        if (extra) { allocations[i].items.push({ ...extra, quantity: 1 }); total += cents(extra.price); added++; }
      }
    }

    const quantities = new Map();
    for (const a of allocations) for (const x of a.items) quantities.set(x.id, { ...x, quantity: (quantities.get(x.id)?.quantity || 0) + x.quantity });
    const satisfaction = allocations.map((a, i) => ({ ...satisfactionOf(participants[i], a.items), person: participants[i].name, personIndex: i, wants: participants[i].wants }));
    allocations.forEach((a, i) => { a.satisfaction = { met: satisfaction[i].met, missed: satisfaction[i].missed, ratio: satisfaction[i].ratio }; });
    const unmet = satisfaction.flatMap(s => s.missed.map(t => `${s.person}想吃「${t}」未满足（预算或菜单限制）`));

    out.plans.push({
      key, title: TITLES[key], description: DESCRIPTIONS[key],
      items: [...quantities.values()], peopleAllocations: allocations, satisfaction,
      budget: Number(budget), subtotalEstimate: total / 100,
      priceStatus: source === 'demo' ? '演示估算 · 未验证价格' : '菜单估算 · 未验证价格',
      priceVerified: false, verifiedPrice: null, offers: normalizeOffers(offers), unmet, source, queriedAt, store,
    });
  }
  if (new Set(out.plans.map(p => JSON.stringify(p.items))).size < out.plans.length) out.notes.push('在当前约束下，部分策略可能得到相同组合；不会为了展示差异强行加餐。');
  out.notes.push('忌口与「不接受」只依据返回的名称和标签匹配，不是配料或过敏原安全保证；严重过敏请向门店确认。');
  return out;
}

/** 比较两份已核对价格的方案，说明“多花多少换来什么”；任一未验证则不给出增量结论。 */
export function compareUpgrade(base, next, extraBudget) {
  if (!base?.priceVerified || !next?.priceVerified) {
    return { comparable: false, reason: '原方案或新预算方案未完成官方价格核对，不显示增量金额。' };
  }
  const delta = Math.round((next.verifiedPrice - base.verifiedPrice) * 100) / 100;
  const count = list => { const m = new Map(); for (const x of list) m.set(x.id, (m.get(x.id) || 0) + x.quantity); return m; };
  const a = count(base.items), b = count(next.items);
  const added = [], removed = [];
  for (const [id, q] of b) { const d = q - (a.get(id) || 0); if (d > 0) added.push({ name: next.items.find(x => x.id === id).name, quantity: d }); }
  for (const [id, q] of a) { const d = q - (b.get(id) || 0); if (d > 0) removed.push({ name: base.items.find(x => x.id === id).name, quantity: d }); }
  const beneficiaries = (next.satisfaction || []).map((s, i) => {
    const before = base.satisfaction?.[i];
    const gained = s.met.filter(t => !(before?.met || []).includes(t));
    return gained.length ? { person: s.person, gained } : null;
  }).filter(Boolean);
  const changed = added.length > 0 || removed.length > 0 || beneficiaries.length > 0;
  if (!changed) {
    return {
      comparable: true, changed: false, extraBudget, delta, added, removed, beneficiaries,
      note: base.key === 'budget'
        ? `这是以最低菜单标价为先的方案，多 ¥${extraBudget} 不会自动加餐；可看「优先满足口味」或「折中推荐」的加价对比。官方实付仍为 ¥${next.verifiedPrice.toFixed(2)}。`
        : `预算提高 ¥${extraBudget} 后，当前候选没有产生新的组合，官方实付仍为 ¥${next.verifiedPrice.toFixed(2)}。`,
    };
  }
  return {
    comparable: true, changed: true, extraBudget, delta, added, removed, beneficiaries,
    note: delta > 0
      ? `多花 ¥${delta.toFixed(2)} 换来上面的变化；仅为当前候选下的比较，不是全局最优。`
      : delta < 0
        ? `预算提高后官方实付反而低 ¥${Math.abs(delta).toFixed(2)}，这是优惠或组合变化的结果，不代表一定更便宜。`
        : '官方实付金额没变，但组合变了；按上面的变化判断是否值得换。',
  };
}

export function exportCard(plan, count, diningMode) {
  // 正向字段白名单；不导出口味原文、忌口原文、个人身份、Token、券码、原始响应或地址。
  return {
    product: '麦门会餐',
    source: plan.source === 'demo' ? '演示 · 虚构数据，非官方调用证据' : '麦当劳官方 MCP（查询与价格核对）',
    store: plan.store?.name || '未选择门店',
    peopleCount: count, diningMode,
    strategy: plan.title,
    items: plan.items.map(x => ({ name: x.name, quantity: x.quantity })),
    allocations: (plan.peopleAllocations || []).map(a => ({
      person: a.person,
      items: a.items.map(x => ({ name: x.name, quantity: x.quantity })),
      metCount: a.satisfaction?.met?.length ?? 0,
      wantCount: a.satisfaction?.wants?.length ?? 0,
    })),
    menuEstimate: plan.subtotalEstimate,
    priceStatus: plan.priceStatus,
    verifiedPrice: plan.priceVerified ? plan.verifiedPrice : null,
    offers: (plan.offers || []).map(x => ({ title: x.title, condition: x.condition, status: x.status })),
    queriedAt: plan.queriedAt,
    priceQueriedAt: plan.priceQueriedAt || null,
    disclaimer: '仅查询和试算；不代表锁价或下单，不承诺全局最低价。',
  };
}
