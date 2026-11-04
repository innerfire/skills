---
name: if-ifas-admin
description: >-
  以管理员（admin）或运营（operator）身份登录并管理 ifAS Center 门户 CMS 内容（智能体 agents、Skill 安装包与目录 skills、专题 topics、轮播 banners、标签 tags、媒体库 media、动态显隐 feeds）。底层通过 @innerfire/auth-cli 完成浏览器回环授权，经本地零依赖脚本执行草稿创建、本地 Skill 目录自动打包上传、版本升级、上线发布与安全下架。适用于“上架智能体”、“上传/发布 Skill 到 CMS”、“更新门户专题/Banner/标签”、“隐藏门户动态”、“ifas cms 运营管理”、“upload skill/agent to ifas cms”。不负责管理 admin-users 后台账号，也不执行任何物理硬删除。
---

# ifAS 门户 CMS 管理员与运营 Skill

通过 `@innerfire/auth-cli` 管理员会话与随包零依赖脚本 `scripts/ifas-cms.mjs`，对话式完成 `ifAS Center` 门户全部运营数据的查询、草稿录入、媒体/ZIP 上传、版本迭代、上线发布与下架。

所有 CMS 读写统一走本目录 `scripts/ifas-cms.mjs`。禁止手写 `curl` 调接口，禁止读取或打印 `~/.config/innerfire-auth-cli/` 下的 `session.json`、`token` 或 `Cookie`。

完整集合字段约束、参数字典与错误码见 [collections-and-cli.md](references/collections-and-cli.md)。

---

## 调用约定

定位本 `SKILL.md` 同级目录下的脚本，统一以绝对路径执行（输出固定为脱敏 JSON）：

```bash
node "<skill-dir>/scripts/ifas-cms.mjs" <domain> [action] [flags]
```

在任何支持 Agent Skills 的运行环境中，执行该脚本时需放行外网 HTTPS 访问与 `~/.config/innerfire-auth-cli` 读写权限。脚本默认连接生产 CMS（`https://ifasccms.innerfireai.com`，对应 `auth-cli` 项目键 `ifas-cms`）。

---

## 标准执行流程

### Step 0：会话核验与浏览器授权

每次会话首次操作 CMS 前，必须先验证当前管理员/运营登录态：

```bash
node "<skill-dir>/scripts/ifas-cms.mjs" whoami
```

- 返回 `"ok": true`：记录当前操作者 `user.email` 与 `user.role`（`admin` 或 `operator`），直接进入下一步。
- 返回 `"code": "unauthenticated"`：执行浏览器回环登录：
  ```bash
  node "<skill-dir>/scripts/ifas-cms.mjs" login
  ```
  将 stderr 输出的 `/api/cli-auth` 授权链接展示给用户，等待用户在浏览器确认授权；命令返回 `"ok": true` 后继续。
- 返回 `"code": "forbidden"` / `"cli_auth_unavailable"` / `"unreachable"`：按下方「异常与失败恢复表」立即中止并报告原因。

### Step 1：前置盘点与元数据采集

根据目标集合拉取权威字典或解析本地资产，**用户已明确给出的字段不再重复询问**：

1. **涉及 `agents` 或 `skills` 时**：
   - 先拉取当前启用的类型与类别标签，向用户展示可选标签，严禁凭空捏造标签名：
     ```bash
     node "<skill-dir>/scripts/ifas-cms.mjs" tags list
     ```
   - 若用户提供了本地 Skill 目录路径，先离线解析目录结构、提取 `SKILL.md` 元数据并测算干净 ZIP 体积（自动剔除 `.git`、`node_modules`、`tests`、`*.test.*`、`results.tsv`、`test-prompts.json`、`.env*`）：
     ```bash
     node "<skill-dir>/scripts/ifas-cms.mjs" skills inspect-dir --dir "<abs-skill-dir>"
     ```
2. **涉及更新、下架或专题编排（`topics`）时**：
   - 先执行 `list` 或 `get` 精确定位目标记录 ID。名称不唯一时展示候选 ID 列表由用户点选，禁止默认取第一条。
3. **检查发布状态与截图硬约束**：
   - 新建 `agents`、`skills`、`topics` 默认存为 `draft`（草稿）。
   - 仅当用户明确要求正式发布（`--status published`）时才设为 `published`；且 **`agents` 与 `skills` 发布时必须具备恰好 2 张界面截图（`--screenshots <图1>,<图2>`）**。

🔴 **CHECKPOINT 1 · 🛑 STOP（缺参或发布前置不足时必停）**
当必填项缺失（如 `name`/`title`、`summary`、`banners` 的 `image`+`url`），或用户要求直接发布 `agents`/`skills` 却未提供满 2 张界面截图时，必须暂停并列出缺失项，由用户选择「补齐截图后发布」或「先存为 `draft` 草稿」。

### Step 2：无 `--yes` 预演（Dry-Run Preview）

所有写操作（`create`、`update`、`upload`、`takedown`、`restore`、`set-hidden`）第一步**禁止携带 `--yes`**：

```bash
# 示例 1：从本地目录创建 Skill（预演模式，不写远端）
node "<skill-dir>/scripts/ifas-cms.mjs" skills create \
  --from-dir "/abs/path/to/if-libclaw" \
  --name "文献检索与真伪核验" \
  --summary "检索学术文献并核验 Word、PDF 与粘贴参考文献真实性" \
  --type-tag "学习辅助" \
  --category-tags "论文,信息提取" \
  --icon "/abs/path/icon.png" \
  --screenshots "/abs/path/s1.png,/abs/path/s2.png" \
  --runtime "Node.js 20+" \
  --version "v1.0.0" \
  --status published

# 示例 2：更新已上线智能体并发布新版本（自动置顶写入 versionHistory[0]）
node "<skill-dir>/scripts/ifas-cms.mjs" agents update \
  --id "<agent-uuid>" \
  --version "v1.3.0" \
  --changelog "新增多学科教案导出模板"
```

脚本会在不改动远端数据的前提下完成标签校验、媒体 `SHA-256` 去重探测、截图数量校验、`versionHistory[0]` 合并及门户动态影响预测（`feedImpact`）。

🔴 **CHECKPOINT 2 · 🛑 STOP（写操作提交前强制人工确认）**
向用户用精简表格展示预演摘要：
- 目标集合与动作（新增 / 修改 / 下架 / 隐藏动态）
- 核心字段变更（修改时对比 `before` → `patch`）
- 媒体处理方式（复用已有 `SHA-256` 媒体 ID 还是新上传文件）
- 发布状态（`draft` / `published`）及是否触发门户公开动态（`feedImpact.note`）

未收到用户明确确认（如「确认」「继续」「是」）前，严禁附加 `--yes` 执行。用户回复「取消」则立即终止。

### Step 3：附带 `--yes` 正式提交与回执

收到用户明确确认后，使用完全相同的命令追加 `--yes` 执行真实写入：

```bash
node "<skill-dir>/scripts/ifas-cms.mjs" <原命令参数...> --yes
```

提交完成后输出结构化回执：记录 `id`、名称/标题、当前 `_status`、`version`（如有）、`downloadUrl`（Skill 安装包地址）以及门户动态触发结果。

---

## 异常与失败恢复表

| 触发条件 | 一线修复 | 仍失败兜底 |
|---|---|---|
| `code = "unauthenticated"`（未登录或会话过期） | 执行 `login` 唤起浏览器回环授权，把授权 URL 发给用户确认后再跑 `whoami` | 提示用户在浏览器先打开 `https://ifasccms.innerfireai.com/admin` 登录后台账号后重跑 `login` |
| `code = "cli_auth_unavailable"`（`/api/cli-auth` 404） | 核对当前 `config` 输出的 `cmsOrigin` 是否正确 | 中止流程，明确告知目标 CMS 尚未发布包含 `/api/cli-auth` 端点的镜像版本 |
| `code = "forbidden"`（无权限或账号已停用） | 执行 `logout` 清除旧会话，提示用户切换具备 `admin` 或 `operator` 角色的启用账号重登 | 中止流程，引导联系平台超级管理员在 CMS `admin-users` 中启用账号或分配角色 |
| `code = "missing_screenshots"`（发布缺 2 张截图） | 向用户索要 2 张界面截图路径（`.png`/`.jpg`/`.webp`）或媒体 UUID | 征得用户同意后改传 `--status draft` 先保存草稿，待补齐截图后再 `update --status published` |
| `code = "invalid_tag"`（标签不存在或已停用） | 执行 `tags list` 列出当前 `type` 与 `category` 分组下的可用标签请用户重选 | 若用户确认需新增标签，先走 `tags create`（预览 → `--yes`）创建后再关联 |
| `code = "ambiguous_match"`（同名记录多于 1 条） | 展示错误详情 `details.candidates` 中的 `id`、`_status`、`enabled` 供用户指定 | 改用唯一 `--id <uuid>` 重新执行预演，禁止盲选第一条 |
| `code = "unreachable"` 或文件超 50MB / 非法格式 | 检查本地文件路径、扩展名（仅限 `.jpg`/`.jpeg`/`.png`/`.webp`/`.zip`）及文件体积 ≤50MB | 中止写入并保留本地文件原状，向用户报告具体超限文件或网络错误原因 |

---

## 反例与危险动作黑名单

以下动作在任何场景下严禁执行：

| # | 禁止动作（Don't） | 危害原因 | 正确做法（Do） |
|---|---|---|---|
| 1 | **物理硬删除任何 CMS 记录**（如发 `HTTP DELETE` 或试图彻底抹除智能体/Skill/标签/媒体） | 破坏门户收藏、最近浏览、使用统计与对象存储引用完整性，且不可逆 | 统一使用非破坏性操作：`takedown --mode disable`（停用下架）、`--mode unpublish`（撤回草稿）、`--mode trash`（软删入回收站）或 `feeds set-hidden --hidden true`；物理清理仅限人工进 CMS 后台操作 |
| 2 | **跳过预演直接带 `--yes` 写入** | 误改线上门户公开目录，甚至误触发全站门户动态（`feeds`） | 任何写命令必须先无 `--yes` 预演并在 🔴 CHECKPOINT 2 取得用户明确确认 |
| 3 | **读取或打印 `session.json`、`payload-token`、`Cookie`** | 管理员会话凭据进入对话上下文或终端日志造成凭据泄露 | 只用 `scripts/ifas-cms.mjs whoami` 验证身份，由脚本在进程内完成鉴权请求 |
| 4 | **把 `versionHistory` 新版本追加到数组末尾** | `cms` 的 `feeds-generator` 读取 `versionHistory[0]` 作为最新版本，追加到末尾会导致动态播报旧版本号 | 统一交由 `scripts/ifas-cms.mjs` 的 `--version` 自动置顶写入 `versionHistory[0]` 并将其余历史项设为 `isCurrent: false` |
| 5 | **直接把含 `.git` / `node_modules` / `.env` / `tests` 的原始目录打成 ZIP 上传** | 泄露本地环境变量、放大安装包体积并污染用户本地 skills 目录 | 必须使用 `--from-dir` 或 `skills inspect-dir` 执行白名单化干净打包 |
| 6 | **跨范围读写 `admin-users` 管理员账号集合** | 运营角色无权访问且易造成后台锁死 | 账号与角色变更一律由超级管理员在 CMS Web 后台人工处理 |
