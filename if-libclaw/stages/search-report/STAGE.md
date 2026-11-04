# Stage: search-report

## 触发条件

`SEARCH-2` 已完成，且用户在 Gate 2 明确选择保留当前范围并生成报告。

## TODO

- 当前项：`SEARCH-4 生成并检查报告`

## 行为

1. 读取 `../../references/qc-schema.md`。推荐论文只能来自当前任务的 `results.json`，并覆盖全部成功数据库。
2. 单库：在同一运行目录写入 `qc.json`，再执行：

```bash
./if-libclaw generate-report \
  --workspace "$RUN_WORKSPACE"
```

3. 多库：把包含各数据库运行子目录的目录设为 `AGGREGATE_WORKSPACE`（标准布局为 `$TASK_WORKSPACE/runs`），将汇总 QC 写到 `$AGGREGATE_WORKSPACE/aggregate-qc.json`，再执行：

```bash
./if-libclaw aggregate-report \
  --workspace "$AGGREGATE_WORKSPACE"
```

4. `generate-report` 与 `aggregate-report` 只读取当前任务本地工件，不请求授权、不要求 API Key，也不产生计费。实际打开生成的 `report.html`，检查：成功数据库均出现在搜索源/执行概况中；推荐论文来自当前结果；有可推荐结果时推荐区非空；CSS 不依赖被 CSP 阻止的外部脚本。
5. 确认 `report.html` 和对应 QC 实际存在且属于本次运行后，勾选 `SEARCH-4`，进入 `search-delivery`。

## 完成条件

- 单库：当前运行的 `qc.json` 与 `report.html` 存在并通过内容检查；
- 多库：`$AGGREGATE_WORKSPACE/aggregate-qc.json` 与同目录 `report.html` 存在，且报告覆盖全部成功数据库与推荐论文。

## 失败与恢复

CLI 失败或报告内容不完整时保留 `SEARCH-4` 未完成。修正当前 QC 后重新调用同一个 CLI 报告命令；不手写替代 HTML。

## 禁止事项

- 不把 `aggregate-qc.json` 放入新的 `aggregate/` 子目录。
- 不自行创建 `index.html`、`reports.html` 或多份单库汇总页。
- 不用外部 Tailwind CDN，不把“文件已生成”等同于“报告已检查”。

## 下一 Stage

完成后读取 `../search-delivery/STAGE.md`。
