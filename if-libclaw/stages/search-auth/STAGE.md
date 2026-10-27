# Stage: search-auth

## 触发条件

新的文献检索任务，或已经获准但因 `AUTH_SESSION_REQUIRED` 暂停的检索任务。

## TODO

`SEARCH-0` 是认证前置 Gate，**不得创建任务工作区、计划或 TODO**；不访问检索来源，也不产生计费。

## 行为

1. 从当前 Skill 目录执行一次 `./if-libclaw auth status`。不得读取 session JSON、环境文件、旧 Skill、下载目录、license 文件，或直接请求任何服务。
2. 明确输出 `Logged in.` 时，认证通过；可选的账户状态查询未完成不影响本 Gate，也不得重新登录。进入 `../search-plan/STAGE.md`。
3. 明确输出 `Not logged in.` 时，从当前 Skill 目录执行一次 `env -u LIBCLAW_OIDC_ISSUER -u LIBCLAW_OIDC_CLIENT_ID -u LIBCLAW_OIDC_AUDIENCE ./if-libclaw login`。从这次输出逐字读取 `Verification URL:` 与 `User code:`，使用 `SKILL.md` 的固定模板展示验证链接、用户代码和操作示例；立即调用 `AskUserQuestion`，唯一完成动作是“已完成”，然后停止等待。
4. 用户选择或回复“已完成”后，只再执行一次 `./if-libclaw auth status`。明确登录成功时恢复本 Stage 并进入 `search-plan`；pending、denied、expired、`AUTH_STATUS_LOOKUP_FAILED` 或其他错误时仅报告安全状态并停止。
5. 除明确 `Not logged in.` 或业务命令返回 `AUTH_SESSION_REQUIRED` 的恢复外，HTTP 401/403/422/503、账户配给、余额、计费、版本、来源或报告错误都不得执行 `login`、生成新验证链接、读取 token 或改用其它凭据。

## 完成条件

- `auth status` 已明确输出 `Logged in.`；
- 尚未创建本次检索的工作区、计划、TODO 或网络检索请求。

## 下一 Stage

认证成功后读取 `../search-plan/STAGE.md`。
