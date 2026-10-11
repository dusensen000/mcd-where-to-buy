---
name: mcd-meal-alternatives
description: 使用麦当劳中国官方 MCP，在目标餐品未出现在附近门店当前菜单时，查询可买原餐的门店与经官方整单核价的备选候选。
---

# 麦门备选计划

1. 询问用户城市、地点关键词、到店取餐或得来速、目标餐品及数量。不要猜测用户位置。
2. 询问哪些餐品不能替换；如用户明确提出可接受的备选餐品，填入该餐品的 `replacementQueries`；有整单预算时填写 `maxTotalYuan`。
3. 餐品名称模糊时先调用 `search_meals`，让用户从名称和编码中明确选择。
4. 调用 `plan_meal_alternatives`。先呈现 `exact` 的原餐门店，再单独呈现 `alternatives` 的备选方案，说明每件餐品由什么改成什么及官方整单价。
5. 将 `unavailable`、`unverified`、`over_budget` 和 `menu_error` 的原因分别说明。不要把未核价的候选描述为可购买。
6. “当前菜单不可售”不能写成“门店缺货”。同菜单分类的候选不等于同款，也不保证口味、配料、营养或过敏原一致。
7. 本 Skill 只做查询和决策辅助。最终由用户在官方渠道核对并决定是否下单。
