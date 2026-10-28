# Stage: verification-delivery

## 触发条件

`VERIFY-4` 已完成，当前验真产物已经过内容检查。

## TODO

- 当前项：`VERIFY-5 交付当前任务产物`

## 行为

1. 读取 `../../references/verification-output-example.md`，按其中的 Example 交付。
2. 重新核对当前任务的 context、唯一 batch、validation、`verification.json`、`report.html`、`report.md` 和适用的 acceptance 文件；内部确认 `completion_status` 仅为 `completed` 或 `partial`，检查失败则为 `failed`。这些内部状态不展开到成功交付回复。
3. 成功时按 Example 输出“状态计数”和“需人工复核的 N 条引用”两段中文摘要。人工复核项依据当前 `verification.json` 中 `review_recommended=true` 的条目逐条列全，原始编号优先使用 `locations[].marker`，缺失时回退为“第 N 条”；不得显示内部 `ref-*` ID。
4. 两个正式文件交付物是 CLI 实际生成并检查过的 `report.html` 与 `report.md` Markdown 链接，固定写为 `[HTML 验真报告](<绝对路径>)` 与 `[Markdown 验真报告](<绝对路径>)`；不列出过程文件，不展示内部检查步骤，不根据 `verification.json` 另写或生成报告。
5. 任一正式报告缺失或检查失败时不得伪造链接，如实说明失败。
6. 在任务根目录 `$TASK_WORKSPACE` 内部读取 CLI 写入的 `billing-summary.json`；它只包含安全余额差摘要，必须在下一步 `--billing-finish` 完成后重新读取，**不是正式交付物，不得链接、回显原始 JSON、文件名、回执状态或服务端诊断，也不得当作报告列出**。
7. 从当前 Skill 目录只执行一次 `./if-libclaw auth status --billing-finish "$TASK_WORKSPACE"`，由 CLI 等待 1 秒后查询余额并更新任务根目录的安全摘要；只采纳其中的 `Remaining credits` 与可选 `Pending credits`；不得把诊断行、内部地址或完整命令输出带入交付回复。
8. 在交付末尾加入简洁的 `## 💳 计费`：
   - 安全摘要为 `source=balance_difference`、`status=observed` 且存在非负 `consumedCredits` 时，显示 `💳 本次消耗：<consumedCredits> credits`；它是首次余额减完成后余额，0 为有效差值。
   - 任一次余额缺失、账户不一致、完成后余额高于开始余额，或摘要缺失/无效时，只显示 `💳 本次消耗：暂不可用`；不得用 `chargedCredits`、标价、旧任务或钱包流水补写。
   - 余额独立采用本次 `auth status` 成功返回的 `Remaining credits`；即使费用不可计算，查询成功仍显示 `💰 余额：<Remaining credits> credits`，查询失败（包括 `AUTH_STATUS_LOOKUP_FAILED`）才显示 `💰 余额：暂不可用`。
   - 不在用户可见交付中解释计费文件、回执、来源覆盖、文档哈希、工作区、命令或服务端状态。
9. 上述最终状态查询失败、余额不足、配给或计费错误都**不得再次执行 `login`**，不得读取 session JSON、提取 token、构造 Bearer 请求或直接请求 Catalog-Billing、Telemetry；已完成的报告仍按本 Stage 交付。
10. 完成交付后勾选 `VERIFY-5`。

## 完成条件

- 交付链接分别指向当前任务实际存在的 `report.html` 与 `report.md`；
- 回复中未列出任何过程文件。

## 禁止事项

- 不把 `reference-context.json`、batch 或候选结果描述为验真结论。
- 不交付或回显 `reference-context.json` 中的论文原文。
- 不列出 context、batch、validation 或验真 JSON 等过程文件。
- 不根据 JSON 自行生成另一份报告或状态汇总页。
- 不把 `not_found` 描述为“虚假文献”。
- 不引用其他任务或旧运行的报告。
