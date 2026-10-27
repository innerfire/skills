---
name: if-libclaw
description: 通过随包 if-libclaw CLI 执行文献检索或引用验真。当用户提到 if-libclaw、搜索或查找论文、制定检索式、引用验真、参考文献真实性、核查引用，提供 .doc/.docx/.pdf，或直接粘贴参考文献 Markdown/截图时使用。
---

# if-libclaw

本 Skill 是 `if-libclaw` 的唯一入口。所有平台二进制统一使用 `if-libclaw` 前缀；先路由，再只读取当前 Stage，不要一次加载完整工作流。

引用验真成功后，CLI 同时交付适合浏览的 `report.html` 与便于复制的中文 `report.md`；两份报告来自同一份结构化结果。

## 平台二进制

- macOS arm64：`./if-libclaw`
- macOS amd64（Intel）：`./if-libclaw-darwin-amd64`
- Linux amd64：`./if-libclaw-linux-amd64`
- Linux arm64：`./if-libclaw-linux-arm64`
- Windows amd64：`.\if-libclaw.exe`

Stage 和 CLI 参考中的 `./if-libclaw` 表示当前平台的随包二进制；macOS Intel 必须
替换为 `./if-libclaw-darwin-amd64`。Linux 必须先用 `uname -m` 确认架构：
`x86_64` 选择 `./if-libclaw-linux-amd64`，`aarch64` 或 `arm64` 选择
`./if-libclaw-linux-arm64`。必须使用原生架构产物，不得通过 QEMU 模拟其它架构；
也不要重命名或改写 Skill 包。

## CLI 认证

- 每个新的文献检索任务都必须先经过 `search-auth`（`SEARCH-0`）认证前置 Gate，再读取 `search-plan`。该 Gate 只执行一次 `auth status`，不创建任务工作区、计划或 TODO，不调用检索来源，也不产生计费。
- `SEARCH-0` 未登录时，直接执行 `login`，展示验证链接、用户代码和操作示例，再调用 HITL 工具 `AskUserQuestion` 等待“已完成”；用户完成浏览器授权后，再执行一次 `auth status`。认证成功才进入检索计划与 Gate 1。不得先创建计划、展示 Gate 1 或访问检索来源，再要求用户登录。
- 每个新的引用验真任务都必须先经过 `verification-auth`（`VERIFY-0`）认证前置 Gate，再读取 `verification-consent`。该 Gate 只执行一次 `auth status`，不读取文档、不创建任务工作区或 TODO、不调用转换/来源服务，也不产生计费。
- `VERIFY-0` 未登录时，直接执行 `login`，展示验证链接、用户代码和操作示例，再调用 HITL 工具 `AskUserQuestion` 等待“已完成”；用户完成浏览器授权后，再执行一次 `auth status`。认证成功才进入三项影响披露。不得先展示披露、等待“继续”、创建工作区或推进 `VERIFY-1/2`，再要求用户登录。
- `VERIFY-0` 是认证 Gate，不加入用户可见的 `VERIFY-1` 至 `VERIFY-5` 清单。`auth status` 已输出 `Logged in.` 时，会话预检通过；可选的账户状态查询未完成不得触发新的 `login`。
- 本 Skill 面向用户的唯一登录入口是 `env -u LIBCLAW_OIDC_ISSUER -u LIBCLAW_OIDC_CLIENT_ID -u LIBCLAW_OIDC_AUDIENCE ./if-libclaw login`。这会清除旧的本地开发覆盖值，固定使用随包内置的 Catalog-Billing OIDC 配置。命令显示浏览器验证地址后立即退出；不要在用户回复中出现底层身份服务品牌，也不要要求用户在终端输入账号密码。
- `LIBCLAW_AUTH_MODE=jwt` 时，CLI 仅从本地普通 session 文件取得 Bearer access token；不得读取、显示、转述或回退到 API Key / `libclaw.license`。
- Agent 只能通过 `./if-libclaw auth status` 查询登录、配给和余额。**不得读取 session JSON、提取 access token、构造 Authorization header，或用 curl/HTTP 客户端直接请求 Catalog-Billing、Telemetry、转换或来源服务。**若 `auth status` 输出 `AUTH_STATUS_LOOKUP_FAILED` 或任何 status 错误，只报告该安全错误并停止；不得以直接请求端点作为“二次验证”，也不得声称取得了余额或配给结果。
- `SEARCH-5` 或 `VERIFY-5` 的最终交付是唯一例外：在已完成的 CLI 产物旁读取安全 `billing-summary.json` 后，只执行一次 `./if-libclaw auth status` 获取新鲜的 `Remaining credits`。搜索只读取任务工作区根目录的这一份摘要，绝不扫描或相加数据库运行目录。若这次输出 `AUTH_STATUS_LOOKUP_FAILED`，仍可交付已完成报告和已 settled 的本次消耗，但必须将剩余点数标为“暂不可用”；不得再次执行 `login`、读取 session JSON、提取 token 或直接请求任何服务。
- `legacy_api_key` 只作为内部兼容说明存在，不是本 Skill 的用户恢复路径。不得建议用户提供、获取、更换或迁移 API Key 或许可证，也不得扫描其它下载目录、旧 Skill 或旧 license 文件寻找替代凭据。
- `auth status` 只显示非秘密身份、到期时间和可选配给/余额信息；`auth logout` 清理本地会话。两者都不会自动创建身份、Lago 或钱包资源。
- 只有 `auth status` 明确输出 `Not logged in.` 时，才从 Skill 目录执行 `env -u LIBCLAW_OIDC_ISSUER -u LIBCLAW_OIDC_CLIENT_ID -u LIBCLAW_OIDC_AUDIENCE ./if-libclaw login`。业务命令返回 `AUTH_SESSION_REQUIRED` 时先在同一 Skill 目录执行一次 `./if-libclaw auth status`；只有该检查明确输出 `Not logged in.` 才进入登录流程。HTTP 401/403/409/422/503、余额、配给、计费、版本或下游服务错误都不得生成新的验证链接。
- 所有平台都使用普通本地 JSON session 文件；不要求 Keychain、Secret Service、D-Bus、TTY、口令或特定文件权限。默认固定保存在当前随包二进制旁的 `./.libclaw/session.json`，因此每次 CLI 调用都必须从同一个 Skill 目录运行。常规调用不得重复设置 `LIBCLAW_AUTH_SESSION_FILE`；只有测试或多账号隔离明确需要其它绝对路径时才允许覆盖，并且 `login`、`auth status` 及后续所有 CLI 命令必须共同使用同一个覆盖值。不得使用每次运行都会变化的临时目录，也不得安装或修复任何凭据服务。
- 部署覆盖值只有在用户或部署配置用字段名明确标注时才能使用；不得把未标注的第三个值猜测为 audience、client secret 或本地会话口令。CLI 是公开客户端，绝不接收 client secret；不明确的秘密值不得尝试、转述或写入命令。
- 读取该次命令输出中的 `Verification URL:` 和 `User code:`；验证地址由身份服务返回，不得自行拼接、缩短或改写。所有 Stage 发起 `login` 后，用户可见回复必须使用以下模板；不添加原因、故障分析或额外认证问题：

```text
验证链接：[打开验证页面](<Verification URL>)
用户代码：`<User code>`

操作示例：

1. 打开验证链接。
2. 在网页中登录；若页面要求用户代码，输入上方代码。
3. 授权完成后，回到这里回复"已完成"。
```

- 发出该模板后，立即调用客户端的 HITL 工具 `AskUserQuestion`，问题只提示“完成网页登录与授权后，选择‘已完成’。”，唯一完成动作是“已完成”。调用后立即停止并等待；若客户端不提供 HITL 工具，才等待用户在对话中回复“已完成”。不得询问“我现在启动登录流程吗？”，也不得添加“当前未登录”或“需要先授权”。
- 用户通过 `AskUserQuestion` 选择“已完成”，或在不支持 HITL 时回复“已完成”后，执行一次 `./if-libclaw auth status`；登录成功时自动恢复原 Stage。若结果为 pending、denied、expired、`AUTH_STATUS_LOOKUP_FAILED` 或任何 status 错误，只报告安全状态并停止，**不得通过读取 session 或直接 HTTP 请求自行验证**。不得在同一认证轮次再次执行 `login`，不得自行生成、覆盖或替换 device code；只有用户明确要求“重新登录”时才允许开始新一轮。
- 认证恢复除登录后等待“已完成”的 `AskUserQuestion` 外，不得调用其它结构化提问工具；也不得询问用户是否拥有 OIDC 配置、API Key 或其它认证信息。不得建议用户提供、获取、更换或迁移 API Key 或许可证。
- 不得向用户展示 scope、entitlement、license 文件路径、旧格式兼容性或身份服务品牌。新文献检索由 `SEARCH-0` 在 Gate 1 前完成会话预检；新引用验真由 `VERIFY-0` 在 Consent 前完成会话预检；其它登录恢复只在对应 Gate/Consent 已获得之后、或恢复一个已经获准但因认证暂停的任务时执行；不得借认证恢复绕过 Gate 或 Consent。

## 题名匹配说明

引用验真会对包含汉字的题名忽略来源或 OCR 引入的空格与标点差异，因此同一中文题名在 CNKI、OpenAlex 等来源出现排版差异时仍可正确匹配；纯英文题名继续使用原有词元匹配规则。

## 意图路由

- 搜索、检索、查找论文或制定检索式：先进入 `search-auth`。
- 引用验真、参考文献真实性核查，核查单个 Word/PDF，或提供参考文献列表/单条引用的 Markdown 或截图：先进入 `verification-auth`。
- 同时包含两种意图：说明它们是两个独立任务并询问先后顺序，确认前不创建混合清单。
- 仅询问会进入哪个工作流且明确不执行时：只回答路由，不创建 TODO、不读 Stage、不运行命令。
- 意图不清楚：只询问“检索论文”还是“核验已有论文的参考文献”。

## Stage 路由

### 文献检索

`search-auth` → `search-plan` → `search-execute` → `search-report` → `search-delivery`

| Stage | 文件 | 完成依据 |
|---|---|---|
| `search-auth` | [STAGE.md](stages/search-auth/STAGE.md) | 会话已确认，或已交付验证链接并暂停等待用户完成浏览器授权。 |
| `search-plan` | [STAGE.md](stages/search-plan/STAGE.md) | 计划可解析且 Gate 1 后收到新的明确确认 |
| `search-execute` | [STAGE.md](stages/search-execute/STAGE.md) | 当前计划的检索完成，且 Gate 2 后收到用户选择 |
| `search-report` | [STAGE.md](stages/search-report/STAGE.md) | 当前结果的 QC 与 CLI 报告实际存在并通过检查 |
| `search-delivery` | [STAGE.md](stages/search-delivery/STAGE.md) | 只交付当前任务的已验证产物 |

### 引用验真

文档输入：`verification-auth` → `verification-consent` → `verification-context` → `verification-batch` → `verification-run` → `verification-delivery`

已粘贴的参考文献列表/单条引用：`verification-auth` → `verification-consent` → `verification-context`（生成已确认的 `reference-input/v1`，不调用转换服务）→ `verification-run` → `verification-delivery`

| Stage | 文件 | 完成依据 |
|---|---|---|
| `verification-auth` | [STAGE.md](stages/verification-auth/STAGE.md) | 会话已确认，或已交付验证链接并暂停等待用户完成浏览器授权。 |
| `verification-consent` | [STAGE.md](stages/verification-consent/STAGE.md) | 三项影响披露后收到新的明确确认 |
| `verification-context` | [STAGE.md](stages/verification-context/STAGE.md) | 文档 context 有效，或粘贴输入已确认并形成 owner-only `reference-input/v1` |
| `verification-batch` | [STAGE.md](stages/verification-batch/STAGE.md) | 文档输入的唯一 batch validation 为双 true；粘贴输入跳过本 Stage |
| `verification-run` | [STAGE.md](stages/verification-run/STAGE.md) | 当前 batch 的验真 JSON、HTML 与 Markdown 报告已生成并核对 |
| `verification-delivery` | [STAGE.md](stages/verification-delivery/STAGE.md) | 按实际完成状态交付 |

## TODO 契约

客户端支持待办列表时，搜索工作流进入后可创建对应清单。引用验真的
`verification-consent` 首条可见回复只展示三项影响披露和确认语；确认前不得在聊天正文中创建、展示或转述 `VERIFY-1` 至 `VERIFY-5` 清单，也不得调用 TODO 工具。收到新的明确确认后，才在客户端内部创建或恢复清单；清单始终只在内部待办区域维护，不复制到聊天正文。客户端不支持待办列表时，直接按 Stage 状态推进，不补写可见清单。恢复任务时复用原 ID，不另建同义 TODO。

`VERIFY-0` 是在 `verification-consent` 之前完成的无 TODO 认证 Gate：不得为它创建工作区、任务卡或可见清单，也不得把它当成用户的影响确认。

`SEARCH-0` 是在 `search-plan` 之前完成的无 TODO 认证 Gate：不得为它创建工作区、任务卡或可见清单，也不得把它当成 Gate 1 确认。

文献检索：

```text
- [ ] SEARCH-1 制定并确认检索计划
- [ ] SEARCH-2 执行所选数据库检索
- [ ] SEARCH-3 确认结果范围
- [ ] SEARCH-4 生成并检查报告
- [ ] SEARCH-5 交付当前任务产物
```

引用验真：

```text
- [ ] VERIFY-1 披露影响并取得确认
- [ ] VERIFY-2 生成本次引用核验输入
- [ ] VERIFY-3 整理并校验结构化引用
- [ ] VERIFY-4 执行来源验真并检查报告
- [ ] VERIFY-5 交付当前任务产物
```

执行规则：

1. 新文献检索任务先完成 `SEARCH-0`，新引用验真任务先完成 `VERIFY-0`；只有会话已确认后，才读取现有 TODO、当前任务工作区和已存在产物，再选择首个未完成业务 Stage。
2. TODO 只是显示层，不是完成证据。只有对应 Stage 的“完成条件”成立才可勾选。
3. 文件不能证明用户确认；Gate/Consent 必须由提问之后的新用户事件证明。
4. 产物与 TODO 冲突时，以产物、CLI 退出状态和确认事件为准，并修正 TODO。
5. 客户端支持 `in_progress` 状态时，同一时间只能有一个 TODO 处于 `in_progress`：只将当前 Stage 标为 `in_progress`，其余未完成项保持 pending。完成迁移时只更新一次，才可将下一 Stage 设为 `in_progress`。
6. 失败时保留当前 Stage 为未完成，记录错误和恢复入口；不要把后续项标为完成。
7. 用户说“继续”时不得重建计划或从头执行；先按以上规则恢复。

## 结构化确认

- 客户端支持结构化问题时，Gate 1 和 Gate 2 必须先发送完整可见计划，再调用客户端提供的结构化提问工具创建选择控件。引用验真的首次 Consent 例外：只发送 `verification-consent` 规定的普通用户披露和“继续/取消”，不得创建结构化控件或可见 VERIFY 清单。
- 结构化问题的选项必须覆盖当前 Stage 的全部合法分支，并使用与可见文字一致的明确标签。调用控件不等于用户确认；收到新的选择事件前不得执行网络、上传、来源查询或计费操作。
- 客户端不支持结构化提问工具时，才退回纯文本提问，并等待新的明确用户消息；不得假设其他客户端的交互状态字段存在。
- API Key、OAuth token、转换服务 key、本地会话口令、pending device code 或其他凭据的值永远不得写入回复、TODO、Task 描述、结构化问题、文件名、日志或报告；只有 `auth status` 明确输出 `Not logged in.` 才按上面的单次登录流程恢复。

## 通用运行规则

- 构造命令前读取 [CLI 参考](cli.md)，使用其中的当前命令和显式标志。
- 从已安装 Skill 目录运行上方对应平台的二进制；通过终端工具的工作目录参数定位，不在命令中嵌入 `cd`。
- 先保存当前客户端任务工作区的绝对路径；所有运行产物显式写入该工作区，不写入 Skill 包。
- Skill 包只读；不修改说明、二进制或 Agent 记忆，不读取 `.env`、Shell 历史、Keychain 寻找凭据。
- 本 Skill 只使用 `login` 的普通本地 session 文件作为用户认证入口；不得把 API Key、许可证文件或 legacy 模式作为恢复建议。
- 缺少 JWT 会话时由 Agent 执行 `login` 并交付验证链接；用户完成后由 Agent 执行一次 `auth status` 并自动恢复原任务。不要要求用户粘贴 Key、token、许可证内容或认证配置。
- 搜索执行遇到 HTTP 401/403/409/422/503、余额、配给、计费或来源授权错误时，**不得读取、检查、展示或分析 `job.json`、`runner.py`、`.env` 或 session JSON；不得推断或展示请求端点、URL、Header、Bearer、key 或 token；不得执行 curl 或直接请求服务端点。**只保留当前 Stage 与工作区，简短说明“本次检索未完成，请稍后重试”并停止。
- 授权、权限、版本、计费或转换服务 HTTP 401/403/409/422/503 错误不可绕过，也不得解释成登录失效。保持当前 Stage 和工作区，给出简短可恢复状态并停止；只有另行执行的 `auth status` 明确输出 `Not logged in.` 才允许开始一次新的登录。
- 不编写临时解析、检索或 HTML 报告脚本绕过 CLI；不要复用其他运行的结果或报告。
- 提出 Gate、Consent 或范围选择后立即停止当前轮；初始请求、TODO、沉默或 Agent 自述都不是批准。

## 资源按需读取

- 只在当前 Stage 明确要求时读取 `references/` 中对应 schema 或输出示例。
- 截图或 Markdown 参考文献输入只在 `verification-consent` / `verification-context` 读取 `references/pasted-reference-input-example.md`；确认前不创建正式 JSON。
- 遇到命令、授权、转换、来源、产物或客户端超时失败时，先读取 [失败恢复图](references/failure-recovery.mmd)，按错误类型进入停止、修复或恢复分支；不要自行发明替代路径。
- 不同时读取两个工作流的 Stage，也不用入口摘要替代 Stage 文件。
- `references/demo-playwright-plan.json` 只用于需要计划示例的检索任务。
- `references/verification-example.json` 只用于解释或校验验真 JSON。
