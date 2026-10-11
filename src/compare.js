const MAX_STORES = 5;
const MAX_ITEMS = 4;
const MAX_COUPON_PROBES = 8;

export function yuan(fen) {
  if (!Number.isInteger(fen) || fen < 0) throw new Error('官方核价未返回有效的分单位金额。');
  return (fen / 100).toFixed(2);
}

function cleanName(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s™®·・（）()\[\]【】]/g, '');
}

export function menuProducts(menu) {
  const products = menu?.data?.meals;
  if (!products || typeof products !== 'object' || Array.isArray(products)) throw new Error('官方菜单结构不符合预期。');
  return Object.entries(products).map(([code, item]) => ({ code, name: item.name, menuPriceYuan: item.currentPrice }));
}

export function matchProduct(products, query) {
  const q = String(query || '').trim();
  if (!q) return { status: 'missing', choices: [] };
  const normalized = cleanName(q);
  const exactCode = products.filter(p => p.code === q);
  const exactName = products.filter(p => cleanName(p.name) === normalized);
  const matches = exactCode.length ? exactCode : exactName.length ? exactName : products.filter(p => cleanName(p.name).includes(normalized));
  if (matches.length === 1) return { status: 'found', product: matches[0] };
  return { status: matches.length ? 'ambiguous' : 'missing', choices: matches.slice(0, 20) };
}

function defaultSignature(detail) {
  const rounds = detail?.data?.rounds;
  if (!Array.isArray(rounds)) throw new Error('餐品详情缺少套餐结构。');
  return JSON.stringify(rounds.map(round => ({
    round: String(round.id),
    selected: (round.choices || []).filter(c => c.isDefault === 1 || c.quantity > 0)
      .map(c => [String(c.code), Number(c.quantity || 1)]).sort((a, b) => a[0].localeCompare(b[0]))
  })));
}

function priceItems(products) {
  return products.map(p => ({ productCode: p.code, quantity: p.quantity }));
}

function sameBasket(priceData, products) {
  const list = priceData?.productList;
  if (!Array.isArray(list)) return false;
  const expected = new Map(products.map(p => [p.code, p.quantity]));
  for (const row of list) {
    const code = String(row.productCode);
    if (!expected.has(code) || Number(row.quantity) !== expected.get(code)) return false;
    expected.delete(code);
  }
  return expected.size === 0;
}

function storeArgs(store, beType) {
  const args = { storeCode: String(store.storeCode), orderType: 1, beType };
  if (beType === 5) {
    if (!store.beCode) throw new Error('得来速门店缺少业务编码。');
    args.beCode = String(store.beCode);
  }
  return args;
}

async function quote(client, store, beType, products, coupon) {
  const items = priceItems(products);
  if (coupon) items[coupon.itemIndex] = { ...items[coupon.itemIndex], couponId: coupon.id, couponCode: coupon.code };
  const response = await client.call('calculate-price', { ...storeArgs(store, beType), items });
  const data = response.data;
  if (!sameBasket(data, products)) throw new Error('核价结果中的餐品或数量与请求不一致。');
  yuan(data.price);
  return { fen: data.price, yuan: yuan(data.price), discountFen: Number(data.discount || 0) };
}

async function couponQuote(client, store, beType, products, baseline) {
  const response = await client.call('query-store-coupons', storeArgs(store, beType));
  const coupons = Array.isArray(response.data) ? response.data : [];
  let best = null;
  let probes = 0;
  for (const coupon of coupons) {
    const id = coupon.id || coupon.couponId;
    const code = coupon.code || coupon.couponCode;
    if (!id || !code) continue;
    for (let itemIndex = 0; itemIndex < products.length; itemIndex++) {
      if (probes++ >= MAX_COUPON_PROBES) return { best, probes: MAX_COUPON_PROBES, truncated: true };
      try {
        const priced = await quote(client, store, beType, products, { id, code, itemIndex });
        if (priced.fen < baseline.fen && (!best || priced.fen < best.fen)) {
          best = { ...priced, title: String(coupon.title || '可用优惠券') };
        }
      } catch { /* A coupon may not apply to this exact basket; keep the verified baseline. */ }
    }
  }
  return { best, probes, truncated: false };
}

export async function nearbyStores(client, { city, keyword, mode = 'pickup', maxStores = MAX_STORES }) {
  if (!city?.trim() || !keyword?.trim()) throw new Error('请提供城市和地点关键词。');
  const beType = mode === 'drive_through' ? 5 : mode === 'pickup' ? 1 : null;
  if (!beType) throw new Error('mode 只能是 pickup 或 drive_through。');
  const response = await client.call('query-nearby-stores', { city: city.trim(), keyword: keyword.trim(), searchType: 2, beType });
  const all = Array.isArray(response.data) ? response.data : [];
  const limit = Math.min(MAX_STORES, Math.max(1, Number(maxStores) || MAX_STORES));
  const stores = all.filter(s => s.businessStatus === true && s.storeCode && (beType !== 5 || s.beCode))
    .sort((a, b) => Number(a.distance ?? Infinity) - Number(b.distance ?? Infinity)).slice(0, limit);
  return { beType, stores, foundCount: all.length, excludedCount: all.length - stores.length };
}

export async function searchMeals(client, input) {
  const { stores, beType } = await nearbyStores(client, input);
  if (!stores.length) return { status: 'no_stores', candidates: [] };
  const store = stores[0];
  const products = menuProducts(await client.call('query-meals', storeArgs(store, beType)));
  const q = cleanName(input.mealQuery);
  if (!q) throw new Error('请提供 mealQuery。');
  return {
    status: 'ok', store: { storeCode: store.storeCode, storeName: store.storeName, address: store.address },
    candidates: products.filter(p => p.code === input.mealQuery || cleanName(p.name).includes(q)).slice(0, 30)
  };
}

export async function compareSameMeal(client, input) {
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > MAX_ITEMS) {
    throw new Error(`items 必须包含 1 至 ${MAX_ITEMS} 个餐品。`);
  }
  const requested = input.items.map(item => ({ query: String(item.query || '').trim(), quantity: Number(item.quantity || 1) }));
  if (requested.some(i => !i.query || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 10)) {
    throw new Error('每个餐品都要有名称或编码，数量须为 1 至 10 的整数。');
  }
  const { stores, beType, foundCount } = await nearbyStores(client, input);
  if (!stores.length) return { status: 'no_stores', message: '未找到当前营业且可用的门店。', foundCount };
  const source = stores[0];
  const sourceMenu = menuProducts(await client.call('query-meals', storeArgs(source, beType)));
  const selected = [];
  const unresolved = [];
  for (const item of requested) {
    const match = matchProduct(sourceMenu, item.query);
    if (match.status !== 'found') unresolved.push({ query: item.query, status: match.status, choices: match.choices });
    else selected.push({ ...match.product, quantity: item.quantity });
  }
  if (unresolved.length) return {
    status: 'needs_exact_product', sourceStore: { storeCode: source.storeCode, storeName: source.storeName }, unresolved,
    message: '请用候选餐品的精确名称或编码重新查询，避免比较不同餐品。'
  };
  const merged = new Map();
  for (const p of selected) merged.set(p.code, { ...p, quantity: (merged.get(p.code)?.quantity || 0) + p.quantity });
  const basket = [...merged.values()];
  if (basket.some(p => p.quantity > 10)) throw new Error('同款餐品合并后数量不得超过 10。');

  const sourceSignatures = new Map();
  for (const p of basket) {
    const detail = await client.call('query-meal-detail', { ...storeArgs(source, beType), code: p.code });
    sourceSignatures.set(p.code, defaultSignature(detail));
  }

  const results = [];
  for (const store of stores) {
    const row = {
      storeCode: String(store.storeCode), storeName: store.storeName, address: store.address,
      distanceMeters: Number.isFinite(Number(store.distance)) ? Number(store.distance) : null
    };
    try {
      const products = menuProducts(await client.call('query-meals', storeArgs(store, beType)));
      const byCode = new Map(products.map(p => [p.code, p]));
      const missing = basket.filter(p => !byCode.has(p.code) || cleanName(byCode.get(p.code).name) !== cleanName(p.name));
      if (missing.length) {
        results.push({ ...row, status: 'unavailable', reason: `未售卖同款餐品：${missing.map(p => p.name).join('、')}` });
        continue;
      }
      for (const p of basket) {
        const detail = await client.call('query-meal-detail', { ...storeArgs(store, beType), code: p.code });
        if (defaultSignature(detail) !== sourceSignatures.get(p.code)) throw new Error(`${p.name} 的默认套餐组合与来源门店不同。`);
      }
      const baseline = await quote(client, store, beType, basket);
      let final = baseline;
      let coupon = null;
      let couponCheck = input.includeCoupons ? 'checked' : 'not_requested';
      if (input.includeCoupons) {
        try {
          const checked = await couponQuote(client, store, beType, basket, baseline);
          if (checked.best) {
            final = checked.best;
            coupon = checked.best.title;
          }
          if (checked.truncated) couponCheck = 'partial';
        } catch { couponCheck = 'unavailable'; }
      }
      results.push({ ...row, status: 'quoted', basePriceYuan: baseline.yuan, finalPriceYuan: final.yuan,
        discountYuan: yuan(baseline.fen - final.fen), coupon, couponCheck, priceFen: final.fen });
    } catch (error) {
      results.push({ ...row, status: 'unverified', reason: error.message });
    }
  }
  const quoted = results.filter(r => r.status === 'quoted');
  const byPrice = [...quoted].sort((a, b) => a.priceFen - b.priceFen || (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
  const byDistance = [...quoted].sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
  return {
    status: quoted.length ? 'ok' : 'no_verified_quote', sampledAt: new Date().toISOString(), mode: input.mode || 'pickup',
    query: { city: input.city, keyword: input.keyword, items: basket.map(({ code, name, quantity }) => ({ code, name, quantity })) },
    comparedStores: results.length, foundCount, cheapestStoreCode: byPrice[0]?.storeCode || null,
    nearestVerifiedStoreCode: byDistance[0]?.storeCode || null,
    results: results.map(({ priceFen, ...rest }) => rest),
    notes: ['价格来自官方 calculate-price，单位已由分换算为元。', '距离来自官方门店查询；未计算步行时间或排队时间。', '仅比较菜单编码、名称及默认套餐组成一致的餐品。', '本工具只查询，不创建订单；最终价格和可售状态以实际下单页为准。']
  };
}
