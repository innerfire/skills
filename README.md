# Innerfire Skills

Innerfire 的 Agent Skills 仓库。兼容 [Agent Skills](https://agentskills.io) 协议，可用 [skills CLI](https://github.com/vercel-labs/skills) 安装到 Cursor、Claude Code、Codex、OpenClaw、Hermes 等大多数 agent。

## Skills

| Skill | 说明 |
|---|---|
| [`casdoor-account-admin`](casdoor-account-admin/) | 选租户后对话编排 Casdoor 账号增删改查、批量建号、重置密码；业务角色对应 Group。 |
| [`course-template-creator`](course-template-creator/) | 按课程模板 V1 数据契约交互式生成课程目录和可导入 ZIP（不负责上传）。 |
| [`student-outcome-submitter`](student-outcome-submitter/) | 学生登录后提交里程碑和实验报告（课程总体报告）。先预览，确认后再上传。 |
| [`teacher-outcome-downloader`](teacher-outcome-downloader/) | 教师登录后准备批量下载学生里程碑和实验报告。当前只验收登录。 |

## 安装

### 推荐：`npx skills`

把本仓库的 skill 装到当前检测到的 agent：

```bash
npx skills add innerfire/skills
```

只装某一个：

```bash
npx skills add innerfire/skills --skill casdoor-account-admin
npx skills add innerfire/skills --skill course-template-creator
npx skills add innerfire/skills --skill student-outcome-submitter
npx skills add innerfire/skills --skill teacher-outcome-downloader
```

常用参数：

```bash
# 全局安装（跨项目可用）
npx skills add innerfire/skills -g

# 指定 agent（可重复 -a）
npx skills add innerfire/skills -a cursor
npx skills add innerfire/skills -a claude-code -a codex

# 列出仓库里有哪些 skill，不安装
npx skills add innerfire/skills --list
```

CLI 会自动识别本机已安装的 agent，并放到对应的 skills 目录。完整 agent 列表见 [skills CLI Supported Agents](https://github.com/vercel-labs/skills#supported-agents)。

### 不支持 `npx skills` 的 agent

如果目标 agent 不在 skills CLI 的支持列表里，直接把 skill 目录下载到该 agent 的 skills 路径即可。

先克隆仓库，再拷贝需要的 skill：

```bash
git clone --depth 1 https://github.com/innerfire/skills.git /tmp/innerfire-skills

# 把 <skill-name> 换成上表中的目录名，把 <agent-skills-dir> 换成该 agent 的 skills 目录
cp -R /tmp/innerfire-skills/<skill-name> <agent-skills-dir>/<skill-name>
```

常见 skills 目录（全局）：

| Agent | 目录 |
|---|---|
| Cursor | `~/.cursor/skills/` |
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| OpenClaw | `~/.openclaw/skills/` 或 `~/.openclaw/workspace/skills/` |
| Hermes Agent | `~/.hermes/skills/` |
| Gemini CLI | `~/.gemini/skills/` |
| OpenCode | `~/.config/opencode/skills/` |
| GitHub Copilot | `~/.copilot/skills/` |

项目级安装则拷到该仓库下对应 agent 的 `skills/` 目录（例如 `.cursor/skills/`、`.claude/skills/`、`.agents/skills/`）。不确定路径时，查该 agent 文档里的 skills 目录说明。

拷贝完成后目录应类似：

```text
<agent-skills-dir>/
└── casdoor-account-admin/
    ├── SKILL.md
    ├── agents/
    ├── references/
    └── scripts/
```

## License

[Apache License 2.0](LICENSE)
