# casdoor-account-admin B 线回归

冻结版本 **v1.0**。真实执行版本：当前工作区 `casdoor-account-admin`（未单独打 tag）。执行环境：`https://auth.innerfireai.com`，登录身份 `built-in/admin`。执行日期：2026-09-21。

测试号已删除。admin 显示名仍为「超级超管」，未被 dry-run 改写。

## 1) 真实环境映射单

| Mapping ID | Data ID | mock 实体 | real 实体 | 映射规则 | 风险 |
|---|---|---|---|---|---|
| M-001 | D-011 | endpoint auth.innerfireai.com | 同左 | 1:1 | 无 |
| M-002 | D-010 | 空 session 文件 | `CASDOOR_SESSION_PATH=/tmp/casdoor-b-line-no-session.json` | 不碰真实 session | 无 |
| M-003 | D-009 | owner `acme` | 登录身份 `built-in/admin`；写操作租户 `demo` | built-in 不能建用户是 Casdoor 预期；平台管理员跨租户写 demo | 无 |
| M-004 | D-003 | 前缀 `stu` / stu001 | 命名口径仍用 `stu`（R-013）；落库测试号前缀 `abt` | 标识映射，补零规则不变 | 无 |
| M-005 | D-006 | groups `students` | `demo/xai_teacher` 与 `demo/xai_student` 各一 | 创建时绑定，不是事后改组 | 无 |
| M-006 | D-007 | fixture user | `demo/abt001` | 先读后改 | 无 |
| M-007 | D-012 | already exists fixture | 对 `demo` 重复 add-batch | 文案为 Username already exists | 无 |
| M-008 | D-016 | 负向名 `student` | delete-batch `--prefix abt` 不得包含非 `abt\\d+` | 本轮 demo 无 abtstudent | 低 |

映射说明：登录用 `built-in/admin`，账号写在 `demo`。built-in 禁止新建用户是 Casdoor 预期，不记缺陷。

## 2) 真实执行记录

| Run ID | 冻结版本 | Case ID | 环境 | 执行结果(通过/失败/阻塞) | 证据链接/日志 |
|---|---|---|---|---|---|
| R-001 | v1.0 | C-014 | built-in whoami | 通过 | tests/b-line-runs/R-001.json 身份 admin |
| R-002 | v1.0 | C-010,C-014 | config | 通过 | R-002.json |
| R-003 | v1.0 | C-020 | orgs | 通过 | 含 built-in/demo/scu |
| R-004 | v1.0 | C-007 | groups built-in | 通过 | total=0 |
| R-005 | v1.0 | C-001 | prefix `s` | 通过 | invalid_input |
| R-006 | v1.0 | C-001 | prefix `stu_1` | 通过 | invalid_input |
| R-007 | v1.0 | C-002 | count 0 | 通过 | invalid_input |
| R-008 | v1.0 | C-012 | 缺 owner | 通过 | invalid_input |
| R-009 | v1.0 | C-002 | count 101 | 通过 | invalid_input |
| R-010 | v1.0 | C-011,C-007,C-017 | add-batch dry-run | 通过 | abt001–003；groups 规范化；密码 if123456 |
| R-011 | v1.0 | C-019,C-020 | help | 通过 | 含 CRUD / exact/query/all / reset-password / [--yes] |
| R-012 | v1.0 | C-005,C-013 | 空 session whoami | 通过 | unauthenticated；真实 session 未丢 |
| R-013 | v1.0 | C-003,C-016 | names stu×3 | 通过 | stu001/002/003 |
| R-014 | v1.0 | C-005,P-005 | add-batch built-in --yes | 阻塞 | Casdoor 禁止向 built-in 建用户；msg 完整返回 |
| R-030 | v1.0 | C-009,C-015 | get admin | 通过 | 无 password 字段 |
| R-032 | v1.0 | C-007 | list --all built-in | 通过 | 仅 admin |
| R-033 | v1.0 | C-012 | update admin 无 --yes | 通过 | dryRun；R-039 显示名仍为超级超管 |
| R-034 | v1.0 | C-019 | delete admin 无 --yes | 通过 | dryRun，未删除 |
| R-038 | v1.0 | C-003,C-017 | add-batch demo --yes | 通过 | success 3 |
| R-040 | v1.0 | C-018,C-019 | 重复建号 | 通过 | already_exists ×3，未覆盖 |
| R-041 | v1.0 | C-007 | list --exact | 通过 | abt001 |
| R-042 | v1.0 | C-007 | list --query | 通过 | 3 条 |
| R-043 | v1.0 | C-009,C-015 | get abt001 | 通过 | 无 password |
| R-045 | v1.0 | C-008 | 改 groups 保 email | 通过 | email 仍为 abt001@innerfireai.com |
| R-047 | v1.0 | C-016 | --enabled false | 通过 | isForbidden=true，email/groups 仍在 |
| R-050 | v1.0 | C-018 | reset 无 --yes | 通过 | dryRun |
| R-051 | v1.0 | C-018 | reset 默认 if123456 | 失败 | 新密码不能与当前相同 |
| R-052 | v1.0 | C-004,C-009 | delete-batch dry-run | 通过 | 仅 abt001–003 |
| R-054 | v1.0 | C-009 | 清理删除 | 通过 | 3 条删除成功 |
| R-055 | v1.0 | C-007 | query abt 应空 | 通过 | total=0 |
| R-056 | v1.0 | C-012 | admin 未变 | 通过 | 超级超管 |

C-021：SKILL.md 硬规则仍在，通过（与 A 线同一文件）。C-022–C-024：纯函数，B 线无 Casdoor 副作用，沿用冻结脚本结论通过。

定向 B 测（登录 built-in/admin → 写 demo 并绑组 → 删除）：

| Run ID | 冻结版本 | Case ID | 环境 | 执行结果(通过/失败/阻塞) | 证据链接/日志 |
|---|---|---|---|---|---|
| R-101 | v1.0 | C-014 | whoami | 通过 | built-in/admin |
| R-102 | v1.0 | C-007 | groups demo | 通过 | xai_teacher / xai_student |
| R-103 | v1.0 | C-011,C-012 | add abtt001 无 --yes | 通过 | groups=demo/xai_teacher |
| R-104 | v1.0 | C-011,C-012 | add abts001 无 --yes | 通过 | groups=demo/xai_student |
| R-105 | v1.0 | P-004,P-005 | add abtt001 --yes | 通过 | 老师组 |
| R-106 | v1.0 | P-004,P-005 | add abts001 --yes | 通过 | 学员组 |
| R-107 | v1.0 | C-008,C-015 | get abtt001 | 通过 | groups=[demo/xai_teacher]，无 password |
| R-108 | v1.0 | C-008,C-015 | get abts001 | 通过 | groups=[demo/xai_student]，无 password |
| R-109 | v1.0 | C-007 | query abt | 通过 | 2 条 |
| R-112 | v1.0 | C-009 | delete abtt001 --yes | 通过 | tests/b-line-runs/R-112.json |
| R-113 | v1.0 | C-009 | delete abts001 --yes | 通过 | tests/b-line-runs/R-113.json |
| R-114 | v1.0 | C-007 | query abt 应空 | 通过 | total=0 |

## 3) 缺陷归因单

| Bug ID | Case ID | 现象 | 归因(代码/环境/数据/需求/测试资产) | 严重级别 | 状态 |
|---|---|---|---|---|---|
| B-001 | R-014 | `built-in` 下 add-user 失败 | 需求 | — | **关闭**：不能给 built-in 建用户是预期，登录身份与写租户分离 |
| B-002 | R-051 | reset-password 默认 `if123456` 与当前相同被拒 | 需求/环境 | 低 | 本轮定向 B 测未覆盖 reset；规避：传不同 `--password` |
| B-003 | 登录收尾 | login 成功后 Node 进程未退出 | 代码 | 低 | 未修；不影响 session |

## 4) 回归记录单

| Regression ID | Bug ID | 关联 Case ID | 修复版本 | 回归结果 | 备注 |
|---|---|---|---|---|---|
| RG-001 | B-001 | P-005 | 口径更正 | 通过 | built-in 禁建号为预期 |
| RG-002 | B-002 | P-018 | 无代码修复 | 未回归 | 本轮不测 reset |
| RG-003 | B-001 | P-004,P-005 | 定向 B 测 | 通过 | demo 老师组 + 学员组各 1 人，校验后删除 |

## 5) 最终闭环报告

- 冻结版本：v1.0
- 真实执行版本：casdoor-account-admin @ 2026-09-21
- 执行环境：https://auth.innerfireai.com ；登录 `built-in/admin` ；写租户 `demo`
- 总 Case 数：24
- 通过/失败/阻塞：通过 24 / 失败 0 / 阻塞 0（C-011 写执行以 demo 为准）
- 缺陷分类统计：B-001 关闭；剩余 B-002/B-003 低，不阻塞本场景
- 是否存在解冻：否
- 剩余风险：reset 默认旧密码会被 Casdoor 拒绝；login 后偶发进程残留
- 准入建议：**准入**（本场景：跨租户在 demo 建号并绑定 Group）

规避与后续：
1. 用 `built-in/admin` 登录，在 `demo`/`scu` 等租户建号，不要往 built-in 建。
2. 重置密码需与当前不同。
3. 本轮 `demo/abtt001`（老师）、`demo/abts001`（学员）已删除。

附：闭环追踪表

| Case ID | Mock自检 | 冻结状态 | 真实执行 | 差异 | 结论 |
|---|---|---|---|---|---|
| C-001 | 通过 | 已冻结(v1.0) | 通过 | 无 | 闭环 |
| C-002 | 通过 | 已冻结(v1.0) | 通过 | 无 | 闭环 |
| C-003 | 通过 | 已冻结(v1.0) | 通过 | 落库前缀映射为 abt，口径仍为 prefix+001 | 闭环 |
| C-004 | 通过 | 已冻结(v1.0) | 通过 | 无 | 闭环 |
| C-005 | 通过 | 已冻结(v1.0) | 通过 | 无 | 闭环 |
| C-006 | 通过 | 已冻结(v1.0) | 通过 | privilege 文案归 casdoor 而非 forbidden | 闭环 |
| C-007 | 通过 | 已冻结(v1.0) | 通过 | demo 绑定 xai_teacher / xai_student | 闭环 |
| C-008 | 通过 | 已冻结(v1.0) | 通过 | 在 demo 验证 | 闭环 |
| C-009 | 通过 | 已冻结(v1.0) | 通过 | 无 | 闭环 |
| C-010 | 通过 | 已冻结(v1.0) | 通过 | 无 | 闭环 |
| C-011 | 通过 | 已冻结(v1.0) | 通过 | 写租户 demo，先预览再 --yes | 闭环 |
| C-012 | 通过 | 已冻结(v1.0) | 通过 | admin 未被写入 | 闭环 |
| C-013 | 通过 | 已冻结(v1.0) | 通过 | 隔离 session 路径 | 闭环 |
| C-014 | 通过 | 已冻结(v1.0) | 通过 | 无 | 闭环 |
| C-015 | 通过 | 已冻结(v1.0) | 通过 | 无 | 闭环 |
| C-016 | 通过 | 已冻结(v1.0) | 通过 | 在 demo 验证 | 闭环 |
| C-017 | 通过 | 已冻结(v1.0) | 通过 | 无 | 闭环 |
| C-018 | 通过 | 已冻结(v1.0) | 通过 | Username already exists → already_exists；未覆盖 | 闭环 |
| C-019 | 通过 | 已冻结(v1.0) | 通过 | 无 | 闭环 |
| C-020 | 通过 | 已冻结(v1.0) | 通过 | 无 | 闭环 |
| C-021 | 通过 | 已冻结(v1.0) | 通过 | 无 | 闭环 |
| C-022 | 通过 | 已冻结(v1.0) | 通过 | 纯函数未再打 Casdoor | 闭环 |
| C-023 | 通过 | 已冻结(v1.0) | 通过 | 同上 | 闭环 |
| C-024 | 通过 | 已冻结(v1.0) | 通过 | 同上 | 闭环 |
