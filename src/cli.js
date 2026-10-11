#!/usr/bin/env node
import { McdClient } from './upstream.js';
import { searchMeals } from './compare.js';
import { planMealAlternatives } from './fallback.js';

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main() {
  const city = flag('city');
  const keyword = flag('keyword');
  if (!city || !keyword) throw new Error('请提供 --city 和 --keyword，例如 --city 上海 --keyword 人民广场。');
  const mode = flag('mode', 'pickup');
  const maxStores = flag('max-stores') == null ? undefined : Number(flag('max-stores'));
  const client = new McdClient();
  try {
    let output;
    if (process.argv.includes('--search')) {
      output = await searchMeals(client, { city, keyword, mode, maxStores, mealQuery: flag('search') });
    } else {
      const raw = flag('items');
      if (!raw) throw new Error('请用 --items 提供餐品 JSON 数组。');
      output = await planMealAlternatives(client, { city, keyword, mode, maxStores, items: JSON.parse(raw),
        maxTotalYuan: flag('budget') == null ? undefined : Number(flag('budget')),
        maxAlternativesPerStore: flag('max-plans') == null ? undefined : Number(flag('max-plans')) });
    }
    console.log(JSON.stringify(output, null, 2));
    if (output.status !== 'ok') process.exitCode = 2;
  } finally {
    await client.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
