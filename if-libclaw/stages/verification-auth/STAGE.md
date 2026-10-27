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
3. 输出 `Not logged in.` 时，直接执行 `login`。从该次输出提取 `Verification URL:` 与 `User code:`，按 `SKILL.md` 模板展示验证链接、用户代码和操作示例；随后立即调用 HITL 工具 `AskUserQuestion` 等待“已完成”，再停止。不得创建工作区、TODO 或影响披露。
4. 用户通过 `AskUserQuestion` 选择“已完成”，或在不支持 HITL 时回复“已完成”后，只执行一次 `auth status`：成功时进入
   `verification-consent`；仍待批准、被拒绝、已过期、`AUTH_STATUS_LOOKUP_FAILED` 或未能确认会话时，仅报告安全状态并停止。
   不得读取 session、提取 token 或直接请求任何 HTTP 端点来补充验证。
   不得在同一轮重复 `login`，除非用户明确要求“重新登录”。
5. 除 `Not logged in.` 外的预检异常不得猜测为未登录，也不得切换到 API Key、许可证或其他认证方式。HTTP 401/403/422/503、余额、配给、计费、版本和下游服务错误均不得触发 `login`。

## 完成条件

- 当前 `auth status` 已确认会话；并且
- 尚未读取验真输入、创建任务工作区或 TODO、调用转换/来源服务或产生计费。

## 下一 Stage

会话确认后读取 `../verification-consent/STAGE.md`。未登录时交付验证链接并暂停；用户完成授权后从本 Stage 恢复。
