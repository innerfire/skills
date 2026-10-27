# `verification.json` 契约

本文描述 `if-libclaw verify-references` 的机器可读输出。字段以实际 JSON 为准；完整样例见 `verification-example.json`。

## 顶层对象

| 字段 | 类型 | 说明 |
|---|---|---|
| `run_id` | string | 当前验真运行 ID |
| `document_sha256` | string | 输入文件 SHA-256；用于绑定结果与原文，不上传 telemetry |
| `rule_version` | string | 确定性匹配规则版本 |
| `generated_at` | string | RFC 3339 生成时间 |
| `completion_status` | enum | `completed` 或 `partial`；表示来源证据覆盖是否完整，与五状态判定分开 |
| `items` | array | 每条参考文献的判定和证据 |
| `summary` | object | 五状态聚合计数 |
| `warnings` | string[] | OCR、来源覆盖或运行警告；可省略 |

`summary` 必须包含 `total`、`verified`、`probable`、`conflict`、`not_found`、`unverifiable`，并满足：

```text
total = verified + probable + conflict + not_found + unverifiable
```

`completion_status=completed` 要求每条 reference 的每个选定来源 evidence 都为
`completed`。只要存在一个 `unavailable`，即使最终 JSON/HTML 已生成，也必须为
`partial`。格式或 context-bound 覆盖检查失败时命令退出且不生成验真报告，工作流状态为
`failed`。

## `items[]`

| 字段 | 类型 | 说明 |
|---|---|---|
| `reference` | object | 原始书目、规范化字段和引用位置 |
| `status` | enum | 五状态之一 |
| `reason` | string | 确定性判定理由 |
| `score` | number | 当前规则版本的匹配分数 |
| `evidence` | array | 本次选择来源的查询结果 |
| `candidate_matches` | array | 每个来源候选的字段级确定性评分；无候选时可省略 |
| `review_recommended` | boolean | 是否建议人工复核 |

`reference` 包含：

- `id`：运行内稳定的条目 ID；
- `raw_text`：从 context 声明页 `pages[].text` 逐字复制的连续参考文献原文，不得规范化或重写；
- `bibliography`：规范化的 `title`、`authors`、`year`、`venue`、`volume`、`issue`、`pages`、`doi`；
- `locations`：正文、参考文献块、脚注或尾注中的 `page`、`block_id`、`marker`。

## `evidence[]`

| 字段 | 类型 | 说明 |
|---|---|---|
| `source` | enum | `cnki`、`google_scholar`、`openalex` 或 `pubmed` |
| `query` | string | 实际发送的单条书目查询；仅保存在本地结果中 |
| `queried_at` | string | RFC 3339 查询时间 |
| `status` | enum | `completed` 或 `unavailable` |
| `error_code` | string | 来源失败或挑战页错误码；成功时可省略 |
| `candidates` | array | 来源返回的候选元数据；没有候选时可省略 |

候选可包含 `title`、`authors`、`year`、`venue`、`volume`、`issue`、`pages`、`doi` 和 `url`。

## `candidate_matches[]`

每项通过 `source` 和零基 `candidate_index` 指回对应 `evidence[].candidates[]`，并包含：

- `title_score`、`author_score`、`composite_score`：范围为 0–1；
- `year_score`：范围为 0–1；同年为 `1`，相差 1/2/3 年分别为 `0.95`、`0.85`、`0.70`，缺失或相差超过 3 年为 `0`；
- `year_match`、`year_conflict`：保留兼容字段；`year_conflict=true` 仅表示超过近似年份窗口的关键冲突；
- `doi_exact`、`doi_conflict`。

这些字段记录当前 `rule_version` 的确定性比较结果，便于复核最终结论；它们不是远端数据库返回的主观评分。

## 状态不变量

- `verified`：至少一条强匹配证据，且无关键字段冲突。
- `probable`：有可信相似候选，但字段不足以达到强匹配。
- `conflict`：存在候选，且题名、作者或年份发生关键冲突。
- `not_found`：本次选择的全部来源均为 `completed`，且均无可信候选。
- `unverifiable`：来源不可用、验证码阻断、OCR/抽取失败或书目信息不足。

`not_found` 不是虚假文献判定，界面与下游系统不得改变这一语义。

## 隐私边界

该文件保存在本地工作区，可以包含参考文献原文和来源查询证据，但不得包含：

- 论文全文或完整页面文本；
- 转换服务或 Google Scholar API key；
- CNKI Cookie；
- `api_key`、`full_text` 等敏感字段。

Telemetry 只接收 `summary` 衍生计数、OCR 页数及分来源查询/错误计数，不接收本文件内容。
