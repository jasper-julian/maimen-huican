# Codex 初步检查记录

检查对象：WorkBuddy 初稿 `lib/mcp-client.mjs`。当前仍在开发；未接入真实 Token，本记录不代表验收通过。

1. `summarizeError()` 目前只截断上游错误消息的首行。截断不等于脱敏：上游错误可能在首行包含手机号、地址或凭据。建议工具错误对外只返回固定错误类别、工具名和错误码，不回传 `data.error.message` 或 `extractText(result)`；日志也不要打印这些原始文本。增加合成敏感字段测试，确认不会出现在接口返回和日志中。
2. `validateAgainstSchema()` 是有限校验器，暂只支持部分 required/type/enum，不能声称完整支持 JSON Schema。接入真实 tools/list 后，应针对所调用工具的实际 schema 测试，遇到不支持的复杂结构要明确提示，不能猜测参数。
3. 业务服务尚未完成。HTTP 入口必须限制可调用工具为本版本需要的查询与 `calculate-price`，不能让前端任意传 `tools/call` 工具名，从而调用创建订单、兑换积分、抽奖等功能。
4. 真实门店菜单和价格试算尚未验证；演示数据不能作为真实 MCP 接入证据，也不能被标成实时价格。

待 WorkBuddy 完成本轮开发后，根据成品继续检查和执行端到端验证。
