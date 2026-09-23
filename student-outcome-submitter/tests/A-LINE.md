# student-outcome-submitter A 线测试资产

冻结版本 **v1.0（已冻结，2026-09-23）**。B 线必须沿用这里的场景语义、断言目标和预期口径，不得为了让实现通过而改断言。

mock 通过不代表产品通过。真实提交以 B 线为准。

## 1) 测试范围说明

- 目标功能：学生账号经浏览器 PKCE 登录后，在对话里选定正在学习的日程和一项任务，预览确认，再提交里程碑或实验报告。实验报告就是课程总体报告 `course_report`，一门课一份，不挂章。
- 包含范围：学生应用 PKCE 配置；未登录不发请求；日程状态门禁；任务投影与点名；提交预检；无 `--yes` 不 POST；确认后恰好一次 multipart；幂等键；错误码；凭据不进入输出；session 文件权限。
- 不包含范围：`SKILL.md` 文案；真实浏览器换票；真实 Payload 写入（这些是 B 线）；报名；下载模板；按目录批量匹配；教师代交；评价；复用 `casdoor-account-admin` 的 session 或 clientId。
- 风险优先级：P0 凭据泄漏、未确认写入、未开放仍提交、把失败当成已提交；P1 任务认错、重交未提示、幂等键漂移、分页丢数据；P2 帮助文案与扩展名清单。
- 依赖与约束：A 线只用本地 Node 24、fixture JSON、`global fetch` mock。不访问网络，不读真实 `~/.config`。默认 Casdoor endpoint `https://auth.innerfireai.com`。redirect 固定 `http://127.0.0.1:18766/callback`，忽略环境变量覆盖。学生 clientId 无默认值，禁止落到管理员 client `f9000a01deab6f84d57c`。Payload origin 无默认值，尾部 `/` 去掉。

锁定导出（实现必须从 `scripts/submit.mjs` 提供）：`DEFAULTS`、`SUBMISSION_EXTENSIONS`、`buildAuthorizeUrl`、`createPkce`、`parseArgs`、`dispatch`、`redact`、`validateSubmission`、`projectTasks`、`resolveSchedule`、`resolveTask`、`idempotencyKeyFor`、`classifyApiError`、`unwrapEnvelope`、`writeSession`、`loadRuntimeConfig`。

失败对象是带 `code` 的 `Error`。`validateSubmission` 成功时返回 `{ ok: true, comment, files }`，comment 已 trim。幂等键是下面这个 canonical JSON 的 SHA-256 十六进制，comment 先 trim，files 按 `name` 再按 `sha256` 排序。`name` 用 basename，`sha256` 是文件原始字节：

```json
{ "scheduleId": "", "taskId": "", "comment": "", "files": [{ "name": "", "sha256": "" }] }
```

## 2) 业务测试点清单

| Point ID | 业务目标 | 场景类型 | 说明 | 优先级 |
|---|---|---|---|---|
| P-001 | 学生 PKCE 配置 | 主流程 | 授权 URL、S256、端口 18766、scope 不含 offline_access | P0 |
| P-002 | 未登录中止 | 异常 | whoami / submit 在没有 session 时不调用 fetch | P0 |
| P-003 | 身份配置不串台 | 主流程 | clientId 必填；redirect 不可改到 18765；origin 去尾斜杠 | P0 |
| P-004 | 多门课不默认 | 分支 | 两门 learning 且未指定 id 为 ambiguous | P0 |
| P-005 | 日程状态门禁 | 分支 | pending / completed 在拉 experience 之前拒绝 | P0 |
| P-006 | 任务投影 | 主流程 | 里程碑保留章名；锁章视为未开放；实验报告单独一条 | P0 |
| P-007 | 任务点名 | 主流程 | 精确名、报告别名、重名不猜、id 优先于名 | P0 |
| P-008 | 不可提交 | 异常 | 任务关闭、章关闭、回看/预览 | P0 |
| P-009 | 本地预检 | 边界 | 说明与文件、4000 字、10 个、50 MB、合计 100 MB、类型 | P0 |
| P-010 | 写保护 | 主流程 | 无 `--yes` 不 POST，并标出是否重交 | P0 |
| P-011 | 凭据不回显 | 主流程 | redact 去掉嵌套 token | P0 |
| P-012 | 幂等键 | 主流程 | 同一份 trim 后的内容键稳定，内容变了键变 | P0 |
| P-013 | 错误可解释 | 异常 | HTTP / envelope 映射为稳定 code | P0 |
| P-014 | 扩展名清单 | 边界 | 与 submission_result 允许的扩展名一致 | P1 |
| P-015 | 帮助与缺参 | 主流程 | 命令面完整；缺参和未知命令在发请求前失败 | P1 |
| P-016 | 分页 | 边界 | `hasNextPage` 时保留后续页 | P1 |
| P-017 | 确认后提交 | 主流程 | `--yes` 恰好一次 multipart，失败不算已提交 | P0 |
| P-018 | session 权限 | 主流程 | 文件模式 0600 | P0 |

## 3) 测试用例清单

| Case ID | Point ID | 场景名称 | 前置条件 | 输入 | 步骤 | 预期结果 | 优先级 | 覆盖类型 |
|---|---|---|---|---|---|---|---|---|
| C-001 | P-001 | 授权 URL | 无网络 | 学生 client 与 DEFAULTS | buildAuthorizeUrl | origin、client_id、redirect 18766、S256、scope=`openid profile email`；无 client_secret、verifier、offline_access | P0 | 正向 |
| C-002 | P-001 | PKCE 算法 | 无网络 | createPkce | challenge = base64url(SHA-256(verifier))；URL 不含 verifier | P0 | 正向 |
| C-003 | P-002 | 未登录 whoami | 空 session 路径 | whoami | dispatch | code=unauthenticated；fetch 0 次 | P0 | 异常 |
| C-004 | P-003 | 配置不串台 | env 可覆盖 endpoint / client / origin | 把 redirect 设成 18765；删掉 clientId | loadRuntimeConfig / buildAuthorizeUrl / config | redirect 仍是 18766；缺 clientId 为 `config`；origin 无尾斜杠；不是管理员 client；默认 endpoint 为 auth.innerfireai.com | P0 | 负向 |
| C-005 | P-004 | 多日程不默认 | fixture 再加一门 learning | 不传 id；传未知 id；传第二门 id | resolveSchedule | ambiguous；not_found；指定 id 命中第二门 | P0 | 分支 |
| C-006 | P-005 | 非学习日程 | 已写 session；mock 只提供日程列表 | submit 待开课 / 已学完 | dispatch | schedule_not_started / schedule_completed；不请求 experience 或 submissions | P0 | 负向 |
| C-007 | P-005/P-016 | 唯一日程与翻页 | fixture 仅一门 learning；mock 两页 | resolveSchedule；schedules list | 选中 101；列表含第一页和第二页 | P1 | 正向/边界 |
| C-008 | P-006 | 任务投影 | experience fixture | projectTasks | 里程碑带章名；锁章 open=false；已交 resubmit=true；报告 chapterTitle=null 且只有一条 | P0 | 正向 |
| C-009 | P-007 | 点名 | fixture；克隆一份重名里程碑 | 基础任务；实验报告/课程总体报告/课程报告；不存在；重名；id 与错误名同时给 | 唯一命中；别名命中报告；not_found；ambiguous；id 优先 | P0 | 正向/分支 |
| C-010 | P-008 | 不可提交 | 关闭任务、锁章、review、schedule_preview | resolveTask | task_closed；非 learning 一律 not_submittable（先于 task_closed） | P0 | 异常 |
| C-011 | P-009 | 预检边界 | 无网络 | 空白说明、说明 4000/4001、0/10/11 文件、50 MB 与 +1、合计 100 MB 与超出、exe、MIME 不符、大写 PDF | validateSubmission | 空为 invalid_input；超长 invalid_input；超大小 too_large；上限本身允许；类型不符 invalid_input | P0 | 边界 |
| C-012 | P-010 | 预览不写 | session + mock GET | submit 无 `--yes`，分别指向未交和已交任务 | dispatch | dryRun=true；resubmit 分别为 false/true；无 submissions 请求；输出无 token | P0 | 正向 |
| C-013 | P-011 | 凭据剥离 | 嵌套 token | redact | access_token、refresh_token、id_token、code_verifier 消失；业务字段还在 | P0 | 正向 |
| C-014 | P-012 | 幂等键 | 无网络 | 同一内容、文件顺序对调、comment 空格、改 comment、改 sha | idempotencyKeyFor | 前三相同且为 64 位十六进制；后两不同 | P0 | 正向/边界 |
| C-015 | P-013 | 错误分类 | fixture envelope | 401/403/409/413/400/500/网络；OK body；数组和 null | classifyApiError / unwrapEnvelope | unauthenticated、forbidden、idempotency_conflict、too_large、invalid_input、internal、unreachable、protocol；OK 只返回 data | P0 | 异常 |
| C-016 | P-015 | 帮助 | 无 session | `--help` | dispatch | 含 whoami、login、schedules list、tasks list、submit、`--yes`、`--schedule`、`--task`、`--file`、`--comment`、18766；不含 client_secret、管理员 client、add-user；fetch 0 次 | P1 | 正向 |
| C-017 | P-017 | 确认提交 | session + mock | 带 `--yes` 的 pdf 和说明 | dispatch | 恰好一次 POST 到该 task 的 submissions；Bearer；无 Cookie；Idempotency-Key 等于 canonical；comment 为 trim 后的说明；一个 file 字段；submitted=true；无 dryRun；versionNo=1；输出无 token | P0 | 正向 |
| C-018 | P-017 | 失败不算已交 | session + mock 500 / 409 | 带 `--yes` | dispatch | code=internal / idempotency_conflict；没有 submitted；错误文本无 token | P0 | 异常 |
| C-019 | P-002 | 未登录 submit | 空 session | 带 `--yes` 和文件路径 | dispatch | code=unauthenticated；fetch 0 次 | P0 | 异常 |
| C-020 | P-018 | session 权限 | 临时目录 | writeSession | 模式 0600 | P0 | 正向 |
| C-021 | P-014 | 扩展名 | 无网络 | SUBMISSION_EXTENSIONS | 排序后等于 submission_result 扩展名全集 | P1 | 正向 |
| C-022 | P-015 | 缺参 | 无 session | 未知命令；submit 缺 schedule；tasks list 缺 schedule | parseArgs / dispatch | code=invalid_input；fetch 0 次 | P1 | 负向 |

## 4) 断言清单

| Assert ID | Case ID | 断言对象 | 断言条件 | 失败判定 |
|---|---|---|---|---|
| A-001 | C-001 | authorize URL | 学生 client、18766、S256、openid profile email | 串到管理员应用或 18765 |
| A-002 | C-002 | pkce | challenge 算法正确且 URL 无 verifier | verifier 泄漏 |
| A-003 | C-003 | whoami | unauthenticated 且 fetch 次数为 0 | 未登录仍打网络 |
| A-004 | C-004 | runtime config | redirect 固定；缺 clientId 抛 config；origin 无斜杠 | 默默使用管理员 client |
| A-005 | C-005 | resolveSchedule | 多门 ambiguous，未知 not_found | 默认第一门 |
| A-006 | C-006 | dispatch submit | 两个日程 code 正确且未请求 experience/submissions | 未开课仍上传 |
| A-007 | C-007 | 列表 | 唯一 learning 被选中；两页 id 都在 | 丢掉第二页 |
| A-008 | C-008 | projectTasks | 章、open、resubmit、唯一 course_report | 报告挂到章上或锁章仍开放 |
| A-009 | C-009 | resolveTask | 别名、id 优先、重名 ambiguous | 模糊猜中 |
| A-010 | C-010 | resolveTask | task_closed / not_submittable 的先后 | 回看仍可交 |
| A-011 | C-011 | validateSubmission | 空、长度、个数、单文件、合计、类型 | 超限被放行 |
| A-012 | C-012 | dryRun | 无 POST，resubmit 与任务现状一致 | 预览即写入 |
| A-013 | C-013 | redact | 四种凭据键消失 | 明文回显 |
| A-014 | C-014 | idempotency key | 与 canonical SHA-256 相同 | 重试换键或改文件仍同键 |
| A-015 | C-015 | classify / unwrap | 七类 code 与 protocol | 失败被当成 OK |
| A-016 | C-016 | help | 命令面在，管理员命令不在 | 帮助把人带到账号管理 |
| A-017 | C-017 | POST | 一次 multipart，键与说明正确，submitted=true | 重复 POST 或没带幂等键 |
| A-018 | C-018 | 失败 | internal / idempotency_conflict，且无 submitted | 500 仍报已交 |
| A-019 | C-019 | submit | unauthenticated 且 fetch 次数为 0 | 无登录却读文件上传 |
| A-020 | C-020 | session mode | `& 0o777 === 0o600` | 凭据文件过宽 |
| A-021 | C-021 | extensions | 深度等于允许清单 | 漏掉 pdf 或放进 exe |
| A-022 | C-022 | argv | invalid_input 且 fetch 次数为 0 | 缺参打到服务端 |

## 5) mock 数据基线

| Data ID | Case ID | mock 输入 | mock 输出 | 关键断言点 | 将来真实映射说明 |
|---|---|---|---|---|---|
| D-001 | C-005,C-006,C-007 | `tests/fixtures/schedules.json` | 一门 learning、一门 pending、一门 completed | 状态门禁 | `GET /v1/me/schedules` 的 `data.items` |
| D-002 | C-008,C-009,C-010,C-012 | `tests/fixtures/experience-learning.json` | 三枚里程碑、一枚锁章任务、一份课程总体报告 | 投影与点名 | `GET /v1/schedules/{id}/experience` 的 data |
| D-003 | C-001,C-002,C-004 | endpoint `https://auth.example.com`，client `student-public-client` | 授权 URL | 不串台 | 学生 Casdoor Application |
| D-004 | C-003,C-019 | 不存在的 session 文件 | unauthenticated | 不发请求 | 无 `~/.config/xai-student-submit/session.json` |
| D-005 | C-014,C-017 | comment `说明`，文件字节 `hello` | 64 位十六进制键 | 预览与 POST 使用同一键 | `Idempotency-Key` |
| D-006 | C-015 | 统一 envelope | data 或 code | 失败可解释 | Payload `code/message/traceId` |
| D-007 | C-017 | 201 envelope | submitted=true，versionNo=1 | 确认后才写 | `POST .../submissions` |
| D-008 | C-018 | 500 / 409 envelope | internal / idempotency_conflict | 失败不标记已交 | 服务端错误 |
| D-009 | C-013 | 嵌套 access_token 等 | 这些键被删除 | 不回显 | CLI JSON |
| D-010 | C-007 | 两页日程，第二页 `...104` | 两个 scheduleId | 翻页 | `meta.pagination.hasNextPage` |
| D-011 | C-011 | 边界字节数与扩展名 | ok 或 invalid_input / too_large | 上限含等号 | `submission_result` 策略 |
| D-012 | C-020 | `{access_token:token-secret}` | mode 0600 | 凭据文件 | session 路径可用 `XAI_STUDENT_SESSION_PATH` 隔离 |

日程与任务 id：

| 含义 | id |
|---|---|
| 正在学习 | `018f0000-0000-7000-8000-000000000101` |
| 待开课 | `018f0000-0000-7000-8000-000000000102` |
| 已学完 | `018f0000-0000-7000-8000-000000000103` |
| 第二门正在学习（翻页/歧义） | `018f0000-0000-7000-8000-000000000104` |
| 基础任务 | `018f0000-0000-7000-8000-000000000201` |
| 关闭任务 | `018f0000-0000-7000-8000-000000000202` |
| 已交任务 | `018f0000-0000-7000-8000-000000000203` |
| 锁章任务 | `018f0000-0000-7000-8000-000000000204` |
| 课程总体报告 / 实验报告 | `018f0000-0000-7000-8000-000000000301` |

## 6) 测试脚本清单

| Script ID | Case ID 列表 | 执行层级 | 脚本文件路径 | 运行前置 | 执行命令 | 输出物 |
|---|---|---|---|---|---|---|
| S-001 | C-001–C-022 | 单测 | student-outcome-submitter/tests/a-line.test.mjs | Node 24 | `node --test student-outcome-submitter/tests/a-line.test.mjs` | TAP/node:test |

`SKILL.md` 硬规则不在本轮 Case 里。等 skill 正文落地后另加用例，不回头改 C-001–C-022 的口径。

## 7) 测试脚本文件清单

| 路径 | 执行命令 | 关联 Case ID |
|---|---|---|
| student-outcome-submitter/tests/a-line.test.mjs | `node --test student-outcome-submitter/tests/a-line.test.mjs` | C-001–C-022 |
| student-outcome-submitter/tests/fixtures/schedules.json | 由 S-001 读取 | D-001 |
| student-outcome-submitter/tests/fixtures/experience-learning.json | 由 S-001 读取 | D-002 |

## 8) A 线脚本自测结果

| SelfTest ID | Script ID | 执行结果 | 日志/输出摘要 | 失败原因 | 处理结论 |
|---|---|---|---|---|---|
| ST-001 | S-001 | 通过 | Node v24.21.0；tests 22 / pass 22 / fail 0；784 ms | — | 可冻结。C-011 的 `toHaveLength` 写法不是 node:assert，已改为断言 `files.length`，预期仍是 1 个和 10 个文件通过 |

## 9) mock 自检

| 检查项 | 结果 | 说明 |
|---|---|---|
| 合理性 | 通过 | fixture 字段对齐 `GET /v1/me/schedules` 与 `GET /v1/schedules/{id}/experience`；提交限额对齐现有 `submission_result` 策略与 `createTaskSubmission` |
| 有效性 | 通过 | 负向用例会 throw（C-003、C-005、C-006、C-010、C-011、C-018、C-019、C-022） |
| 一致性 | 通过 | P-001–P-018 均有 Case；C-001–C-022 均有 Assert 与脚本中的同名 test；D-001–D-012 覆盖会发请求和纯函数的输入 |
| 覆盖性 | 通过 | 主流程、分支、异常、边界都有 Point。P0 覆盖凭据、未确认写入、未开放提交、失败误报已交 |

## 10) 测试资产冻结单

- 冻结版本：v1.0
- 冻结时间：2026-09-23
- 冻结范围：C-001–C-022 / A-001–A-022 / S-001 / D-001–D-012
- mock 自检结果：合理性、有效性、一致性、覆盖性均通过
- 审核结论：A 线冻结。mock 通过不代表产品通过。B 线仍须按同一口径做真实映射。
