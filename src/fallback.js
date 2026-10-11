import { cleanName, defaultSignature, matchProduct, menuProducts, nearbyStores, quote, storeArgs, yuan } from './compare.js';

const GENERIC_CATEGORY = /人气|热卖|精选|推荐|上新|新品|麦金卡|超值|小食甜品|其他|周边|商品/;
const MAX_QUOTE_ATTEMPTS = 12;

function kind(product) {
  if (product.tags?.includes('套餐')) return 'combo';
  if (product.tags?.includes('单品')) return 'single';
  return 'unknown';
}

function defaultParts(detail) {
  return (detail.data.rounds || []).map(round => ({
    round: round.name,
    selected: (round.choices || []).filter(choice => choice.isDefault === 1 || choice.quantity > 0)
      .map(choice => ({ code: String(choice.code), name: choice.name, quantity: Number(choice.quantity || 1) }))
  }));
}

function categoryOverlap(source, candidate) {
  const specific = source.categories.filter(c => !GENERIC_CATEGORY.test(c));
  return specific.filter(c => candidate.categories.includes(c));
}

function nameSimilarity(a, b) {
  const x = cleanName(a);
  const y = cleanName(b);
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Set(Array.from({ length: x.length - 1 }, (_, i) => x.slice(i, i + 2)));
  return Array.from({ length: y.length - 1 }, (_, i) => y.slice(i, i + 2)).filter(g => grams.has(g)).length;
}

function candidateScore(source, candidate, common) {
  const sourcePrice = Number(source.menuPriceYuan);
  const candidatePrice = Number(candidate.menuPriceYuan);
  const gap = Number.isFinite(sourcePrice) && Number.isFinite(candidatePrice) ? Math.abs(sourcePrice - candidatePrice) : 100;
  return common.length * 100 + nameSimilarity(source.name, candidate.name) * 10 - gap;
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 4) throw new Error('items 必须包含 1 至 4 个餐品。');
  const result = items.map(item => ({
    query: String(item.query || '').trim(), quantity: Number(item.quantity ?? 1),
    allowAlternative: item.allowAlternative !== false,
    replacementQueries: Array.isArray(item.replacementQueries) ? item.replacementQueries.map(q => String(q).trim()).filter(Boolean) : []
  }));
  if (result.some(item => !item.query || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10)) {
    throw new Error('每件餐品须提供名称或编码，数量须为 1 至 10 的整数。');
  }
  if (items.some(item => item.replacementQueries !== undefined && !Array.isArray(item.replacementQueries))) {
    throw new Error('replacementQueries 须为餐品名称或编码组成的数组。');
  }
  if (result.some(item => item.replacementQueries.length > 5)) throw new Error('每件餐品最多指定 5 个备选。');
  return result;
}

function mergeBasket(items) {
  const merged = new Map();
  for (const item of items) {
    const previous = merged.get(item.code);
    merged.set(item.code, { code: item.code, name: item.name, quantity: item.quantity + (previous?.quantity || 0) });
  }
  if ([...merged.values()].some(item => item.quantity > 10)) throw new Error('合并后同款餐品的数量不能超过 10。');
  return [...merged.values()];
}

function combinations(groups, limit) {
  let plans = [{ choices: [], score: 0 }];
  for (const group of groups) {
    const next = [];
    for (const plan of plans) {
      for (const option of group) next.push({ choices: [...plan.choices, option], score: plan.score + option.score });
    }
    plans = next.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  return plans;
}

export async function planMealAlternatives(client, input) {
  const requested = normalizeItems(input.items);
  const maxPlans = Math.min(5, Math.max(1, Number(input.maxAlternativesPerStore ?? 3)));
  if (!Number.isInteger(maxPlans)) throw new Error('maxAlternativesPerStore 须为整数。');
  const budgetFen = input.maxTotalYuan == null ? null : Math.round(Number(input.maxTotalYuan) * 100);
  if (budgetFen !== null && (!Number.isSafeInteger(budgetFen) || budgetFen < 1)) throw new Error('maxTotalYuan 须大于 0。');

  const { stores, beType, foundCount } = await nearbyStores(client, input);
  if (!stores.length) return { status: 'no_stores', foundCount, results: [], message: '附近没有当前营业且支持所选取餐方式的门店。' };

  const records = [];
  for (const store of stores) {
    try {
      records.push({ store, products: menuProducts(await client.call('query-meals', storeArgs(store, beType))) });
    } catch (error) {
      records.push({ store, error: error.message });
    }
  }
  const allProducts = new Map();
  for (const record of records.filter(r => r.products)) {
    for (const product of record.products) {
      const key = `${product.code}:${cleanName(product.name)}`;
      if (!allProducts.has(key)) allProducts.set(key, product);
    }
  }
  if (!allProducts.size) return { status: 'menu_unavailable', foundCount, results: records.map(r => ({ storeCode: String(r.store.storeCode), status: 'menu_error', reason: r.error })) };

  const referenceProducts = [];
  const unresolved = [];
  for (const item of requested) {
    const match = matchProduct([...allProducts.values()], item.query);
    if (match.status !== 'found') unresolved.push({ query: item.query, status: match.status, choices: match.choices.map(p => ({ code: p.code, name: p.name })) });
    else referenceProducts.push({ ...match.product, quantity: item.quantity,
      allowAlternative: item.allowAlternative, replacementQueries: item.replacementQueries });
  }
  if (unresolved.length) return { status: 'needs_exact_product', unresolved, message: '请指定精确餐品名称或编码；不会猜测用户想买的餐品。' };
  mergeBasket(referenceProducts);

  const detailCache = new Map();
  async function detail(record, code) {
    const key = `${record.store.storeCode}:${code}`;
    if (!detailCache.has(key)) detailCache.set(key, client.call('query-meal-detail', { ...storeArgs(record.store, beType), code }));
    return detailCache.get(key);
  }
  for (const product of referenceProducts) {
    const source = records.find(r => r.products?.some(p => p.code === product.code && cleanName(p.name) === cleanName(product.name)));
    if (!source) return { status: 'reference_unverified', reason: `找不到 ${product.name} 的来源门店。` };
    try {
      const response = await detail(source, product.code);
      product.defaultSignature = defaultSignature(response);
      product.defaultParts = defaultParts(response);
      product.kind = response.data.rounds?.length ? 'combo' : 'single';
    } catch (error) {
      return { status: 'reference_unverified', reason: `${product.name} 的官方餐品详情无法验证：${error.message}` };
    }
  }

  const results = [];
  for (const record of records) {
    const { store, products } = record;
    const base = { storeCode: String(store.storeCode), storeName: store.storeName, address: store.address,
      distanceMeters: Number.isFinite(Number(store.distance)) ? Number(store.distance) : null };
    if (!products) { results.push({ ...base, status: 'menu_error', reason: record.error }); continue; }
    const byCode = new Map(products.map(p => [p.code, p]));
    const groups = [];
    const blockers = [];
    const uncertainties = [];
    const warnings = [];
    let changedCount = 0;
    for (const source of referenceProducts) {
      const offered = byCode.get(source.code);
      let exact = false;
      let offeredDetail;
      if (offered && cleanName(offered.name) === cleanName(source.name)) {
        try {
          offeredDetail = await detail(record, offered.code);
          exact = defaultSignature(offeredDetail) === source.defaultSignature;
        } catch {
          uncertainties.push(`${source.name} 列在当前菜单中，但餐品详情无法验证。`);
          continue;
        }
      }
      if (exact) {
        groups.push([{ product: { ...offered, quantity: source.quantity }, score: 1000, change: null }]);
        continue;
      }
      changedCount++;
      if (!source.allowAlternative) {
        blockers.push(`${source.name} 已设为不可替换，在此店未验证到原餐。`);
        continue;
      }
      const options = [];
      const candidateCodes = new Set();
      for (const query of source.replacementQueries) {
        const chosen = matchProduct(products, query);
        if (chosen.status !== 'found') {
          warnings.push(`用户指定的备选「${query}」未在此店当前菜单中唯一匹配。`);
          continue;
        }
        if (candidateCodes.has(chosen.product.code)) continue;
        candidateCodes.add(chosen.product.code);
        try {
          const response = await detail(record, chosen.product.code);
          options.push({ product: { ...chosen.product, quantity: source.quantity }, score: 800,
            change: { from: source.name, to: chosen.product.name, reason: '用户指定的备选餐品',
              candidateDefault: defaultParts(response) } });
        } catch { warnings.push(`用户指定的备选「${query}」详情无法核验。`); }
      }
      if (offeredDetail) {
        options.push({ product: { ...offered, quantity: source.quantity }, score: 500,
          change: { from: source.name, to: offered.name, reason: '默认套餐组成不同',
            originalDefault: source.defaultParts, candidateDefault: defaultParts(offeredDetail) } });
      }
      if (offered && cleanName(offered.name) !== cleanName(source.name)) {
        try {
          const response = await detail(record, offered.code);
          if ((response.data.rounds?.length ? 'combo' : 'single') === source.kind) {
            options.push({ product: { ...offered, quantity: source.quantity }, score: 550,
              change: { from: source.name, to: offered.name, reason: '官方餐品编码相同但名称不同，按备选方案处理',
                originalDefault: source.defaultParts, candidateDefault: defaultParts(response) } });
          }
        } catch { /* Unverified detail cannot be a candidate. */ }
      }
      const sameNameOtherCode = products.filter(p => p.code !== source.code && cleanName(p.name) === cleanName(source.name));
      for (const candidate of sameNameOtherCode) {
        try {
          const response = await detail(record, candidate.code);
          if ((response.data.rounds?.length ? 'combo' : 'single') !== source.kind) continue;
          options.push({ product: { ...candidate, quantity: source.quantity }, score: 600,
            change: { from: source.name, to: candidate.name, reason: '名称相同但官方餐品编码不同，按备选方案处理',
              originalDefault: source.defaultParts, candidateDefault: defaultParts(response) } });
        } catch { /* Unverified detail cannot be a candidate. */ }
      }
      const candidates = products.filter(p => p.code !== source.code && cleanName(p.name) !== cleanName(source.name))
        .map(p => ({ product: p, categories: categoryOverlap(source, p) }))
        .filter(x => x.categories.length && !candidateCodes.has(x.product.code) && (kind(x.product) === 'unknown' || kind(x.product) === source.kind))
        .sort((a, b) => candidateScore(source, b.product, b.categories) - candidateScore(source, a.product, a.categories))
        .slice(0, 8);
      for (const candidate of candidates) {
        try {
          const response = await detail(record, candidate.product.code);
          const candidateKind = response.data.rounds?.length ? 'combo' : 'single';
          if (candidateKind !== source.kind) continue;
          options.push({ product: { ...candidate.product, quantity: source.quantity },
            score: candidateScore(source, candidate.product, candidate.categories),
            change: { from: source.name, to: candidate.product.name, reason: `同属官方菜单分类：${candidate.categories.join('、')}` } });
        } catch { /* Do not propose products whose detail cannot be verified. */ }
        if (options.length >= 3) break;
      }
      if (!options.length) blockers.push(`${source.name} 当前菜单不可售，且未找到可核实的同类候选。`);
      else groups.push(options.sort((a, b) => b.score - a.score).slice(0, 3));
    }
    if (uncertainties.length) { results.push({ ...base, status: 'unverified', reasons: uncertainties, warnings }); continue; }
    if (blockers.length) { results.push({ ...base, status: 'unavailable', reasons: blockers, warnings }); continue; }

    const plans = [];
    let failedQuotes = 0;
    let successfulQuotes = 0;
    let cheapestOverBudgetFen = null;
    for (const plan of combinations(groups, MAX_QUOTE_ATTEMPTS)) {
      try {
        const basket = mergeBasket(plan.choices.map(x => x.product));
        const priced = await quote(client, store, beType, basket);
        successfulQuotes++;
        if (budgetFen !== null && priced.fen > budgetFen) {
          cheapestOverBudgetFen = Math.min(cheapestOverBudgetFen ?? Infinity, priced.fen);
          continue;
        }
        plans.push({ totalYuan: priced.yuan, items: basket.map(({ code, name, quantity }) => ({ code, name, quantity })),
          changes: plan.choices.flatMap(x => x.change ? [x.change] : []),
          basis: '官方 calculate-price 整单核价' });
      } catch { failedQuotes++; }
      if (plans.length >= maxPlans) break;
    }
    if (!plans.length) {
      results.push({ ...base, status: successfulQuotes ? 'over_budget' : failedQuotes ? 'unverified' : 'unavailable',
        reason: successfulQuotes ? '官方核价的候选方案均超过预算。' : '候选购物篮未通过官方整单核价。',
        warnings,
        ...(cheapestOverBudgetFen !== null ? { cheapestQuotedYuan: yuan(cheapestOverBudgetFen) } : {}) });
      continue;
    }
    results.push({ ...base, status: changedCount ? 'alternatives' : 'exact', plans, failedQuotes, warnings });
  }
  return {
    status: results.some(r => r.status === 'exact' || r.status === 'alternatives') ? 'ok' : 'no_verified_plan',
    sampledAt: new Date().toISOString(), mode: input.mode || 'pickup', foundCount,
    wanted: referenceProducts.map(({ code, name, quantity, allowAlternative }) => ({ code, name, quantity, allowAlternative })),
    results,
    notes: ['当前菜单不可售不等于门店实物缺货。', '替代餐仅为同菜单分类的候选，不保证口味、成分、营养或过敏原等同；需用户自行确认。',
      '仅展示经过官方餐品详情校验和 calculate-price 整单核价的方案。', '本工具只查询，不创建订单；价格和可售状态以实际下单页为准。']
  };
}
