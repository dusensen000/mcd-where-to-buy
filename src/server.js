#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { McdClient } from './upstream.js';
import { searchMeals } from './compare.js';
import { planMealAlternatives } from './fallback.js';

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
    description: '在附近候选门店查询官方菜单，返回餐品名称、编码及当前有哪些门店列出它。名称不明确时先调用此工具。只读取数据，不下单。',
    inputSchema: z.object({ ...locationFields, mealQuery: z.string().min(1).describe('餐品名称的一部分或完整编码') })
  }, async input => {
    const client = new McdClient();
    try { return result(await searchMeals(client, input)); }
    catch (error) { return failure(error); }
    finally { await client.close(); }
  });

  server.registerTool('plan_meal_alternatives', {
    title: '当前菜单不可售时的整单备选方案',
    description: '查询附近门店：原餐可买时直接核价；若餐品未出现在当前菜单或套餐默认组成不同，只从同类在售餐品提出候选并整单核价。候选不是同款，口味、营养和过敏原需用户自行核对。本工具只读，不下单。',
    inputSchema: z.object({
      ...locationFields,
      items: z.array(z.object({
        query: z.string().min(1).describe('目标餐品的名称或编码；模糊匹配有歧义时会要求重新指定'),
        quantity: z.number().int().min(1).max(10).default(1),
        allowAlternative: z.boolean().default(true).describe('false 表示此餐品不能替换'),
        replacementQueries: z.array(z.string().min(1)).max(5).default([]).describe('可选：用户明确指定的备选餐品名称或编码；经当前门店菜单和官方详情核验后才采用')
      })).min(1).max(4),
      maxTotalYuan: z.number().positive().optional().describe('可选的整单预算上限，单位元'),
      maxAlternativesPerStore: z.number().int().min(1).max(5).default(3)
    })
  }, async input => {
    const client = new McdClient();
    try { return result(await planMealAlternatives(client, input)); }
    catch (error) { return failure(error); }
    finally { await client.close(); }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void serveStdio(createServer);
}
