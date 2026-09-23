# if-skills 安装/更新流程（与 install-external-skill 约定一致）

`scripts/sync.mjs` 的 `sync` 子命令已把下面流程固化成代码，这里记录**为什么**这么做，方便排错。

## 1. 两份落点

skills CLI（`npx skills add`）的真实中枢是 `~/.agents/skills/<name>/`，再在各 agent 目录里建**软链**。
WorkBuddy 实际读取 `~/.workbuddy/skills/<name>/`。所以安装时两处都要同步：

```bash
cp -R /tmp/innerfire-skills-sync/<name>/. ~/.agents/skills/<name>/
cp -R /tmp/innerfire-skills-sync/<name>/. ~/.workbuddy/skills/<name>/
```

`/.` 结尾是复制**内容**而非目录本身——否则会把上游目录当子目录套一层。

## 2. 备份必须放在 skills/ 之外

WorkBuddy 扫描 `~/.workbuddy/skills/*/SKILL.md`，把每个含 SKILL.md 的目录当成 skill。
若把备份放在 `skills/` 内（哪怕名字是 `.xxx.bak`），会被当成**第二个同名 skill**，
`Skill` 工具可能加载到备份里的旧版。已实踩：加载 `course-template-creator` 时 base directory
指向了 `~/.workbuddy/skills/.course-template-creator.bak.20260918`。

✅ 正确落点：`~/.workbuddy/_skill-backups/` 与 `~/.agents/_skill-backups/`。

## 3. 校验

装完必跑：

```bash
diff -r /tmp/innerfire-skills-sync/<name> ~/.workbuddy/skills/<name>
diff -r /tmp/innerfire-skills-sync/<name> ~/.agents/skills/<name>
```

两处都无差异才算成功。注意 `diff -r` 只比 skill 子目录，**不要拿仓库根去比**
（根的 `.gitignore` / `LICENSE` / `README` 不会被 CLI 收录，会误判成"上游多了文件"）。

## 4. 网络抖动降级

`npx skills add` 失败常是 GitHub 网络抖动（SSL_ERROR_SYSCALL），但 `git clone --depth 1` 往往能通。
本 skill 直接用 `git clone --depth 1`，已落在可靠路径上。若仍失败，提示用户重试即可。
另外：`npx` 报 Failed 时可能已**部分成功**（第一个 skill 已落中枢），降级前先 `ls` 确认真实状态。

## 5. 密钥/环境变量约定（火光内部）

- 明文不落文件，一律 macOS 钥匙串：`security add-generic-password -a "$USER" -s <SERVICE> -w '<key>' -U`
- 读 key 类变量需从 `~/.zshrc` 取新值（Bash 工具环境是启动快照，改 zshrc 不影响当前会话）：
  `VAR="$(zsh -i -c 'printenv VAR' 2>/dev/null)"`
- ⚠️ `XAI_PAYLOAD_ORIGIN` 被 `course-template-creator`（要 aixmng）与
  `student-outcome-submitter`（要 aixstu）抢用，env 优先于持久化配置，会导致学生端静默提交到错误服务器。
  新 skill 若也读此变量，先核对语义，必要时调用时就地覆盖，不要改 `~/.zshrc`。
- 换 origin ≠ 数据等价：HTTP 200 不代表内容一致，换源后必须重新核对业务数据条数。
