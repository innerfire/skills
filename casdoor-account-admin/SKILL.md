---
name: casdoor-account-admin
description: >-
  Operates Casdoor tenant accounts (create/list/update/delete) through the local
  OAuth CLI against https://auth.innerfireai.com. Use when the user wants to 开账号,
  批量建号, 学员/员工账号, Casdoor 用户增删改查, 重置密码, 选租户/组织后操作账号, or manage Groups as 角色.
  Not for writing Casdoor adapters or browser SSO/OIDC app code.
---

# Casdoor 账号管理

对话编排租户内账号增删改查。真正打 API 的只有本目录 `scripts/casdoor.mjs`。不要手写 curl，不要把 token / cookie 读进对话。

业务「角色」= Casdoor **Group**，不是 Role。分组支持多选。

写适配器请用 `casdoor-management-api`。浏览器 SSO 排障请用 `casdoor-sso`。

## 调用方式

先定位本 `SKILL.md` 旁边的脚本，用绝对路径：

```bash
node "<skill>/scripts/casdoor.mjs" <command> --json
```

Cursor 里所有 CLI 调用都带能写 `~/.config` 和访问外网的权限（`all`）。始终加 `--json`。不要打印或日志化 `access_token` / `refresh_token` / session 文件内容。

缺参数先问；用户已经给的（租户、前缀、数量、分组）不要再问。互不依赖的问题同一轮问。写操作必须先预览再等明确「是」，然后才带 `--yes`。用户说「换租户」回到选租户；说「取消」立即停，已提交的不回滚。

## 流程

### 0. 登录与探测

```bash
node "<skill>/scripts/casdoor.mjs" whoami --json
```

- `unauthenticated` → `login --json`（会打开系统浏览器；把 stderr 里的 URL 发给用户）。登录完成后立刻再 `whoami`。
- `unreachable` → 中止，告诉用户 Casdoor 不可达。
- `forbidden` → 中止，当前登录者不是平台管理员。
- `ok` 后 `orgs --json` 能列出组织，视为 P0 通过。

`login` 失败且 `code=config`：Casdoor 应用 Redirect URL 必须精确包含 `http://127.0.0.1:18765/callback`，端口不能改。清单见 `config --json`。

### 1. 选租户

`orgs --json`（可选 `--with-counts`）。展示「序号 / displayName / name」。超过 20 个就按关键字过滤。用户输入对不上就再问，**不要默认第一个**。回显「当前操作租户：{displayName}（{name}）」，后续所有命令都带这个 `--owner`。

### 2. 选功能

用户没说要干嘛时再问：新增 / 查询 / 修改 / 删除。

### 3A. 新增（主路径）

1. 问要不要角色。要 → `groups --owner <org> --json`，展示「序号 / displayName / name」，可多选；无分组则允许跳过。不要 → `groups` 留空。
2. 收集 `--prefix`（2–16 位字母数字）和 `--count`（1–100）。不合法就重问，不自动改。
3. 先 **dry-run**（不要 `--yes`）：

```bash
node "<skill>/scripts/casdoor.mjs" users add-batch --owner <org> --prefix stu --count 3 --groups g1,g2 --json
```

4. 用表格预览：账号、租户、角色、初始密码 `if123456`、待创建。用户确认后再加 `--yes`（可加 `--csv <path>` 做发放表，文件 0600）。
5. 单条失败不中断。已存在 → 该条失败，不覆盖、不改密、不跳号。全部失败才当作环境问题中止。
6. 回执：成功 m / 失败 k；失败原因；提示首次登录改弱口令。

规则细节见 [naming.md](references/naming.md)。

### 3B. 查询

先问精确名 / 关键字 / 全量。

```bash
node "<skill>/scripts/casdoor.mjs" users list --owner <org> --exact stu001 --json
node "<skill>/scripts/casdoor.mjs" users list --owner <org> --query stu --json
node "<skill>/scripts/casdoor.mjs" users list --owner <org> --all --json
```

表格只展示账号、显示名、分组、启用（`isForbidden=false` 为启用）、创建时间。没有匹配就说「未找到」。不要展示密码。

### 3C. 修改

定位必须唯一命中。先 `users get` 把当前字段给用户看。可改：显示名、分组（多选）、邮箱、手机、启用停用、重置密码。先 **不要** `--yes`，看返回的 `before` / `after`，用户确认后再加 `--yes`：

```bash
node "<skill>/scripts/casdoor.mjs" users update --owner <org> --name stu001 --display-name ... --groups g1,g2 --enabled true --json
node "<skill>/scripts/casdoor.mjs" users update --owner <org> --name stu001 --display-name ... --groups g1,g2 --enabled true --yes --json
```

重置密码单独二次确认：先 `users reset-password` 预览，再 `--yes`。改分组必须走 CLI 的先读后改，否则其它字段会被清空。见 [api.md](references/api.md)。

### 3D. 删除

禁止模糊命中直接删。先 dry-run 列出待删账号（账号 / 租户 / 分组），提示不可恢复，用户确认后再 `--yes`。

```bash
node "<skill>/scripts/casdoor.mjs" users delete --owner <org> --name stu001 --json
node "<skill>/scripts/casdoor.mjs" users delete-batch --owner <org> --prefix stu --json
```

`--prefix` 只匹配 `stu` + 数字（不会误删 `student`）。批量删除必须把完整名单列入二次确认。

## 硬规则

- 所有写请求都限定在用户所选 `--owner`，不跨租户。
- 没有 `--yes` 的写命令只是预览；没有用户确认不要加 `--yes`。
- 默认密码是弱口令 `if123456`，回执里必须提醒改密。
- 中途取消：未提交的丢掉；已提交的按既成事实写进回执。
