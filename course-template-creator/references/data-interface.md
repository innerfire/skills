# 课程模板 V1 数据接口

本参考定义 skill 生成的目录数据。项目完整机器协议的 authoritative source 是 `docs/contracts/course-template-package.md`；两者冲突时以该文件为准。

## 目录

```text
<course-directory>/
├── course.yaml
├── chapters/
│   └── 001-<章节短名>/
│       ├── chapter.yaml
│       ├── pages/
│       │   └── 001-<页面名>.<图片扩展名>
│       ├── materials/                 # 可选
│       │   └── 001/                   # 对应 pages/001-...
│       │       └── 001-<素材名>.<素材扩展名>
│       ├── tools.yaml                 # 可选
│       └── milestones/                # 可选
│           └── 001-<任务短名>/
│               ├── milestone.yaml
│               └── <任务模板>.docx
└── course-report/                     # 可选，最多一个
    ├── report.yaml
    └── <课程报告模板>.docx
```

根目录和每个章节目录不得出现契约之外的文件或目录，不添加包装 ZIP、`.DS_Store` 或 `__MACOSX/`。页面素材可以包含原始压缩附件，但不得展开它们。

## YAML 接口

`course.yaml`：

```yaml
schemaVersion: 1
name: AI 入门实践
summary: 课程简介
seriesName: AI 入门系列
visibility: personal
```

| 字段            | 类型    | 约束                                                    |
| --------------- | ------- | ------------------------------------------------------- |
| `schemaVersion` | integer | 必须为 `1`                                              |
| `name`          | string  | 必填，trim 后非空                                       |
| `summary`       | string  | 必填，trim 后非空                                       |
| `seriesName`    | string  | 必填，使用可跨环境匹配的系列名称，不写 `seriesId`       |
| `visibility`    | enum    | `personal` 或 `shared`；Admin 导入时服务端固定为 shared |

`chapter.yaml`：

```yaml
name: 认识问题
description: 本章说明
defaultOpen: true
```

三个字段均必填；`name`、`description` 为非空字符串，`defaultOpen` 为 boolean。

`tools.yaml`（可省略）：

```yaml
- toolId: 018f0000-0000-7000-8000-000000000002
  aliasName: 课程助手
  defaultOpen: true
```

数组顺序就是工具绑定顺序。`toolId` 和 `defaultOpen` 必填；`aliasName` 可省略。不得写工具名称、URL、类型或状态来替代 `toolId`。

需要绑定工具时，从部署环境的公开目录取得可用 ID，无需 API key 或登录：

```sh
curl --fail --silent --show-error "${XAI_PAYLOAD_ORIGIN%/}/v1/course-tools"
```

响应使用统一 envelope，候选项位于 `data.items`，每项包含 `id`、`name`、`description`、`toolType` 和 `iconUrl`。只把明确匹配项的 `id` 写入 `toolId`；多个候选都可能匹配时先询问用户。不要把接口返回的其他字段写入 YAML。

`milestone.yaml` 与 `course-report/report.yaml` 使用相同接口：

```yaml
name: 基础任务
description: 完成模板中的练习
defaultOpen: true
```

三个字段均必填。每个对应目录可包含 0..1 个 PDF、DOCX、PPTX 或 XLSX 模板文件；没有模板时任务仅使用名称和描述。

## 编号与素材

- 章节、页面、页面内素材和里程碑分别在各自作用域使用 `NNN-<名称>`，从 `001` 连续编号；`NNN` 对应零基 `position = NNN - 1`。
- 页面必须是平台允许的图片格式，每个页面编号恰好一张主图片。
- `materials/NNN/` 的编号必须与同章页面编号完全对应；目录内素材也从 `001` 连续编号。
- `*.prompt.md`：UTF-8 非空正文，对应提示词素材。
- `*.link`：仅一行 `http://` 或 `https://` URL，对应链接素材。
- 服务端识别可预览的 PDF、音频和视频；其他格式或预览识别失败时，作为普通文件下载。
- 页面素材支持任意文件类型（含 Office、ZIP、HTML、代码、未知扩展名和无扩展名文件）。保留原始字节，不检查附件内部内容，不解压或转换为 XML；下载附件使用 `application/octet-stream`。任务及课程报告模板仍按专用模板规则校验。
- 文件扩展名必须与真实内容类型一致。不要通过重命名扩展名制造图片、媒体或 Office 文件。

## 禁止字段与内容

包内不能声明 `seriesId`、`ownerId`、`ownerExternalId`、`templateId`、`businessRevision`、`_status`、`deletedAt`、`status`、`lifecycleStatus`、`enabled`，也不能包含日程、快照、报名、提交、评价或发布参数。

配置 YAML 不使用未知字段、重复 key、alias、anchor、merge key、自定义 tag 或多文档；作为普通素材的 `.yaml` 不按配置解析。外层课程包路径使用相对路径和 Unicode NFC；禁止绝对路径、`.`、`..`、反斜杠逃逸和符号链接。压缩附件仅作为不透明文件保存，不递归展开。外层课程 ZIP 仅使用 stored 或 deflate，所有文件的 CRC、压缩大小和解压大小须在 local header 与 central directory 中一致；禁止 ZIP64、加密和 data descriptor（general-purpose flag 的 bit 0、bit 3 均不得设置）。

## 交付边界

skill 同时保留普通目录并生成同名 ZIP。可使用当前环境可用的任意打包能力，但不得假设存在特定命令行工具；压缩目录内的内容，使 `course.yaml` 直接位于 ZIP 根目录；不要把同一目录再套一层，也不要加入系统隐藏文件。无法满足本文件规定的 ZIP 元数据约束时不得生成 ZIP。skill 不调用导入接口或上传 ZIP。
