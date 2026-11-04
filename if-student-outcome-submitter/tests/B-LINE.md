# student-outcome-submitter B 线回归

版本 **v1.0 A 线已冻结**。真实执行日期：2026-09-23。环境：本机 Casdoor `http://127.0.0.1:8000`，学生应用 `aix`，client `db9af54714f47d49025f`。Payload 为本机 `http://127.0.0.1:43107`（`apps/payload` 的 `.env`，库 `127.0.0.1:25432/xai`，身份网关 `http://127.0.0.1:8888`）。

学生已在浏览器完成 PKCE，会话文件模式 0600，stdout 无 token。`GET /v1/me/schedules` 返回空列表：该主体没有 active enrollment。本地库另有 47 条日程、12 条 active enrollment，不属于这次登录的主体。没有报名，也没有 `--yes` 提交。

`https://stuxai.innerfire.ai` 对这次本机 token 返回「身份服务暂不可用」。`api.xai.localhost` 与 `student.xai.localhost` 返回 Traefik 404。本机 3000 不是 xAI Payload。

## 1) 真实环境映射单

| Mapping ID | Data ID | mock 实体 | real 实体 | 映射规则 | 风险 |
|---|---|---|---|---|---|
| M-001 | D-003 | endpoint `https://auth.example.com` | 本机 `http://127.0.0.1:8000`，学生应用 `aix`，client `db9af54714f47d49025f` | `GET /api/get-app-login` 返回 `ok`，回调端口保持 18766 | 登录服务换成本机 Casdoor，不使用管理员 client |
| M-002 | D-004 | 空 session 文件 | `XAI_STUDENT_SESSION_PATH` 指向临时文件 | 不读取、不覆盖 `~/.config/xai-student-submit/session.json` 里已有登录 | 无 |
| M-003 | D-001 | fixture 日程 101/102/103 | 当前学生 token 下 `GET /v1/me/schedules` 的真实 items | 用真实 `derivedStatus` 判断；没有 learning 日程则提交 Run 阻塞 | 不要为了测试去报名 |
| M-004 | D-002 | 基础任务 / 课程总体报告 | 该 learning 日程 experience 里开放的里程碑和 `course_report` | 实验报告只对应这一份课程总体报告 | 当前没有可列出的任务 |
| M-005 | D-007 | mock 201 | 沙箱日程上的真实 201 | 学生 API 不能删除提交；只用可丢弃的沙箱日程 | 这次没有 201 |
| M-006 | D-005 | 文件字节 `hello` | 本地小 pdf，说明固定短句 | 重交必须换说明或换文件，并看到 `versionNo` 增加 | 未执行 |

纯函数 Case（C-001、C-002、C-005、C-008–C-011、C-013–C-015、C-020、C-021）在 B 线不打 Payload。它们以 A 线复跑结果为准。

## 2) 真实执行记录

| Run ID | 冻结版本 | Case ID | 环境 | 执行结果 | 证据 |
|---|---|---|---|---|---|
| R-001 | v1.0 | C-003,C-019 | 空 session | 通过 | tests/b-line-runs/R-001.json、R-008-unauth.json：`unauthenticated`，未发请求 |
| R-002 | v1.0 | C-001,C-004 | 本机 Casdoor `aix` | 通过 | tests/b-line-runs/R-002-login.json：`loggedIn=true`，回调 `http://127.0.0.1:18766/callback`。R-002-config.json：client `db9af54714f47d49025f`，Payload `http://127.0.0.1:43107` |
| R-003 | v1.0 | C-016 | 本机 CLI | 通过 | tests/b-line-runs/R-003.json：帮助含 18766 和 `--yes` |
| R-004 | v1.0 | C-007 | 本机 Payload 43107 | 部分通过 | tests/b-line-runs/R-004-whoami.json：`authenticated=true`，`scheduleCount=0`。R-004-schedules.json：`items=[]`。没有 learning 日程，不能证明唯一选中或翻页 |
| R-005 | v1.0 | C-008,C-009 | 同上 | 阻塞 | 日程列表为空，没有 experience 可投影 |
| R-006 | v1.0 | C-006 | 同上 | 阻塞 | 该主体没有待开课或已学完日程，状态门禁未打到 |
| R-007 | v1.0 | C-012 | 同上 | 阻塞 | 没有任务可预览，不能证明预览不改变版本 |
| R-008 | v1.0 | C-011,C-022 | 空 session / 未知命令 | 部分通过 | 未知命令见 R-008-unknown.json：`invalid_input`。空提交在登录前返回 `unauthenticated`，本地预检仍以 A 线 C-011 为准 |
| R-009 | v1.0 | C-017 | 沙箱日程 | 阻塞 | 没有 learning 日程，未发 `--yes` |
| R-010 | v1.0 | C-017 | 实验报告 | 阻塞 | 同上 |
| R-011 | v1.0 | C-012,C-014 | 重交 | 阻塞 | 同上 |
| R-012 | v1.0 | C-018 | 服务端失败 | 阻塞 | 没有真实 500/409 |
| R-013 | v1.0 | C-013 | 已执行 stdout | 通过 | R-001、R-002、R-003、R-004、R-008 的 JSON 都不含 access_token |

C-002、C-005、C-010、C-014、C-015、C-020、C-021 不在上表重复打真实接口。A 线一旦复跑通过，这些 Case 在 B 线记为沿用，不另造 Run。

## 3) 缺陷归因单

| Bug ID | Case ID | 现象 | 归因 | 严重级别 | 状态 |
|---|---|---|---|---|---|
| — | — | 已登录学生的日程列表为空 | 该主体没有 active enrollment，不是接口失败 | — | 无缺陷可归 |

## 4) 回归记录单

| Regression ID | Bug ID | 关联 Case ID | 修复版本 | 回归结果 | 备注 |
|---|---|---|---|---|---|
| — | — | — | — | 未开始 | 没有待回归缺陷 |

## 5) 最终闭环报告

- 冻结版本：A 线 v1.0
- 真实执行版本：student-outcome-submitter @ 2026-09-23
- 执行环境：Casdoor `http://127.0.0.1:8000` 应用 `aix`；Payload `http://127.0.0.1:43107`
- 总 Case 数：22（A 线）
- B 线 Run：通过 4（R-001、R-002、R-003、R-013）/ 部分通过 2（R-004、R-008）/ 阻塞 7 / 失败 0
- 是否存在解冻：否
- 剩余风险：当前学生没有在学日程，里程碑和实验报告的真实提交未发生
- 准入建议：**不准入**（提交链路还没有真实 201）

附：闭环追踪表

| Case ID | Mock自检 | 冻结状态 | 真实执行 | 差异 | 结论 |
|---|---|---|---|---|---|
| C-001 | 通过 | 已冻结(v1.0) | 通过 | 浏览器登录完成，回调 18766 | 闭环 |
| C-003 | 通过 | 已冻结(v1.0) | 通过 | 空 session | 闭环 |
| C-004 | 通过 | 已冻结(v1.0) | 通过 | 本机 endpoint、client、Payload 43107 | 闭环 |
| C-007 | 通过 | 已冻结(v1.0) | 部分通过 | 列表真实为空，没有唯一 learning | 未闭环 |
| C-013 | 通过 | 已冻结(v1.0) | 通过 | 已执行 stdout 无 token | 闭环 |
| C-016 | 通过 | 已冻结(v1.0) | 通过 | help | 闭环 |
| C-019 | 通过 | 已冻结(v1.0) | 通过 | 未登录 submit 不发请求 | 闭环 |
| C-022 | 通过 | 已冻结(v1.0) | 通过 | 未知命令 `invalid_input` | 闭环 |
| 其余 Case | 通过 | 已冻结(v1.0) | 阻塞 | 没有该学生的 learning 日程 | 未闭环 |
