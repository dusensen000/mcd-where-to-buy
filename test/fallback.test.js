import test from 'node:test';
import assert from 'node:assert/strict';
import { planMealAlternatives } from '../src/fallback.js';

const stores = [
  { storeCode: '101', storeName: '近店', address: '甲', distance: 100, businessStatus: true },
  { storeCode: '102', storeName: '远店', address: '乙', distance: 200, businessStatus: true }
];

function menu(meals, categories) { return { data: { meals, categories } }; }
const menus = {
  '101': menu({ '1100': { name: '巨无霸', currentPrice: '25.5' }, '4810': { name: '薯条', currentPrice: '13.5' } }, [
    { name: '巨无霸牛鱼肉堡', meals: [{ code: '1100', tags: ['单品'] }] },
    { name: '小食甜品/其他', meals: [{ code: '4810', tags: ['单品'] }] }
  ]),
  '102': menu({ '1100': { name: '巨无霸', currentPrice: '26' }, '4437': { name: '玉米杯', currentPrice: '13' } }, [
    { name: '巨无霸牛鱼肉堡', meals: [{ code: '1100', tags: ['单品'] }] },
    { name: '小食甜品/其他', meals: [{ code: '4437', tags: ['单品'] }] }
  ])
};

function fakeClient({ customMenus = menus, quoteFailure = false, customDetails = {} } = {}) {
  const calls = [];
  return { calls, async call(name, args) {
    calls.push([name, args]);
    if (name === 'query-nearby-stores') return { data: stores };
    if (name === 'query-meals') return customMenus[args.storeCode];
    if (name === 'query-meal-detail') return customDetails[`${args.storeCode}:${args.code}`] || { data: { rounds: [] } };
    if (name === 'calculate-price') {
      if (quoteFailure && args.storeCode === '102') throw new Error('核价失败');
      const prices = args.storeCode === '101' ? { '1100': 2550, '4810': 1350 } : { '1100': 2600, '4437': 1300 };
      return { data: { price: args.items.reduce((sum, item) => sum + prices[item.productCode] * item.quantity, 0),
        productList: args.items.map(item => ({ productCode: item.productCode, quantity: item.quantity })) } };
    }
    throw new Error(`Unexpected ${name}`);
  } };
}

const input = { city: '上海', keyword: '人民广场', items: [
  { query: '巨无霸', quantity: 1 },
  { query: '薯条', quantity: 1, replacementQueries: ['玉米杯'] }
] };

test('原餐与菜单不可售后的替代餐分别整单核价', async () => {
  const client = fakeClient();
  const result = await planMealAlternatives(client, input);
  assert.equal(result.status, 'ok');
  assert.equal(result.results[0].status, 'exact');
  assert.equal(result.results[0].plans[0].totalYuan, '39.00');
  assert.equal(result.results[1].status, 'alternatives');
  assert.equal(result.results[1].plans[0].totalYuan, '39.00');
  assert.deepEqual(result.results[1].plans[0].changes.map(c => [c.from, c.to]), [['薯条', '玉米杯']]);
  assert.equal(client.calls.filter(([name]) => name === 'calculate-price').length, 2);
});

test('用户锁定餐品后不推荐替换', async () => {
  const client = fakeClient();
  const result = await planMealAlternatives(client, { ...input, items: [{ query: '薯条', allowAlternative: false }] });
  assert.equal(result.results[1].status, 'unavailable');
  assert.equal(client.calls.filter(([name, args]) => name === 'calculate-price' && args.storeCode === '102').length, 0);
});

test('宽泛的小食甜品/其他分类不自动推荐其他商品', async () => {
  const result = await planMealAlternatives(fakeClient(), { ...input, items: [
    { query: '巨无霸' }, { query: '薯条' }
  ] });
  assert.equal(result.results[1].status, 'unavailable');
});

test('用户指定的备选未在该店菜单唯一匹配时说明原因', async () => {
  const result = await planMealAlternatives(fakeClient(), { ...input, items: [
    { query: '薯条', replacementQueries: ['不存在的商品'] }
  ] });
  assert.equal(result.results[1].status, 'unavailable');
  assert.match(result.results[1].warnings[0], /未在此店当前菜单中唯一匹配/);
});

test('预算过滤以官方整单核价为准', async () => {
  const result = await planMealAlternatives(fakeClient(), { ...input, maxTotalYuan: 38 });
  assert.equal(result.status, 'no_verified_plan');
  assert.ok(result.results.every(r => r.status === 'over_budget'));
});

test('核价失败的候选不能展示为可购买方案', async () => {
  const result = await planMealAlternatives(fakeClient({ quoteFailure: true }), input);
  assert.equal(result.results[1].status, 'unverified');
  assert.equal(result.results[1].plans, undefined);
});

test('名称有歧义时要求用户选定商品', async () => {
  const result = await planMealAlternatives(fakeClient(), { ...input, items: [{ query: '巨' }] });
  assert.equal(result.status, 'ok');
  const result2 = await planMealAlternatives(fakeClient(), { ...input, items: [{ query: '不存在' }] });
  assert.equal(result2.status, 'needs_exact_product');
});

test('无营业门店时返回明确状态', async () => {
  const client = { async call() { return { data: [] }; } };
  const result = await planMealAlternatives(client, input);
  assert.equal(result.status, 'no_stores');
});

test('原餐列在菜单但详情失败时不声称缺席，也不推荐替代', async () => {
  const base = fakeClient();
  const client = { async call(name, args) {
    if (name === 'query-meal-detail' && args.storeCode === '102' && args.code === '1100') throw new Error('详情暂不可用');
    return base.call(name, args);
  } };
  const result = await planMealAlternatives(client, input);
  assert.equal(result.results[1].status, 'unverified');
  assert.match(result.results[1].reasons[0], /详情无法验证/);
});

test('名称相同而编码不同的餐品只能作为明确标记的备选', async () => {
  const changedMenus = structuredClone(menus);
  changedMenus['102'].data.meals['9999'] = { name: '薯条', currentPrice: '13' };
  changedMenus['102'].data.categories[1].meals.push({ code: '9999', tags: ['单品'] });
  const client = fakeClient({ customMenus: changedMenus });
  const originalCall = client.call.bind(client);
  client.call = async (name, args) => {
    if (name === 'calculate-price' && args.storeCode === '102') return { data: { price: 3900,
      productList: args.items.map(item => ({ productCode: item.productCode, quantity: item.quantity })) } };
    return originalCall(name, args);
  };
  const result = await planMealAlternatives(client, { ...input, items: [{ query: '1100' }, { query: '4810' }] });
  const otherStore = result.results[1];
  assert.equal(otherStore.status, 'alternatives');
  assert.equal(otherStore.plans[0].changes[0].reason, '名称相同但官方餐品编码不同，按备选方案处理');
});

test('官方核价返回不同购物篮时拒绝展示方案', async () => {
  const base = fakeClient();
  const client = { async call(name, args) {
    if (name === 'calculate-price' && args.storeCode === '102') return { data: { price: 1,
      productList: [{ productCode: 'not-requested', quantity: 1 }] } };
    return base.call(name, args);
  } };
  const result = await planMealAlternatives(client, input);
  assert.equal(result.results[1].status, 'unverified');
  assert.equal(result.results[1].plans, undefined);
});

test('套餐编码相同但默认组成改变时不能标为原餐', async () => {
  const comboMenus = {
    '101': menu({ '990': { name: '汉堡套餐', currentPrice: '30' } }, [
      { name: '单人套餐', meals: [{ code: '990', tags: ['套餐'] }] }
    ]),
    '102': menu({ '990': { name: '汉堡套餐', currentPrice: '30' } }, [
      { name: '单人套餐', meals: [{ code: '990', tags: ['套餐'] }] }
    ])
  };
  const details = {
    '101:990': { data: { rounds: [{ id: 1, name: '饮料', choices: [{ code: '可乐', name: '可乐', isDefault: 1, quantity: 1 }] }] } },
    '102:990': { data: { rounds: [{ id: 1, name: '饮料', choices: [{ code: '雪碧', name: '雪碧', isDefault: 1, quantity: 1 }] }] } }
  };
  const base = fakeClient({ customMenus: comboMenus, customDetails: details });
  const client = { async call(name, args) {
    if (name === 'calculate-price') return { data: { price: 3000, productList: [{ productCode: '990', quantity: 1 }] } };
    return base.call(name, args);
  } };
  const result = await planMealAlternatives(client, { ...input, items: [{ query: '990' }] });
  assert.equal(result.results[0].status, 'exact');
  assert.equal(result.results[1].status, 'alternatives');
  assert.equal(result.results[1].plans[0].changes[0].reason, '默认套餐组成不同');
  assert.equal(result.results[1].plans[0].changes[0].candidateDefault[0].selected[0].name, '雪碧');
});

test('一家门店菜单失败不阻断其他门店', async () => {
  const base = fakeClient();
  const client = { async call(name, args) {
    if (name === 'query-meals' && args.storeCode === '102') throw new Error('菜单暂不可用');
    return base.call(name, args);
  } };
  const result = await planMealAlternatives(client, { ...input, items: [{ query: '巨无霸' }] });
  assert.equal(result.results[0].status, 'exact');
  assert.equal(result.results[1].status, 'menu_error');
});

test('来源餐品在所有门店菜单中都不存在时不臆造替代品', async () => {
  const result = await planMealAlternatives(fakeClient(), { ...input, items: [{ query: '已下架餐品' }] });
  assert.equal(result.status, 'needs_exact_product');
  assert.deepEqual(result.unresolved[0].choices, []);
});

test('编码相同但名称变化时只能作为明确标记的备选', async () => {
  const changedMenus = structuredClone(menus);
  changedMenus['102'].data.meals['1100'].name = '巨无霸新版';
  const client = fakeClient({ customMenus: changedMenus });
  const result = await planMealAlternatives(client, { ...input, items: [{ query: '巨无霸' }] });
  assert.equal(result.results[0].status, 'exact');
  assert.equal(result.results[1].status, 'alternatives');
  assert.match(result.results[1].plans[0].changes[0].reason, /名称不同/);
});
