#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { McdClient } from './upstream.js';
import { compareSameMeal, searchMeals } from './compare.js';

const locationFields = {
  city: z.string().min(1).describe('城市，例如上海'),
  keyword: z.string().min(1).describe('商圈、地标或地址关键词，例如人民广场'),
  mode: z.enum(['pickup', 'drive_through']).default('pickup').describe('到店取餐或得来速'),
  maxStores: z.number().int().min(1).max(5).default(5).describe('比较最近的 1 至 5 家营业门店')
};

function result(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

function failure(error) {
  return { content: [{ type: 'text', text: error.message || '查询失败' }], isError: true };
}

export function createServer() {
  const server = new McpServer({ name: 'mcd-where-to-buy', version: '1.0.0' });
  server.registerTool('search_meals', {
    title: '查找可比较餐品',
    description: '在附近第一家营业门店查询官方菜单，返回餐品名称和编码。名称不明确时先调用此工具。只读取数据，不下单。',
    inputSchema: z.object({ ...locationFields, mealQuery: z.string().min(1).describe('餐品名称的一部分或完整编码') })
  }, async input => {
    const client = new McdClient();
    try { return result(await searchMeals(client, input)); }
    catch (error) { return failure(error); }
    finally { await client.close(); }
  });

  server.registerTool('compare_same_meal', {
    title: '同一餐跨门店核价',
    description: '用官方门店、菜单、餐品详情和核价工具比较同一组餐品在附近门店的实价。严格核对编码、名称、默认套餐组成；无法确认的门店不参与最低价排名。可选试算门店可用券。只读取数据，不下单。',
    inputSchema: z.object({
      ...locationFields,
      items: z.array(z.object({ query: z.string().min(1).describe('精确餐品名或编码'), quantity: z.number().int().min(1).max(10).default(1) })).min(1).max(4),
      includeCoupons: z.boolean().default(false).describe('是否尝试门店可用券；最多试算 8 种券与餐品组合/店')
    })
  }, async input => {
    const client = new McdClient();
    try { return result(await compareSameMeal(client, input)); }
    catch (error) { return failure(error); }
    finally { await client.close(); }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void serveStdio(createServer);
}
