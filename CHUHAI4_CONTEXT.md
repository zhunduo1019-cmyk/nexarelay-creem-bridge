# chuhai4 项目承接上下文

生成时间：2026-07-20  
当前线上站点：`https://api.getnexarelay.com/`  
当前目录：`C:\Users\pglgl\Documents\chuhai4`

## 当前判断

- `chuhai4` 目录目前为空，本文件用于承接 `chuhai3` 的执行上下文。
- 线上首页 `https://api.getnexarelay.com/` 可访问，HTTP 状态码为 `200`。
- 线上页面标题为 `One API`，描述显示这是 One API 聚合管理前端。
- `https://api.getnexarelay.com/api/health` 当前返回 `404`，不能作为健康检查接口使用。
- 用户截图显示 Creem 当前处于 `Bank payout verification` 页面，状态为 `Waiting for sync`。

## 从 chuhai3 继承的 MVP 主线

当前项目目标不是继续写总结，而是把东南亚 AI 聚合平台跑成：

- 可测试：OpenRouter 渠道真实可用。
- 可调用：前台能用测试用户发起真实模型调用。
- 可扣费：One API / New API 内部 quota 能正确扣减。
- 可充值：Creem 或人工支付能把用户支付映射为 quota。
- 可对外演示：首页、价格、FAQ、充值入口足够清晰。

## 已确定产品策略

- 平台方向：AI 模型聚合平台，不做单一模型站。
- 首发市场：东南亚。
- 首个上游：OpenRouter。
- 默认低成本模型：`deepseek/deepseek-r1`。
- 第二档模型：`qwen/qwen-plus-2025-07-28`。
- 高级模型：Gemini Pro 类模型先只给付费或测试用户。

## 建议额度规则

```text
1 USD = 500,000 quota
注册送 10,000 quota
免费用户每日最多消耗 5,000 quota
免费用户只开放 DeepSeek Reasoner
```

建议充值档位：

| 档位 | 支付金额 | 到账额度 |
|---|---:|---:|
| Starter | 1 USD | 500,000 quota |
| Plus | 5 USD | 2,800,000 quota |
| Pro | 10 USD | 6,000,000 quota |

## Creem 当前状态

截图状态说明：

- 页面标题：`Bank payout verification`
- 状态：`Waiting for sync`
- 当前动作：继续 Paysway payout verification。
- 含义：这是 Creem 商户收款后的结算/打款验证，不等同于站内 checkout/webhook 已经配置完成。

当前不要把支付作为唯一上线阻塞。可以并行做：

- One API OpenRouter 调用链路测试。
- Creem 产品和 webhook 配置准备。
- 人工充值兜底流程。

但以下动作通常要等 Creem 后台可进入正式收款配置后再确认：

- 正式生产产品 ID。
- 正式 API Key。
- 正式 webhook secret。
- 首笔真实支付测试。

## 下一步顺序

1. 完成 Creem 的银行打款验证同步，直到后台能进入产品/API/webhook 配置。
2. 在 Creem 创建 3 个一次性支付产品：Starter、Plus、Pro。
3. 在 One API / New API 后台填入 Creem 相关配置，或用自定义 webhook 对接充值。
4. 配置生产 webhook 地址，确保 Cloudflare/WAF 不拦截。
5. 用小额测试单验证支付成功后自动加 quota。
6. 验证失败时，先保留人工补单流程。

## 官方资料

- Creem API Introduction: `https://docs.creem.io/api-reference/introduction`
- Creem Checkout API: `https://docs.creem.io/features/checkout/checkout-api`
- Creem Create Checkout: `https://docs.creem.io/api-reference/endpoint/create-checkout`
- Creem Webhooks: `https://docs.creem.io/code/webhooks`
- OpenRouter Quickstart: `https://openrouter.ai/docs/quickstart`

