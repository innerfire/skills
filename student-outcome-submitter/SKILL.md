---
name: student-outcome-submitter
description: 以学生身份提交里程碑和实验报告（课程总体报告）。用浏览器 PKCE 登录学生应用，列出正在学习的日程和任务，预览后经脚本上传。适用于交作业、重交成果、查看待交任务。不负责建课、报名、评分，也不使用管理员 token。
---

# 学生成果提交

学生登录后，把本地文件和可选说明交到一门正在学习的课。一次只交一个任务。实验报告就是课程总体报告 `course_report`，一门课一份，不挂在章下。里程碑是 `milestone`，挂在章下。

真正发请求的只有本目录 `scripts/submit.mjs`。不要手写 curl，不要把 access token 读进对话。

## 调用方式

先定位本 `SKILL.md` 旁边的脚本，用绝对路径：

```bash
node "<skill>/scripts/submit.mjs" <command> --json
```

Cursor 里调用 CLI 时带能写 `~/.config` 和访问外网的权限（`all`）。始终加 `--json`。不要打印 session 文件。

缺参数先问。用户已经给出的课程、任务、文件路径、说明不要再问。写操作必须先给出预览，等用户明确同意后再加 `--yes`。用户说取消就停；已经返回 201 的提交按既成事实写入回执。

接口细节见 [submission-api.md](references/submission-api.md)。

## 流程

### 0. 配置与登录

```bash
node "<skill>/scripts/submit.mjs" config --json
node "<skill>/scripts/submit.mjs" whoami --json
```

`whoami` 返回 `unauthenticated` 时运行 `login --json`。把 stderr 里的授权地址发给用户，等浏览器登录完成后再 `whoami`。

`config` 里 `clientId` 或 `payloadOrigin` 为空时先问用户，不要猜，也不要改用管理员 client。把下面的环境变量交给同一次命令：

- `XAI_STUDENT_CLIENT_ID`：学生 Public SPA 的 client id。当前生产学生应用是 `415e7652f294f1923793`
- `XAI_PAYLOAD_ORIGIN`：学生端 origin，不要尾斜杠。当前是 `https://aixstu.innerfireai.com`。同一主机的 `/v1` 转到 Payload，不要用旧主机 `stuxai.innerfire.ai`
- `XAI_CASDOOR_ENDPOINT`：可选。默认 `https://auth.innerfireai.com`

回调固定是 `http://127.0.0.1:18766/callback`。端口被占用就停，不要换端口。`login` 返回 `config` 时，说明学生 Casdoor Application 还没登记这个回调。

`unreachable` 表示登录服务或业务 API 不可达，停止并说明。`forbidden` 表示当前账号没有学生资格。

### 1. 选课

```bash
node "<skill>/scripts/submit.mjs" schedules list --json
```

用表格展示名称、教师、状态、`scheduleId`。多于一门 `learning` 时让用户选，不默认第一门。

只有 `derivedStatus=learning` 可以提交。`pending` 告诉用户课程还没开始，`completed` 告诉用户已结课。这两种都停止在这一门，不要继续选任务。

### 2. 选任务

```bash
node "<skill>/scripts/submit.mjs" tasks list --schedule <scheduleId> --json
```

列出章节名、任务名、类型、是否开放、是否已有成果。用户点名某一项。名称不能唯一对应时再问，不要猜测。

用户说「实验报告」「课程报告」或「课程总体报告」时，对上唯一的 `course_report`。里程碑用任务名称或用户确认后的 `taskId`。

`open` 为 false 的任务不要提交，说明教师还没开放。

### 3. 收集成果并预览

向用户要这一项的文件路径和可选说明。说明最多 4000 字。说明和文件都空就停。

先不带 `--yes`：

```bash
node "<skill>/scripts/submit.mjs" submit --schedule <scheduleId> --task <taskId> --file <path> --comment "<text>" --json
```

多个文件重复 `--file`。预览里写清课程、任务、说明、文件名。`resubmit` 为 true 时写明：这将生成新版本，学生端只显示最新一次。等用户明确同意后，同一命令加上 `--yes`。

### 4. 回执

成功回执包含 `submissionId`、`taskKind`、`versionNo`、`submittedAt`。失败时保留本地文件，不要把这次说成已提交。要交下一项就回到第 2 步。

## 硬规则

- 所有 HTTP 都走 `scripts/submit.mjs`。不要复用 `casdoor-account-admin` 的 session。
- 没有 `--yes` 的 `submit` 只是预览。
- 一次命令只提交一个任务。说明和文件至少有一项。
- 不报名、不下载模板、不按目录批量匹配、不写评价、不替教师代交。
