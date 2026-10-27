# 已粘贴参考文献输入示例

本文件只用于参考文献列表/单条引用的截图或 Markdown。Agent 必须先展示结构化结果，指出看不清或缺失的题名、作者、年份、DOI，并取得明确确认。确认前不写入正式 JSON，确认前不查询数据库；不得猜测截断内容。

## 截图输入示例

先向用户展示：

| ID | 原始引用 | 题名 | 作者 | 年份 | DOI | 不确定项 |
|---|---|---|---|---:|---|---|
| ref-1 | Turing, A. M. (1950). Computing machinery and intelligence. | Computing machinery and intelligence | A. M. Turing | 1950 | — | DOI 未提供 |

用户明确确认后才写：

```json
{
  "version": "reference-input/v1",
  "input_kind": "screenshot",
  "source_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "references": [
    {
      "id": "ref-1",
      "raw_text": "Turing, A. M. (1950). Computing machinery and intelligence.",
      "title": "Computing machinery and intelligence",
      "authors": ["A. M. Turing"],
      "year": 1950,
      "source_locator": {"image_index": 1}
    }
  ]
}
```

报告 provenance 必须写“用户确认的视觉转录”，不能写成 OCR 精确原文。示例哈希仅是格式占位；正式输入必须计算真实来源或已确认完整转录的 SHA-256。

## Markdown 输入示例

先展示同一张字段表，用户明确确认后才写：

```json
{
  "version": "reference-input/v1",
  "input_kind": "markdown",
  "source_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "references": [
    {
      "id": "ref-1",
      "raw_text": "Lovelace, A. (1843). Notes on the Analytical Engine.",
      "title": "Notes on the Analytical Engine",
      "authors": ["Ada Lovelace"],
      "year": 1843,
      "source_locator": {"line_start": 1, "line_end": 1}
    }
  ]
}
```

Markdown 的 `raw_text` 保留用户粘贴原文；locator 使用真实行号。该分支不调用转换服务。

## 信息不完整示例

如果截图只显示“... prediction of speech[M]. Springer ...”或作者/题名被裁掉，应回复：

> 当前引用被截断，无法可靠确认完整题名和作者。请补充包含整条引用的清晰截图或完整 Markdown；在补充前不会生成正式 JSON，也不会查询任何数据库。

不得自行补成已知书名，也不得先查询后反推缺失字段。

## 顺序约束

始终先展示结构化结果，再披露来源查询与计费并等待确认。确认前不写入正式 JSON，确认前不查询数据库。确认后写入 owner-only 文件，再由 `verify-references` 严格校验；校验失败发生在授权和来源查询之前。
