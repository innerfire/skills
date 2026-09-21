# casdoor-account-admin A 线测试资产

冻结版本 **v1.0（已冻结，2026-09-21）**。B 线（真实 Casdoor 回归）必须基于本文件，不得改场景语义、断言目标、预期口径或覆盖范围。

## 1) 测试范围说明

- 目标功能：平台管理员通过对话 + `scripts/casdoor.mjs` 完成「选租户 → 选功能 → 预览确认 → 账号增删改查」。
- 包含范围：OAuth PKCE 登录配置与未登录探测；租户/分组只读列举的 CLI 契约；账号命名与默认密码；dry-run / `--yes` 写保护；分组多选规范化；`update-user` 先读后改不丢字段；删除前缀匹配不误伤；错误码可解释；凭据与密码不进入 list/get 输出；SKILL 编排硬规则。
- 不包含范围：租户/分组/权限/应用的写操作；真实浏览器 OAuth 换票；真实 `add-user`/`delete-user`（这些是 B 线）；Cookie 抽取。
- 风险优先级：P0 凭据泄漏、整对象覆盖丢字段、未确认写操作、跨租户/误删；P1 批量命名与已存在不覆盖；P2 查询三种方式、分组多选、错误分类；P3 可选账号计数。
- 依赖与约束：A 线只用本地 Node、fixture envelope、无网络、无真实 session。Casdoor `https://auth.innerfireai.com`、clientId `f9000a01deab6f84d57c`、redirect `http://127.0.0.1:18765/callback` 仅作为配置断言，不发请求。默认密码 `if123456`。单批 1–100。

## 2) 业务测试点清单

| Point ID | 业务目标 | 场景类型(主流程/分支/异常/边界) | 说明 | 优先级 |
|---|---|---|---|---|
| P-001 | 登录配置与身份探测 | 主流程 | PKCE authorize URL、config 清单、未登录 whoami | P0 |
| P-002 | 租户列举契约 | 主流程 | CLI 提供 `orgs`，config 指向真实 endpoint | P0 |
| P-003 | 功能分流 | 主流程 | add / list / update / delete 均存在 | P0 |
| P-004 | 角色（Group）多选 | 主流程 | `a,b` → `owner/a, owner/b` | P1 |
| P-005 | 批量创建命名与密码 | 主流程 | `stu`×3 → stu001/002/003，密码 if123456 | P0 |
| P-006 | 账号已存在不覆盖 | 分支 | `already_exists`，不跳号 | P1 |
| P-007 | 三种查询方式 | 主流程 | `--exact` / `--query` / `--all` | P1 |
| P-008 | 修改先读后改 | 主流程 | 改 groups 保留 email，去掉 password | P0 |
| P-009 | 删除二次确认与匹配边界 | 主流程 | 无 `--yes` 为 dry-run；前缀只匹配数字后缀 | P0 |
| P-010 | 失败可解释 | 异常 | envelope 错误映射为 code | P0 |
| P-011 | 凭据与密码不回显 | 主流程 | redact / publicUser 不含 password | P0 |
| P-012 | 写操作必须预览 | 主流程 | 缺 `--yes` 只 dry-run；缺 owner 失败 | P0 |
| P-013 | 前缀与数量校验 | 边界 | 2–16 字母数字；数量 1–100 | P1 |
| P-014 | 按前缀删除不误伤 | 边界 | `stu` 不匹配 `student` | P0 |
| P-015 | 分组 ID 规范化 | 主流程 | 已带 owner 的不双写 | P1 |
| P-016 | 序号补零与扩位 | 边界 | 001；1000 为四位 | P1 |
| P-017 | 未登录中止 | 异常 | whoami → unauthenticated | P0 |
| P-018 | 重置密码需确认 | 分支 | usage 含 reset-password 与可选 `--yes` | P1 |
| P-019 | 批次单条失败码 | 异常 | already_exists 可单独标记 | P1 |
| P-020 | SKILL 编排硬规则 | 主流程 | 禁止手写 curl；必须 `--yes`；角色=Group | P0 |

## 3) 测试用例清单

| Case ID | Point ID | 场景名称 | 前置条件 | 输入 | 步骤 | 预期结果 | 优先级 | 覆盖类型 |
|---|---|---|---|---|---|---|---|---|
| C-001 | P-013 | 前缀非法拒绝 | 无网络 | `s` / `stu_1` / 超长 / `stu` | validatePrefix | 仅 `stu` ok | P1 | 负向/正向 |
| C-002 | P-013 | 数量非法拒绝 | 无网络 | 0 / -1 / 101 / 3 / 100 | validateCount | 仅 1–100 的整数 ok | P1 | 边界 |
| C-003 | P-005/P-016 | 生成名单补零扩位 | 无网络 | prefix=stu count=3；seq 1000 | generateNames / formatSeq | stu001/002/003；1000→`1000` | P0 | 正向/边界 |
| C-004 | P-014 | 生成名正则 | 无网络 | stu001 / student / stu-001 | generatedNamePattern | 仅 stu001 true | P0 | 边界 |
| C-005 | P-010 | envelope 登录失败 | fixture | `{status:error,msg:Please sign in first}` | unwrapEnvelope | throw code=unauthenticated | P0 | 异常 |
| C-006 | P-010 | 错误分类 | fixture 文案 | sign in / no permission / already exists / redirect_uri | classifyCasdoorError | 对应 unauthenticated/forbidden/already_exists/config | P0 | 异常 |
| C-007 | P-004/P-015 | 分组多选规范化 | owner=acme | `a,b` 与 `acme/students` | parseGroupList / normalizeGroupId | `acme/a,acme/b`；不双写 | P1 | 正向 |
| C-008 | P-008 | 改分组不丢邮箱 | 完整 user fixture | patch.groups | mergeUserUpdate | email 保留；password 剥离 | P0 | 正向 |
| C-009 | P-011 | redact 去密 | user 含 password/totpSecret | redactUser | 无 password | P0 | 正向 |
| C-010 | P-001 | authorize URL | DEFAULTS | buildAuthorizeUrl | origin/clientId/redirect/S256/offline_access；无 client_secret | P0 | 正向 |
| C-011 | P-005/P-012 | add-batch dry-run | 无 session | `--owner acme --prefix stu --count 3 --groups students` 无 `--yes` | dispatch | dryRun=true，三账号，密码 if123456 | P0 | 正向 |
| C-012 | P-012 | 缺 owner / 数量 0 | 无网络 | 缺 owner；count=0 | dispatch add-batch | code=invalid_input | P0 | 负向 |
| C-013 | P-001/P-017 | 未登录 whoami | 空 session 路径 | whoami | dispatch | code=unauthenticated | P0 | 异常 |
| C-014 | P-001/P-002 | config 默认值 | 无环境覆盖 | config | dispatch | endpoint/clientId/redirect 与生产一致 | P0 | 正向 |
| C-015 | P-011 | publicUser 无密码 | user fixture | publicUser | 无 password 字段 | P0 | 正向 |
| C-016 | P-008 | 停用映射 isForbidden | user fixture | patch isForbidden=true | merge 后 isForbidden true，email 仍在 | P0 | 正向 |
| C-017 | P-005 | 默认密码常量 | 无 | DEFAULT_PASSWORD / parseArgs | `if123456` | P0 | 正向 |
| C-018 | P-006/P-019 | 已存在错误码 | fixture msg | classify / unwrap | code=already_exists | P1 | 分支 |
| C-019 | P-009/P-018 | help 含写保护命令 | 无 | --help | reset-password、delete、[--yes] | P1 | 正向 |
| C-020 | P-003/P-007 | help 含四类功能与查询 | 无 | --help | add/list/update/delete 与 exact/query/all | P0 | 正向 |
| C-021 | P-020 | SKILL 硬规则文本 | SKILL.md | 读文件 | 含 curl 禁止、`--yes`、Group、if123456 | P0 | 正向 |
| C-022 | P-011 | authorize 不含 secret | PKCE | createPkce + buildAuthorizeUrl | URL 无 client_secret、无 verifier | P0 | 正向 |
| C-023 | P-010 | 非 JSON 形状 | `[]` / null | unwrapEnvelope | throw casdoor | P2 | 异常 |
| C-024 | P-008 | 空对象不可 merge | existing=null | mergeUserUpdate | code=not_found | P1 | 异常 |

## 4) 断言清单

| Assert ID | Case ID | 断言对象 | 断言条件 | 失败判定 | 备注 |
|---|---|---|---|---|---|
| A-001 | C-001 | validatePrefix | 非法 false、stu true | 任一相反 | |
| A-002 | C-002 | validateCount | 0/-1/101 false；3/100 true | 超上限被放行 | |
| A-003 | C-003 | names/formatSeq | 等于 stu001..003；formatSeq(1000)=1000 | 跳号或未补零 | |
| A-004 | C-004 | regexp | stu001 true；student/stu-001 false | 误匹配 student | |
| A-005 | C-005 | thrown.code | === unauthenticated | 静默或其它 code | |
| A-006 | C-006 | classify 四类 | 与表 3 一致 | 文案映射错 | |
| A-007 | C-007 | group ids | 多选带 owner 且不双写 | `acme/acme/x` | |
| A-008 | C-008 | merged user | email 保留；无 password/passwordSalt | 覆盖丢字段 | P0 |
| A-009 | C-009 | redacted | password undefined | 明文回显 | P0 |
| A-010 | C-010 | authorize URL | client_id、redirect、S256、offline_access | 缺 PKCE | |
| A-011 | C-011 | dryRun payload | 3 名、groups=[acme/students]、password=if123456 | 直接写 | |
| A-012 | C-012 | thrown.code | invalid_input | 默认取空 owner | |
| A-013 | C-013 | thrown.code | unauthenticated | 误打网络 | |
| A-014 | C-014 | config | endpoint=https://auth.innerfireai.com；redirect 端口 18765 | 配错环境 | |
| A-015 | C-015 | publicUser | !('password' in obj) 或 password 为空缺 | | |
| A-016 | C-016 | merged.isForbidden | true 且 email 不变 | | |
| A-017 | C-017 | DEFAULT_PASSWORD | === if123456 | | |
| A-018 | C-018 | code | already_exists | 当 ok 处理 | |
| A-019 | C-019 | help 文本 | 含 reset-password 与 yes | | |
| A-020 | C-020 | help 文本 | 含四类 + exact/query/all | 缺分流 | |
| A-021 | C-021 | SKILL.md | 含「不要手写 curl」、`--yes`、`Group`、`if123456` | | |
| A-022 | C-022 | authorize URL | 不含 client_secret 与 verifier | 泄漏 PKCE | |
| A-023 | C-023 | unwrap | throw | 当 ok | |
| A-024 | C-024 | merge | throw not_found | 空读后写 | |

## 5) mock 数据基线

| Data ID | Case ID | mock 输入 | mock 输出 | 关键断言点 | 将来真实映射说明 |
|---|---|---|---|---|---|
| D-001 | C-001 | 前缀字符串 | `{ok,value/error}` | 规则与 naming.md 一致 | 用户对话输入 |
| D-002 | C-002 | 数量 | 同上 | 上限 100 | `--count` |
| D-003 | C-003 | stu,3 | [stu001,stu002,stu003] | 补零 | add-batch 预览名单 |
| D-004 | C-005 | envelope error sign-in | throw unauthenticated | P0 探测 | GET /api/get-account 未登录 |
| D-005 | C-006 | 四类 msg | 四类 code | 失败可解释 | Casdoor msg 原文 |
| D-006 | C-007 | owner=acme groups=a,b | [acme/a,acme/b] | 多选 | `--groups` |
| D-007 | C-008 | user+password+email+groups | merge 后无 password、email 仍在 | 先读后改 | GET user → POST update-user |
| D-008 | C-010 | DEFAULTS+pkce | authorize URL | PKCE | 浏览器登录 |
| D-009 | C-011 | argv add-batch 无 yes | `{dryRun:true, users[3]}` | 预览关卡 | 确认后再 --yes |
| D-010 | C-013 | 不存在的 session 文件 | throw unauthenticated | 不发请求 | 无 ~/.config session |
| D-011 | C-014 | 默认 env | 生产 endpoint/clientId/redirect | 配置 | Casdoor 应用 |
| D-012 | C-018 | msg=User already exists | already_exists | 不覆盖 | POST /api/add-user 冲突 |
| D-013 | C-021 | SKILL.md 正文 | 四条硬规则均在 | 编排 | 对话代理 |
| D-014 | C-016 | isForbidden patch | 停用且 email 保留 | 启用停用 | `--enabled false` |
| D-015 | C-024 | existing=null | not_found | 改前必 GET | 并发删除 |

| D-016 | C-004 | stu001 / student / stu-001 | true/false/false | 不误删 student | delete-batch --prefix |
| D-017 | C-009 | `{name,password,totpSecret}` | password 被删 | 查询不回显密 | get-user 输出 |
| D-018 | C-012 | 缺 --owner；--count 0 | invalid_input | 不默认第一租户 | 对话补参 |
| D-019 | C-015 | user 含 password | publicUser 无该键 | list/get 列 | GET /api/get-user |
| D-020 | C-017 | 常量 / add-batch dry-run | if123456 | 弱口令提示 | add-user.password |
| D-021 | C-019 | --help 文本 | 含 reset-password 与 [--yes] | 重置需确认 | reset-password 命令 |
| D-022 | C-020 | --help 文本 | 四类功能 + exact/query/all | 功能分流 | 对话菜单 |
| D-023 | C-022 | createPkce() | URL 有 challenge 无 verifier | PKCE 不泄漏 | 浏览器 authorize |
| D-024 | C-023 | `[]` / null | throw casdoor | 非 envelope | 异常 HTML/空体 |

## 6) 测试脚本清单

| Script ID | Case ID 列表 | 执行层级(单测/接口/端到端) | 脚本文件路径 | 运行前置 | 执行命令/方式 | 输出物 |
|---|---|---|---|---|---|---|
| S-001 | C-001,C-002,C-003,C-004,C-005,C-006,C-007,C-008,C-009,C-010,C-011,C-012,C-015,C-017 | 单测 | casdoor-account-admin/scripts/casdoor.test.mjs | Node 18+ | `node --test casdoor-account-admin/scripts/casdoor.test.mjs` | TAP/node:test |
| S-002 | C-013,C-014,C-015,C-016,C-018,C-019,C-020,C-021,C-022,C-023,C-024 | 单测 | casdoor-account-admin/tests/a-line.test.mjs | Node 18+；可读 SKILL.md | `node --test casdoor-account-admin/tests/a-line.test.mjs` | TAP/node:test |

## 7) 测试脚本文件清单

| 路径 | 执行命令 | 关联 Case ID |
|---|---|---|
| casdoor-account-admin/scripts/casdoor.test.mjs | `node --test casdoor-account-admin/scripts/casdoor.test.mjs` | C-001–C-012,C-015,C-017 |
| casdoor-account-admin/tests/a-line.test.mjs | `node --test casdoor-account-admin/tests/a-line.test.mjs` | C-013–C-016,C-018–C-024 |

## 8) A 线脚本自测结果

| SelfTest ID | Script ID | 执行结果(通过/失败/阻塞) | 日志/输出摘要 | 失败原因 | 处理结论 |
|---|---|---|---|---|---|
| ST-001 | S-001 | 通过 | 13 tests pass, fail 0 | — | 可冻结 |
| ST-002 | S-002 | 通过 | 11 tests pass, fail 0；合计 24 pass / 0 fail / 394ms | — | 可冻结 |

## 9) mock 自检

| 检查项 | 结果 | 说明 |
|---|---|---|
| 合理性 | 通过 | envelope `{status,msg,data}`、authorize 参数、dry-run argv 与真实 CLI/Casdoor 形状一致 |
| 有效性 | 通过 | 负向用例会 throw（C-001/002/005/012/013/023/024）；误匹配 student 会被断言抓住 |
| 一致性 | 通过 | Point P-001–P-020 均有 Case；Case C-001–C-024 均有 Assert 与 Data；S-001/S-002 覆盖全部 Case |
| 覆盖性 | 通过 | 主流程/分支/异常/边界均有 Point；P0 风险（覆盖丢失、未确认写入、凭据、误删、未登录）均有 Case |

## 10) 测试资产冻结单

- 冻结版本：v1.0
- 冻结时间：2026-09-21
- 冻结范围（Case/Assert/Script/Data）：C-001–C-024 / A-001–A-024 / S-001,S-002 / D-001–D-024
- 覆盖 Case ID：C-001,C-002,C-003,C-004,C-005,C-006,C-007,C-008,C-009,C-010,C-011,C-012,C-013,C-014,C-015,C-016,C-017,C-018,C-019,C-020,C-021,C-022,C-023,C-024
- 覆盖 Script ID：S-001,S-002
- 覆盖 Data ID：D-001,D-002,D-003,D-004,D-005,D-006,D-007,D-008,D-009,D-010,D-011,D-012,D-013,D-014,D-015,D-016,D-017,D-018,D-019,D-020,D-021,D-022,D-023,D-024
- mock 自检结果：合理性/有效性/一致性/覆盖性均通过，无阻塞
- 审核结论：冻结。mock 通过不代表产品通过。B 线需登录 `https://auth.innerfireai.com` 后按同一 Case 做真实映射，不得改断言口径。
