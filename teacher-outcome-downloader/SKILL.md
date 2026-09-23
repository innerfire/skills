---
name: teacher-outcome-downloader
description: 以教师身份登录教学系统，为随后批量下载学生里程碑和实验报告做准备。用浏览器 PKCE 登录教师应用。适用于下载教学成果前的登录。当前只验收登录，不下载文件。不使用管理员或学生 client。
---

# 教师成果下载

当前切片只做登录。日程选择和文件落盘等登录 A/B 通过后再做。

真正发请求的只有本目录 `scripts/download.mjs`。不要手写 curl，不要把 access token 读进对话，不要复用 `casdoor-account-admin` 或 `student-outcome-submitter` 的 session。

## 调用方式

```bash
node "<skill>/scripts/download.mjs" <command> --json
```

Cursor 里调用 CLI 时带能写 `~/.config` 和访问外网的权限（`all`）。始终加 `--json`。不要打印 session 文件。

## 0. 配置与登录

```bash
node "<skill>/scripts/download.mjs" config --json
node "<skill>/scripts/download.mjs" whoami --json
```

`whoami` 返回 `unauthenticated` 时运行 `login --json`。把 stderr 里的授权地址发给用户，等浏览器登录完成后再 `whoami`。

固定值，不要改：

- 授权地址：`https://auth.innerfireai.com`（与学生端、管理端相同）
- clientId：`2a06575699b7fff7736f`
- 回调：`http://127.0.0.1:18767/callback`。端口被占用就停，不要改成 18765 或 18766
- scope：`openid profile email`

`XAI_TEACHER_PAYLOAD_ORIGIN` 是教师端 origin，不要尾斜杠。当前生产是 `https://aixtec.innerfireai.com`。没设置时先问，不要猜，也不要用学生 origin。

`login` 返回 `config` 时，教师 Casdoor Application 还没登记 `http://127.0.0.1:18767/callback`。`forbidden` 表示当前账号没有教师资格。`unreachable` 表示登录服务或业务 API 不可达。

## 硬规则

- 不使用管理端 client `f9000a01deab6f84d57c`，也不使用学生端 client `415e7652f294f1923793`。
- Token 只留在本次 session 文件，不写进对话。
- 没有登录成功前，不创建下载目录。
