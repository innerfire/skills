# Stage: search-execute

## 触发条件

当前 `plan.json` 已通过 Gate 1，且存在 Gate 1 提问之后的明确确认事件。

## TODO

- 执行期：`SEARCH-2 执行所选数据库检索`
- 范围确认：`SEARCH-3 确认结果范围`

## 开始余额记录

任务已获准、工作区已创建后，在第一次检索、文档转换或来源查询之前执行一次 `./if-libclaw auth status --billing-start "$TASK_WORKSPACE"`。CLI 只保存首次余额，不因恢复或重检覆盖；首次余额查询失败则本次费用不可计算，但不得因此重新登录或读取凭据。

## 执行步骤

1. 读取 `../../cli.md`，从 Skill 目录使用显式标志逐库执行：

```bash
./if-libclaw execute \
  --plan-file "$PLAN_FILE" \
  --databases openalex \
  --workspace-dir "$TASK_WORKSPACE/runs" \
  --timeout-seconds 120
```

2. 当前 Runtime 每次只接受一个数据库。多库计划按计划顺序逐库执行，保留各自 `job.json` 和 `results.json`；不要向一次 `execute` 传多个数据库。每次 `execute` 只是中间检索步骤，不产生最终计费或用户可见账单。
3. 所选数据库均到达成功或明确失败的终态后，汇总实际状态与数量，勾选 `SEARCH-2`。失败项不能伪装成成功。
4. 读取 `../../references/gate2-output-example.md`，依据当前 `results.json` 展示实际数据库状态、数量和范围判断。
5. 客户端支持结构化问题时，在可见结果之后调用客户端提供的结构化提问工具，提供“修改后重检”“保留当前范围并生成报告”“暂停，只交付原始结果”三个选项；不要只输出编号文本。调用后立即停止，等待新的选择事件。
6. 客户端不支持结构化问题时，才用同样三个选项进行纯文本提问并立即停止。新选择为“保留”时勾选 `SEARCH-3` 并进入 `search-report`；选择重检时重新打开受影响的 TODO 并回到 `search-plan`；选择暂停时勾选 `SEARCH-3` 并进入 `search-delivery`。

浏览器数据库仅在用户批准检索后运行。Runtime 会先探测受信任环境提供的远程 CDP；未配置或不可达时自动启动可见的临时本地 Chrome，并只在本次执行结束时回收自己启动的实例。不要要求用户预先运行 `launch-browser` 或 `playwright install chromium`。

## 完成条件

- `SEARCH-2`：每个所选数据库在当前任务工作区都有可核对的本次执行状态；
- `SEARCH-3`：Gate 2 提问之后收到新的用户范围选择。

## 失败与恢复

- `python_missing`、`playwright_missing`、`browser_unavailable`、`runner_timeout`、`runner_failed`、`results_missing` 或 `results_invalid`：保留工作区与安全错误信息，保持相关 TODO 未完成。
- HTTP 401/403/409/422/503、余额、配给、计费或来源授权错误：只保留当前 Stage 和工作区，回复“本次检索未完成，请稍后重试”并停止。不得读取、检查、展示或分析 `job.json`、`runner.py`、`.env` 或 session JSON；不得推断或展示请求端点、URL、Header、Bearer、key 或 token；不得执行 curl 或直接请求服务端点；不得修改计划、执行 login 或自动重试。
- 用户说“继续”时先核对 `runs/` 中已有结果，只执行尚未完成的数据库；不要重复已成功的真实检索。

## 禁止事项

- 不静默重跑，不在 Gate 2 之前生成或声称存在报告。
- 不用其他运行的结果填充当前任务。
- 不自行选择 Gate 2 目标选项。

## 下一 Stage

保留当前范围时读取 `../search-report/STAGE.md`；暂停时读取 `../search-delivery/STAGE.md`。
