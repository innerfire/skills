# Stage: verification-context

## 触发条件

`VERIFY-1` 已完成，且确认针对当前文档，或针对刚展示的截图/Markdown 结构化引用。

## TODO

- 当前项：`VERIFY-2 生成本次引用核验输入（不交付）`

## 开始余额记录

任务已获准、工作区已创建后，在第一次检索、文档转换或来源查询之前执行一次 `./if-libclaw auth status --billing-start "$TASK_WORKSPACE"`。CLI 只保存首次余额，不因恢复或重检覆盖；首次余额查询失败则本次费用不可计算，但不得因此重新登录或读取凭据。

## 文档输入

从 Skill 目录执行：

```bash
./if-libclaw reference-context \
  --input "$PAPER_FILE" \
  --output "$TASK_WORKSPACE/reference-context.json"
```

检查输出为仅当前用户可读写的 JSON，`document_sha256` 与输入文件一致，页面含页码、文本和 `text_block_id`。该文件只是本次引用核验的中间上下文，不是自动拆分结果，也不是验真结论；只能保存在当前任务工作区，不能写入 stdout、回复、TODO、日志、报告或 telemetry。

成功后勾选 `VERIFY-2`。恢复任务时若文件已存在，先核对输入 SHA 和结构；一致才复用，否则不得把它当成本次 context。

## 截图或 Markdown 参考文献输入

1. 读取 `../../references/pasted-reference-input-example.md`。只使用用户刚确认的完整预览；不得重新猜测或补全字段。
2. 创建 `reference-input/v1`：`input_kind` 为 `screenshot` 或 `markdown`；`raw_text` 保留确认的完整原文；题名、作者、年份和 DOI 只写确认过的值。截图使用 `source_locator.image_index` 并标为用户确认的视觉转录；Markdown 使用 `line_start` / `line_end`。
3. `source_sha256` 绑定原始输入：有本地附件时计算附件字节；纯粘贴 Markdown 计算其 UTF-8 字节；若客户端无法读取截图附件字节，则计算用户确认的完整视觉转录 UTF-8 字节，并在工作记录中说明哈希对象是确认转录，不宣称为截图文件哈希。
4. 一次性写入 `$TASK_WORKSPACE/reference-input.json`，权限必须为 owner-only。确认前不写入正式 JSON；确认前不查询数据库。
5. 本分支不调用转换服务，不执行 `reference-context`，也不手工制造 `reference-context.json` 或 `reference-batch.json`。CLI 会在查询前严格校验并派生 canonical owner-only artifacts。

正式 JSON 完成后勾选 `VERIFY-2` 和 `VERIFY-3`，直接读取 `../verification-run/STAGE.md`，跳过 `verification-batch`。

## 完成条件

- 文档分支：当前输入对应的 `$TASK_WORKSPACE/reference-context.json` 实际存在，SHA-256 一致且页面结构可读；
- 截图/Markdown 分支：当前确认对应的 `$TASK_WORKSPACE/reference-input.json` 实际存在，符合 `reference-input/v1` 且有正确 locator；
- 文件权限不向其他用户开放。
- 转换后的论文文本未出现在回复、TODO、日志、报告或 telemetry 中。

## 失败与恢复

- `reference-context` 返回 `AUTH_SESSION_REQUIRED` 时，在同一 Skill 目录执行一次 `./if-libclaw auth status`；只有明确输出 `Not logged in.` 才转入 `verification-auth` 的单次登录流程。转换服务 HTTP 401/403/422/503、计费或配给错误不得触发 `login`；保留当前工作区和 `VERIFY-2` 状态，给出简短可恢复状态并停止。
- 其他转换失败：保留错误与工作区，保持 `VERIFY-2` 未完成；只有按 CLI 契约可重试的问题才从本 Stage 恢复。

## 禁止事项

- 不把 context 描述为参考文献 batch 或验真结果。
- 不在终端或回复中打印 context 内容；`reference-context` 必须使用仅当前用户可读写的 `--output` 文件。
- 不用旧文件、其他论文 context 或临时转换脚本代替。
- 不把截图转录描述为 OCR 精确文本；不把 Markdown/截图扩展成整篇文档处理。

## 下一 Stage

文档分支完成后读取 `../verification-batch/STAGE.md`；截图/Markdown 分支完成后直接读取 `../verification-run/STAGE.md`。
