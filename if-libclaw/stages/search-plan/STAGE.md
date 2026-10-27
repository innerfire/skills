# Stage: search-plan

## 触发条件

文献检索新任务，或用户要求修改尚未确认的检索计划时执行。

## TODO

- 当前项：`SEARCH-1 制定并确认检索计划`
- 新任务若没有检索清单，按 `SKILL.md` 创建一次；恢复时复用现有清单。

## 行为

1. 读取 `../../cli.md`，确认数据库 ID、当前标志和运行要求。
2. 保存当前任务工作区绝对路径；不得扫描环境变量、旧 Skill、下载目录或 license 文件寻找替代凭据。
3. 从 Skill 目录执行 `./if-libclaw check-runtime --json`。运行时不可用时保留本 Stage 未完成并用非技术语言说明。认证已由 `SEARCH-0` 完成；本命令不承担登录检查，不能因其输出执行 `login`。
4. 将用户需求写入当前任务的 `plan.json`，至少包含 `naturalLanguageRequest`、`normalizedQuery`、`planning.searchPlan.enSearchTerms` 和 `planning.searchPlan.databases`；适用时包含字段与日期范围。
5. 用 `python3 -m json.tool "$PLAN_FILE" >/dev/null` 检查语法。失败时只修复该计划，不进入 Gate 1。
6. 读取 `../../references/gate1-output-example.md`，在同一条回复中先完整展示实际计划。
7. 客户端支持结构化问题时，在可见计划之后调用客户端提供的结构化提问工具，提供“确认执行检索”“修改计划”“取消检索”三个选项；不要只输出编号文本，也不要先显示控件再补发计划。调用后立即停止，等待新的选择事件。
8. 客户端不支持结构化问题时，才用同样三个选项进行纯文本提问并立即停止。确认问题之后收到新的明确批准时，勾选 `SEARCH-1` 并进入 `search-execute`。

Gate 1 必须展示原始请求、规范化查询、中英文检索式、数据库与理由、日期、字段、最大结果数、并发、超时和浏览器模式。用户说“没看到计划”时重新完整展示并重新提问，不能视为确认。

## 完成条件

- `plan.json` 位于当前任务工作区且可解析；
- 用户已经看到具体计划；
- Gate 1 提问之后出现新的明确确认事件。

## 禁止事项

- Gate 1 前不运行 `prepare` 或 `execute`，不访问真实检索源。
- 不先显示选择控件再补发计划，不把初始请求或 TODO 当作确认。
- 不为引用验真创建或复用检索计划。

## 下一 Stage

确认后读取 `../search-execute/STAGE.md`；修改计划则继续本 Stage；取消则停止。
