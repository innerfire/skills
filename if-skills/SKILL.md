---
name: if-skills
description: >-
  检查火光智能线上 skill 仓库（github.com/innerfire/skills）的最新状态：比对本地已装 skill、
  发现新 skill、并在用户确认后安全地安装/更新。当用户说"看看 innerfire/skills 有没有新 skill"
  "检查火光 skill 仓库" "更新本地 skill" "if-skills" 时使用。Not for 安装非 innerfire 源的第三方 skill
  （那种用 install-external-skill）。
---

# if-skills · 火光 skill 仓库同步

只管 `github.com/innerfire/skills` 这一个仓库。真正干活的是本目录 `scripts/sync.mjs`（零依赖 Node）。
不要手写 git/cp，不要跳过 diff 校验。

## 调用方式

```bash
node "<skill>/scripts/sync.mjs" <command> --json
```

`<skill>` 即本 SKILL.md 所在目录（通常为 `~/.workbuddy/skills/if-skills`）。
所有调用都带 `--json`，便于结构化解析。

## 流程

### 0. 检查（只读，无副作用）

```bash
node "<skill>/scripts/sync.mjs" check --json
```

返回三类技能：

- `status: "new"` —— 上游有、本地没有（**新 skill**）。
- `status: "updated"` —— 上游与本地有差异（可更新）。
- `status: "identical"` —— 已是最新。

`summary` 给出计数。`head` 是上游当前 commit（hash / date / subject），回执里带上，方便用户判断是否真有新内容。

### 1. 没有新内容

`summary.new === 0 && summary.updated === 0` → 直接告诉用户"本地已全部是最新（上游 HEAD xxx）"，结束。
即便 `updated > 0` 而用户没要求，也不要擅自更新——等下一步询问。

### 2. 发现新 skill → 列表询问用户

把所有 `status: "new"` 的技能列成表格（序号 / name / 上游最后提交说明），然后**用 AskUserQuestion 问用户要装哪些**：

- 一个问题，`multiSelect: true`，每个选项 = 一个 new skill（label 用 name，description 写该 skill 一句话简介或上游提交说明）。
- 用户可多选，也可选"都不装"。
- **不要默认全装**——火光内部仓库可能含仅内网可用、或需要特定密钥才能跑的 skill，必须让用户自己挑。

> 若 new 数量 > 4，AskUserQuestion 一次性放不下：先列前 4 个问一轮，剩下再问一轮；或改用纯文本表格 + 让用户回"装 1、3、5"。

### 3. 可更新的 skill → 同样询问

把所有 `status: "updated"` 的技能也列出来，单独一个问题（multiSelect）问"以下本地 skill 有上游更新，要更新哪些？"。
更新会**覆盖本地文件**，所以必须先确认，不能静默更新。（注意：if-skills 自身也可能出现在 updated 列表里——
更新它自己没问题，因为本 SKILL.md 的指令此刻已在上下文里，落盘覆盖不影响本次执行。）

### 4. 执行安装/更新（用户确认后）

对用户在 2/3 步选中的每个 name，逐个调用：

```bash
node "<skill>/scripts/sync.mjs" sync --name <name> --yes --json
```

脚本会自动：① 把本地旧版备份到 `skills/` **之外**的 `~/.workbuddy/_skill-backups/<name>.bak.<日期>` 与
`~/.agents/_skill-backups/<name>.bak.<日期>`；② 同时 `cp -R` 到中枢 `~/.agents/skills/<name>` 与
WorkBuddy `~/.workbuddy/skills/<name>`；③ `diff -r` 校验两处都字节一致。

- `verifyWb && verifyAgents` 都为 `true` → 同步成功。
- 任一为 `false` → 报"校验未通过"，**不要**向用户谎称成功，提示手动检查。
- 未带 `--yes` 时脚本只返回预览（`dryRun: true`），不会改任何文件。

### 5. 收尾回执

逐条汇报：装了哪些（backup 日期戳）、更新了哪些、跳过了哪些、有无校验失败。
如果用户装了**新** skill，额外提醒：新 skill 可能需要环境变量/密钥才能跑——

- 让 WorkBuddy 重新加载该 skill（新装的 SKILL.md 需要被扫描到才会出现在 Skill 列表）。
- 读一下新 skill 的 SKILL.md，看它要哪些 env / 密钥。
- ⚠️ **重点复查 `XAI_PAYLOAD_ORIGIN` 冲突**（见 install-external-skill 的已装记录）：
  `course-template-creator` 要它指向 aixmng，而 `student-outcome-submitter` 要它指向 aixstu。
  若新装的 skill 也读这个变量，先确认语义，必要时调用时**就地覆盖**而非改 `~/.zshrc`：
  ```bash
  XAI_PAYLOAD_ORIGIN=https://aixstu.innerfireai.com node <skill>/scripts/<cli>.mjs <command> --json
  ```

## 硬规则

- 检查阶段（`check`）绝不写文件、绝不碰网络以外资源。
- 写操作（`sync`）无 `--yes` 只预览；没有用户明确确认不要加 `--yes`。
- 备份只能在 `skills/` 之外（`_skill-backups/`）——WorkBuddy 会把 `skills/*/SKILL.md`
  扫成 skill，把备份放里面会导致加载到旧版（已在 install-external-skill 踩过）。
- 新 skill 永不全装；必须由用户挑。
- 不伪造成功：校验失败就明说失败。
- 安装细节与已知坑见 [install-flow.md](references/install-flow.md)。
