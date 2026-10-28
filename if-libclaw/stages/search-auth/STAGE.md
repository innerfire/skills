# Stage: search-auth

## 触发条件

新的文献检索任务，或已经获准但因 `AUTH_SESSION_REQUIRED` 暂停的检索任务。

## TODO

`SEARCH-0` 是认证前置 Gate，**不得创建任务工作区、计划或 TODO**；不访问检索来源，也不产生计费。

## 行为

1. 从当前 Skill 目录执行一次 `./if-libclaw auth status`。不得读取 session JSON、环境文件、旧 Skill、下载目录、license 文件，或直接请求任何服务。
2. 明确输出 `Logged in.` 时，认证通过；可选的账户状态查询未完成不影响本 Gate，也不得重新登录。进入 `../search-plan/STAGE.md`。
3. 明确输出 `Not logged in.` 时，按 `SKILL.md` 的当前平台命令，从 Skill 目录执行一次 `login`。从这次输出逐字读取 `Verification URL:`（仅实际输出 `User code:` 时附上用户代码），使用 `SKILL.md` 的固定模板展示验证链接和操作示例；立即调用客户端可用的 HITL 工具（`AskUserQuestion` 或等价工具，无工具时等待对话回复），唯一完成动作是“已完成”，然后停止等待。
4. 用户选择或回复“已完成”后，只再执行一次 `./if-libclaw auth status`。明确登录成功时恢复本 Stage 并进入 `search-plan`；pending、denied、expired、`AUTH_STATUS_LOOKUP_FAILED` 或其他错误时仅报告安全状态并停止。
5. 除明确 `Not logged in.` 或业务命令返回 `AUTH_SESSION_REQUIRED` 的恢复外，HTTP 401/403/422/503、账户配给、余额、计费、版本、来源或报告错误都不得执行 `login`、生成新验证链接、读取 token 或改用其它凭据。

## 完成条件

- `auth status` 已明确输出 `Logged in.`；
- 尚未创建本次检索的工作区、计划、TODO 或网络检索请求。

## 下一 Stage

认证成功后读取 `../search-plan/STAGE.md`。

## Token 复用与网页登录

- `auth status` 由 CLI 检查 Token 到期并在需要时自动续期。有效会话不打开网页。临时网络、状态查询或计费错误不等于未登录，不能据此执行 `login`。
- 默认 `login` 使用授权码 + PKCE，打印链接后立即返回并尝试打开本机浏览器；正常输出没有 `User code:`。若它直接返回 `Logged in.`，复用会话并继续。
- 展示链接和操作示例后，必须保留客户端可用 HITL 工具（`AskUserQuestion` 或等价工具，无工具时等待对话回复）的“已完成”等待步骤。网页回调、CLI 的 `Login pending.` 和 Agent 自述都不是完成证据。用户确认后，以一次 `auth status` 的实际结果继续或停止。
