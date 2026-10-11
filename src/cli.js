#!/usr/bin/env node
import { McdClient } from './upstream.js';
import { compareSameMeal, searchMeals } from './compare.js';

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main() {
  const city = flag('city', '上海');
  const keyword = flag('keyword', '人民广场');
  const mode = flag('mode', 'pickup');
  const client = new McdClient();
  try {
    let output;
    if (process.argv.includes('--search')) {
      output = await searchMeals(client, { city, keyword, mode, mealQuery: flag('search') });
    } else {
      const raw = flag('items', '[{"query":"巨无霸","quantity":1}]');
      output = await compareSameMeal(client, { city, keyword, mode, items: JSON.parse(raw), includeCoupons: process.argv.includes('--coupons') });
    }
    console.log(JSON.stringify(output, null, 2));
    if (output.status !== 'ok') process.exitCode = 2;
  } finally {
    await client.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
