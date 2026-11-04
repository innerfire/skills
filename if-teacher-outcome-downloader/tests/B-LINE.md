# teacher-outcome-downloader B 线（登录切片）

版本 **v0.1-auth**。真实执行日期：2026-09-23。

用户在指定浏览器完成 PKCE 后，`login --no-open` 返回 `loggedIn=true`，stdout 无 token。`whoami` 返回 `authenticated=true`，`scheduleCount=1`。

`export --name 测试导出skill` 写入 `/Users/jsonlee/Downloads/测试导出skill-教学成果`。报名学生 1，已提交任务 1。该提交没有附件，只有说明，已落成 `说明.txt`。失败 0。

## 闭环

- A 线：10/10 通过
- B 线：登录、教师身份、按日程名导出均通过
- 剩余：这场日程当前没有可下载的附件，只有文字说明
