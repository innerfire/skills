# if-libclaw CLI

`if-libclaw` 是 RuntimeHub 的 Go 运行时二进制文件。

```bash
# 直接运行
if-libclaw <command> [flags]

# 或通过 go run
./if-libclaw <command> [flags]
```

支持的命令：`login`、`auth status`、`auth logout`（或 `logout`）、`probe`、`check-runtime`、`prepare`、`execute`、`complete-search`、`reference-context`、`validate-reference-batch`、`verify-references`、`check-reference-acceptance`、`query-references`、`generate-report`、`aggregate-report`、`launch-browser`

---

## 命令

### `login`、`auth status` 与 `auth logout`

客户端 HITL 工具名以 `SKILL.md` 为准：`AskUserQuestion` 的同名示例均可替换为等价结构化工具，无此能力则等待新的对话回复。首次会话预检若已 `Logged in.`，可选账户查询失败不触发重登；用户网页确认后的复查若有 `AUTH_STATUS_LOOKUP_FAILED`，按认证 Stage 暂停；已完成报告的最终交付则可继续交付，未知余额如实显示。

CLI 使用发行版内置的公开客户端配置。`login` 默认使用 OAuth 2.0 Authorization Code + PKCE（S256）打开网页登录。已有有效 Token 时直接输出 `Logged in.`，不重新授权；Token 临近到期先自动续期。缺少会话或 refresh token 已明确失效时才创建网页登录，临时网络或服务错误不会清空会话或自动重登。

CLI 先启动仅监听 `127.0.0.1:18451` 的短时回调进程，打印 `Verification URL:`，尝试打开本机浏览器，然后立即退出。浏览器不可自动打开时，Agent 仍展示该链接供用户点击。网页完成登录和授权后显示“网页授权已完成，请返回任务回复‘已完成’”；回调不会向网页返回 Token，也不会自动恢复业务任务。

Agent 必须展示验证链接与三步操作示例，随后调用 HITL 工具 `AskUserQuestion` 等待“已完成”。用户确认后只执行一次 `auth status`，由 CLI 交换授权码、保存会话并确认 `Logged in.` 后恢复任务。默认没有设备确认码；只有显式 `--method device` 的远程终端兼容流程才显示本次返回的 `User code:`。CLI 是公开客户端，不接收 client secret。

```bash
./if-libclaw auth status
# 只有 Not logged in. 时：
./if-libclaw login
# 网页授权完成，并回复/选择“已完成”后：
./if-libclaw auth status
./if-libclaw auth logout
```

| `login` 标志 | 默认值 | 环境变量覆盖 | 说明 |
|---|---|---|---|
| `--issuer` | *（随包内置）* | `LIBCLAW_OIDC_ISSUER` | 仅供部署覆盖。 |
| `--client-id` | *（随包内置）* | `LIBCLAW_OIDC_CLIENT_ID` | 内置公开/native client ID；仅供部署覆盖。 |
| `--audience` | *（随包内置）* | `LIBCLAW_OIDC_AUDIENCE` | 内置 access token audience；仅供部署覆盖。 |
| `--scopes` | `openid profile email offline_access` | — | OIDC scopes，`offline_access` 用于续期。 |
| `--method` | `browser` | — | `browser` 为授权码 + PKCE；`device` 供明确需要的远程终端兼容使用。 |
| `--callback-port` | `18451` | — | 本机回调端口，需与管理员登记的 URI 完全一致。 |
| `--no-open` | `false` | — | 仅显示链接，不自动打开浏览器。 |

管理员在对应公开客户端应用启用 **Authorization Code**、**Refresh Token**，登记精确回调 URI `http://127.0.0.1:18451/callback`。修改端口后也须登记对应 URI；端口占用返回 `OIDC_CALLBACK_PORT_BUSY`，不得自动改用未登记地址。浏览器与 CLI 必须运行在同一台电脑；SSH/容器使用者需要管理员明确选择兼容流程。PKCE 默认流程不需要登录页的 Device login 入口。

这里的 scopes 用于 OIDC 登录协议，不是运行时业务权限，不要求普通用户填写认证配置。登录、续期和状态查询都不创建计费事件。

#### 运行时认证模式

对发起运行时 telemetry 授权的命令，`LIBCLAW_AUTH_MODE` 精确接受以下值；未设置时使用 JWT。未知值会以 `AUTH_MODE_INVALID` 失败。

| 值 | 默认 | 运行时授权行为 |
|---|---|---|
| 未设置或 `jwt` | 是 | 加载本地可续期登录会话；会话缺失、损坏或不可用时以 `AUTH_SESSION_REQUIRED` 失败。遥测请求只发送 `Authorization: Bearer <access-token>` 和 `auth_mode=jwt`，JSON body 中不会有 `api_key`。 |
| `legacy_api_key` | 否，兼容模式 | 需要 API Key，并发送 `auth_mode=legacy_api_key` 与 `api_key`。 |

`jwt` 模式不会读取旧 API Key 来源作为回退；即使调用方提供 `--api-key`，该值也不会被用于运行时遥测授权或外部服务。令牌临近到期时会用 refresh token 续期并安全保存新会话。`LIBCLAW_AUTH_REFRESH_SKEW_SECONDS` 未设置时为 `60` 秒；显式值必须是 `30` 到 `300` 的十进制整秒，否则以 `AUTH_REFRESH_SKEW_INVALID` 失败。不会静默改用 API Key。

#### 本地会话存储

所有平台使用同一个普通本地 JSON session 文件。它不要求 Keychain、Secret Service、Credential Manager、TTY、口令或特定文件权限；`login`、`auth status`、自动 refresh 与业务命令始终使用同一路径。默认路径固定为当前二进制旁的 `.libclaw/session.json`，从同一个 Skill 目录运行时无需设置 `LIBCLAW_AUTH_SESSION_FILE`。该变量只用于测试或多账号隔离，并且必须是由全部相关命令共同使用的稳定绝对路径。为兼容已有部署，`LIBCLAW_AUTH_METADATA_FILE` 和 `LIBCLAW_AUTH_PLAINTEXT_FILE` 也会被视为 session 文件路径；`LIBCLAW_AUTH_CIPHERTEXT_DIR` 不使用。

`LIBCLAW_AUTH_STORE` 的 `platform`（默认）、`passphrase_file` 与 `plaintext_file` 值均选择这一个普通文件实现；不会出现交互确认或口令提示。未知值仍返回 `CREDENTIAL_STORE_UNAVAILABLE`。旧 `LIBCLAW_AUTH_FILE` 和 `LIBCLAW_AUTH_LEGACY_FILE` 不会被自动读取或迁移。

#### 状态、退出与配给

`auth status` 支持互斥的 `--billing-start <任务绝对路径>` 与 `--billing-finish <同一任务绝对路径>`；不带标志时不写计费记录。前者记录首个余额，后者等 1 秒后计算差值，均不扣款。

`auth status` 先验证本地 Token 可用性并在需要时续期；确实没有可用会话时输出 `Not logged in.`。若网页登录尚无回调，输出 `Login pending.`；回调已完成时单次交换授权码。显式设备授权仍单次检查状态。否则由 CLI 在内部使用 Bearer access token 查询账户状态，并显示非秘密的登录状态、到期时间、身份、组织、配给、`Remaining credits` 和可选 `Pending credits`；wallet 总额不是用户可用余额，不会作为余额展示。CLI 不会打印 access、refresh、ID token 或 device code。`LIBCLAW_CATALOG_BILLING_URL` 仅供部署覆盖；`LIBCLAW_CATALOG_BILLING_TIMEOUT_SECONDS` 默认 `5` 秒，可设置为 `1` 到 `30`。`Provisioning: not provisioned` 只是状态报告：`login`、`auth status` 和运行时不会自动创建组织、账户、credit 或任何配给记录。

Agent 仅可调用本 CLI 查询上述状态；不得读取 session 文件取得 token、构造 Bearer 请求，或用 curl/其他 HTTP 客户端直接调用 Catalog-Billing。`AUTH_STATUS_LOOKUP_FAILED` 表示 CLI 未能完成可信状态查询，必须原样报告并停止；不得以旁路请求替代该结果或宣称余额已确认。

`auth logout`（或 `logout`）会通过 OIDC discovery 尽力通知 provider，然后无论远端结果如何都删除本地正式会话和待授权状态和短期回调结果；远端退出失败只会产生警告。远端调用只使用 client ID 和 refresh token，不发送 access 或 ID token。

#### JWT rollout 与当前限制

CLI 未设置认证模式时使用 JWT。生产 Telemetry 设置 `LIBCLAW_JWT_AUTH_ENABLED=true`、`LIBCLAW_JWT_BILLING_MODE=external_usage_events` 与 `LIBCLAW_JWT_BILLING_ENABLED=false`；转换与 Google Scholar 设置 `LIBCLAW_DIRECT_USAGE_EVENTS_ENABLED=false`。完整工作流只在 Telemetry 的最终 finish-run 提交一次 usage event；上述 billing false 关闭旧 reservation 路线，不关闭最终结算。

在该部署就绪后，`probe`、`prepare`、`execute` 和引用验真命令会用 Bearer 走 canonical runtime 授权路径；JWT 模式跳过旧的 API-key skill-version/scope 查询，由 `authorize-run` 返回的策略决定。`check-runtime` 仍可运行本地检查，但不会在 JWT 模式中做旧 API-key 版本查询。

`generate-report` 与 `aggregate-report` 是纯本地报告命令，不请求 telemetry、不读取 API Key，也不产生计费。转换服务、Google Scholar 和 OpenAlex 都使用当前登录会话的 Bearer；不会发送、读取或回退到旧 if-libclaw API Key、converter key 或 Scholar key。一次完整引用验真只在最终 `verify-references` 成功报告的 finish-run 结算 1 个 `libclaw_verification / verification_run` usage event；转换、来源查询与重试不单独记账。一次完整文献检索只在全部来源结果已终态且完成交付时，由 `complete-search` 结算 1 个任务级 usage event；逐库 `execute`、报告生成与重试不单独记账。

用户可见的本次消耗使用任务前后余额差，不依赖 `chargedCredits` 或钱包流水回执。在 Gate/Consent 已确认、任务工作区已创建后、第一次业务操作前执行 `auth status --billing-start "$TASK_WORKSPACE"`，CLI 将首次账户与余额保存为私有基线。完成扣费与报告后执行 `auth status --billing-finish "$TASK_WORKSPACE"`，CLI 等待 1 秒后查询余额，并将“首次余额 − 完成后余额”写为根目录 `billing-summary.json` 的 `consumedCredits`，`source=balance_difference`、`status=observed`；0 是有效值。两次余额缺失、账户不同或差值为负时显示 unavailable。首次基线和已经生成的有效差值不随恢复重算。摘要不含凭据、钱包 ID 或内部地址；最终余额独立采用本次成功查询值。并发消费或充值会影响余额差，因此它是任务时间范围内的余额变化，不是逐笔账单金额。旧完成命令产生的回执摘要仅是内部兼容产物，交付时不采用它计算本次消耗。

只有 `auth status` 明确输出 `Not logged in.` 时，Agent 才执行一次 `login`，交付验证链接和操作示例（仅显式设备授权实际返回用户代码时附上），并调用 `AskUserQuestion` 等待“已完成”。业务命令返回 `AUTH_SESSION_REQUIRED` 时先在同一 Skill 目录执行一次 `auth status`；只有该检查明确输出 `Not logged in.` 才进入登录流程。HTTP 401/403/422/503、余额、配给、计费、版本或下游服务错误都不得触发 `login` 或生成新的验证链接。

---

### `probe`

验证遥测控制面生命周期（授权 → 心跳 → 完成），**不执行**实际搜索任务。

```bash
./if-libclaw probe \
  --api-key "$LIBCLAW_API_KEY" \
  --databases openalex,cnki \
  --max-results 5
```

| 标志 | 默认值 | 环境变量覆盖 | 说明 |
|------|--------|-------------|------|
| `--api-key` | *（legacy_api_key 模式必填）* | `LIBCLAW_API_KEY` | legacy 模式的授权 API Key；`jwt` 模式使用本地会话，不读取或发送此值。 |
| `--telemetry-url` | `https://libclaw.innerfire.ai:22943` | `LIBCLAW_TELEMETRY_URL` | 遥测服务地址 |
| `--skill-version` | `0.3.7` | `LIBCLAW_DEV_VERSION` | 运行时版本标签 |
| `--installation-id` | `runtime-probe` | `LIBCLAW_INSTALLATION_ID` | 安装标识 |
| `--machine-id` | *（主机名）* | `LIBCLAW_MACHINE_ID` | 机器标识 |
| `--databases` | `openalex` | — | 逗号分隔的数据库 ID |
| `--max-results` | `5` | — | 请求的最大结果数 |
| `--concurrent-pages` | `1` | — | 请求的并发页数 |
| `--stage` | `runtime_probe` | — | 心跳阶段标签 |

---

### `check-runtime`

检查本地运行时环境：Python、Python 包、浏览器可用性、内存。输出推荐并发数。

```bash
./if-libclaw check-runtime
```

| 标志 | 默认值 | 环境变量覆盖 | 说明 |
|------|--------|-------------|------|
| `--python-bin` | `python3` | `PYTHON_BIN` | Python 可执行文件路径 |
| `--json` | `false` | — | 输出机器可读的 JSON 摘要 |
| `--api-key` | *（legacy_api_key 模式可选）* | `LIBCLAW_API_KEY` | 仅 legacy 模式提供时查询本地 skill 版本；`jwt` 模式跳过该 API-key 查询。 |
| `--telemetry-url` | `https://libclaw.innerfire.ai:22943` | `LIBCLAW_TELEMETRY_URL` | 遥测服务地址 |
| `--skill-version` | `0.3.7` | `LIBCLAW_DEV_VERSION` | 本地 skill 版本标签 |

**输出示例：**

```
== if-libclaw Runtime Check ==
python3: Python 3.12.3
python executable: python3
python packages: OK (httpx, beautifulsoup4, playwright, websockets)
node: FOUND
npx: FOUND
browser: FOUND at /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
memory: 16.0 GiB
recommended concurrent pages: 2
ACTION: runtime looks usable.
```

**状态值：** `ok`、`missing_python`、`missing_python_packages`、`missing_browser`

**修复建议：**

- `missing_python` → 安装 Python 3.10+
- `missing_python_packages` → `python3 -m pip install <包名>`；浏览器数据库只需要 Playwright Python 包，不需要执行 `playwright install chromium`
- `missing_browser` → 安装 Chrome/Chromium，或设置 `E2E_REMOTE_CDP_HTTP` / `LIBCLAW_REMOTE_CDP_HTTP`

若 Python 包下载较慢，可在当前 shell 临时设置部署环境提供的 PyPI 镜像：

```bash
export PIP_INDEX_URL="https://<your-pypi-mirror>/simple"
```

`check-runtime` 只提醒这些配置，不会自动修改源或安装依赖。

在 `legacy_api_key` 模式提供 `--api-key` 时，`check-runtime` 会调用 canonical 端点 `/v1/runtimes/search/skill-version` 获取平台推荐版本；服务端仍兼容旧 `/v1/libclaw/skill-version`。`jwt` 模式不会把登录会话转换成该 API-key 查询。状态为 `update_recommended` 时只提示升级；状态为 `update_required` 时，执行型命令会阻断并输出平台返回的 `upgradeGuideUrl`。

当前公开命令名为 `if-libclaw`；为兼容已部署的服务，控制平面的 canonical 身份沿用以下标识：

- 文献检索：`product_type=search`、`product_instance=libclaw-dev`
- 引用验真：`product_type=verification`、`product_instance=libclaw-dev`

---

### `prepare`

准备运行时工作区：验证遥测访问、加载 plan 文件、选择数据库适配器，生成 `job.json` + `runner.py`。**不执行** Python 运行器。

```bash
./if-libclaw prepare \
  --api-key "$LIBCLAW_API_KEY" \
  --plan-file references/demo-playwright-plan.json
```

| 标志 | 默认值 | 环境变量覆盖 | 说明 |
|------|--------|-------------|------|
| `--api-key` | *（legacy_api_key 模式必填）* | `LIBCLAW_API_KEY` | legacy 模式的授权 API Key；`jwt` 模式使用本地会话，不读取或发送此值。 |
| `--telemetry-url` | `https://libclaw.innerfire.ai:22943` | `LIBCLAW_TELEMETRY_URL` | 遥测服务地址 |
| `--skill-version` | `0.3.7` | `LIBCLAW_DEV_VERSION` | 运行时版本标签 |
| `--installation-id` | `runtime-prepare` | `LIBCLAW_INSTALLATION_ID` | 安装标识 |
| `--machine-id` | *（主机名）* | `LIBCLAW_MACHINE_ID` | 机器标识 |
| `--plan-file` | *（必填）* | — | Plan JSON 文件路径 |
| `--databases` | *（从 plan 读取）* | — | 逗号分隔的数据库覆盖 |
| `--workspace-dir` | `./runs` | `LIBCLAW_WORKSPACE_DIR` | 运行时产物输出目录 |
| `--max-results` | `5` | — | 请求的最大结果数 |
| `--concurrent-pages` | `1` | — | 请求的并发页数 |
| `--stage` | `runtime_prepare` | — | 心跳阶段标签 |

**输出：**

```
[runtime-prepare] workspace=/tmp/... job=/tmp/.../job.json runner=/tmp/.../runner.py finish_status=completed
```

`prepare` 会向控制平面发送 `product_type=search` 与 `product_instance=libclaw-dev`，并优先读取返回的 `effectiveConstraints.search.databases` 作为数据库授权结果。

---

### `execute`

完整端到端流程：准备工作区 → 启动生成的 Python 运行器 → 等待完成 → 将 `results.json` 读回 Go。每次 `execute` 仅完成一个来源的中间检索，不产生最终计费；全部来源完成、Gate 2 后的交付由 `complete-search` 统一结算。`report.html` 不在 `execute` 阶段自动生成；它只在 Gate 2 确认保留当前范围后，由 `generate-report` 或 `aggregate-report` 创建。

```bash
./if-libclaw execute \
  --api-key "$LIBCLAW_API_KEY" \
  --plan-file references/demo-playwright-plan.json \
  --databases openalex,cnki \
  --timeout-seconds 120
```

| 标志 | 默认值 | 环境变量覆盖 | 说明 |
|------|--------|-------------|------|
| `--api-key` | *（legacy_api_key 模式必填）* | `LIBCLAW_API_KEY` | legacy 模式的授权 API Key；`jwt` 模式使用本地会话，不读取或发送此值。 |
| `--telemetry-url` | `https://libclaw.innerfire.ai:22943` | `LIBCLAW_TELEMETRY_URL` | 遥测服务地址 |
| `--skill-version` | `0.3.7` | `LIBCLAW_DEV_VERSION` | 运行时版本标签 |
| `--installation-id` | `runtime-execute` | `LIBCLAW_INSTALLATION_ID` | 安装标识 |
| `--machine-id` | *（主机名）* | `LIBCLAW_MACHINE_ID` | 机器标识 |
| `--plan-file` | *（必填）* | — | Plan JSON 文件路径 |
| `--databases` | *（从 plan 读取）* | — | 逗号分隔的数据库覆盖 |
| `--workspace-dir` | `./runs` | `LIBCLAW_WORKSPACE_DIR` | 运行时产物输出目录 |
| `--python-bin` | `python3` | `PYTHON_BIN` | Python 可执行文件路径 |
| `--max-results` | `5` | — | 请求的最大结果数 |
| `--concurrent-pages` | `1` | — | 请求的并发页数 |
| `--timeout-seconds` | `60` | — | 运行器超时秒数 |
| `--stage` | `runtime_execute` | — | 心跳阶段标签 |

**输出：**

```
[runtime-execute] workspace=/tmp/... status=completed papers=5 stdout="..."
```

成功执行后，当前运行工作区至少包含 `results.json`。若 Gate 2 需要确认，在用户选择“保留当前范围，直接生成报告”前，不要声称 `report.html` 已存在。

---

### `complete-search`

在所有计划来源都已有终态 `results.json`、并且 Gate 2 已决定交付方式后执行一次。它是搜索任务唯一的最终结算入口：重复执行同一个任务会复用稳定的完成标识，服务端据此保持幂等；不得按数据库分别结算；消费展示交由上述任务级余额记录命令计算。

检索和引用验真的最终结算响应成功但消费回执仍不可用时，CLI 等待 1 秒，再用同一个 run token 和原请求重试一次。已获得有效消费回执时不等待；重试仍无金额时保留安全状态，不推算费用。

完整报告交付：

```bash
./if-libclaw complete-search \
  --task-workspace "$TASK_WORKSPACE" \
  --plan-file "$PLAN_FILE" \
  --delivery report \
  --report-path "$REPORT_HTML"
```

仅交付原始结果：

```bash
./if-libclaw complete-search \
  --task-workspace "$TASK_WORKSPACE" \
  --plan-file "$PLAN_FILE" \
  --delivery raw-results
```

| 标志 | 默认值 | 环境变量覆盖 | 说明 |
|------|--------|-------------|------|
| `--task-workspace` | *（必填）* | — | 当前搜索任务工作区；其中必须包含每个计划来源的终态结果。 |
| `--plan-file` | *（必填）* | — | 当前任务计划 JSON。 |
| `--delivery` | *（必填）* | — | `report` 或 `raw-results`。 |
| `--report-path` | `<task-workspace>/report.html` | — | `--delivery report` 时必须指向已生成的报告。 |
| `--telemetry-url` | *（随包配置）* | `LIBCLAW_TELEMETRY_URL` | 仅供部署覆盖。 |
| `--skill-version` | 命令内置版本 | `LIBCLAW_DEV_VERSION` | 运行时版本标签。 |
| `--installation-id` | `runtime-complete-search` | `LIBCLAW_INSTALLATION_ID` | 安装标识。 |
| `--machine-id` | *（主机名）* | `LIBCLAW_MACHINE_ID` | 机器标识。 |

成功后，任务根目录会有安全的计费摘要，供 Skill 在最终交付时显示“本次消耗”和“余额”。它不是报告交付物，也不应直接展示给用户。

---

### `reference-context`

将单个论文转换为仅供当前验真任务使用的页级文本上下文 JSON。它复用转换服务和 `citation.verify` 授权，但**不**创建 `runs/` 工作区，也不将全文发送到 telemetry。`--output` 必填，文件以仅当前用户可读写的权限写入；为避免转换后的论文文本进入终端、Agent 回复或日志，CLI 禁止写入 stdout。它不自动拆分参考文献、不访问 CNKI/Google Scholar，也不产生验真结论。

在执行前，调用方必须说明转换后的论文文本、页码和 block ID 将返回给当前 Agent/LLM
整理参考文献，并获得明确同意。

```bash
./if-libclaw reference-context \
  --input "$PAPER_FILE" \
  --pages 9-11 \
  --output ./reference-context.json
```

| 标志 | 默认值 | 说明 |
|---|---|---|
| `--input` | *（必填）* | 单个 `.doc`、`.docx` 或 `.pdf` |
| `--pages` | *（全部）* | 可选闭区间，如 `9-11`；输出保留原始页码 |
| `--output` | *（必填）* | 任务工作区 JSON 输出路径；禁止省略或写入 stdout |
| `--converter-url` | `https://libtools.innerfire.ai:22943/converter` | 转换/OCR 服务地址；可用 flag 或环境变量覆盖 |
| `--api-key` | *（legacy_api_key 模式必填）* | legacy 模式需要 `citation.verify` scope；`jwt` 不发送 API Key。已部署的 direct JWT 转换服务使用本地会话 Bearer。 |
| `--timeout` | `30m` | 总超时（Go duration） |

输出版本为 `reference-query/v1`，包含文档 SHA-256、文件类型、页数、OCR 元数据、每页
文本以及块/段落 ID、类型、坐标和页码。每页 `text_block_id` 是完整页文本的稳定
provenance anchor，通常为 `page-N-text`；batch 的 `locations.block_id` 可直接使用它，
无需复制整页文本或猜测低层 block。

Agent 只能依据该输出生成任务工作区内的 `reference-batch.json`，不得在整理阶段查询来源或下结论。

在默认 `legacy_api_key` 模式，引用验真最小配置只需要 `LIBCLAW_API_KEY` 加服务 URL；转换服务使用该主 key，由控制平面在线核验 `citation.verify`，Google Scholar 未配置专用 key 时也复用它。`jwt` 模式不复用该 key，也不把 OAuth access token 转发给转换或来源服务；其当前限制见上文。

### `validate-reference-batch`

本地检查 Agent 生成的 `reference-batch.json`。它不需要 API Key，不授权、不创建
workspace，也不访问转换服务或任何来源。

```bash
./if-libclaw validate-reference-batch \
  --input ./reference-batch.json \
  --context ./reference-context.json \
  --output ./reference-batch.validation.json
```

| 标志 | 默认值 | 说明 |
|---|---|---|
| `--input` | *（必填）* | `reference-query/v1` 中间文件 |
| `--context` | *（主流程必填）* | 对应的 `reference-context.json`；绑定 SHA、参考文献页、block 和原文 |
| `--output` | stdout | 可选 owner-only 检查结果 JSON |
| `--batch-limit` | `100` | 单批最大条数 |

结果包含 `valid`、`context_validated`、`contract_version`、`reference_count` 和
`issues[].code/path/message`；当 `raw_text` 与 context 不一致且可精确定位条目时，
对应 issue 还会返回可直接替换的 `expected_raw_text`。context-bound 检查覆盖严格 JSON、版本、SHA-256、参考文献
起止页和逐页数量、真实 page/block、原文可追溯性、重复/合并条目、批量上限、唯一 ID、
题名、年份、DOI，以及作者或整条书目误作题名。title 包含 `[J]`、`[M]`、`[EB/OL]`
等文献类型或明显混入作者与年份时会被拒绝；单字符、单个英文词或其他明显截断片段返回
`reference_title_too_short`。仍含控制字符、换行或异常空格返回
`reference_title_not_normalized`；全角 Latin/数字/ASCII 标点会在查询边界自动转换；英文词被 OCR 粘成异常长串时返回
`reference_title_likely_missing_spaces`。title 与 OCR 原文的可追溯比较支持全角/半角
宽度归一化，也允许 Agent 恢复正常词间空格并去掉 OCR 跨行断词连字符，但不会改写
`raw_text`。`raw_text` 必须是声明页 `pages[].text` 的逐字连续子串；不得替换控制字符、
折叠换行、转换全角/半角或改写标点，否则返回
`reference_raw_text_not_exact_context_substring`。此时应优先把 `raw_text` 直接替换为
同一 issue 的 `expected_raw_text` 完整 JSON 字符串值，不要人工重打。跨页时按 locations 页序以单个换行连接
相邻页面原文。主流程还要求输入文件名为 `reference-batch.json` 且使用 owner-only 权限。
`valid=false` 时命令退出非零；原子重写同一个中间文件后重新检查。

省略 `--context` 只执行旧的结构检查，属于兼容模式，不能证明参考文献覆盖完整，也不
用于 `stages/verification-batch/STAGE.md` 的标准验真流程。

### `verify-references`

接收两种输入之一并生成最终报告：

- 文档流程中检查通过的 `reference-query/v1` `reference-batch.json`，同时提供 `--context`；
- 用户已确认的截图转录或 Markdown 参考文献 `reference-input/v1`，不提供 `--context`。

命令会在任何授权、workspace 或来源请求前严格检查输入。直接输入通过后，CLI 在 run workspace
派生 owner-only `reference-context.json`、`reference-batch.json` 和
`reference-batch.validation.json`，不联系转换服务；截图 provenance 标记为用户确认的视觉转录，
不宣称 OCR 精确文本。

```bash
./if-libclaw verify-references \
  --input ./reference-batch.json \
  --context ./reference-context.json \
  --sources cnki,google_scholar,openalex,pubmed \
  --workspace-dir ./runs \
  --timeout 45m
```

确认后的 Markdown/截图直接输入：

```bash
./if-libclaw verify-references \
  --input ./reference-input.json \
  --sources cnki,google_scholar,openalex,pubmed \
  --workspace-dir ./runs \
  --timeout 45m
```

| 标志 | 默认值 | 说明 |
|---|---|---|
| `--input` | *（必填）* | 已检查的 `reference-query/v1` batch，或已确认的 `reference-input/v1` |
| `--context` | *（文档流程必填）* | 与 batch 对应的 `reference-context.json`；直接输入时必须省略 |
| `--sources` | `cnki,google_scholar,openalex,pubmed` | 允许 `cnki`、`google_scholar`、`openalex`、`pubmed`。有 DOI/arXiv ID 时优先标识符直查；命中后跳过 CNKI/Google Scholar/PubMed 题名检索 |
| `--workspace-dir` | `runs` | 新验真 workspace 的父目录 |
| `--batch-limit` | `100` | 单批最大条数 |
| `--google-scholar-concurrency` | `4` | Scholar 受限并发。其它源按公开 QPS 内置限速：Crossref 并发 3（~8 rps，polite）、OpenAlex 并发 8、PubMed 并发 5（固定 NCBI key，~10 HTTP rps）、arXiv 串行且间隔 ≥3s、CNKI 串行 |
| `--google-scholar-retry-rounds` | `1` | 首轮后仅补查暂时不可用的 Scholar 条目；`0` 关闭 |
| `--google-scholar-retry-delay` | `10s` | 每轮 Scholar 补查前的冷却时间（非负 Go duration） |
| `--google-scholar-url` | `https://libtools.innerfire.ai:22943` | 选择 Scholar 时的默认服务；可用 flag 或环境变量覆盖 |
| `--google-scholar-api-key` | *（无）* | 仅供 legacy 模式专用覆盖；未提供时复用 `--api-key` / `LIBCLAW_API_KEY`。JWT 模式不读取或发送该 Key，Scholar 请求使用本地会话 Bearer。 |
| `--api-key` | *（legacy_api_key 模式必填）* | legacy 模式需要 `citation.verify` scope；`jwt` 只用于 telemetry Bearer 授权，不会向外部服务发送 API Key。 |
| `--telemetry-url` | `https://libclaw.innerfire.ai:22943` | 控制平面地址 |
| `--timeout` | `30m` | 总超时（Go duration） |

命令在来源配置、授权、计费、workspace 或来源请求前执行 context-bound 检查。省略
`--context` 仅为兼容模式，不属于 Skill 主流程。

每条参考文献、每个来源只使用整理后的 `title`：CNKI 先发送 `TI="title"`；仅当该查询正常完成但返回 0 个候选时，再以从题名中提取的主标题发送 `SU="主标题"`（主题检索，去除 `——` 后的副标题和紧邻的问号或冒号）。Google Scholar 发送裸 `title`；OpenAlex、PubMed 使用对应服务的题名查询。OpenAlex 的检索与 DOI/ID 直查统一发送到 `https://libtools.innerfire.ai:22943/openalex`；legacy 模式使用主 `LIBCLAW_API_KEY`，JWT 模式使用当前登录会话的 Bearer。上游 OpenAlex 凭据只存在于 Libtools。完整引用验真仅在最终报告成功时结算 1 个 `libclaw_verification / verification_run`；转换、来源查询与重试不单独扣费。
CNKI 不使用作者、年份、期刊、卷期页或原始书目进行第二种查询；`evidence.query` 会如实记录 `TI="title" -> SU="主标题"` 的回退路径。篇名查询出现认证、限流、服务或响应错误时不触发主题回退。
发送前会自动对 title 执行全角 ASCII、数字、空格和标点的宽度归一化；不会从 `raw_text`
重新生成或扩展检索式。Google Scholar 服务也会返回 `normalized_query` 作为实际检索式。请求固定 `provider=serperapi`，不使用聚合服务的
`auto` provider 或其他 fallback 来源。

各来源单个请求最多重试三次；首轮结束后，仅 Google Scholar 的网络错误、HTTP 429 或 5xx 的
最终不可用条目会按上述设置串行补查。4xx、配置错误和无效响应不会补查；最终报告只展示
补查后的证据。

通过检查后在 CLI 返回的 workspace 写入 `verification.json`、中文 `report.html` 和便于复制的中文 `report.md`。HTML 与 Markdown 使用同一份结构化验真结果，不调用 LLM。查询期间会在
stderr 打印按来源的进度条（TTY 同行刷新；重定向时改为阶段性日志）。标识符源（crossref/openalex/arxiv）先并行，
题名源（cnki/google_scholar/pubmed）再并行，以便 DOI 命中后跳过题名检索；结束后仍输出 workspace 路径。所有来源
完成时顶层 `completion_status=completed`；来源不可用会保留类型化
`*_unavailable` evidence/warning，将证据不足的条目标为 `unverifiable`，并写出
`completion_status=partial` 的报告，不能描述为完整成功。

### `check-reference-acceptance`

本地用 hash-bound profile 检查客户端 E2E 的实际 context、batch 和验真 JSON。它不需要
API Key，不授权、不计费、不访问网络，也不创建验真 workspace。

```bash
./if-libclaw check-reference-acceptance \
  --profile ./references/reference-acceptance.json \
  --context ./reference-context.json \
  --batch ./reference-batch.json \
  --verification ./runs/<run_id>/verification.json \
  --output ./reference-acceptance.json
```

检查包括 context-bound batch 全部规则、标准文件名与权限、目录中不存在版本/修复 batch
或辅助提取脚本，以及 profile 约束的 SHA、参考文献页、数量、首尾题名和允许的
`completion_status`。结果包含 `valid` 和结构化 `issues[]`；任一断言失败时退出非零。

### `query-references`

兼容的候选查询命令。它接收 `reference-batch.json` 并返回来源候选与 unavailable 状态，
但不执行五状态判定，也不生成 `verification.json`、`report.html` 或 `report.md`。

```bash
./if-libclaw query-references \
  --input ./normalized-references.json \
  --sources cnki,google_scholar,openalex,pubmed \
  --output ./reference-candidates.json \
  --markdown-output ./reference-candidates.md
```

| 标志 | 默认值 | 说明 |
|---|---|---|
| `--input` | *（必填）* | `reference-query/v1` 标准化批次 JSON |
| `--sources` | `cnki,google_scholar,openalex,pubmed` | 允许 `cnki`、`google_scholar`、`openalex`、`pubmed`。有 DOI/arXiv ID 时优先标识符直查；命中后跳过 CNKI/Google Scholar/PubMed 题名检索 |
| `--output` | stdout | 可选候选 JSON 输出路径，建议写入任务工作区 |
| `--markdown-output` | *（无）* | 可选 Markdown 候选链接文件，建议写入任务工作区 |
| `--batch-limit` | `100` | 单批最大条数 |
| `--google-scholar-concurrency` | `4` | Scholar 受限并发。其它源按公开 QPS 内置限速：Crossref 并发 3（~8 rps，polite）、OpenAlex 并发 8、PubMed 并发 5（固定 NCBI key，~10 HTTP rps）、arXiv 串行且间隔 ≥3s、CNKI 串行 |
| `--google-scholar-retry-rounds` | `1` | 首轮后仅补查暂时不可用的 Scholar 条目；`0` 关闭 |
| `--google-scholar-retry-delay` | `10s` | 每轮 Scholar 补查前的冷却时间（非负 Go duration） |
| `--google-scholar-api-key` | *（无）* | 仅供 legacy 模式专用覆盖；未提供时复用 `--api-key` / `LIBCLAW_API_KEY`。JWT 模式不读取或发送该 Key，Scholar 请求使用本地会话 Bearer。 |
| `--google-scholar-url` | `https://libtools.innerfire.ai:22943` | 选择 Scholar 时的默认服务；可用 flag 或环境变量覆盖 |
| `--api-key` | *（legacy_api_key 模式必填）* | legacy 模式需要 `citation.verify` scope；`jwt` 只用于 telemetry Bearer 授权，不会向外部服务发送 API Key。 |
| `--timeout` | `30m` | 总超时（Go duration） |

结果只包含候选；Google Scholar 的暂时不可用条目会在首轮后串行补查，最终仍不可用时才
保留 `unavailable`。两个来源都只使用 `title` 查询，不使用作者或年份扩展检索式。
`stages/verification-run/STAGE.md` 的标准流程使用 `verify-references`。

### `generate-report`

在 Gate 2 确认后，从当前运行工作区中的 `job.json`、`results.json` 和 `qc.json` 渲染 HTML 报告。该命令使用 `if-libclaw` 内置报告模板，不依赖外部 classic `if-libclaw` skill 脚本路径。它完全在本地运行：不需要登录、不读取 API Key、不访问 telemetry，也不计费。

```bash
./if-libclaw generate-report \
  --workspace runs/<run_id>
```

| 标志 | 默认值 | 环境变量覆盖 | 说明 |
|------|--------|-------------|------|
| `--workspace` | *（推荐填写）* | — | 当前运行工作区，例如 `runs/<run_id>` |
| `--job-json` | `<workspace>/job.json` | — | 运行任务 JSON |
| `--results-json` | `<workspace>/results.json` | — | 搜索结果 JSON |
| `--qc-json` | `<workspace>/qc.json` | — | 单库推荐论文和报告内容 JSON |
| `--output` | `<workspace>/report.html` | — | 输出 HTML 报告路径 |

**输出：**

```text
report.html written to: runs/<run_id>/report.html
```

### `aggregate-report`

多库检索的总报告命令。它扫描 `--workspace` 下各数据库子目录中的 `results.json` 渲染“搜索概况/搜索执行情况”，数据库名优先读取同目录 `job.json`，再从汇总级 `aggregate-qc.json` 渲染“推荐论文”。默认严格优先读取 `<workspace>/aggregate-qc.json`；为兼容早期工作流，只有根目录文件不存在时才读取 `<workspace>/aggregate/aggregate-qc.json`。`--qc-json` 始终覆盖这两条默认路径。如果汇总级 QC 文件暂时缺失，命令仍可生成仅含执行结果的总报告；如果某个子目录的 `job.json` 缺失或损坏，该目录会被跳过并在报告中写入 warning。它完全在本地运行：不需要登录、不读取 API Key、不访问 telemetry，也不计费。

```bash
./if-libclaw aggregate-report \
  --workspace runs/<session_id>
```

| 标志 | 默认值 | 环境变量覆盖 | 说明 |
|------|--------|-------------|------|
| `--workspace` | *（推荐填写）* | — | 聚合运行目录，例如 `runs/<session_id>` |
| `--qc-json` | `<workspace>/aggregate-qc.json` | — | 汇总级推荐论文和报告内容 JSON；根目录不存在时兼容 `<workspace>/aggregate/aggregate-qc.json` |
| `--output` | `<workspace>/report.html` | — | 输出总 HTML 报告路径 |

目录结构示例：

```text
runs/<session_id>/
├── aggregate-qc.json          # 可选
├── wos_sci/
│   ├── job.json
│   └── results.json
├── wos_ssci/
│   ├── job.json
│   └── results.json
└── cnki/
    └── results.json           # 若缺失 job.json，则被跳过并记 warning
```

**输出：**

```text
aggregate report.html written to: runs/<session_id>/report.html
```

---

**错误码**（错误信息前缀）：

| 错误码 | 含义 |
|--------|------|
| `python_missing` | 找不到 Python 可执行文件 |
| `playwright_missing` | `import playwright` 失败（浏览器数据库需要） |
| `browser_unavailable` | 配置的远程 CDP 不可用，且未能启动临时本地 Chrome/Chromium/Edge |
| `runner_timeout` | Python 运行器超过 `--timeout-seconds` |
| `runner_failed` | Python 运行器非零退出 |
| `results_missing` | 运行后未找到 `results.json` |
| `results_invalid` | `results.json` 无法解码 |
| `verification_input_invalid` | 验真输入缺失、不是普通文件或扩展名不受支持 |
| `reference_batch_invalid` | 中间文件 JSON、版本、字段、元数据或题名可追溯性检查失败；读取 validation JSON 的 issues |
| `converter_failed` | 转换/OCR 服务失败、跨 host 重定向或输入哈希不一致 |
| `verification_source_unavailable` | 没有可完成判定的来源证据；保留工作区后恢复 |

---

### `launch-browser`

启动本地 Chrome/Chromium/Edge 实例（启用 CDP），或复用已有实例。适用于需要持久浏览器配置文件的数据库。

```bash
./if-libclaw launch-browser
```

| 标志 | 默认值 | 环境变量覆盖 | 说明 |
|------|--------|-------------|------|
| `--cdp-host` | `127.0.0.1` | — | 本地 CDP 主机 |
| `--cdp-port` | `9222` | — | 本地 CDP 端口 |
| `--url` | `https://pubs.acs.org` | — | 浏览器初始 URL |
| `--profile-dir` | `~/.paperflow/libclaw-dev-browser-profile` | — | 持久浏览器配置文件目录 |
| `--browser-executable` | *（自动检测）* | — | 可选的浏览器可执行文件路径 |

**行为：**

1. 探测 `http://<cdp-host>:<cdp-port>/json/version`
2. 若 CDP 已存活 → 打印复用信息并退出
3. 否则启动 Chrome/Chromium/Edge（带 `--remote-debugging-port`）
4. 最多等待 20 秒直到 CDP 就绪

**输出：**

```
[launch-browser] ready cdp=http://127.0.0.1:9222 profile=~/.paperflow/... url=https://pubs.acs.org
```

---

## 支持的数据库

| ID | 名称 | 需要浏览器 | 需要 Playwright |
|----|------|-----------|----------------|
| `openalex` | OpenAlex | 否 | 否 |
| `pubmed` | PubMed | 否 | 否 |
| `crossref` | Crossref | 否 | 否 |
| `arxiv` | arXiv | 否 | 否 |
| `ieee_xplore` | IEEE Xplore | 否 | 否 |
| `rsc` | 英国皇家化学会 | 是 | 是 |
| `acs` | ACS Publications | 是 | 是 |
| `aps` | APS Physics | 是 | 是 |
| `wos_sci` | Web of Science SCI | 是 | 是 |
| `wos_ssci` | Web of Science SSCI | 是 | 是 |
| `wos_ahci` | Web of Science AHCI | 是 | 是 |
| `cnki` | 中国知网 | 否 | 否 |
| `engineering_village` | Engineering Village | 是 | 是 |

`openalex`、`pubmed`、`crossref`、`arxiv`、`cnki` 的 `execute` 适配器均直接使用 HTTP/API，不启动浏览器。
CNKI 请求使用其支持的每页 10、20、50 条档位，解析后按 `--max-results` 截取；不足一页时也不发送 1、5、12 等无效页大小。
arXiv 使用 Atom API 默认的相关度排序，保留计划中的日期过滤。上游 429 仍会如实报告为 `arxiv_rate_limited`，不当作零结果；`LIBCLAW_ARXIV_RETRY_ATTEMPTS=0` 可显式关闭重试。

浏览器数据库由 `execute` 统一管理 CDP：

- 若配置了 `E2E_REMOTE_CDP_HTTP` 或 `LIBCLAW_REMOTE_CDP_HTTP`，先探测并复用健康的远程 CDP。
- 远程端点未配置或不可达时，自动启动可见的临时本地 Chrome/Chromium/Edge，使用隔离的临时 profile，并在本次执行结束后清理。
- 外部 CDP 不会被关闭；只有本次执行自行启动的临时浏览器会被回收。
- 只需安装 Playwright Python 包和系统浏览器，不需要执行 `playwright install chromium`，也不依赖 headless-shell。

`launch-browser` 仍可用于需要持久 profile 或人工登录的场景；普通执行无需先运行该命令。

---

## 环境变量

| 变量 | 默认值 | 使用者 | 说明 |
|------|--------|--------|------|
| `LIBCLAW_AUTH_MODE` | `jwt` | telemetry 授权命令 | 精确值为 `legacy_api_key` 或 `jwt`；未设置等同 JWT。JWT 不读取或发送 API Key；本地报告命令不读取认证。 |
| `LIBCLAW_API_KEY` | *（无）* | legacy 模式的 probe, check-runtime, prepare, execute, complete-search 与引用命令 | 主 API Key（也可用 `--api-key`）；JWT 模式不会读取、发送或回退到此值。 |
| `LIBCLAW_API_KEY_FILE` | *（无）* | legacy API Key 解析 | 未设置 `LIBCLAW_API_KEY` 时读取；JWT 模式不读取。 |
| `LIBCLAW_LICENSE_FILE` | `if-libclaw` 同目录的 `libclaw.license` | legacy API Key 解析 | 兼容许可文件路径；前两项未设置时读取；JWT 模式不读取。 |
| `LIBCLAW_OIDC_ISSUER` | *（随包内置）* | login | 仅供部署覆盖；普通用户无需设置。 |
| `LIBCLAW_OIDC_ALLOW_INSECURE_HOSTS` | *（无）* | login、auth status、JWT 运行时 | 仅部署方在受控内网 HTTP 环境配置精确 host allow-list；普通用户无需设置。 |
| `LIBCLAW_OIDC_CLIENT_ID` | *（随包内置）* | login | 内置公开/native client ID；普通用户无需设置。 |
| `LIBCLAW_OIDC_AUDIENCE` | *（随包内置）* | login | 内置 access token audience；普通用户无需设置。 |
| `LIBCLAW_AUTH_STORE` | `platform` | login, auth status/logout, JWT 运行时 | `platform`、`passphrase_file`、`plaintext_file` 都选择普通 session 文件；未知值安全失败。 |
| `LIBCLAW_AUTH_REFRESH_SKEW_SECONDS` | `60` | JWT 运行时 | access token 提前续期窗口；必须是 `30`–`300` 的十进制整数，否则 `AUTH_REFRESH_SKEW_INVALID`。 |
| `LIBCLAW_AUTH_SESSION_FILE` | 二进制旁的 `.libclaw/session.json` | login, auth status/logout, JWT 运行时 | 普通 JSON session 文件的绝对路径覆盖。 |
| `LIBCLAW_AUTH_METADATA_FILE` | *（无）* | 兼容旧部署 | 作为 `LIBCLAW_AUTH_SESSION_FILE` 的兼容别名。 |
| `LIBCLAW_AUTH_PLAINTEXT_FILE` | *（无）* | 兼容旧部署 | 作为 `LIBCLAW_AUTH_SESSION_FILE` 的兼容别名。 |
| `LIBCLAW_AUTH_CIPHERTEXT_DIR` | *（无）* | 兼容旧部署 | 不使用。 |
| `LIBCLAW_AUTH_FILE` | *（无）* | 旧配置 | 不自动读取或迁移。 |
| `LIBCLAW_AUTH_LEGACY_FILE` | *（无）* | 旧配置 | 不自动读取或迁移。 |
| `LIBCLAW_CATALOG_BILLING_URL` | `https://aixstu.innerfireai.com/gateway` | auth status | 仅供部署覆盖；不会自动配给。 |
| `LIBCLAW_CATALOG_BILLING_TIMEOUT_SECONDS` | `5` | auth status | Catalog-Billing status 查询超时；仅 `1`–`30` 有效，其他值回到默认值。 |
| `LIBCLAW_TELEMETRY_URL` | *（随包配置）* | probe, check-runtime, prepare, execute, complete-search, reference-context, verify-references, query-references | 仅供部署覆盖。 |
| `LIBCLAW_DEV_VERSION` | 命令内置版本 | probe, check-runtime, prepare, execute, complete-search, reference-context, verify-references, query-references | 发送给遥测的版本标签 |
| `LIBCLAW_INSTALLATION_ID` | `runtime-<cmd>` | probe, prepare, execute, complete-search | 安装 ID |
| `LIBCLAW_MACHINE_ID` | *（主机名）* | probe, prepare, execute, complete-search | 机器 ID |
| `LIBCLAW_WORKSPACE_DIR` | *（临时目录）* | prepare, execute | 工作区输出目录 |
| `PYTHON_BIN` | `python3` | check-runtime, execute | Python 可执行文件 |
| `E2E_REMOTE_CDP_HTTP` | *（无）* | check-runtime, execute (Python) | 可选远程 CDP 端点；不可达时自动回退临时本地 Chrome |
| `LIBCLAW_REMOTE_CDP_HTTP` | *（无）* | check-runtime, execute (Python) | `E2E_REMOTE_CDP_HTTP` 的兼容别名 |
| `CNKI_COOKIE` | *（内置默认值）* | execute (Python), live e2e | 可选覆盖 CNKI Cookie；默认会注入内置 `Ecp_ClientId` |
| `LIBCLAW_E2E_IEEE_XPLORE_ACCESS` | *（默认启用）* | live e2e | IEEE Xplore 访问确认；仅在显式设为 `0/false/off` 时跳过 |
| `LIBCLAW_E2E_ACS_ACCESS` | *（默认启用）* | live e2e | ACS 访问确认；仅在显式设为 `0/false/off` 时跳过 |
| `LIBCLAW_E2E_WOS_ACCESS` | *（默认启用）* | live e2e | Web of Science 访问确认；仅在显式设为 `0/false/off` 时跳过 |
| `LIBCLAW_E2E_ENGINEERING_VILLAGE_ACCESS` | *（默认启用）* | live e2e | Engineering Village 访问确认；仅在显式设为 `0/false/off` 时跳过 |
| `LIBCLAW_E2E_APS_ACCESS` | *（默认启用）* | live e2e | APS 访问确认；仅在显式设为 `0/false/off` 时跳过 |
| `LIBCLAW_E2E_CNKI_ACCESS` | *（默认启用）* | live e2e | CNKI 访问确认；仅在显式设为 `0/false/off` 时跳过 |
| `LIBCLAW_BROWSER_PROFILE_DIR` | *（无）* | execute (Python) | 持久浏览器配置文件目录 |
| `PAPERFLOW_TOTAL_MEMORY_GB` | *（自动检测）* | check-runtime | 覆盖总内存（用于并发数计算） |
| `LIBCLAW_DOCUMENT_CONVERTER_URL` | `https://libtools.innerfire.ai:22943/converter` | reference-context, verify-references | 文档转换/OCR API 基地址；canonical 名称 |
| `LIBCLAW_GOOGLE_SCHOLAR_API_URL` | `https://libtools.innerfire.ai:22943` | verify-references, query-references | Google Scholar 兼容 API 基地址；canonical 名称 |
| `LIBCLAW_CONVERTER_URL` | *（无）* | reference-context | `LIBCLAW_DOCUMENT_CONVERTER_URL` 的兼容别名 |
| `LIBCLAW_GOOGLE_SCHOLAR_URL` | *（无）* | verify-references, query-references | `LIBCLAW_GOOGLE_SCHOLAR_API_URL` 的兼容别名 |
| `LIBCLAW_GOOGLE_SCHOLAR_API_KEY` | *（无）* | verify-references, query-references | legacy 模式的可选 Google Scholar 专用覆盖；未设置时复用 `LIBCLAW_API_KEY`。JWT 模式不读取或发送它。 |

---

## Skill 版本检查与升级

在 `legacy_api_key` 模式，`check-runtime`（仅当提供 API Key）、`prepare`、`execute`、`complete-search` 与 `verify-references` 会按各自的 API-key 路径查询 `telemetry_service` 的版本/授权信息。`jwt` 模式不会把本地登录会话降级为旧的 API-key skill-version 查询；它由 `authorize-run` 的 Bearer 策略决定是否可执行。本地报告命令不做版本或授权查询。

- `ok`：本地 skill 版本可用。
- `update_recommended`：平台有新版本，命令继续运行，但会打印升级提醒。
- `update_required`：本地版本低于平台最低支持版本，`prepare` / `execute` 会阻断。
- `check_failed`：版本检查失败，`check-runtime` 仅记录状态，执行型命令会继续后续授权流程。

升级流程正文维护在 `runtime/libclaw-dev/docs/upgrade.md`。遥测服务响应中的 `upgradeGuideUrl` 指向平台发布的最新升级指南，`downloadUrl` 指向最新 skill package 下载地址。

---

## Plan 文件格式

`--plan-file` 需要一个 JSON 文件，最小结构如下：

```json
{
  "naturalLanguageRequest": "搜索大语言模型相关论文",
  "normalizedQuery": "LLM",
  "planning": {
    "searchPlan": {
      "searchTermLanguage": ["en"],
      "enSearchTerms": [
        {
          "role": "subject",
          "value": ["large language model"],
          "synonyms": ["LLM"]
        }
      ],
      "searchFields": ["title", "abstract"],
      "publicationStartDate": "2020-01-01",
      "publicationEndDate": "2025-12-31",
      "databases": ["openalex"]
    }
  }
}
```

**必填字段：**
- `normalizedQuery` — 规范化查询词
- `planning.searchPlan.enSearchTerms` — 英文检索词组（`role` + `value` + `synonyms`）
- `planning.searchPlan.databases` — 目标数据库 ID 列表

**可选字段：**
- `naturalLanguageRequest` — 原始自然语言请求
- `planning.searchPlan.cnSearchTerms` — 中文检索词组
- `planning.searchPlan.searchFields` — 检索字段（默认 `title`, `abstract`）
- `planning.searchPlan.publicationStartDate` / `publicationEndDate` — 时间范围

**示例文件：**
- `references/demo-playwright-plan.json` — 简单 Playwright 浏览器搜索示例
- `references/demo-playwright-plan.json` — 完整多数据库示例

---

## 快速开始

在 `runtime/libclaw-dev/` 目录运行：

```bash
# 1. 启动遥测服务
docker compose up --build

# 2. 检查运行时环境
./if-libclaw check-runtime

# 3. 探测控制面
./if-libclaw probe --api-key "$LIBCLAW_API_KEY"

# 4. 执行搜索
./if-libclaw execute \
  --api-key "$LIBCLAW_API_KEY" \
  --plan-file references/demo-playwright-plan.json \
  --databases openalex \
  --timeout-seconds 120
```

引用验真默认使用公开转换服务和 Google Scholar 网关；CNKI 使用 runtime 固定入口。完成上传
确认后，依次运行 `reference-context`、`validate-reference-batch` 和
`verify-references`。完整命令及确认门见 `stages/verification-*/STAGE.md`。

```bash
./if-libclaw reference-context \
  --input "$PAPER_FILE" \
  --output ./reference-context.json
```

## Live E2E 约束

`internal/core/cli/live_e2e_test.go` 当前维护两组 live E2E：

- `TestExecuteCommandLiveDatabaseE2E`：基础 smoke matrix。每个数据库至少返回 1 篇真实论文
- `TestExecuteCommandLiveDatabaseE2EPaginationDefaultMaxResults`：分页 matrix。每个数据库在 `--max-results 100` 时都要实际返回 100 篇论文

数据库 case 会先做环境门禁，再执行真正搜索：

- 未配置远程 CDP 时，`execute` 会使用可见的临时本地 Chrome；只有远程和本地浏览器都不可用时才失败
- 访问确认环境变量默认视为启用；只有显式设为 `0` / `false` / `off` 时，case 才会跳过
- telemetry 授权失败时，case 直接失败，不再继续打印误导性的 workspace 诊断
- `cnki` 遇到验证页、挑战页或 HTTP 403 时，视为会话态无效，不允许以 0 结果通过
- 依赖远程 CDP 的 case 若出现 `runner_failed:`，会最多重试 3 次后再判定失败；该重试逻辑有单独 unit test 覆盖

建议在跑整套 live E2E 之前先确认：

```bash
export LIBCLAW_ENABLE_LIVE_E2E=1
export LIBCLAW_E2E_API_KEY="$LIBCLAW_API_KEY"
export LIBCLAW_E2E_TELEMETRY_URL=http://127.0.0.1:8011
export E2E_REMOTE_CDP_HTTP=http://127.0.0.1:9222
go test -run '^TestExecuteCommandLiveDatabaseE2E$' ./internal/core/cli -count=1
```

若要单独验证默认分页上限的 100 条结果路径，运行：

```bash
export LIBCLAW_ENABLE_LIVE_E2E=1
export LIBCLAW_E2E_API_KEY="$LIBCLAW_API_KEY"
export LIBCLAW_E2E_TELEMETRY_URL=http://127.0.0.1:8011
export E2E_REMOTE_CDP_HTTP=http://127.0.0.1:9222
go test -run '^TestExecuteCommandLiveDatabaseE2EPaginationDefaultMaxResults$' ./internal/core/cli -count=1
```
