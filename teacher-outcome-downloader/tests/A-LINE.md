# teacher-outcome-downloader A 线（登录切片）

冻结版本 **v0.1-auth**。这一轮只冻结登录，不包含日程选择和文件下载。B 线必须沿用这里的断言，不得为了让实现通过而改口径。

mock 通过不代表产品通过。真实登录以 B 线为准。

## 范围

- 包含：教师 Public Client 的 PKCE 授权 URL、固定回调端口、未登录不发请求、教师日程列表探测、凭据不回显、session 文件权限。
- 不包含：按日程下载、目录命名、浏览器换票、真实 Casdoor。
- 授权地址默认 `https://auth.innerfireai.com`，与学生端 `student-outcome-submitter`、管理端 `casdoor-account-admin` 相同。
- clientId 固定 `2a06575699b7fff7736f`。禁止落到管理端 `f9000a01deab6f84d57c` 或学生端 `415e7652f294f1923793`。
- 回调固定 `http://127.0.0.1:18767/callback`。忽略环境变量改端口。管理端是 18765，学生端是 18766。
- scope 为 `openid profile email`，不含 `offline_access`。这与教师 SPA、学生 skill 一致；管理端多出的 `offline_access` 不带到这里。
- session 在 `xai-teacher-download/session.json`，不读另外两个 skill 的 session。

## 用例

| Case | 预期 |
|---|---|
| C-001 | 授权 URL 的 origin、path、client_id、18767、S256、scope 正确；无 client_secret、verifier、offline_access |
| C-002 | challenge 是 verifier 的 S256，URL 不含 verifier |
| C-003 | 无 session 的 whoami 为 `unauthenticated`，fetch 0 次 |
| C-004 | 默认 endpoint 与教师 clientId；回调不能改到 18765/18766；管理端和学生端 clientId 为 `config`；origin 去掉尾斜杠 |
| C-005 | 有 session 时恰好一次 `GET /v1/schedules?page=1&pageSize=1`，Bearer，无 Cookie，`scheduleCount` 取 `totalItems` |
| C-006 | 没有教师分页的 OK 体为 `forbidden`；401 为 `unauthenticated` |
| C-007 | redact 去掉 access_token、refresh_token、id_token、code_verifier |
| C-008 | 帮助含 whoami、login、config、18767、auth.innerfireai.com；不含另外两个 skill 的端口、client、命令 |
| C-009 | session 模式 0600；默认目录不是管理端或学生端目录 |
| C-010 | 未知命令为 `invalid_input`；whoami 缺 origin 为 `config`；两种都不发请求 |
