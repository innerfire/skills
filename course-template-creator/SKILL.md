---
name: course-template-creator
description: 按 xAI 课程模板 V1 数据契约交互式创建课程目录并压缩为可供教师端或 Payload Admin 导入的 ZIP。适用于生成或修改 course.yaml、章节、页面素材、工具绑定、里程碑和课程报告。扫描阶段必须打通 XAI_PAYLOAD_ORIGIN 并用 curl 查询公开工具目录；里程碑归属、工具匹配等决策必须先询问用户再继续；不负责导入或上传。
---

# 课程模板创建器

根据用户提供的课程内容，在用户指定位置创建课程模板目录，并交付同名 ZIP。

开始前读取 [数据接口](references/data-interface.md)。先扫描课程并打通公开目录查询，再通过交互确认可选内容；不要猜测，不要虚构二进制素材。

## 交互规则

所有需要用户决定的事项都用当前环境的结构化提问工具（Cursor 为 `AskQuestion`；否则用等价工具或对话提问）。**等用户回答后再继续。** 不要用纯文本清单代替交互，不要静默填默认值。用户已经明确给出的字段不要再问。

- 选项要具体、可点选；需要自由输入时保留「其他」入口。
- 后续问题依赖前一答案时分轮问，不要一次抛出互相依赖的问题。
- 互不依赖的确认可以放在同一轮。

## 流程

### 1. 扫描课程，并打通公开目录查询

这一步同时做两件事：映射课程结构，以及让当前进程能用 `curl` 查到 `/v1/course-tools`。Origin 解析不是独立产品步骤，只为查询服务。

从教案、大纲或自然语言推导 `name`、`summary`、`seriesName`、`visibility`、章节、页面、提示词、链接。

打通查询的唯一目标是让 `curl` 能读到这个变量，不为任何特定 shell 设计逻辑，不假设 macOS/zsh 之外的系统或 Linux/Windows 上也有等价的配置文件。

1. 用当前实际执行命令的环境读取一次现有变量，语法按该环境本来的样子选，不要不看环境就套用某一种：
   - POSIX shell（bash/zsh/sh/fish 等）：`printenv XAI_PAYLOAD_ORIGIN`
   - Windows PowerShell：`$env:XAI_PAYLOAD_ORIGIN`
   - Windows cmd.exe：`echo %XAI_PAYLOAD_ORIGIN%`
   非空则直接查询，跳过下面步骤。
2. 为空时不要猜配置文件去加载。不同 shell 的配置文件路径和语法不同，Windows 上环境变量通常来自系统设置而非某个 rc 文件；挑一个看似常见的文件去加载，在错的 shell 或系统上会读错变量或直接报错。直接停下来问用户三选一：
   - 我直接填写 Origin URL
   - 我告诉你从哪个文件加载（我确认那是我当前环境里配置这个变量的地方）
   - 这次不查询工具目录
3. 用户给出 URL，直接用。用户给出文件路径时，按该文件/环境对应的语法在同一条命令里加载并立刻重新读取变量，不要脱离原命令假设已经进入某个登录 shell：
   - POSIX：`set -a; . "$file"; set +a; printenv XAI_PAYLOAD_ORIGIN`
   - PowerShell：`. "$file"; $env:XAI_PAYLOAD_ORIGIN`
   - Windows 批处理：`call "$file" && echo %XAI_PAYLOAD_ORIGIN%`
   语法不确定就问用户这个文件属于哪种环境，不要猜。
4. 加载失败或变量仍空：把错误反馈给用户并再问一次，不要改用硬编码 URL。Origin 只用于本次查询，不要写入仓库文件。

查询固定用 curl：POSIX 下 `curl --fail --silent --show-error "${XAI_PAYLOAD_ORIGIN%/}/v1/course-tools"`；PowerShell 下用 `curl.exe`（避免命中 `Invoke-WebRequest` 别名）执行等价请求。该接口不使用 API key。只使用响应 `data.items` 中的 `id`。

向用户展示扫描结果（章节列表、页面数，以及查到的工具候选）。缺 `course.yaml` 必填字段（`name`、`summary`、`seriesName`、`visibility`）时提问补齐；`visibility` 选项为 `personal` 或 `shared`。未指定输出位置时询问；只有用户明确说「用默认位置」才在当前工作区用课程名称的安全短名建目录。工具按名称和说明匹配用户意图；不能唯一匹配时列出候选并询问，没有匹配项或用户选择不查询时省略 `tools.yaml`。

### 2. 询问里程碑与课程报告

扫描并完成目录查询后、写目录前，必须询问：

1. 是否创建里程碑？
2. 若创建：挂到哪一章？选项必须是刚扫描出的章节，可多选。再问每章几个、名称和说明。
3. 是否创建课程报告？

用户没有确认要里程碑或课程报告时，不要生成对应目录。不要把普通练习自动升级成里程碑。里程碑询问与缺字段/输出位置/工具匹配互不依赖时，可与第 1 步的确认放在同一轮。

### 3. 生成目录

- 根目录直接包含 `course.yaml`、`chapters/`，以及可选的 `course-report/`。
- 仅生成数据契约允许的目录和文件，不在根目录添加 README、说明文件、清单副本或包装 ZIP；页面素材可保留用户提供的任意附件（包括 ZIP）。
- 所有有序目录和文件使用从 `001` 开始、连续且唯一的三位编号。
- YAML、`.prompt.md` 和 `.link` 使用 UTF-8；YAML 只写契约字段。
- 有用户提供的素材时，保留原始字节、扩展名并按契约编号；任意文件类型均可作为附件，不解压 ZIP 或 Office 文件，不转换为 XML。没有真实二进制素材时，不生成伪文件或改扩展名占位。
- 页面素材必须放入同章对应页面编号的 `materials/NNN/`；不能创建没有对应页面的素材目录。
- 里程碑和课程报告的模板文件可选；有真实 PDF、DOCX、PPTX 或 XLSX 时保留，无文件时仅生成描述性任务，不伪造占位文件。

### 4. 完成检查

检查目录和编号连续性、必填字段、素材到页面的对应关系、工具 ID 是否来自公开目录、可选模板文件的数量与类型，以及未知文件。没有素材缺口时调用本 skill 的 `scripts/package-template.sh`，唯一参数为模板目录的绝对路径。脚本保留原目录、在其旁边生成同名 `.zip`，排除 `.DS_Store` 和 `__MACOSX`，并确保 `course.yaml` 位于 ZIP 根目录。向用户报告目录和 ZIP 路径。

存在缺口时报告目录与缺少的真实素材，不生成 ZIP，也不得声称目录可直接导入。不要调用导入接口或上传 ZIP。
