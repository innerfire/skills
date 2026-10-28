# Stage: verification-auth

## 触发条件

每个新的引用验真请求，以及一个已获准但因认证暂停的引用验真任务恢复时。它必须在
`verification-consent` 之前执行。

## 目的

只确认当前 Skill 目录中的普通本地 session 是否可用。此 Stage 不是用户的影响确认，
不读取文档或截图内容、不创建任务工作区或 TODO、不调用转换服务或来源服务，也不计费。

## 行为

1. 从当前平台的随包二进制所在 Skill 目录执行：

   ```bash
   ./if-libclaw auth status
   ```

   所有平台使用对应的原生二进制名称；不设置临时 session 路径。
2. 输出包含 `Logged in.` 时，会话预检通过，即使可选的 identity、配给或余额查询未完成。
   直接读取 `../verification-consent/STAGE.md`，再展示三项影响披露；不得重新登录。
3. 输出 `Not logged in.` 时，按 `SKILL.md` 的当前平台命令执行一次 `login`。从该次输出提取 `Verification URL:`（仅实际输出 `User code:` 时附上用户代码），按 `SKILL.md` 模板展示验证链接和操作示例；随后立即调用客户端可用的 HITL 工具（`AskUserQuestion` 或等价工具，无工具时等待对话回复） 等待“已完成”，再停止。不得创建工作区、TODO 或影响披露。
4. 用户通过客户端可用的 HITL 工具（`AskUserQuestion` 或等价工具）选择“已完成”，或在不支持 HITL 时回复“已完成”后，只执行一次 `auth status`：成功时进入
   `verification-consent`；仍待批准、被拒绝、已过期、`AUTH_STATUS_LOOKUP_FAILED` 或未能确认会话时，仅报告安全状态并停止。
   不得读取 session、提取 token 或直接请求任何 HTTP 端点来补充验证。
   不得在同一轮重复 `login`，除非用户明确要求“重新登录”。
5. 除 `Not logged in.` 外的预检异常不得猜测为未登录，也不得切换到 API Key、许可证或其他认证方式。HTTP 401/403/422/503、余额、配给、计费、版本和下游服务错误均不得触发 `login`。

## 完成条件

- 当前 `auth status` 已确认会话；并且
- 尚未读取验真输入、创建任务工作区或 TODO、调用转换/来源服务或产生计费。

## 下一 Stage

会话确认后读取 `../verification-consent/STAGE.md`。未登录时交付验证链接并暂停；用户完成授权后从本 Stage 恢复。

## Token 复用与网页登录

- `auth status` 由 CLI 检查 Token 到期并在需要时自动续期。有效会话不打开网页。临时网络、状态查询或计费错误不等于未登录，不能据此执行 `login`。
- 默认 `login` 使用授权码 + PKCE，打印链接后立即返回并尝试打开本机浏览器；正常输出没有 `User code:`。若它直接返回 `Logged in.`，复用会话并继续。
- 展示链接和操作示例后，必须保留客户端可用 HITL 工具（`AskUserQuestion` 或等价工具，无工具时等待对话回复）的“已完成”等待步骤。网页回调、CLI 的 `Login pending.` 和 Agent 自述都不是完成证据。用户确认后，以一次 `auth status` 的实际结果继续或停止。
