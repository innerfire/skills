# Stage: verification-run

## 触发条件

`VERIFY-3` 已完成；文档分支的最终 validation 对应当前唯一 batch，或截图/Markdown 分支的 owner-only `reference-input.json` 对应刚确认的结构化预览。

## TODO

- 当前项：`VERIFY-4 执行来源验真并检查报告`

## 执行步骤

从 Skill 目录执行：

```bash
./if-libclaw verify-references \
  --input "$TASK_WORKSPACE/reference-batch.json" \
  --context "$TASK_WORKSPACE/reference-context.json" \
  --sources cnki,google_scholar,openalex,pubmed \
  --workspace-dir "$TASK_WORKSPACE/runs" \
  --timeout 45m
```

若当前输入是已确认的截图/Markdown，则改用直接输入，不传 `--context`：

```bash
./if-libclaw verify-references \
  --input "$TASK_WORKSPACE/reference-input.json" \
  --sources cnki,google_scholar,openalex,pubmed \
  --workspace-dir "$TASK_WORKSPACE/runs" \
  --timeout 45m
```

直接输入必须是 `reference-input/v1`。CLI 会在授权和来源查询前严格校验，并在 run workspace 派生 owner-only `reference-context.json`、`reference-batch.json` 与 `reference-batch.validation.json`；该路径不调用转换服务。

该命令会再次校验 context 绑定，按题名查询来源，并在同一运行目录写入 `verification.json`、中文 `report.html` 与便于复制的中文 `report.md`。HTML 与 Markdown 均由同一份结构化结果确定性渲染，不调用 LLM。默认且仅支持的来源为 CNKI、Google Scholar、OpenAlex、PubMed。CNKI 先使用 `TI="完整题名的自动半角查询"`；若该查询正常完成但为零候选，再使用去除 `——` 后副标题的 `SU="主标题"`（主题检索）。Google Scholar 使用无额外引号的裸完整题名；OpenAlex、PubMed 使用对应服务的题名查询。CNKI 回退不追加作者、年份、来源或原始书目；认证、限流、服务和响应错误不触发回退。`query-references` 是兼容命令，不属于本工作流。

来源临时网络错误、HTTP 429 或 5xx 由 CLI 按配置补查；4xx、配置错误和无效响应不绕过。业务命令返回 `AUTH_SESSION_REQUIRED` 时，在同一 Skill 目录执行一次 `./if-libclaw auth status`；只有明确输出 `Not logged in.` 才转入 `verification-auth` 的单次登录流程。授权、权限、版本、计费、配给或转换服务 401/403/422/503 不得触发 `login`；保留当前工作区和 Stage，给出简短可恢复状态并停止。不得调用除登录后等待“已完成”的 `AskUserQuestion` 外的结构化提问工具，不得询问认证配置或展示内部诊断。

五状态为 `verified`、`probable`、`conflict`、`not_found`、`unverifiable`。只有本次选择的全部来源都成功查询但没有可信候选时才是 `not_found`；来源不可用、验证码或证据不足必须为 `unverifiable`。

## 报告检查

1. 读取 `../../references/verification-schema.md`。
2. 确认 workspace、`verification.json`、`report.html` 和 `report.md` 实际存在；文档分支要求两份报告修改时间不早于最后一次 batch 写入，直接输入分支要求两份报告修改时间不早于 `reference-input.json`。
3. 实际打开 HTML 并读取 Markdown，核对标题、状态计数和逐条引用一致；概览题名必须完整可读，不能出现 `Ｃ`、`基` 等单字符题名；细节中每个来源的实际检索式严格符合 title-only 规则。
4. 核对 `document_sha256`、`completion_status`、五状态计数和 `summary.total`；每条应包含原文、位置、来源证据、理由和分数，warning 保留 OCR、验证码和 `*_unavailable`。
5. 若输入 SHA 命中 `../../references/reference-acceptance.json`，执行：

```bash
./if-libclaw check-reference-acceptance \
  --profile ./references/reference-acceptance.json \
  --context "$TASK_WORKSPACE/reference-context.json" \
  --batch "$TASK_WORKSPACE/reference-batch.json" \
  --verification "$VERIFICATION_JSON" \
  --output "$TASK_WORKSPACE/reference-acceptance.json"
```

6. 验收命令非零或 `valid=false` 时本次 E2E 为 failed；全部检查完成后勾选 `VERIFY-4`。
7. 报告检查完成并勾选 `VERIFY-4` 后，进入 `verification-delivery`。

## 完成条件

- 当前 batch 对应的验真 JSON、HTML 与 Markdown 实际存在并通过内容检查；
- 适用的 acceptance profile 已通过；
- 完成状态与来源证据一致。

## 禁止事项

- 不把 `not_found` 描述为“虚假文献”；来源不可用或证据不足应为 `unverifiable`。
- 不以“HTML 已生成”代替逐条查询式和题名检查。
- 不手写替代报告，不复用旧 run。

## 下一 Stage

完成后读取 `../verification-delivery/STAGE.md`。
