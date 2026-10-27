# Stage: search-delivery

## 触发条件

用户在 Gate 2 选择只交付原始结果，或 `SEARCH-4` 已完成。

## TODO

- 当前项：`SEARCH-5 交付当前任务产物`

## 行为

1. 读取 `../../references/report-output-example.md`，但只采用其输出层次。
2. 重新核对当前任务中的计划、检索结果、QC 和报告；只交付实际存在且属于本次任务的报告。
3. 用简洁中文说明检索已完成、结果概览和报告链接；不展开检索式、浏览器模式、工作区或中间文件。
4. 用户选择“只交付原始结果”时明确说明未生成报告；完整报告路径只在 `SEARCH-4` 完成后提供。
5. 在交付前只执行一次任务级完成命令。用户选择完整报告时执行：

```bash
./if-libclaw complete-search \
  --task-workspace "$TASK_WORKSPACE" \
  --plan-file "$PLAN_FILE" \
  --delivery report \
  --report-path "$REPORT_HTML"
```

用户选择只交付原始结果时，将 `--delivery` 改为 `raw-results`，不传 `--report-path`。该命令是唯一的最终结算入口；不得按数据库相加、扫描旧 run 或自行计算费用。
6. 若完成命令返回 `AUTH_SESSION_REQUIRED`，只执行一次 `./if-libclaw auth status`；只有明确输出 `Not logged in.` 才按 `SEARCH-0` 的单次登录与 HITL 流程恢复，然后重试同一条完成命令一次。其它错误均不得触发登录。命令在结算暂不可用时仍会保留安全摘要；已完成的报告或原始结果仍可交付。
7. 只从 `$TASK_WORKSPACE/billing-summary.json` 读取本次任务的安全计费摘要；它**不是正式交付物，不得链接、回显原始 JSON、文件名、回执状态或服务端诊断，也不得当作报告列出**。
8. 从当前 Skill 目录只执行一次 `./if-libclaw auth status`，只采纳其中的 `Remaining credits` 与可选 `Pending credits`；不得把诊断行、内部地址或完整命令输出带入交付回复。
9. 在交付末尾加入简洁的 `## 💳 计费`：
   - `billing-summary.json` 为 `settled` 时，只显示 `💳 本次消耗：<chargedCredits> credits` 与最新 `💰 余额：<Remaining credits> credits`；消耗必须取自安全回执，绝不以余额差值计算。
   - 回执为 `pending` 时，只显示 `💳 本次消耗：待确认` 与 `💰 余额：暂不可用`。
   - 回执为 `unavailable` 时，只显示 `💳 本次消耗：暂不可用` 与 `💰 余额：暂不可用`。
   - 若回执已 `settled` 但这一次 `auth status` 输出 `AUTH_STATUS_LOOKUP_FAILED`，仍显示已确认的本次消耗与 `💰 余额：暂不可用`。
   - 不在用户可见交付中解释计费文件、回执、来源覆盖、文档哈希、工作区、命令或服务端状态。
10. 上述最终状态查询失败、余额不足、配给或计费错误都**不得再次执行 `login`**，不得读取 session JSON、提取 token、构造 Bearer 请求或直接请求 Catalog-Billing、Telemetry；已完成的报告仍按本 Stage 交付。
11. 交付完成后勾选 `SEARCH-5`。

## 完成条件

- 交付内容与当前文件、CLI 状态一致；
- 没有引用旧运行或不存在的文件；
- 论文 URL 使用 Markdown 链接。

## 禁止事项

- 不展开无关 `job.json`、runner 或浏览器中间工件，除非用户正在排障。
- 不把检索结果描述为引用真实性结论。
