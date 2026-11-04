# Stage: verification-batch

## 触发条件

`VERIFY-2` 已完成，当前论文的 `reference-context.json` 已通过 SHA 与结构检查。

## TODO

- 当前项：`VERIFY-3 整理并校验 reference-batch.json`

## Agent 整理

1. 读取 `../../references/agent-reference-batch.example.json` 和 context 的全部页；定位参考文献区的起止页，逐页盘点，不只看第一页。
2. 只依据 context 拆分条目。顶层 `version` 为 `reference-query/v1`，原样复制 `document_sha256`；`extraction_scope` 明确写入 `start_page`、`end_page`、连续 `processed_pages` 和逐页 `references_per_page`。
3. 每条 `raw_text` 必须直接复制自声明页 `pages[].text` 的逐字连续子串；不归一化、不重打、不从 block 拼接。跨页条目按 locations 页序用单个换行连接相邻页原文，并按首个 location 计入逐页数量。
4. `title` 必须是完整作品题名，不是首字符、作者、机构、来源、年份或卷页。只恢复词间空格、移除 OCR 换行造成的断词连字符并折叠为空格；全半角由 CLI/服务查询边界处理。
5. `authors`、`year`、`doi` 只在 OCR 原文支持时填写。不查询外部来源、不下真实性结论、不编造缺失字段。
6. 同页 location 优先复制该页 `text_block_id`；跨页保留每个相关页的 anchor。只有需要细粒度位置时才读取 `pages[].blocks[]`，并保留覆盖完整原文的连续全部 `block_id`；不得推断或按序号猜测。
7. 在当前推理中逐条自查完整题名和页计数，一次性把完整 JSON 写到 `$TASK_WORKSPACE/reference-batch.tmp`；不得用 Python、Shell、正则或临时脚本替代语义整理，也不得以时间限制为由跳过剩余页面或条目。
8. 原子写入唯一正式文件：

```bash
chmod 600 "$TASK_WORKSPACE/reference-batch.tmp"
mv "$TASK_WORKSPACE/reference-batch.tmp" "$TASK_WORKSPACE/reference-batch.json"
```

## 格式检查与修复

```bash
./if-libclaw validate-reference-batch \
  --input "$TASK_WORKSPACE/reference-batch.json" \
  --context "$TASK_WORKSPACE/reference-context.json" \
  --output "$TASK_WORKSPACE/reference-batch.validation.json"
```

必须同时满足 `valid=true` 与 `context_validated=true`。失败时读取 `issues[].code/path/message/expected_raw_text`，依据 context 重写同一个 batch，再复检：

- `reference_title_too_short`：恢复完整题名，不跳过或写成 `not_found`；
- `reference_title_contains_bibliographic_metadata`：从题名移除作者、来源、年份、卷页等元数据；
- `reference_title_not_normalized` / `reference_title_likely_missing_spaces`：恢复单行题名和正常英文词间空格；
- `reference_raw_text_not_exact_context_substring`：优先直接使用非空 `expected_raw_text` 的完整 JSON 值，否则从声明页逐字复制。

最后一次 validation 必须晚于最后一次 batch 写入。通过后勾选 `VERIFY-3`。

## 完成条件

- 只有一个 owner-only `reference-batch.json`；
- 全部参考文献页与条目已处理；
- validation 为 `valid=true` 且 `context_validated=true`，并对应当前 batch。

## 禁止事项

- 不创建空或部分 batch，不逐条增量写正式文件。
- 不创建 `reference-batch_v*.json`、`reference-batch_fixed*.json` 或辅助提取脚本。
- validation 通过前不查询 CNKI/Google Scholar，不调用下一 Stage。

## 下一 Stage

完成后读取 `../verification-run/STAGE.md`。
