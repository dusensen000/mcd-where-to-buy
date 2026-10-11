const MAX_STORES = 5;

export function yuan(fen) {
  if (!Number.isInteger(fen) || fen < 0) throw new Error('官方核价未返回有效的分单位金额。');
  return (fen / 100).toFixed(2);
}

export function cleanName(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s™®·・（）()\[\]【】]/g, '');
}

export function menuProducts(menu) {
  const products = menu?.data?.meals;
  if (!products || typeof products !== 'object' || Array.isArray(products)) throw new Error('官方菜单结构不符合预期。');
  const categories = new Map();
  const tags = new Map();
  for (const category of menu.data.categories || []) {
    for (const meal of category.meals || []) {
      const code = String(meal.code);
      if (!categories.has(code)) categories.set(code, new Set());
      categories.get(code).add(String(category.name).replace(/\s+/g, ' ').trim());
      if (!tags.has(code)) tags.set(code, new Set());
      for (const tag of meal.tags || []) tags.get(code).add(tag);
    }
  }
  return Object.entries(products).map(([code, item]) => ({ code, name: item.name,
    menuPriceYuan: item.currentPrice, categories: [...(categories.get(code) || [])], tags: [...(tags.get(code) || [])] }));
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

export function defaultSignature(detail) {
  const rounds = detail?.data?.rounds;
  if (!Array.isArray(rounds)) throw new Error('餐品详情缺少套餐结构。');
  return JSON.stringify(rounds.map(round => ({
    round: String(round.id),
    selected: (round.choices || []).filter(c => c.isDefault === 1 || c.quantity > 0)
      .map(c => [String(c.code), Number(c.quantity || 1)]).sort((a, b) => a[0].localeCompare(b[0]))
  })));
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

export function storeArgs(store, beType) {
  const args = { storeCode: String(store.storeCode), orderType: 1, beType };
  if (beType === 5) {
    if (!store.beCode) throw new Error('得来速门店缺少业务编码。');
    args.beCode = String(store.beCode);
  }
  return args;
}

export async function quote(client, store, beType, products) {
  const items = products.map(p => ({ productCode: p.code, quantity: p.quantity }));
  const response = await client.call('calculate-price', { ...storeArgs(store, beType), items });
  const data = response.data;
  if (!sameBasket(data, products)) throw new Error('核价结果中的餐品或数量与请求不一致。');
  yuan(data.price);
  return { fen: data.price, yuan: yuan(data.price) };
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
  const q = cleanName(input.mealQuery);
  if (!q) throw new Error('请提供 mealQuery。');
  const found = new Map();
  const errors = [];
  for (const store of stores) {
    try {
      const products = menuProducts(await client.call('query-meals', storeArgs(store, beType)));
      for (const product of products) {
        if (product.code !== input.mealQuery && !cleanName(product.name).includes(q)) continue;
        const key = `${product.code}:${cleanName(product.name)}`;
        if (!found.has(key)) found.set(key, { code: product.code, name: product.name, stores: [] });
        found.get(key).stores.push({ storeCode: String(store.storeCode), storeName: store.storeName });
      }
    } catch (error) { errors.push({ storeCode: String(store.storeCode), reason: error.message }); }
  }
  return {
    status: found.size ? 'ok' : errors.length === stores.length ? 'menu_unavailable' : 'no_match',
    candidates: [...found.values()].slice(0, 30), searchedStores: stores.length, errors
  };
}
