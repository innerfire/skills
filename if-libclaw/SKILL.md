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

### 入口与会话判定

每个新的文献检索任务都必须先经过 `search-auth`（`SEARCH-0`）认证前置 Gate；每个新的引用验真任务都必须先经过 `verification-auth`（`VERIFY-0`）认证前置 Gate。先在当前 Skill 目录执行一次对应平台的 `auth status`。这两个 Gate 不创建工作区、计划或 TODO，不读取验真文档、不访问检索/来源/转换服务，也不产生计费。会话确认后才进入检索计划或验真影响披露。

| 本次 CLI 输出或事件 | 下一步 | 必须停止的位置 |
|---|---|---|
| `Logged in.` | 复用会话，进入当前 Stage 的后续步骤；CLI 在需要时续期 | 不再生成验证链接 |
| `Not logged in.` | 按下表执行一次 `login`，展示原样验证链接，等待“已完成” | 用户确认之前 |
| `login` 直接返回 `Logged in.` | 继续原 Stage，不编造链接、不提问“已完成” | 仍须遵守业务 Gate/Consent |
| 用户选择或回复“已完成” | 只执行一次 `auth status`，成功才恢复原 Stage | pending、denied、expired 或不能确认会话时 |
| `AUTH_SESSION_REQUIRED` | 先执行一次 `auth status`；明确 `Not logged in.` 才进入单次登录 | 不凭业务错误猜测登录状态 |
| 401/403/409/422/503、余额、配给、计费、版本或来源错误 | 保留当前 Stage 和产物，按原 Stage 报告安全状态 | 不重新登录、不换凭据、不直接请求服务 |

`auth status` 同时包含 `Logged in.` 和 `AUTH_STATUS_LOOKUP_FAILED` 时，会话状态与账户查询失败分开处理：不得重登、不得声称取得余额。认证 Gate 的首次预检按会话状态通过；用户网页登录并回复“已完成”后的单次复查若发生该错误，仍按原认证 Stage 暂停；已生成报告的最终交付仍可保留报告，余额标为未知。其他状态查询错误只报告安全状态并停止。

### 当前平台登录命令

默认采用授权码 + PKCE。CLI 是公开客户端，不接收 client secret，不要求终端输入账号密码，也不显示默认设备确认码。执行前按“平台二进制”选定原生命令；所有 Stage 的 `login` 示例都按本表替换，不在 Windows 执行 Unix `env -u`。

| 平台 | 从 Skill 工作目录运行 |
|---|---|
| macOS arm64 | `env -u LIBCLAW_OIDC_ISSUER -u LIBCLAW_OIDC_CLIENT_ID -u LIBCLAW_OIDC_AUDIENCE ./if-libclaw login` |
| macOS Intel / Linux | 使用同一组 `env -u`，把可执行文件替换为上方对应平台的原生二进制 |
| Windows | `powershell.exe -NoProfile -Command "Remove-Item Env:LIBCLAW_OIDC_ISSUER,Env:LIBCLAW_OIDC_CLIENT_ID,Env:LIBCLAW_OIDC_AUDIENCE -ErrorAction SilentlyContinue; & '.\if-libclaw.exe' login"` |

这些命令只在本次子进程中清除三项旧开发覆盖，使用随包公开配置，不改写用户持久配置。明确标注字段名的部署覆盖按部署配置处理；不得猜测未标注值的用途，不得尝试、转述或写入不明确的秘密值。CLI 显示链接后退出；浏览器与 CLI 应位于同一台电脑，回调或端口错误按安全错误停止，不自动切换登录协议。

### 🔴 CHECKPOINT · 等待“已完成”

从本次输出读取 `Verification URL:`，逐字展示，不拼接、缩短或改写。用户可见回复采用以下模板，不附加故障分析、身份服务品牌、认证参数或“是否现在启动”问题：

```text
验证链接：[打开验证页面](<Verification URL>)

操作示例：

1. 打开验证链接。
2. 在网页中登录并完成授权。
3. 回到这里回复“已完成”。
```

展示后立即调用客户端可用的 HITL 工具（`AskUserQuestion` 或等价工具），唯一完成动作是“已完成”，然后停止等待；没有 HITL 工具时，等待新的用户对话回复。网页回调、`Login pending.`、TODO 或 Agent 自述都不代表用户确认。用户确认后只查一次状态，不能在同一轮重新 `login`；只有用户明确要求“重新登录”才开始新一轮。登录确认不等于检索 Gate 1、Gate 2 或验真 Consent 的批准。

只有远程终端明确采用 `login --method device`，且本次 CLI 实际返回 `User code:` 时，才另附“用户代码：`<User code>`”，并在第 2 步说明输入该代码。不得为修复网页回调错误自行选择设备授权。

### 会话路径与禁止事项

- 所有平台都使用普通本地 JSON session 文件，默认在当前二进制旁的 `./.libclaw/session.json`。不要求 Keychain、Secret Service、D-Bus、TTY、口令或特定文件权限；不安装、修复凭据服务。所有命令从同一个 Skill 目录运行，不用 `cd` 串接目录。
- 普通调用不设置 `LIBCLAW_AUTH_SESSION_FILE`；测试或多账号隔离确需覆盖时，全部相关命令共用同一个稳定绝对路径，不用每次变化的临时目录。
- Agent 只能通过 CLI 查询身份、配给与余额。不得读取 session JSON、提取 token、构造 Authorization header，或用 curl/HTTP 客户端直连计费、Telemetry、转换或来源服务；CLI 内部使用 Bearer 不代表 Agent 可以提取凭据。
- 不读取、转述、搜索或回退到 API Key、`libclaw.license`、旧 Skill、下载目录、`.env`、Shell 历史或其他凭据。`legacy_api_key` 仅供内部兼容，不是用户恢复路径。
- 不得向用户展示 scope、entitlement、license 文件路径、旧格式兼容性或身份服务品牌；此规则覆盖所有认证回复和错误恢复，不只限于登录模板。
- 认证恢复只问网页登录后的“已完成”；不询问认证配置、API Key、许可证或本地口令，不向回复、TODO、问题、文件名、日志或报告写入秘密值。原工作流的独立业务确认仍按 Stage 执行。
- `auth logout` 清理本地会话；`login`、`auth status`、`auth logout` 均不自动创建身份、组织、钱包、配给或充值。

### 任务余额记录

仅在业务 Gate/Consent 已获准、任务工作区已创建后，第一次业务操作前执行一次 `auth status --billing-start "$TASK_WORKSPACE"`。首次余额包括失败记录都不随恢复或重检覆盖。完成报告和原任务完成命令后，交付前执行一次 `auth status --billing-finish "$TASK_WORKSPACE"`，CLI 等待 1 秒后查询并计算“首次余额 − 完成后余额”；这两条命令本身不扣款。

只读当前任务根目录的安全 `billing-summary.json`：`source=balance_difference` 且 `status=observed` 时使用非负 `consumedCredits`，0 有效；无基线、查询失败、账户不一致或负差值显示“暂不可用”。本次查询成功的 `Remaining credits` 独立展示，不因费用未知隐藏余额。不使用 `chargedCredits`、钱包流水、标价或其他任务补写消耗；不为费用未知追加轮询、重跑业务或创建新扣费事件。余额差记录不是正式交付物，不链接或回显内部文件。


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
| `search-auth` | [STAGE.md](stages/search-auth/STAGE.md) | `auth status` 已确认会话；交付链接后仍停留本 Stage 等待确认。 |
| `search-plan` | [STAGE.md](stages/search-plan/STAGE.md) | 计划可解析且 Gate 1 后收到新的明确确认 |
| `search-execute` | [STAGE.md](stages/search-execute/STAGE.md) | 当前计划的检索完成，且 Gate 2 后收到用户选择 |
| `search-report` | [STAGE.md](stages/search-report/STAGE.md) | 当前结果的 QC 与 CLI 报告实际存在并通过检查 |
| `search-delivery` | [STAGE.md](stages/search-delivery/STAGE.md) | 只交付当前任务的已验证产物 |

### 引用验真

文档输入：`verification-auth` → `verification-consent` → `verification-context` → `verification-batch` → `verification-run` → `verification-delivery`

已粘贴的参考文献列表/单条引用：`verification-auth` → `verification-consent` → `verification-context`（生成已确认的 `reference-input/v1`，不调用转换服务）→ `verification-run` → `verification-delivery`

| Stage | 文件 | 完成依据 |
|---|---|---|
| `verification-auth` | [STAGE.md](stages/verification-auth/STAGE.md) | `auth status` 已确认会话；交付链接后仍停留本 Stage 等待确认。 |
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
