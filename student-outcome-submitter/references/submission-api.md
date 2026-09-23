# 学生提交接口

脚本只调用下面这些学生 Bearer 接口。不发送 Cookie，不调用教师路由。

| 命令 | 方法 | 路径 |
|---|---|---|
| whoami / schedules list | GET | `/v1/me/schedules` |
| tasks list | GET | `/v1/schedules/{scheduleId}/experience` |
| submit --yes | POST | `/v1/schedules/{scheduleId}/tasks/{taskId}/submissions` |

POST 使用 `multipart/form-data`。文件字段名是重复的 `file`，说明字段名是 `comment`。请求头带 `Idempotency-Key`。同一份说明和同一批文件字节重试时复用键；内容变了就换键。

限额：说明最多 4000 字；文件最多 10 个；单文件不超过 50 MB；合计不超过 100 MB。说明和文件至少有一项。扩展名与 `submission_result` 策略一致。

成功是 HTTP 201，`data.taskKind` 为 `milestone` 或 `course_report`。学生端只显示当前版本，重交会让 `versionNo` 增加。

日程只有 `derivedStatus=learning` 且学习页 `scenario=learning` 时可以提交。任务或所在章节未开放时不提交。现行学习页用 `chapter.capability.enabled` 和 `task.submissionCapability.enabled` 表示是否开放；fixture 里的 `open` 布尔值仍然有效。
