# 同一餐，去哪家店买？

一个面向中国大陆麦当劳顾客的 MCP Skill。用户已经决定吃什么，却不知道附近哪家门店能买到同一餐、实际要付多少钱。本项目连接麦当劳中国官方 MCP，逐店核对在售菜单、套餐默认组成和官方核价，再给出**最低价门店**与**最近的已核价门店**。

> 独立参赛作品，非麦当劳官方产品。本工具只做查询和决策辅助，不自动下单、领券或取消订单。价格、可售状态以实际下单页为准。

## 给谁用

- 已选好餐品，想比较附近门店价格的顾客。
- 想同时比较两三件餐品构成的“一餐”的顾客。
- 经常使用得来速，希望在支持得来速的门店中选店的顾客。

## 它做什么

1. 用 `query-nearby-stores` 找到最多 5 家当前营业的到店取餐或得来速门店。
2. 用 `query-meals` 在最近门店解析餐品名称或编码；模糊名称有歧义时要求明确选择。
3. 对每家门店核对餐品编码、名称，并用 `query-meal-detail` 核对套餐默认组成。
4. 用 `calculate-price` 对完全相同的餐品及数量逐店核价。金额按官方返回的“分”精确换算为“元”。
5. 可选查询 `query-store-coupons`，对最多 8 个券与餐品组合逐店试算；只有官方核价确实降低了同一购物篮金额，才显示券后价。
6. 输出最低价、最近的已核价门店、各店状态及不能比较的具体原因。距离来自官方门店查询，**不代表路程或等待时间**。

## 安装

需要 Node.js 20 或更新版本，以及从[麦当劳 MCP 开放平台](https://open.mcd.cn/mcp)申请的 Token。

```powershell
npm ci
$env:MCD_MCP_TOKEN = Read-Host '输入麦当劳 MCP Token' -MaskInput
npm run doctor
```

`doctor` 只检查连接和所需工具，不会下单。不要把真实 Token 写进项目文件或提交到 GitHub。`.env` 已加入 `.gitignore`；项目不会自动读取 `.env`。

## 使用示例

先查名称和编码：

```powershell
node src/cli.js --city 上海 --keyword 人民广场 --search 巨无霸
```

比较“巨无霸 + 薯条”：

```powershell
node src/cli.js --city 上海 --keyword 人民广场 --items '[{"query":"巨无霸","quantity":1},{"query":"薯条","quantity":1}]'
```

如需试算当前门店可用券，在命令末尾加 `--coupons`。得来速模式加 `--mode drive_through`。CLI 默认查询上海人民广场附近的巨无霸，仅为方便首次体验；正式使用请提供自己的位置和餐品。

返回的 `status=quoted` 才进入排名。`unavailable` 表示该店菜单没有同款；`unverified` 表示官方详情或核价不足以确认同款。`couponCheck=partial` 表示达到每店 8 次试算上限，不能断言已找到绝对最优用券方案。

## 作为 MCP Server 接入

本项目通过 **stdio** 向 MCP 客户端提供两个工具：

| 工具 | 用途 |
| --- | --- |
| `search_meals` | 查附近门店的官方餐品名称和编码 |
| `compare_same_meal` | 对 1–4 个餐品组成的一餐，跨最多 5 家店做同款核对及核价 |

参考 [`mcp-config.example.json`](mcp-config.example.json) 配置客户端。把 `${PROJECT_DIR}` 指向此项目的绝对路径，并在客户端安全的环境变量设置中提供 `MCD_MCP_TOKEN`。不同客户端的环境变量插值方式不同；示例中的占位符不能直接作为真实 Token 使用。也可以在已设置环境变量的终端运行 `npm start`，用 MCP Inspector 或支持 stdio 的客户端连接。

仓库内的 [`SKILL.md`](SKILL.md) 给出了面向智能体的使用流程。源码在 `src/`，集成调用链和边界见 [`MCP_INTEGRATION.md`](MCP_INTEGRATION.md)。

## 设计与限制

- **只读**：仅调用官方查询和核价工具，不调用 `create-order`、`cancel-order`、领券或抽奖工具。
- **同款**：编码、名称和默认套餐组成必须一致。套餐自定义替换暂不比较。
- **范围**：目前比较到店取餐和得来速；外送依赖用户配送地址及配送费，留待后续单独实现。
- **距离**：使用官方返回的门店距离，不计算路线、耗时、排队或库存余量。
- **实时性**：价格是查询时的快照，门店营业、菜单和优惠可能变化。
- **优惠券**：只试算门店当前返回的券；部分券可能有复杂使用条件，达到探测上限时会明确标记。

## 参赛文件

- `README.md`：介绍、安装、示例与目标用户。
- `CONTEST_DECLARATION.md`：直接取自活动官方仓库，内容未修改。
- `MCP_INTEGRATION.md`：实际使用的 Server、Tool、调用流程和业务价值。
- `mcp-config.example.json`：脱敏配置，只使用环境变量占位符提供本地路径和 Token。
- `SKILL.md` 与 `src/`：可运行的 Skill 和 MCP Server 源码。

测试：`npm test`。公开报名时，先将本项目上传到你自己的 Public GitHub 仓库，再按[比赛 README](https://github.com/M-China/mcd-developer-innovation-challenge)的格式提交 Issue。不要提交 Token、真实地址或个人订单数据。
