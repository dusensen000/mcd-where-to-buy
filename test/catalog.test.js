import test from 'node:test';
import assert from 'node:assert/strict';
import { matchProduct, menuProducts, searchMeals, yuan } from '../src/compare.js';

test('模糊名称有歧义时不猜测餐品', () => {
  const products = [{ code: '1', name: '巨无霸' }, { code: '2', name: '巨无霸套餐' }];
  assert.equal(matchProduct(products, '巨无霸').product.code, '1');
  assert.equal(matchProduct(products, '巨').status, 'ambiguous');
  assert.equal(matchProduct(products, '3').status, 'missing');
});

test('菜单分类换行被归一化，金额按官方分单位换算', () => {
  const products = menuProducts({ data: { meals: { '1': { name: '巨无霸' } }, categories: [
    { name: '巨无霸\n牛鱼肉堡', meals: [{ code: '1', tags: ['单品'] }] }
  ] } });
  assert.deepEqual(products[0].categories, ['巨无霸 牛鱼肉堡']);
  assert.equal(yuan(2550), '25.50');
  assert.equal(yuan(1), '0.01');
  assert.throws(() => yuan(25.5));
});

test('餐品搜索覆盖所有候选门店，而非只查最近一家', async () => {
  const client = { async call(name, args) {
    if (name === 'query-nearby-stores') return { data: [
      { storeCode: '1', storeName: '近店', distance: 10, businessStatus: true },
      { storeCode: '2', storeName: '远店', distance: 20, businessStatus: true }
    ] };
    if (name === 'query-meals') return { data: { meals: args.storeCode === '1' ? {} : { '4648': { name: '不素之霸双层牛堡' } }, categories: [] } };
  } };
  const result = await searchMeals(client, { city: '上海', keyword: '人民广场', mealQuery: '不素之霸' });
  assert.equal(result.status, 'ok');
  assert.equal(result.candidates[0].code, '4648');
  assert.equal(result.candidates[0].stores[0].storeCode, '2');
});
