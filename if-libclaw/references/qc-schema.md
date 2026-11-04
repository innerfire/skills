# QC Schema

`qc.json` 是 `if-libclaw generate-report` 的质量筛选输入。它必须基于当前运行目录中的 `results.json` 生成，用于说明本轮搜索中哪些论文最值得推荐、为什么推荐，以及用户下一步应如何阅读或收窄范围。

推荐结构：

```json
{
  "reportTitle": "if-libclaw Literature Highlights: AI 大模型",
  "executiveSummary": "一句话说明本轮搜索的主要发现、当前范围是否偏宽或偏窄，以及哪些论文最值得优先阅读。",
  "selectionRationale": [
    "优先选择与用户需求直接相关、且能代表方法或系统进展的论文。",
    "兼顾综述、代表性方法和可落地的工程实现。"
  ],
  "suggestedNextActions": [
    "先阅读排名前 3 的方法类论文，确认技术主线。",
    "如果要做系统演示，再补读工程实现和应用论文。"
  ],
  "recommendedPapers": [
    {
      "rank": 1,
      "paperId": "openalex:W123456789",
      "title": "论文标题",
      "translatedTitleZh": "中文标题",
      "source": "OpenAlex",
      "dataSource": ["openalex"],
      "url": "https://...",
      "abstract": "英文摘要",
      "translatedAbstractZh": "中文摘要",
      "recommendationReason": "为什么这篇最值得先看。"
    }
  ]
}
```

## 质量筛选指引

生成 `qc.json` 前，先对 `results.json` 中的候选论文做质量筛选：

1. **相关性优先**：论文必须直接回应用户的原始问题或归一化检索需求；只含宽泛关键词但主题不匹配的论文不要推荐。
2. **信息完整性**：优先选择有标题、来源、URL、摘要或可判断贡献点的论文；元数据严重缺失的论文只有在特别重要时才推荐。
3. **代表性与多样性**：推荐列表应覆盖不同方法、系统、综述或应用场景，避免多篇内容高度重复的论文占据前排。
4. **可信来源**：优先考虑来自本轮选定数据库、可追溯 URL、来源字段明确的论文。
5. **可解释性**：每篇论文的 `recommendationReason` 必须说明它为什么值得先读，不能只写关键词或“相关”。
6. **范围反馈**：如果本轮结果偏宽或偏窄，应在 `executiveSummary` 或 `suggestedNextActions` 中说明是否建议收窄关键词、调整数据库或保留范围继续阅读。

## 字段约束

- `recommendedPapers` 里的论文必须来自当前运行目录的 `results.json`。
- `rank` 从 `1` 开始连续编号，不要跳号。
- `recommendedPapers` 每项至少要有 `paperId`、`title`、`recommendationReason`。
- `recommendationReason` 必须是自然语言，说明推荐原因和阅读价值。
- `translatedTitleZh` 和 `translatedAbstractZh` 由客户端当前模型生成。严禁使用 `[待翻译]`、`[TBD]`、`[TODO]` 等占位前缀；如果确实无法翻译，保留英文原文即可。
- `abstract` 优先保留英文原摘要；如果源结果本身没有摘要，报告会显示占位说明。
- `selectionRationale` 和 `suggestedNextActions` 是必填顶层字段，每个至少包含 1 条。
- `selectionRationale` 和 `suggestedNextActions` 推荐输出为字符串数组，不要输出对象。
- 当你把推荐论文输出到聊天或 Markdown 时，标题应写成 `- [标题](url)`，不要只输出纯文本标题。
- `planning.keywordAssessment` 和 `execution.initialScopeQC` 虽然不是 `qc.json` 字段，但应体现在 `executiveSummary` 或 `suggestedNextActions` 中。
