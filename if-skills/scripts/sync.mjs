#!/usr/bin/env node
// if-skills 同步助手（零依赖 Node ESM）
//
// 职责：
//   check  —— 拉取 github.com/innerfire/skills 最新快照，逐一对本地已装 skill 做字节级比对，
//            产出 new（上游有、本地无）/ updated（有差异）/ identical（一致）三类报告。
//   sync   —— 对指定 skill 执行"安全安装/更新"：先备份到 skills/ 目录之外，再同时同步到
//            中枢 ~/.agents/skills/<name> 与 WorkBuddy ~/.workbuddy/skills/<name>，最后 diff -r 校验。
//
// 设计要点（与 install-external-skill 约定一致）：
//   - 不觉察仓库根文件（README / LICENSE / .gitignore），只扫含 SKILL.md 的子目录。
//   - 写操作一律先预览、再带 --yes 才落盘；无 --yes 只返回预览。
//   - 备份一律落在 skills/ 之外的 _skill-backups/，避免被 WorkBuddy 当成第二个同名 skill。

import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, cpSync, rmSync, readdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPO = 'https://github.com/innerfire/skills.git';
const TMP = '/tmp/innerfire-skills-sync';
const AGENTS_DIR = join(homedir(), '.agents', 'skills');
const WB_DIR = join(homedir(), '.workbuddy', 'skills');
const BACKUP_AGENTS = join(homedir(), '.agents', '_skill-backups');
const BACKUP_WB = join(homedir(), '.workbuddy', '_skill-backups');

// ---------- 小工具 ----------
function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

function discoverUpstream(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => existsSync(join(root, n, 'SKILL.md')))
    .sort();
}

// 'identical' | 'updated' | 'new'
function diffStatus(upstreamDir, localDir) {
  if (!existsSync(localDir)) return 'new';
  try {
    const out = run('diff', ['-rq', upstreamDir, localDir]);
    return out.trim() === '' ? 'identical' : 'updated';
  } catch {
    // diff 退出码 1 = 存在差异（无论输出落在 stdout 还是 stderr）
    return 'updated';
  }
}

function verify(srcDir, dstDir) {
  try {
    const out = run('diff', ['-rq', srcDir, dstDir]);
    return out.trim() === '';
  } catch {
    return false;
  }
}

function headInfo() {
  const hash = run('git', ['-C', TMP, 'rev-parse', 'HEAD']).trim();
  const date = run('git', ['-C', TMP, 'log', '-1', '--format=%ci']).trim();
  const subject = run('git', ['-C', TMP, 'log', '-1', '--format=%s']).trim();
  return { hash, date, subject };
}

function cloneOrUpdate(force) {
  if (existsSync(join(TMP, '.git')) && !force) {
    try {
      run('git', ['-C', TMP, 'pull', '--ff-only', '--depth', '1']);
      return true;
    } catch {
      // 浅克隆 pull 偶尔失败，退回整目录重拉
    }
  }
  rmSync(TMP, { recursive: true, force: true });
  run('git', ['clone', '--depth', '1', REPO, TMP]);
  return true;
}

// ---------- 子命令：check ----------
function cmdCheck({ json, force }) {
  try {
    cloneOrUpdate(force);
  } catch (e) {
    const msg = `拉取上游仓库失败（多为网络抖动）：\n${String(e.stderr || e.message || e)}`;
    if (json) return out({ ok: false, error: msg });
    return out(msg);
  }

  const upstreamNames = discoverUpstream(TMP);
  const head = headInfo();

  const skills = upstreamNames.map((name) => {
    const upstreamDir = join(TMP, name);
    const localDir = join(WB_DIR, name);
    return {
      name,
      status: diffStatus(upstreamDir, localDir),
      upstream: upstreamDir,
      local: localDir,
    };
  });

  const summary = {
    new: skills.filter((s) => s.status === 'new').length,
    updated: skills.filter((s) => s.status === 'updated').length,
    identical: skills.filter((s) => s.status === 'identical').length,
    total: skills.length,
  };

  const report = {
    ok: true,
    repo: REPO,
    head,
    tmp: TMP,
    localDir: WB_DIR,
    skills,
    summary,
  };
  if (json) return out(report);

  // 人类可读表格
  const lines = [];
  lines.push(`上游 HEAD: ${head.hash}  (${head.date})  ${head.subject}`);
  lines.push(`本地目录: ${WB_DIR}`);
  lines.push('');
  lines.push('状态   技能');
  lines.push('------  ----');
  for (const s of skills) {
    const mark = { new: '🆕 新', updated: '🔄 更', identical: '✅ 同' }[s.status];
    lines.push(`${mark}  ${s.name}`);
  }
  lines.push('');
  lines.push(`合计: ${summary.total}  | 新 ${summary.new} · 可更新 ${summary.updated} · 已最新 ${summary.identical}`);
  if (summary.new === 0 && summary.updated === 0) {
    lines.push('本地已全部是最新。');
  }
  return out(lines.join('\n'));
}

// ---------- 子命令：sync ----------
function cmdSync({ names, yes, json }) {
  if (names.length === 0) {
    return out({ ok: false, error: 'sync 需要至少一个 --name <skill>' });
  }
  const results = names.map((name) => syncOne(name, yes));
  if (json) return out({ ok: results.every((r) => r.ok), results });

  const lines = results.map((r) => {
    if (!r.ok) return `❌ ${r.name}: ${r.message}`;
    if (r.dryRun) return `⏳ ${r.name}: 仅预览（加 --yes 才落盘）`;
    const mark = r.verifyWb && r.verifyAgents ? '✅' : '⚠️';
    return `${mark} ${r.name}: 已同步（备份 ${r.backupStamp}）` +
      (r.verifyWb && r.verifyAgents ? '' : ' · 校验未通过，请检查');
  });
  return out(lines.join('\n'));
}

function syncOne(name, yes) {
  const upstreamDir = join(TMP, name);
  if (!existsSync(join(upstreamDir, 'SKILL.md'))) {
    return { name, ok: false, message: `上游不存在该 skill：${name}` };
  }
  if (!yes) {
    return { name, ok: true, dryRun: true, message: 'preview only' };
  }

  const stamp = new Date().toISOString().slice(0, 10);

  // 1) 备份到 skills/ 之外
  for (const [src, bdir] of [
    [join(WB_DIR, name), BACKUP_WB],
    [join(AGENTS_DIR, name), BACKUP_AGENTS],
  ]) {
    if (existsSync(src)) {
      mkdirSync(bdir, { recursive: true });
      cpSync(src, join(bdir, `${name}.bak.${stamp}`), { recursive: true });
    }
  }

  // 2) 同时同步到两个落点
  mkdirSync(join(WB_DIR, name), { recursive: true });
  mkdirSync(join(AGENTS_DIR, name), { recursive: true });
  cpSync(upstreamDir, join(WB_DIR, name), { recursive: true });
  cpSync(upstreamDir, join(AGENTS_DIR, name), { recursive: true });

  // 3) 字节级校验
  const verifyWb = verify(upstreamDir, join(WB_DIR, name));
  const verifyAgents = verify(upstreamDir, join(AGENTS_DIR, name));

  return {
    name,
    ok: verifyWb && verifyAgents,
    verifyWb,
    verifyAgents,
    backupStamp: stamp,
  };
}

// ---------- 输出 ----------
function out(payload) {
  if (typeof payload === 'string') {
    process.stdout.write(payload + '\n');
  } else {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  }
  process.exit(0);
}

// ---------- argv ----------
function main() {
  const argv = process.argv.slice(2);
  const cmd = argv.find((a) => !a.startsWith('--')) ?? 'check';
  const json = argv.includes('--json');
  const force = argv.includes('--force-clone');
  const yes = argv.includes('--yes');
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--name' && argv[i + 1]) names.push(argv[i + 1]);
    if (argv[i] === '--names' && argv[i + 1]) names.push(...argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean));
  }

  if (cmd === 'check') return cmdCheck({ json, force });
  if (cmd === 'sync') return cmdSync({ names, yes, json });
  out({ ok: false, error: `未知子命令：${cmd}（支持 check / sync）` });
}

main();
