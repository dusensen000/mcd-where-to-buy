import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSameMeal, matchProduct, yuan } from '../src/compare.js';

test('商品名有多个部分匹配时要求用户明确选择', () => {
  const products = [{ code: '1', name: '巨无霸' }, { code: '2', name: '巨无霸套餐' }];
  assert.equal(matchProduct(products, '巨无霸').product.code, '1');
  assert.equal(matchProduct(products, '巨').status, 'ambiguous');
  assert.equal(matchProduct(products, '3').status, 'missing');
});

test('官方分单位金额准确换算为元', () => {
  assert.equal(yuan(2550), '25.50');
  assert.equal(yuan(1), '0.01');
  assert.throws(() => yuan(25.5));
});

test('只对同款、同默认组成并经过官方核价的门店排名', async () => {
  const calls = [];
  const stores = [
    { storeCode: '101', storeName: '近店', distance: 100, address: '甲', businessStatus: true },
    { storeCode: '102', storeName: '便宜店', distance: 200, address: '乙', businessStatus: true },
    { storeCode: '103', storeName: '异款店', distance: 300, address: '丙', businessStatus: true }
  ];
  const client = { async call(name, args) {
    calls.push([name, args]);
    if (name === 'query-nearby-stores') return { data: stores };
    if (name === 'query-meals') return { data: { meals: { '1100': { name: args.storeCode === '103' ? '另一餐' : '巨无霸' } } } };
    if (name === 'query-meal-detail') return { data: { rounds: [] } };
    if (name === 'calculate-price') return { data: { price: args.storeCode === '101' ? 2550 : 2300,
      discount: 0, productList: [{ productCode: '1100', quantity: 1 }] } };
    throw new Error(`unexpected ${name}`);
  } };
  const result = await compareSameMeal(client, { city: '上海', keyword: '人民广场', items: [{ query: '巨无霸', quantity: 1 }] });
  assert.equal(result.status, 'ok');
  assert.equal(result.cheapestStoreCode, '102');
  assert.equal(result.nearestVerifiedStoreCode, '101');
  assert.equal(result.results.find(r => r.storeCode === '103').status, 'unavailable');
  assert.equal(result.results.find(r => r.storeCode === '102').finalPriceYuan, '23.00');
  assert.equal(calls.filter(([n]) => n === 'calculate-price').length, 2);
});

test('核价篮子不一致时不展示报价', async () => {
  const client = { async call(name) {
    if (name === 'query-nearby-stores') return { data: [{ storeCode: '101', storeName: '甲', businessStatus: true, distance: 1 }] };
    if (name === 'query-meals') return { data: { meals: { '1100': { name: '巨无霸' } } } };
    if (name === 'query-meal-detail') return { data: { rounds: [] } };
    if (name === 'calculate-price') return { data: { price: 1, productList: [{ productCode: '9999', quantity: 1 }] } };
  } };
  const result = await compareSameMeal(client, { city: '上海', keyword: '人民广场', items: [{ query: '巨无霸', quantity: 1 }] });
  assert.equal(result.status, 'no_verified_quote');
  assert.equal(result.results[0].status, 'unverified');
});
