import { McdClient } from './upstream.js';

const required = ['query-nearby-stores', 'query-meals', 'query-meal-detail', 'calculate-price'];
const client = new McdClient();
try {
  const tools = await client.listTools();
  const available = new Set(tools.map(t => t.name));
  const missing = required.filter(name => !available.has(name));
  if (missing.length) throw new Error(`官方 MCP 缺少工具：${missing.join('、')}`);
  console.log(`连接成功；已找到全部 ${required.length} 个所需官方工具。`);
} catch (error) {
  console.error(`连接或工具检查失败：${error.message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
