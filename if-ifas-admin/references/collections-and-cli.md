# ifAS CMS 数据契约与脚本命令速查

本文档对应 `ifas-center/cms`（Payload CMS 3）中开放给 `admin` 与 `operator` 角色（`contentAccess`）的 7 个运营集合及 `scripts/ifas-cms.mjs` 参数约定。`admin-users` 集合不在本 Skill 管理范围内。

---

## 1. 集合字段与服务端强校验规则

### 1.1 `agents`（智能体）— 支持草稿 (`draft`/`published`) 与软删 (`deletedAt`)
| 字段 | 类型 | 必填 / 约束 | 说明 |
|---|---|---|---|
| `name` | string | 必填，≤100 字 | 智能体名称 |
| `summary` | string | 必填，≤300 字 | 列表与详情顶部一句话简介 |
| `icon` | upload (`media`) | 可选，仅 `image/*` | 智能体图标 |
| `screenshots` | upload[] (`media`) | 最多 2 张；**`_status="published"` 时必须恰好 2 张** | 详情页界面截图，少于或多于 2 张无法发布 |
| `ownerName` | string | 可选，≤100 字 | 提供方/作者名称 |
| `typeTag` | relationship (`tags`) | 可选，必须属于 `group="type"` 且 `enabled=true` | 单选类型标签 |
| `categoryTags` | relationship[] (`tags`) | 可选，必须属于 `group="category"` 且 `enabled=true` | 多选类别标签 |
| `introduction` | Lexical RichText | 可选 | 脚本通过 `--intro-md` / `--intro-file` 自动从 Markdown 转 AST |
| `version` | string | 可选，≤50 字 | 当前对外版本号（如 `v1.2.0`） |
| `targetUrl` | string | 可选，`http(s)://` 或 `/...`（禁含账号密码） | 「立即使用」跳转地址 |
| `usageSteps` | string[] | 可选 | 使用步骤列表（CLI 用 `|` 分隔或 JSON 数组） |
| `faqs` | `{question, answer}[]` | 可选 | 常见问题数组（`--faqs-json` 或 `--spec`） |
| `versionHistory` | array | **新版本必须置顶写入 `versionHistory[0]`** | `feeds-generator` 读取 `[0]` 生成「发布新版本」动态 |
| `tenantIds` | string[] | 默认 `[]`（全部有效租户可见） | 指定 Casdoor 组织 `rentid` 白名单，不可重复或含空白 |
| `sortWeight` | number | 默认 `0` | 降序排列权重 |
| `enabled` | boolean | 默认 `true` | `false` 表示门户停用下架 |
| `_status` | `draft` \| `published` | 新建默认 `draft` | 首次/重新变为 `published` 会自动写入 `feeds` 动态 |

### 1.2 `skills`（Skill）— 支持草稿 (`draft`/`published`) 与软删 (`deletedAt`)
继承 `agents` 的全部基础目录字段（含 **`published` 必须恰好 2 张 `screenshots`** 与 **`versionHistory[0]` 最新版本置顶**），并新增：

| 字段 | 类型 | 必填 / 约束 | 说明 |
|---|---|---|---|
| `fromDir` (CLI 专用) | 本地目录路径 | 目录内须含 `SKILL.md` | 自动排除 `.git`、`node_modules`、`tests`、`.env*`、`results.tsv`、`test-prompts.json`、`*.test.*` 打包 ZIP 并提取元数据 |
| `packageFile` | upload (`media`) | 可选，仅 `.zip`（≤100MB） | 绑定后 CMS `syncSkillPackageInfo` 自动回填 `downloadUrl` 与历史包大小 |
| `downloadUrl` | string | 可选，`http(s)://` 或 `/...` | 上传 `packageFile` 后自动同步，也可传外部稳定链接 |
| `applicableScenarios` | string | 可选 | 适用场景文本（`--scenarios`） |
| `runtimeEnvironment` | string | 可选，≤300 字 | 运行环境说明（`--runtime`，如 `Node.js 20+`） |
| `usageExamples` | `{markdown}[]` | 可选 | 使用示例 Markdown 片段（`--examples-md` 或目录代码块自动提取） |
| `installPromptTemplate` | string | 可选 | 自安装提示词模板（`--install-prompt`） |

### 1.3 `topics`（专题）— 支持草稿 (`draft`/`published`) 与软删 (`deletedAt`)
| 字段 | 类型 | 必填 / 约束 | 说明 |
|---|---|---|---|
| `title` | string | 必填，≤100 字 | 专题标题 |
| `summary` | string | 必填，≤300 字 | 专题摘要 |
| `cover` | upload (`media`) | 可选，仅 `image/*` | 专题封面图 |
| `description` | Lexical RichText | 可选 | `--desc-md` / `--desc-file` 自动转 Lexical AST |
| `items` | polymorphic array | `agents:<id或精确名>,skills:<id或精确名>` | 按顺序关联智能体与 Skill |
| `pinned` | boolean | 默认 `false` | 首页置顶专题标记 |
| `tenantIds` / `enabled` / `sortWeight` / `_status` | 同上 | 新建默认 `_status="draft"` | 发布或更新公开专题同样触发 `feeds` 动态 |

### 1.4 `banners`（轮播 Banner）— 无草稿，立即生效
- 必填：`--image <本地图片或媒体UUID>`、`--url <http(s):// 或 /相对路径>`。
- 可选：`--sort <数字>`（升序，默认 `0`）、`--tenants <all 或 t1,t2>`、`--enabled <true|false>`。
- 下架：`banners takedown --id <id> --yes`（设 `enabled=false`）。

### 1.5 `tags`（标签）— 无草稿
- 字段：`--group <type|category>`（创建后不可跨组混用）、`--name <≤100字>`、`--sort <数字>`、`--enabled <true|false>`。
- 已被任何智能体/Skill（含草稿与回收站）引用的标签不可删除，只能通过 `tags update --id <id> --enabled false --yes` 停用。

### 1.6 `media`（媒体库）
- 允许格式：`.jpg` / `.jpeg` / `.png` / `.webp` / `.zip`，单文件上限 **100MB**。
- 自动去重：脚本上传前计算本地文件 `SHA-256` 并查询 `media.contentSha256`；命中同哈希媒体时自动复用已有 `mediaId`，避免重复上传 OSS（除非显式传 `--force-upload`）。
- ASCII 文件名归一化：含中文或空格的本地文件名会自动转为 `<prefix>-<sha256前12位>.<ext>` 上传，避免 OSS `CopyObject` 编码报错，原文件名保留在 `alt` 中。

### 1.7 `feeds`（门户动态）
- 由 `agents` / `skills` / `topics` 发布与更新钩子自动生成（`publish` / `relist` / `release` / `update`）。
- 运营微调与显隐控制：
  - 隐藏/恢复展示：`feeds set-hidden --id <id> --hidden true|false [--yes]`
  - 修正标题或摘要：`feeds update --id <id> [--title <text>] [--summary <text>] [--hidden true|false] [--yes]`

---

## 2. CLI 命令模板速查

统一调用入口（不带 `--yes` 永远只做校验与预览，不写远端数据）：

```bash
# 0. 环境与登录核验
node "<skill>/scripts/ifas-cms.mjs" config
node "<skill>/scripts/ifas-cms.mjs" whoami
node "<skill>/scripts/ifas-cms.mjs" login

# 1. 查询可用标签与媒体
node "<skill>/scripts/ifas-cms.mjs" tags list
node "<skill>/scripts/ifas-cms.mjs" media list --mime image --limit 20

# 2. 解析本地 Skill 目录（免登录离线检查打包体积与提取字段）
node "<skill>/scripts/ifas-cms.mjs" skills inspect-dir --dir "/abs/path/to/if-xxx"

# 3. 从本地目录新增 Skill（先预览，确认后加 --yes）
node "<skill>/scripts/ifas-cms.mjs" skills create \
  --from-dir "/abs/path/to/if-xxx" \
  --name "文献核验助手" \
  --summary "检索并核验 Word/PDF 参考文献真实性" \
  --type-tag "学习辅助" \
  --category-tags "论文,信息提取" \
  --icon "/abs/path/icon.png" \
  --screenshots "/abs/path/s1.png,/abs/path/s2.png" \
  --runtime "Node.js 20+" \
  --version "v1.0.0" \
  --status published

# 4. 智能体升级版本（自动把新版本置顶写入 versionHistory[0]）
node "<skill>/scripts/ifas-cms.mjs" agents update \
  --id "<agent-uuid>" \
  --version "v1.3.0" \
  --changelog "新增多格式教案模板导出"

# 5. 安全下架或移入回收站（严禁物理硬删除）
node "<skill>/scripts/ifas-cms.mjs" agents takedown --id "<uuid>" --mode disable
node "<skill>/scripts/ifas-cms.mjs" skills takedown --id "<uuid>" --mode unpublish
node "<skill>/scripts/ifas-cms.mjs" topics takedown --id "<uuid>" --mode trash
node "<skill>/scripts/ifas-cms.mjs" feeds set-hidden --id "<feed-uuid>" --hidden true
```

---

## 3. 标准错误码对照

| `code` | 含义 | 处理动作 |
|---|---|---|
| `unauthenticated` | 本地无会话、会话距过期 ≤60s，或服务端 401 | 运行 `login` 完成浏览器回环授权后再试 |
| `cli_auth_unavailable` | 目标 CMS `/api/cli-auth` 返回 404 | 目标环境尚未部署挂载 `createCliAdminEndpoints` 的 CMS 镜像，中止并告知用户 |
| `forbidden` | 登录者非启用的 `admin` / `operator` | 中止，提示切换具备 CMS 后台管理或运营权限的账号 |
| `unreachable` | 网络超时或域名不可达 | 中止，检查网络与 CMS 服务状态 |
| `missing_screenshots` | `_status="published"` 但 `screenshots` 数量不为 2 | 询问用户提供恰好 2 张截图，或改存 `--status draft` |
| `invalid_tag` | 标签不存在、跨分组（`type` vs `category`）或已停用 | 执行 `tags list` 展示可用标签供用户点选 |
| `ambiguous_match` | 按名称/标题匹配到多条同名记录 | 展示返回的 `details.candidates` 列表，改用 `--id` 唯一定位 |
| `forbidden_operation` | 触发物理硬删除命令或 `DELETE` 请求黑名单 | 改用 `takedown`（`disable`/`unpublish`/`trash`）或 `feeds set-hidden` |
| `out_of_scope` | 试图读写 `admin-users` 后台账号集合 | 中止，引导用户在 CMS 后台人工管理账号 |
