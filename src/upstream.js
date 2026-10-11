import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export class McdClient {
  constructor({ token = process.env.MCD_MCP_TOKEN, url = process.env.MCD_MCP_URL || 'https://mcp.mcd.cn' } = {}) {
    if (!token) throw new Error('缺少 MCD_MCP_TOKEN 环境变量。');
    this.token = token;
    this.url = url;
    this.client = null;
  }

  async connect() {
    if (this.client) return;
    const client = new Client({ name: 'mcd-where-to-buy', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } }
    });
    await client.connect(transport);
    this.client = client;
  }

  async call(name, args) {
    await this.connect();
    const result = await this.client.callTool({ name, arguments: args });
    let body = result.structuredContent;
    if (!body) {
      const text = result.content?.filter(x => x.type === 'text').map(x => x.text).join('\n') || '';
      try { body = JSON.parse(text); } catch { /* Upstream normally returns structuredContent. */ }
    }
    if (result.isError || !body || body.success === false || (body.code && body.code !== 200)) {
      const message = typeof body?.message === 'string' ? body.message : `官方工具 ${name} 调用失败`;
      throw new Error(`${name}: ${message}`);
    }
    return body;
  }

  async listTools() {
    await this.connect();
    return (await this.client.listTools()).tools;
  }

  async close() {
    if (this.client) await this.client.close();
    this.client = null;
  }
}
