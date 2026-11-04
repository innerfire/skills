#!/usr/bin/env node
/**
 * ifAS Center CMS Admin & Operations CLI (`if-ifas-admin`).
 * Zero external runtime dependencies (Node.js >= 20 built-ins only).
 *
 * Authentication & session storage are delegated to `@innerfire/auth-cli`:
 *   ~/.config/innerfire-auth-cli/projects/<projectKey>/session.json (mode 0600)
 * Raw tokens and cookies are NEVER printed to stdout/stderr.
 * All write operations default to dry-run preview unless `--yes` is passed.
 * Physical hard deletion (HTTP DELETE) is strictly blocked in code.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, posix, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";

export const DEFAULTS = Object.freeze({
  prodOrigin: "https://ifasccms.innerfireai.com",
  prodProjectKey: "ifas-cms",
  localProjectKey: "ifas-cms-local",
  maxUploadBytes: 50 * 1024 * 1024,
  timeoutMs: 30_000,
});

const ALLOWED_MIMES = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".zip": "application/zip",
});

const ZIP_EXCLUDED_NAMES = new Set([
  ".git",
  "node_modules",
  ".DS_Store",
  "Thumbs.db",
  "__pycache__",
  ".pytest_cache",
  ".turbo",
  ".next",
  "tests",
  "__tests__",
  "results.tsv",
  "test-prompts.json",
]);

const REDACT_KEYS = new Set([
  "token",
  "accessToken",
  "refreshToken",
  "cookie",
  "password",
  "secret",
  "accessKeySecret",
  "clientSecret",
]);

export class CliError extends Error {
  constructor(message, code = "error", details = undefined) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.details = details;
  }
}

export function fail(message, code = "error", details = undefined) {
  return new CliError(message, code, details);
}

export function stripSlash(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (REDACT_KEYS.has(k)) continue;
      out[k] = redactSecrets(v);
    }
    return out;
  }
  return value;
}

export function loadRuntimeConfig(env = process.env) {
  const rawOrigin = env.IFAS_CMS_ORIGIN ? stripSlash(env.IFAS_CMS_ORIGIN) : DEFAULTS.prodOrigin;
  let parsedOrigin;
  try {
    parsedOrigin = new URL(rawOrigin);
  } catch {
    throw fail(`无效的 CMS 地址: ${rawOrigin}`, "invalid_config");
  }
  if (parsedOrigin.protocol !== "https:" && parsedOrigin.protocol !== "http:") {
    throw fail(`CMS 地址必须是 http(s) 协议: ${rawOrigin}`, "invalid_config");
  }
  const cmsOrigin = parsedOrigin.origin;
  const isDefaultProd = cmsOrigin === DEFAULTS.prodOrigin;
  const projectKey =
    (env.IFAS_AUTH_PROJECT_KEY && env.IFAS_AUTH_PROJECT_KEY.trim()) ||
    (isDefaultProd ? DEFAULTS.prodProjectKey : DEFAULTS.localProjectKey);

  if (!/^[a-zA-Z0-9_-]+$/.test(projectKey)) {
    throw fail(`非法的 auth-cli projectKey: ${projectKey}`, "invalid_config");
  }

  const authConfigDir =
    (env.INNERFIRE_AUTH_CONFIG_DIR && resolve(env.INNERFIRE_AUTH_CONFIG_DIR.trim())) ||
    join(homedir(), ".config", "innerfire-auth-cli");

  const projectDir = join(authConfigDir, "projects", projectKey);
  return {
    cmsOrigin,
    projectKey,
    isDefaultProd,
    authConfigDir,
    projectDir,
    projectFile: join(projectDir, "project.json"),
    sessionFile: join(projectDir, "session.json"),
    authCliBin: env.IFAS_AUTH_CLI_BIN ? env.IFAS_AUTH_CLI_BIN.trim() : null,
  };
}

export async function readAuthCliSession(cfg) {
  try {
    const raw = await readFile(cfg.sessionFile, "utf8");
    const session = JSON.parse(raw);
    if (!session || typeof session.token !== "string" || !session.token) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt = typeof session.expiresAt === "number" ? session.expiresAt : 0;
    if (expiresAt <= nowSec + 60) {
      return { expired: true, expiresAt, userEmail: session.userEmail || null };
    }
    return {
      expired: false,
      cookieName: session.cookieName || "payload-token",
      token: session.token,
      expiresAt,
      userEmail: session.userEmail || null,
    };
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw fail(`读取会话文件失败: ${err.message}`, "session_corrupt");
  }
}

export function buildCmsHeaders(cmsOrigin, session, extraHeaders = {}) {
  const origin = new URL(cmsOrigin).origin;
  return {
    Origin: origin,
    Referer: `${origin}/admin`,
    Cookie: `${session.cookieName}=${session.token}`,
    ...extraHeaders,
  };
}

export async function cmsFetch(cfg, session, { method = "GET", path, body, headers = {} }, fetchImpl = fetch) {
  const upperMethod = String(method).toUpperCase();
  if (upperMethod === "DELETE") {
    throw fail(
      "安全红线拦截：禁止通过 Skill 发送物理 DELETE 请求。请改用 takedown (--mode disable|unpublish|trash) 或 feeds set-hidden。",
      "forbidden_operation",
    );
  }
  if (/^\/?api\/admin-users(?:\b|\/|$)/.test(path) && upperMethod !== "GET") {
    throw fail("越权拦截：本 Skill 不允许新增或修改 admin-users 后台账号。", "out_of_scope");
  }

  const url = new URL(path.startsWith("/") ? path : `/${path}`, cfg.cmsOrigin);
  const mergedHeaders = buildCmsHeaders(cfg.cmsOrigin, session, headers);
  let payloadBody = body;

  if (body !== undefined && body !== null && !(body instanceof FormData) && typeof body === "object" && !Buffer.isBuffer(body)) {
    mergedHeaders["Content-Type"] = "application/json";
    payloadBody = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetchImpl(url.toString(), {
      method: upperMethod,
      headers: mergedHeaders,
      body: payloadBody,
      signal: AbortSignal.timeout(DEFAULTS.timeoutMs),
    });
  } catch (err) {
    throw fail(`无法连接 CMS (${cfg.cmsOrigin}): ${err.message}`, "unreachable");
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (res.status === 401) {
    throw fail("CMS 管理会话未登录或已失效，请执行 login --json 重新授权。", "unauthenticated");
  }
  if (res.status === 403) {
    const msg = extractPayloadErrorMessage(json) || "当前账号无此操作权限或已被停用";
    throw fail(msg, "forbidden");
  }
  if (!res.ok) {
    const msg = extractPayloadErrorMessage(json) || `CMS 请求失败 (HTTP ${res.status})`;
    const code = res.status === 404 ? "not_found" : res.status === 409 ? "conflict" : "cms_error";
    throw fail(msg, code, { status: res.status, errors: json?.errors });
  }

  return json;
}

export function extractPayloadErrorMessage(json) {
  if (!json || typeof json !== "object") return null;
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    return json.errors.map((e) => e?.message || JSON.stringify(e)).join("; ");
  }
  if (typeof json.message === "string" && json.message) return json.message;
  if (typeof json.error === "string" && json.error) return json.error;
  return null;
}

export async function verifyStaffSession(cfg, fetchImpl = fetch) {
  const session = await readAuthCliSession(cfg);
  if (!session) {
    throw fail(
      `尚未登录 CMS (${cfg.cmsOrigin})，请先执行 login --json 完成浏览器授权。`,
      "unauthenticated",
    );
  }
  if (session.expired) {
    throw fail(
      `本地 CMS 会话已过期，请执行 login --json 重新授权。`,
      "unauthenticated",
    );
  }

  const me = await cmsFetch(cfg, session, { method: "GET", path: "/api/admin-users/me" }, fetchImpl);
  const user = me?.user;
  if (!user) {
    throw fail("CMS 会话无效或已退出，请执行 login --json 重新授权。", "unauthenticated");
  }
  if (user.enabled !== true || (user.role !== "admin" && user.role !== "operator")) {
    throw fail(
      `当前账号 (${user.email || user.id}) 不是启用的管理员或运营人员 (role=${user.role}, enabled=${user.enabled})。`,
      "forbidden",
    );
  }

  return {
    session,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName || null,
      role: user.role,
      enabled: user.enabled,
    },
  };
}

export async function runAuthCliCommand(cfg, subArgs, env = process.env) {
  const cmd = cfg.authCliBin || "npx";
  const fullArgs = cfg.authCliBin
    ? subArgs
    : ["--yes", "@innerfire/auth-cli", ...subArgs];

  await mkdir(cfg.authConfigDir, { recursive: true });

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, fullArgs, {
      env: {
        ...env,
        INNERFIRE_AUTH_CONFIG_DIR: cfg.authConfigDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuf = "";
    let stderrBuf = "";

    const forwardSafeLine = (chunk, isErr) => {
      const text = chunk.toString("utf8");
      if (isErr) stderrBuf += text;
      else stdoutBuf += text;
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/https?:\/\/\S+\/api\/cli-auth/i.test(trimmed) || /open this url|waiting for browser/i.test(trimmed)) {
          process.stderr.write(`[auth-cli] ${trimmed}\n`);
        }
      }
    };

    child.stdout.on("data", (c) => forwardSafeLine(c, false));
    child.stderr.on("data", (c) => forwardSafeLine(c, true));
    child.on("error", (err) => rejectPromise(fail(`启动 @innerfire/auth-cli 失败: ${err.message}`, "auth_cli_error")));
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        const cleanErr = (stderrBuf || stdoutBuf).replace(/payload-token=[^\s;"]+/g, "payload-token=[REDACTED]").trim();
        rejectPromise(fail(`auth-cli 执行失败 (exit=${exitCode}): ${cleanErr || "未知错误"}`, "auth_cli_error"));
        return;
      }
      resolvePromise();
    });
  });
}

// ---------------------------------------------------------------------------
// Markdown -> Payload 3 Lexical SerializedEditorState converter
// ---------------------------------------------------------------------------

function makeLexicalText(text, format = 0) {
  return {
    type: "text",
    detail: 0,
    format,
    mode: "normal",
    style: "",
    text,
    version: 1,
  };
}

export function parseInlineMarkdownToLexicalNodes(line) {
  const nodes = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(makeLexicalText(line.slice(lastIndex, match.index), 0));
    }
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(makeLexicalText(token.slice(1, -1), 16));
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(makeLexicalText(token.slice(2, -2), 1));
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(makeLexicalText(token.slice(1, -1), 2));
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < line.length) {
    nodes.push(makeLexicalText(line.slice(lastIndex), 0));
  }
  return nodes.length > 0 ? nodes : [makeLexicalText("", 0)];
}

function makeParagraphNode(children) {
  return {
    type: "paragraph",
    direction: "ltr",
    format: "",
    indent: 0,
    textFormat: 0,
    textStyle: "",
    version: 1,
    children,
  };
}

export function markdownToLexical(markdown) {
  const raw = String(markdown ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) {
    return {
      root: {
        type: "root",
        direction: "ltr",
        format: "",
        indent: 0,
        version: 1,
        children: [makeParagraphNode([makeLexicalText("", 0)])],
      },
    };
  }

  const lines = raw.split("\n");
  const children = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block -> inline-code paragraphs compatible with default lexicalEditor()
    if (trimmed.startsWith("```")) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      children.push(makeParagraphNode([makeLexicalText(codeLines.join("\n"), 16)]));
      continue;
    }

    // Heading (#..####)
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      children.push({
        type: "heading",
        tag: `h${level}`,
        direction: "ltr",
        format: "",
        indent: 0,
        version: 1,
        children: parseInlineMarkdownToLexicalNodes(headingMatch[2].trim()),
      });
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      children.push({
        type: "quote",
        direction: "ltr",
        format: "",
        indent: 0,
        version: 1,
        children: parseInlineMarkdownToLexicalNodes(quoteLines.join(" ")),
      });
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      const listItems = [];
      let val = 1;
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^[-*+]\s+/, "");
        listItems.push({
          type: "listitem",
          direction: "ltr",
          format: "",
          indent: 0,
          value: val++,
          version: 1,
          children: parseInlineMarkdownToLexicalNodes(itemText),
        });
        i++;
      }
      children.push({
        type: "list",
        listType: "bullet",
        tag: "ul",
        start: 1,
        direction: "ltr",
        format: "",
        indent: 0,
        version: 1,
        children: listItems,
      });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const listItems = [];
      let val = 1;
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^\d+\.\s+/, "");
        listItems.push({
          type: "listitem",
          direction: "ltr",
          format: "",
          indent: 0,
          value: val++,
          version: 1,
          children: parseInlineMarkdownToLexicalNodes(itemText),
        });
        i++;
      }
      children.push({
        type: "list",
        listType: "number",
        tag: "ol",
        start: 1,
        direction: "ltr",
        format: "",
        indent: 0,
        version: 1,
        children: listItems,
      });
      continue;
    }

    // Regular paragraph (merge consecutive plain lines)
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !/^(#{1,4})\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith(">") &&
      !/^[-*+]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    children.push(makeParagraphNode(parseInlineMarkdownToLexicalNodes(paraLines.join(" "))));
  }

  return {
    root: {
      type: "root",
      direction: "ltr",
      format: "",
      indent: 0,
      version: 1,
      children: children.length > 0 ? children : [makeParagraphNode([makeLexicalText("", 0)])],
    },
  };
}

// ---------------------------------------------------------------------------
// Zero-dependency ZIP creator & local Skill directory parser
// ---------------------------------------------------------------------------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZipArchive(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path.replace(/\\/g, "/"), "utf8");
    const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const deflated = deflateRawSync(rawData);
    const useDeflate = deflated.length < rawData.length;
    const compData = useDeflate ? deflated : rawData;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(rawData);

    // Fixed deterministic DOS timestamp (2026-01-01 00:00:00) so identical dir -> identical SHA256!
    const dosTime = 0x0000;
    const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compData.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compData);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compData.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compData.length;
  }

  const centralSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function shouldExcludeFromSkillZip(entryName) {
  if (ZIP_EXCLUDED_NAMES.has(entryName)) return true;
  if (entryName === ".env" || (entryName.startsWith(".env.") && entryName !== ".env.example")) return true;
  if (/\.bak(\.|$)/i.test(entryName)) return true;
  if (/\.(test|spec)\.(mjs|cjs|js|ts|mts|cts)$/i.test(entryName)) return true;
  return false;
}

async function walkSkillDir(rootDir, currentDir, files, excluded) {
  const dirEntries = await readdir(currentDir, { withFileTypes: true });
  dirEntries.sort((a, b) => a.name.localeCompare(b.name));
  for (const d of dirEntries) {
    const abs = join(currentDir, d.name);
    const rel = relative(rootDir, abs).split("\\").join("/");
    if (shouldExcludeFromSkillZip(d.name)) {
      excluded.push(rel);
      continue;
    }
    if (d.isDirectory()) {
      await walkSkillDir(rootDir, abs, files, excluded);
    } else if (d.isFile()) {
      const data = await readFile(abs);
      files.push({ relPath: rel, data });
    }
  }
}

export function parseSkillMarkdownMetadata(skillMdText, fallbackSlug) {
  const normalized = String(skillMdText || "").replace(/\r\n/g, "\n");
  let frontmatterName = "";
  let frontmatterDesc = "";
  let body = normalized;

  const fmMatch = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (fmMatch) {
    const fm = fmMatch[1];
    body = fmMatch[2].trim();
    const nameLine = /^name:\s*(.+)$/m.exec(fm);
    if (nameLine) {
      frontmatterName = nameLine[1].trim().replace(/^["']|["']$/g, "");
    }
    const descMultiline = /^description:\s*>[+-]?\s*\n((?:[ \t]+.+\n?)+)/m.exec(fm);
    if (descMultiline) {
      frontmatterDesc = descMultiline[1]
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" ");
    } else {
      const descInline = /^description:\s*(.+)$/m.exec(fm);
      if (descInline) {
        frontmatterDesc = descInline[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  }

  const h1Match = /^#\s+(.+)$/m.exec(body);
  const titleCandidate = (h1Match ? h1Match[1].trim() : frontmatterName || fallbackSlug).slice(0, 100);
  const cleanedDesc = frontmatterDesc
    .replace(/\s*(?:适用于|触发词|不负责|Use when|Triggers on|Not for)[\s\S]*$/i, "")
    .trim();
  const rawSummary =
    cleanedDesc ||
    frontmatterDesc ||
    body.split("\n").find((l) => l.trim() && !l.startsWith("#")) ||
    "";
  const summaryCandidate = rawSummary.trim().slice(0, 300);

  const codeBlocks = [];
  const fenceRegex = /```(?:bash|sh|zsh|text|json|yaml|ts|js)?\n([\s\S]*?)```/g;
  let m;
  while ((m = fenceRegex.exec(body)) !== null && codeBlocks.length < 3) {
    const snippet = m[0].trim();
    if (snippet) codeBlocks.push({ markdown: snippet });
  }

  return {
    slug: frontmatterName || fallbackSlug,
    titleCandidate,
    summaryCandidate,
    introductionMarkdown: body,
    usageExamples: codeBlocks,
  };
}

export async function buildCleanSkillZip(skillDir) {
  const absDir = resolve(skillDir);
  let dirStat;
  try {
    dirStat = await stat(absDir);
  } catch {
    throw fail(`Skill 目录不存在: ${absDir}`, "invalid_input");
  }
  if (!dirStat.isDirectory()) {
    throw fail(`路径不是目录: ${absDir}`, "invalid_input");
  }

  const skillMdPath = join(absDir, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    throw fail(`目录缺少 SKILL.md，无法作为标准 Skill 打包: ${absDir}`, "invalid_input");
  }

  const rawSlug = basename(absDir);
  const safeSlug = rawSlug.replace(/[^a-zA-Z0-9._-]/g, "-") || "skill-package";
  const files = [];
  const excluded = [];
  await walkSkillDir(absDir, absDir, files, excluded);

  const archiveEntries = files.map((f) => ({
    path: posix.join(safeSlug, f.relPath),
    data: f.data,
  }));
  const zipBuffer = createZipArchive(archiveEntries);
  if (zipBuffer.length > DEFAULTS.maxUploadBytes) {
    throw fail(`打包后的 ZIP 超过 50MB 上限 (${zipBuffer.length} bytes)`, "invalid_input");
  }

  const sha256 = createHash("sha256").update(zipBuffer).digest("hex");
  const skillMdText = await readFile(skillMdPath, "utf8");
  const extracted = parseSkillMarkdownMetadata(skillMdText, safeSlug);

  return {
    absDir,
    safeSlug,
    zipFilename: `${safeSlug}.zip`,
    fileCount: files.length,
    uncompressedBytes: files.reduce((s, f) => s + f.data.length, 0),
    zipBytes: zipBuffer.length,
    sha256,
    zipBuffer,
    excluded,
    extracted,
  };
}

// ---------------------------------------------------------------------------
// Media upload & SHA256 deduplication
// ---------------------------------------------------------------------------

export function normalizeAsciiFilename(originalName, sha256Hex) {
  const ext = extname(originalName).toLowerCase();
  const stem = basename(originalName, extname(originalName));
  if (/^[a-zA-Z0-9._-]+$/.test(stem) && stem.length <= 80) {
    return `${stem}${ext}`;
  }
  const cleanPrefix = stem.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "asset";
  return `${cleanPrefix}-${String(sha256Hex).slice(0, 12)}${ext}`;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(val) {
  return UUID_REGEX.test(String(val || "").trim());
}

export async function prepareMediaInput(cfg, session, valueOrPath, { expectedKind = "any", alt = "", yes = false, forceUpload = false } = {}, fetchImpl = fetch) {
  const raw = String(valueOrPath || "").trim();
  if (!raw) return null;

  if (isUuid(raw) && !existsSync(raw)) {
    const doc = await cmsFetch(cfg, session, { method: "GET", path: `/api/media/${raw}?depth=0` }, fetchImpl);
    if (expectedKind === "image" && !String(doc.mimeType || "").startsWith("image/")) {
      throw fail(`媒体 ${raw} 不是图片类型 (${doc.mimeType})`, "invalid_input");
    }
    if (expectedKind === "zip" && !String(doc.mimeType || "").includes("zip")) {
      throw fail(`媒体 ${raw} 不是 ZIP 安装包 (${doc.mimeType})`, "invalid_input");
    }
    return {
      mode: "existing_id",
      mediaId: doc.id,
      url: doc.url || null,
      filename: doc.filename,
      filesize: doc.filesize,
      mimeType: doc.mimeType,
    };
  }

  const absPath = resolve(raw);
  let fileStat;
  try {
    fileStat = await stat(absPath);
  } catch {
    throw fail(`本地文件不存在（也不是有效的媒体 UUID）: ${raw}`, "invalid_input");
  }
  if (!fileStat.isFile()) {
    throw fail(`媒体路径不是普通文件: ${absPath}`, "invalid_input");
  }
  if (fileStat.size === 0) {
    throw fail(`媒体文件为空: ${absPath}`, "invalid_input");
  }
  if (fileStat.size > DEFAULTS.maxUploadBytes) {
    throw fail(`文件大小超过 50MB 限制: ${absPath}`, "invalid_input");
  }

  const ext = extname(absPath).toLowerCase();
  const mimeType = ALLOWED_MIMES[ext];
  if (!mimeType) {
    throw fail(
      `不支持的文件扩展名 ${ext || "(无)"}；仅支持 .jpg / .jpeg / .png / .webp / .zip`,
      "invalid_input",
    );
  }
  if (expectedKind === "image" && !mimeType.startsWith("image/")) {
    throw fail(`该字段仅接受图片文件 (.jpg/.png/.webp)，当前为 ${ext}`, "invalid_input");
  }
  if (expectedKind === "zip" && mimeType !== "application/zip") {
    throw fail(`安装包字段仅接受 .zip 文件，当前为 ${ext}`, "invalid_input");
  }

  const buffer = await readFile(absPath);
  return uploadOrReuseMediaBuffer(
    cfg,
    session,
    {
      buffer,
      originalName: basename(absPath),
      mimeType,
      alt: alt || basename(absPath, ext),
      yes,
      forceUpload,
    },
    fetchImpl,
  );
}

export async function uploadOrReuseMediaBuffer(
  cfg,
  session,
  { buffer, originalName, mimeType, alt = "", yes = false, forceUpload = false },
  fetchImpl = fetch,
) {
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const safeFilename = normalizeAsciiFilename(originalName, sha256);

  if (!forceUpload) {
    const existingRes = await cmsFetch(
      cfg,
      session,
      {
        method: "GET",
        path: `/api/media?where[contentSha256][equals]=${encodeURIComponent(sha256)}&limit=1&depth=0`,
      },
      fetchImpl,
    );
    const existing = existingRes?.docs?.[0];
    if (existing) {
      return {
        mode: "reused_sha256",
        mediaId: existing.id,
        url: existing.url || null,
        filename: existing.filename,
        filesize: existing.filesize,
        mimeType: existing.mimeType,
        sha256,
      };
    }
  }

  if (!yes) {
    return {
      mode: "pending_upload",
      mediaId: `<pending-upload:${safeFilename}>`,
      url: null,
      filename: safeFilename,
      originalName,
      filesize: buffer.length,
      mimeType,
      alt: String(alt || "").slice(0, 200),
      sha256,
    };
  }

  const form = new FormData();
  form.append("_payload", JSON.stringify({ alt: String(alt || safeFilename).slice(0, 200) }));
  form.append("file", new Blob([buffer], { type: mimeType }), safeFilename);

  const created = await cmsFetch(
    cfg,
    session,
    {
      method: "POST",
      path: "/api/media",
      body: form,
    },
    fetchImpl,
  );
  const doc = created?.doc || created;
  return {
    mode: "uploaded",
    mediaId: doc.id,
    url: doc.url || null,
    filename: doc.filename || safeFilename,
    filesize: doc.filesize ?? buffer.length,
    mimeType: doc.mimeType || mimeType,
    sha256,
  };
}

// ---------------------------------------------------------------------------
// Domain helpers: Version History, Feed Impact Prediction, Tag & Relation Lookup
// ---------------------------------------------------------------------------

export function mergeVersionHistory(existingHistory, { version, changelog, packageFileId, releasedAt, kind = "agents" }) {
  const prev = Array.isArray(existingHistory) ? existingHistory : [];
  const normalizedPrev = prev.map((item) => {
    const copy = { ...item, isCurrent: false };
    if (copy.packageFile && typeof copy.packageFile === "object" && copy.packageFile.id) {
      copy.packageFile = copy.packageFile.id;
    }
    return copy;
  });

  const filteredPrev = normalizedPrev.filter((item) => item.version !== version);
  const head = {
    version,
    releasedAt: releasedAt || new Date().toISOString(),
    isCurrent: true,
    ...(changelog ? { changelog } : {}),
    ...(kind === "skills" && packageFileId ? { packageFile: packageFileId } : {}),
  };

  // CRITICAL: cms/src/lib/feeds-generator.ts reads currVersions[0] as the latest version!
  return [head, ...filteredPrev];
}

export function predictFeedImpact(collectionSlug, previousDoc, nextData) {
  const nextStatus = nextData._status ?? previousDoc?._status ?? "draft";
  if (nextStatus !== "published") {
    return { willCreateFeed: false, eventType: null, note: "草稿状态不会触发门户公开动态 (feeds)" };
  }
  if (!["agents", "skills", "topics"].includes(collectionSlug)) {
    return { willCreateFeed: false, eventType: null, note: "该集合不生成门户动态" };
  }

  const isFirstPublish =
    (!previousDoc || previousDoc._status !== "published") && !previousDoc?.firstPublishedAt;
  if (isFirstPublish) {
    return { willCreateFeed: true, eventType: "publish", note: "首次正式上线，将自动生成「新上线」门户动态" };
  }

  const isRelist =
    previousDoc && previousDoc._status !== "published" && Boolean(previousDoc.firstPublishedAt);
  if (isRelist) {
    return { willCreateFeed: true, eventType: "relist", note: "从草稿恢复上线，将自动生成「重新上线」门户动态" };
  }

  if (collectionSlug === "agents" || collectionSlug === "skills") {
    const currLen = Array.isArray(nextData.versionHistory)
      ? nextData.versionHistory.length
      : Array.isArray(previousDoc?.versionHistory)
        ? previousDoc.versionHistory.length
        : 0;
    const prevLen = Array.isArray(previousDoc?.versionHistory) ? previousDoc.versionHistory.length : 0;
    if (currLen > prevLen) {
      const topVer = nextData.versionHistory?.[0]?.version || nextData.version || "";
      return {
        willCreateFeed: true,
        eventType: "release",
        note: `versionHistory 新增版本记录 (${topVer})，将自动生成「发布新版本」门户动态`,
      };
    }
  }

  if (previousDoc && previousDoc._status === "published") {
    const watchedFields = [
      "name",
      "title",
      "summary",
      "applicableScenarios",
      "runtimeEnvironment",
      "introduction",
      "description",
      "screenshots",
    ];
    const changed = watchedFields.some(
      (f) => f in nextData && JSON.stringify(nextData[f]) !== JSON.stringify(previousDoc[f]),
    );
    if (changed) {
      return {
        willCreateFeed: true,
        eventType: "update",
        note: "已发布内容字段变更，将触发「有更新」门户动态（30分钟内自动防抖合并）",
      };
    }
  }

  return { willCreateFeed: false, eventType: null, note: "未命中门户动态触发条件" };
}

export async function resolveTagIds(cfg, session, group, inputs, fetchImpl = fetch) {
  if (!inputs || inputs.length === 0) return [];
  const res = await cmsFetch(
    cfg,
    session,
    {
      method: "GET",
      path: `/api/tags?where[group][equals]=${encodeURIComponent(group)}&limit=200&depth=0`,
    },
    fetchImpl,
  );
  const allTags = res?.docs || [];
  const enabledTags = allTags.filter((t) => t.enabled === true);

  const resolvedIds = [];
  for (const raw of inputs) {
    const needle = String(raw || "").trim();
    if (!needle) continue;
    const hit = allTags.find((t) => t.id === needle || t.name === needle);
    if (!hit) {
      const candidates = enabledTags.map((t) => `${t.name}(${t.id})`).join(", ") || "暂无启用标签";
      throw fail(
        `未找到 ${group === "type" ? "类型(type)" : "类别(category)"} 标签 "${needle}"。当前可用: ${candidates}`,
        "invalid_tag",
      );
    }
    if (!hit.enabled) {
      throw fail(`标签 "${hit.name}" (${hit.id}) 已停用，不能绑定到新内容`, "invalid_tag");
    }
    if (!resolvedIds.includes(hit.id)) resolvedIds.push(hit.id);
  }
  return resolvedIds;
}

export function parseTenantsFlag(raw) {
  if (raw === undefined) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.toLowerCase() === "all" || trimmed === "[]") return [];
  const list = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(list));
}

export async function resolveUniqueDocument(cfg, session, collection, { id, name, title }, fetchImpl = fetch) {
  if (id) {
    return cmsFetch(
      cfg,
      session,
      { method: "GET", path: `/api/${collection}/${encodeURIComponent(id)}?draft=true&depth=0` },
      fetchImpl,
    );
  }
  const field = collection === "topics" ? "title" : "name";
  const value = collection === "topics" ? title : name;
  if (!value) {
    throw fail(`必须通过 --id 或 --${field} 指定唯一目标记录`, "invalid_input");
  }
  const res = await cmsFetch(
    cfg,
    session,
    {
      method: "GET",
      path: `/api/${collection}?draft=true&depth=0&limit=10&where[${field}][equals]=${encodeURIComponent(value)}`,
    },
    fetchImpl,
  );
  const docs = res?.docs || [];
  if (docs.length === 0) {
    throw fail(`在 ${collection} 中未找到 ${field}="${value}" 的记录`, "not_found");
  }
  if (docs.length > 1) {
    throw fail(
      `${collection} 中存在 ${docs.length} 条同名记录 "${value}"，请改用明确的 --id 指定`,
      "ambiguous_match",
      { candidates: docs.map((d) => ({ id: d.id, [field]: d[field], _status: d._status, enabled: d.enabled })) },
    );
  }
  return docs[0];
}

export async function parseTopicItemsSpec(cfg, session, rawSpec, fetchImpl = fetch) {
  const entries = Array.isArray(rawSpec)
    ? rawSpec
    : String(rawSpec || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

  const items = [];
  for (const entry of entries) {
    let relationTo;
    let ref;
    if (typeof entry === "object" && entry !== null) {
      relationTo = entry.relationTo || entry.kind || entry.type;
      ref = entry.value || entry.id || entry.name;
    } else {
      const idx = String(entry).indexOf(":");
      if (idx <= 0) {
        throw fail(
          `专题条目格式错误 "${entry}"，应为 "agents:<id或名称>" 或 "skills:<id或名称>"`,
          "invalid_input",
        );
      }
      relationTo = entry.slice(0, idx).trim();
      ref = entry.slice(idx + 1).trim();
    }
    if (relationTo === "agent") relationTo = "agents";
    if (relationTo === "skill") relationTo = "skills";
    if (relationTo !== "agents" && relationTo !== "skills") {
      throw fail(`专题仅能关联 agents 或 skills，收到 "${relationTo}"`, "invalid_input");
    }

    const doc = isUuid(ref)
      ? await resolveUniqueDocument(cfg, session, relationTo, { id: ref }, fetchImpl)
      : await resolveUniqueDocument(cfg, session, relationTo, { name: ref }, fetchImpl);
    items.push({ target: { relationTo, value: doc.id } });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Argument parser & CLI dispatcher
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > 2) {
        const key = token.slice(2, eq);
        const val = token.slice(eq + 1);
        appendFlag(flags, key, val);
        i++;
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          flags[key] = true;
          i++;
        } else {
          appendFlag(flags, key, next);
          i += 2;
        }
      }
    } else {
      positionals.push(token);
      i++;
    }
  }
  return { positionals, flags };
}

function appendFlag(flags, key, val) {
  if (key in flags) {
    if (Array.isArray(flags[key])) flags[key].push(val);
    else flags[key] = [flags[key], val];
  } else {
    flags[key] = val;
  }
}

function splitCsv(val) {
  if (val === undefined || val === null || val === false) return [];
  const arr = Array.isArray(val) ? val : [val];
  return arr
    .flatMap((v) => String(v).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBool(val, flagName) {
  if (typeof val === "boolean") return val;
  const s = String(val).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  throw fail(`参数 --${flagName} 必须是 true 或 false，收到 "${val}"`, "invalid_input");
}

async function readTextOrFile(inlineVal, fileVal) {
  if (fileVal && typeof fileVal === "string") {
    return readFile(resolve(fileVal), "utf8");
  }
  if (typeof inlineVal === "string") return inlineVal;
  return undefined;
}

async function loadOptionalSpecJson(specFlag) {
  if (!specFlag || typeof specFlag !== "string") return {};
  const trimmed = specFlag.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      throw fail(`--spec JSON 解析失败: ${err.message}`, "invalid_input");
    }
  }
  const raw = await readFile(resolve(trimmed), "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw fail(`--spec 文件 JSON 解析失败: ${err.message}`, "invalid_input");
  }
}

function relationIdOf(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v.id === "string") return v.id;
  return null;
}

async function buildCatalogPayload(
  kind,
  { cfg, session, flags, spec, existingDoc, yes },
  fetchImpl = fetch,
) {
  const data = {};
  const mediaActions = [];
  let dirBundle = null;

  if (kind === "skills" && (flags["from-dir"] || spec.fromDir)) {
    dirBundle = await buildCleanSkillZip(flags["from-dir"] || spec.fromDir);
  }

  const nameVal = flags.name ?? spec.name ?? (!existingDoc && dirBundle ? dirBundle.extracted.titleCandidate : undefined);
  if (nameVal !== undefined) {
    const trimmed = String(nameVal).trim();
    if (!trimmed || trimmed.length > 100) throw fail("name 必填且长度不能超过 100 字符", "invalid_input");
    data.name = trimmed;
  } else if (!existingDoc) {
    throw fail("新建记录缺少必填参数 --name", "invalid_input");
  }

  const summaryVal =
    flags.summary ?? spec.summary ?? (!existingDoc && dirBundle ? dirBundle.extracted.summaryCandidate : undefined);
  if (summaryVal !== undefined) {
    const trimmed = String(summaryVal).trim();
    if (!trimmed || trimmed.length > 300) throw fail("summary 必填且长度不能超过 300 字符", "invalid_input");
    data.summary = trimmed;
  } else if (!existingDoc) {
    throw fail("新建记录缺少必填参数 --summary（一句话简介，<=300字）", "invalid_input");
  }

  if (flags["owner-name"] !== undefined || spec.ownerName !== undefined) {
    data.ownerName = String(flags["owner-name"] ?? spec.ownerName).trim();
  }

  // Tags
  const typeInput = flags["type-tag"] ?? spec.typeTag;
  if (typeInput !== undefined) {
    if (typeInput === "" || typeInput === "none") {
      data.typeTag = null;
    } else {
      const [typeId] = await resolveTagIds(cfg, session, "type", [typeInput], fetchImpl);
      data.typeTag = typeId;
    }
  }

  const categoryInput = flags["category-tags"] ?? spec.categoryTags;
  if (categoryInput !== undefined) {
    const list = Array.isArray(categoryInput) ? categoryInput : splitCsv(categoryInput);
    data.categoryTags = list.length === 0 ? [] : await resolveTagIds(cfg, session, "category", list, fetchImpl);
  }

  // RichText introduction
  const introMd =
    (await readTextOrFile(flags["intro-md"] ?? spec.introductionMarkdown, flags["intro-file"])) ??
    (!existingDoc && dirBundle && dirBundle.extracted.introductionMarkdown
      ? dirBundle.extracted.introductionMarkdown
      : undefined);
  if (introMd !== undefined) {
    data.introduction = markdownToLexical(introMd);
  } else if (spec.introduction && typeof spec.introduction === "object") {
    data.introduction = spec.introduction;
  }

  // Icon
  const iconInput = flags.icon ?? spec.icon;
  if (iconInput !== undefined) {
    const m = await prepareMediaInput(
      cfg,
      session,
      iconInput,
      { expectedKind: "image", alt: `${data.name || existingDoc?.name || kind} 图标`, yes },
      fetchImpl,
    );
    if (m) {
      mediaActions.push({ field: "icon", ...m });
      data.icon = m.mediaId;
    }
  }

  // Screenshots (max 2; published requires 2!)
  const screenshotsInput = flags.screenshots ?? spec.screenshots;
  if (screenshotsInput !== undefined) {
    const items = Array.isArray(screenshotsInput) ? screenshotsInput : splitCsv(screenshotsInput);
    if (items.length > 2) {
      throw fail("界面截图 (screenshots) 最多允许 2 张", "invalid_input");
    }
    const ids = [];
    for (let idx = 0; idx < items.length; idx++) {
      const m = await prepareMediaInput(
        cfg,
        session,
        items[idx],
        {
          expectedKind: "image",
          alt: `${data.name || existingDoc?.name || kind} 界面截图 ${idx + 1}`,
          yes,
        },
        fetchImpl,
      );
      mediaActions.push({ field: `screenshots[${idx}]`, ...m });
      ids.push(m.mediaId);
    }
    data.screenshots = ids;
  }

  // Common visibility & publication
  const tenantsInput = flags.tenants ?? spec.tenantIds;
  if (tenantsInput !== undefined) {
    data.tenantIds = Array.isArray(tenantsInput) ? tenantsInput : parseTenantsFlag(tenantsInput);
  } else if (!existingDoc) {
    data.tenantIds = [];
  }

  if (flags.enabled !== undefined || spec.enabled !== undefined) {
    data.enabled = parseBool(flags.enabled ?? spec.enabled, "enabled");
  } else if (!existingDoc) {
    data.enabled = true;
  }

  if (flags["sort-weight"] !== undefined || spec.sortWeight !== undefined) {
    const n = Number(flags["sort-weight"] ?? spec.sortWeight);
    if (!Number.isFinite(n)) throw fail("--sort-weight 必须是数字", "invalid_input");
    data.sortWeight = n;
  }

  const targetStatus =
    flags.status ?? spec._status ?? spec.status ?? (existingDoc ? existingDoc._status || "draft" : "draft");
  if (targetStatus !== "draft" && targetStatus !== "published") {
    throw fail(`--status 仅支持 draft 或 published，收到 "${targetStatus}"`, "invalid_input");
  }
  data._status = targetStatus;

  const effectiveScreenshots =
    data.screenshots !== undefined
      ? data.screenshots
      : Array.isArray(existingDoc?.screenshots)
        ? existingDoc.screenshots.map(relationIdOf).filter(Boolean)
        : [];

  if (data._status === "published" && effectiveScreenshots.length !== 2) {
    throw fail(
      `CMS 强校验拦截：${kind === "agents" ? "智能体" : "Skill"} 发布为 published 时必须提供恰好 2 张界面截图（当前 ${effectiveScreenshots.length} 张）。请补充 --screenshots <图1>,<图2> 或改用 --status draft 先存为草稿。`,
      "missing_screenshots",
    );
  }

  // Version & specific fields
  const nextVersion = flags.version ?? spec.version;
  if (nextVersion !== undefined) {
    data.version = String(nextVersion).trim();
  }

  let uploadedPackageMediaId = null;

  if (kind === "agents") {
    if (flags["target-url"] !== undefined || spec.targetUrl !== undefined) {
      data.targetUrl = String(flags["target-url"] ?? spec.targetUrl).trim();
    }
    if (flags["usage-steps"] !== undefined || spec.usageSteps !== undefined) {
      const rawSteps = flags["usage-steps"] ?? spec.usageSteps;
      data.usageSteps = Array.isArray(rawSteps)
        ? rawSteps.map((s) => String(s).trim()).filter(Boolean)
        : String(rawSteps)
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean);
    }
    if (flags["faqs-json"] !== undefined || spec.faqs !== undefined) {
      const rawFaqs =
        typeof flags["faqs-json"] === "string" ? JSON.parse(flags["faqs-json"]) : spec.faqs;
      if (!Array.isArray(rawFaqs)) throw fail("faqs 必须是 [{question, answer}] 数组", "invalid_input");
      data.faqs = rawFaqs;
    }
  } else if (kind === "skills") {
    if (flags.scenarios !== undefined || spec.applicableScenarios !== undefined) {
      data.applicableScenarios = String(flags.scenarios ?? spec.applicableScenarios).trim();
    }
    if (flags.runtime !== undefined || spec.runtimeEnvironment !== undefined) {
      data.runtimeEnvironment = String(flags.runtime ?? spec.runtimeEnvironment).trim();
    }
    if (flags["install-prompt"] !== undefined || spec.installPromptTemplate !== undefined) {
      data.installPromptTemplate = String(flags["install-prompt"] ?? spec.installPromptTemplate).trim();
    }
    if (flags["download-url"] !== undefined || spec.downloadUrl !== undefined) {
      data.downloadUrl = String(flags["download-url"] ?? spec.downloadUrl).trim();
    }
    if (flags["examples-md"] !== undefined || spec.usageExamples !== undefined) {
      const rawEx = flags["examples-md"] ?? spec.usageExamples;
      if (Array.isArray(rawEx)) {
        data.usageExamples = rawEx.map((item) =>
          typeof item === "string" ? { markdown: item } : { markdown: String(item.markdown || "") },
        );
      } else {
        data.usageExamples = [{ markdown: String(rawEx) }];
      }
    } else if (!existingDoc && dirBundle && dirBundle.extracted.usageExamples.length > 0) {
      data.usageExamples = dirBundle.extracted.usageExamples;
    }

    if (dirBundle) {
      const pkgMedia = await uploadOrReuseMediaBuffer(
        cfg,
        session,
        {
          buffer: dirBundle.zipBuffer,
          originalName: dirBundle.zipFilename,
          mimeType: "application/zip",
          alt: `${data.name || existingDoc?.name || dirBundle.safeSlug} 安装包`,
          yes,
        },
        fetchImpl,
      );
      mediaActions.push({
        field: "packageFile",
        fromDir: dirBundle.absDir,
        packedFiles: dirBundle.fileCount,
        excludedPaths: dirBundle.excluded,
        ...pkgMedia,
      });
      data.packageFile = pkgMedia.mediaId;
      uploadedPackageMediaId = pkgMedia.mediaId;
    } else if (flags["package-file"] !== undefined || spec.packageFile !== undefined) {
      const pkgMedia = await prepareMediaInput(
        cfg,
        session,
        flags["package-file"] ?? spec.packageFile,
        {
          expectedKind: "zip",
          alt: `${data.name || existingDoc?.name || "skill"} 安装包`,
          yes,
        },
        fetchImpl,
      );
      if (pkgMedia) {
        mediaActions.push({ field: "packageFile", ...pkgMedia });
        data.packageFile = pkgMedia.mediaId;
        uploadedPackageMediaId = pkgMedia.mediaId;
      }
    }
  }

  // Prepend versionHistory[0] when version is newly set or bumped
  const changelog = flags.changelog ?? spec.changelog;
  const shouldRecordVersion =
    flags["no-record-version"] !== true &&
    Boolean(data.version) &&
    (!existingDoc || data.version !== existingDoc.version || Boolean(changelog) || flags["record-version"] === true);

  if (shouldRecordVersion) {
    data.versionHistory = mergeVersionHistory(existingDoc?.versionHistory, {
      version: data.version,
      changelog: changelog ? String(changelog).trim() : undefined,
      packageFileId: uploadedPackageMediaId || relationIdOf(data.packageFile) || relationIdOf(existingDoc?.packageFile),
      kind,
    });
  }

  const feedImpact = predictFeedImpact(kind, existingDoc, data);
  return { data, mediaActions, feedImpact };
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

const BLOCKED_MUTATION_VERBS = new Set(["delete", "remove", "purge", "hard-delete", "destroy"]);

export async function executeCommand(argv, { env = process.env, fetchImpl = fetch } = {}) {
  const { positionals, flags } = parseArgs(argv);
  const [domain, action] = positionals;
  const yes = flags.yes === true;
  const cfg = loadRuntimeConfig(env);

  if (!domain || domain === "help" || flags.help) {
    return {
      ok: true,
      help: true,
      commands: [
        "config --json",
        "whoami --json",
        "login --json",
        "logout --json",
        "tags list|create|update --json",
        "media list|upload --json",
        "agents list|get|create|update|takedown|restore --json",
        "skills inspect-dir|list|get|create|update|takedown|restore --json",
        "topics list|get|create|update|takedown|restore --json",
        "banners list|create|update|takedown --json",
        "feeds list|set-hidden|update --json",
      ],
    };
  }

  if (domain === "admin-users") {
    throw fail("越权拦截：本 Skill 仅面向门户运营内容集合，不管理 admin-users 账号。", "out_of_scope");
  }

  if (BLOCKED_MUTATION_VERBS.has(domain) || BLOCKED_MUTATION_VERBS.has(action)) {
    throw fail(
      "安全红线拦截：禁止通过 Skill 执行物理硬删除。请改用 takedown (--mode disable|unpublish|trash) 下架或移入回收站，或用 feeds set-hidden --hidden true 隐藏动态。",
      "forbidden_operation",
    );
  }

  if (domain === "config") {
    return {
      ok: true,
      cmsOrigin: cfg.cmsOrigin,
      projectKey: cfg.projectKey,
      isDefaultProd: cfg.isDefaultProd,
    };
  }

  if (domain === "whoami") {
    const verified = await verifyStaffSession(cfg, fetchImpl);
    return {
      ok: true,
      cmsOrigin: cfg.cmsOrigin,
      projectKey: cfg.projectKey,
      user: verified.user,
      expiresAt: verified.session.expiresAt,
    };
  }

  if (domain === "login") {
    // Probe /api/cli-auth availability first for clear error reporting
    let probeRes;
    try {
      probeRes = await fetchImpl(
        `${cfg.cmsOrigin}/api/cli-auth?callback=${encodeURIComponent("http://127.0.0.1:1/callback")}&state=probe`,
        { redirect: "manual", signal: AbortSignal.timeout(10_000) },
      );
    } catch (err) {
      throw fail(`无法访问 CMS (${cfg.cmsOrigin}): ${err.message}`, "unreachable");
    }
    if (probeRes.status === 404) {
      throw fail(
        `目标 CMS (${cfg.cmsOrigin}) 返回 404，尚未挂载 /api/cli-auth 授权端点。请确认目标环境已部署包含 createCliAdminEndpoints 的版本。`,
        "cli_auth_unavailable",
      );
    }

    await runAuthCliCommand(cfg, ["login", "-p", cfg.projectKey, "-u", cfg.cmsOrigin], env);
    const verified = await verifyStaffSession(cfg, fetchImpl);
    return {
      ok: true,
      cmsOrigin: cfg.cmsOrigin,
      projectKey: cfg.projectKey,
      user: verified.user,
      expiresAt: verified.session.expiresAt,
    };
  }

  if (domain === "logout") {
    await rm(cfg.sessionFile, { force: true });
    return { ok: true, cleared: true, cmsOrigin: cfg.cmsOrigin, projectKey: cfg.projectKey };
  }

  // Pure offline inspection of a local skill directory requires no login!
  if (domain === "skills" && action === "inspect-dir") {
    if (!flags.dir) throw fail("缺少参数 --dir <本地Skill目录>", "invalid_input");
    const bundle = await buildCleanSkillZip(String(flags.dir));
    return {
      ok: true,
      dir: bundle.absDir,
      zipFilename: bundle.zipFilename,
      fileCount: bundle.fileCount,
      uncompressedBytes: bundle.uncompressedBytes,
      zipBytes: bundle.zipBytes,
      sha256: bundle.sha256,
      excluded: bundle.excluded,
      extracted: bundle.extracted,
    };
  }

  // All remaining commands require active admin/operator session
  const { session, user } = await verifyStaffSession(cfg, fetchImpl);

  // ---------------- TAGS ----------------
  if (domain === "tags") {
    if (action === "list") {
      const clauses = [];
      if (flags.group) clauses.push(`where[group][equals]=${encodeURIComponent(String(flags.group))}`);
      if (!flags.all) clauses.push("where[enabled][equals]=true");
      const qs = ["limit=200", "depth=0", "sort=sort", ...clauses].join("&");
      const res = await cmsFetch(cfg, session, { method: "GET", path: `/api/tags?${qs}` }, fetchImpl);
      return {
        ok: true,
        total: res.totalDocs,
        items: (res.docs || []).map((t) => ({
          id: t.id,
          group: t.group,
          name: t.name,
          enabled: t.enabled,
          sort: t.sort,
        })),
      };
    }

    if (action === "create") {
      const group = String(flags.group || "").trim();
      const name = String(flags.name || "").trim();
      if (group !== "type" && group !== "category") {
        throw fail("--group 必须是 type 或 category", "invalid_input");
      }
      if (!name || name.length > 100) {
        throw fail("--name 必填且不超过 100 字符", "invalid_input");
      }
      const dup = await cmsFetch(
        cfg,
        session,
        {
          method: "GET",
          path: `/api/tags?where[group][equals]=${group}&where[name][equals]=${encodeURIComponent(name)}&limit=1`,
        },
        fetchImpl,
      );
      if (dup?.docs?.length > 0) {
        throw fail(`同分组 (${group}) 下已存在同名标签 "${name}" (id=${dup.docs[0].id})`, "already_exists");
      }
      const data = {
        group,
        name,
        sort: flags.sort !== undefined ? Number(flags.sort) : 0,
        enabled: flags.enabled !== undefined ? parseBool(flags.enabled, "enabled") : true,
      };
      if (!yes) {
        return { ok: true, preview: true, action: "tags.create", operator: user.email, data };
      }
      const created = await cmsFetch(cfg, session, { method: "POST", path: "/api/tags", body: data }, fetchImpl);
      return { ok: true, preview: false, action: "tags.create", doc: redactSecrets(created.doc || created) };
    }

    if (action === "update") {
      if (!flags.id) throw fail("修改标签必须提供 --id", "invalid_input");
      const before = await cmsFetch(
        cfg,
        session,
        { method: "GET", path: `/api/tags/${encodeURIComponent(String(flags.id))}?depth=0` },
        fetchImpl,
      );
      const patch = {};
      if (flags.name !== undefined) patch.name = String(flags.name).trim();
      if (flags.sort !== undefined) patch.sort = Number(flags.sort);
      if (flags.enabled !== undefined) patch.enabled = parseBool(flags.enabled, "enabled");
      if (Object.keys(patch).length === 0) throw fail("未提供任何待更新字段 (--name / --sort / --enabled)", "invalid_input");

      if (!yes) {
        return {
          ok: true,
          preview: true,
          action: "tags.update",
          id: before.id,
          before: { name: before.name, group: before.group, sort: before.sort, enabled: before.enabled },
          patch,
        };
      }
      const updated = await cmsFetch(
        cfg,
        session,
        { method: "PATCH", path: `/api/tags/${encodeURIComponent(before.id)}`, body: patch },
        fetchImpl,
      );
      return { ok: true, preview: false, action: "tags.update", doc: redactSecrets(updated.doc || updated) };
    }

    throw fail(`未知 tags 子命令: ${action || "(空)"}`, "invalid_input");
  }

  // ---------------- MEDIA ----------------
  if (domain === "media") {
    if (action === "list") {
      const limit = Math.min(Number(flags.limit || 20), 100);
      const clauses = [`limit=${limit}`, "depth=0", "sort=-createdAt"];
      if (flags.query) {
        clauses.push(`where[or][0][filename][contains]=${encodeURIComponent(String(flags.query))}`);
        clauses.push(`where[or][1][alt][contains]=${encodeURIComponent(String(flags.query))}`);
      }
      if (flags.mime === "image") clauses.push("where[mimeType][contains]=image/");
      if (flags.mime === "zip") clauses.push("where[mimeType][contains]=zip");
      const res = await cmsFetch(cfg, session, { method: "GET", path: `/api/media?${clauses.join("&")}` }, fetchImpl);
      return {
        ok: true,
        total: res.totalDocs,
        items: (res.docs || []).map((m) => ({
          id: m.id,
          filename: m.filename,
          alt: m.alt || null,
          mimeType: m.mimeType,
          filesize: m.filesize,
          url: m.url || null,
        })),
      };
    }

    if (action === "upload") {
      if (!flags.file) throw fail("缺少参数 --file <文件路径>", "invalid_input");
      const result = await prepareMediaInput(
        cfg,
        session,
        flags.file,
        {
          expectedKind: "any",
          alt: flags.alt ? String(flags.alt) : "",
          yes,
          forceUpload: flags["force-upload"] === true,
        },
        fetchImpl,
      );
      return {
        ok: true,
        preview: !yes && result.mode === "pending_upload",
        action: "media.upload",
        result,
      };
    }

    throw fail(`未知 media 子命令: ${action || "(空)"}`, "invalid_input");
  }

  // ---------------- AGENTS & SKILLS ----------------
  if (domain === "agents" || domain === "skills") {
    if (action === "list") {
      const limit = Math.min(Number(flags.limit || 20), 100);
      const clauses = [`limit=${limit}`, "depth=1", "draft=true", "sort=-sortWeight"];
      if (flags.query) clauses.push(`where[name][contains]=${encodeURIComponent(String(flags.query))}`);
      if (flags.status === "draft" || flags.status === "published") {
        clauses.push(`where[_status][equals]=${flags.status}`);
      }
      const res = await cmsFetch(cfg, session, { method: "GET", path: `/api/${domain}?${clauses.join("&")}` }, fetchImpl);
      return {
        ok: true,
        total: res.totalDocs,
        items: (res.docs || []).map((d) => ({
          id: d.id,
          name: d.name,
          version: d.version || null,
          _status: d._status || "draft",
          enabled: d.enabled,
          sortWeight: d.sortWeight,
          typeTag: d.typeTag?.name || d.typeTag || null,
          screenshotsCount: Array.isArray(d.screenshots) ? d.screenshots.length : 0,
          updatedAt: d.updatedAt,
        })),
      };
    }

    if (action === "get") {
      const doc = await resolveUniqueDocument(
        cfg,
        session,
        domain,
        { id: flags.id, name: flags.name },
        fetchImpl,
      );
      return { ok: true, doc: redactSecrets(doc) };
    }

    if (action === "create") {
      const spec = await loadOptionalSpecJson(flags.spec);
      const built = await buildCatalogPayload(
        domain,
        { cfg, session, flags, spec, existingDoc: null, yes },
        fetchImpl,
      );

      if (!yes) {
        return {
          ok: true,
          preview: true,
          action: `${domain}.create`,
          cmsOrigin: cfg.cmsOrigin,
          operator: user.email,
          mediaActions: built.mediaActions,
          feedImpact: built.feedImpact,
          data: built.data,
        };
      }

      const draftParam = built.data._status === "published" ? "false" : "true";
      const created = await cmsFetch(
        cfg,
        session,
        { method: "POST", path: `/api/${domain}?draft=${draftParam}`, body: built.data },
        fetchImpl,
      );
      const doc = created.doc || created;
      return {
        ok: true,
        preview: false,
        action: `${domain}.create`,
        id: doc.id,
        name: doc.name,
        _status: doc._status,
        version: doc.version || null,
        downloadUrl: doc.downloadUrl || null,
        feedImpact: built.feedImpact,
      };
    }

    if (action === "update") {
      const spec = await loadOptionalSpecJson(flags.spec);
      const existingDoc = await resolveUniqueDocument(
        cfg,
        session,
        domain,
        { id: flags.id || spec.id, name: flags.nameLookup || flags["lookup-name"] || (!flags.id ? flags.target : undefined) },
        fetchImpl,
      );
      const built = await buildCatalogPayload(
        domain,
        { cfg, session, flags, spec, existingDoc, yes },
        fetchImpl,
      );

      if (!yes) {
        return {
          ok: true,
          preview: true,
          action: `${domain}.update`,
          id: existingDoc.id,
          before: {
            name: existingDoc.name,
            summary: existingDoc.summary,
            version: existingDoc.version || null,
            _status: existingDoc._status,
            enabled: existingDoc.enabled,
            sortWeight: existingDoc.sortWeight,
            tenantIds: existingDoc.tenantIds || [],
          },
          mediaActions: built.mediaActions,
          feedImpact: built.feedImpact,
          patch: built.data,
        };
      }

      const draftParam = built.data._status === "published" ? "false" : "true";
      const updated = await cmsFetch(
        cfg,
        session,
        {
          method: "PATCH",
          path: `/api/${domain}/${encodeURIComponent(existingDoc.id)}?draft=${draftParam}`,
          body: built.data,
        },
        fetchImpl,
      );
      const doc = updated.doc || updated;
      return {
        ok: true,
        preview: false,
        action: `${domain}.update`,
        id: doc.id,
        name: doc.name,
        _status: doc._status,
        version: doc.version || null,
        downloadUrl: doc.downloadUrl || null,
        feedImpact: built.feedImpact,
      };
    }

    if (action === "takedown" || action === "restore") {
      const isRestore = action === "restore";
      const targetDoc = isRestore
        ? await cmsFetch(
            cfg,
            session,
            {
              method: "GET",
              path: `/api/${domain}/${encodeURIComponent(String(flags.id || ""))}?trash=true&draft=true&depth=0`,
            },
            fetchImpl,
          )
        : await resolveUniqueDocument(cfg, session, domain, { id: flags.id, name: flags.name }, fetchImpl);

      const mode = isRestore ? "restore" : String(flags.mode || "disable");
      let patch;
      let query = "draft=true";
      if (mode === "disable") {
        patch = { enabled: false };
      } else if (mode === "unpublish") {
        patch = { _status: "draft" };
      } else if (mode === "trash") {
        patch = { deletedAt: new Date().toISOString() };
      } else if (mode === "restore") {
        patch = { deletedAt: null };
        query = "trash=true&draft=true";
      } else {
        throw fail("--mode 仅支持 disable（停用下架）、unpublish（撤回草稿）、trash（软删入回收站）", "invalid_input");
      }

      if (!yes) {
        return {
          ok: true,
          preview: true,
          action: `${domain}.${action}`,
          id: targetDoc.id,
          name: targetDoc.name,
          mode,
          patch,
        };
      }

      const updated = await cmsFetch(
        cfg,
        session,
        {
          method: "PATCH",
          path: `/api/${domain}/${encodeURIComponent(targetDoc.id)}?${query}`,
          body: patch,
        },
        fetchImpl,
      );
      const doc = updated.doc || updated;
      return {
        ok: true,
        preview: false,
        action: `${domain}.${action}`,
        id: doc.id,
        name: doc.name,
        mode,
        enabled: doc.enabled,
        _status: doc._status,
        deletedAt: doc.deletedAt || null,
      };
    }

    throw fail(`未知 ${domain} 子命令: ${action || "(空)"}`, "invalid_input");
  }

  // ---------------- TOPICS ----------------
  if (domain === "topics") {
    if (action === "list") {
      const limit = Math.min(Number(flags.limit || 20), 100);
      const clauses = [`limit=${limit}`, "depth=1", "draft=true", "sort=-sortWeight"];
      if (flags.query) clauses.push(`where[title][contains]=${encodeURIComponent(String(flags.query))}`);
      const res = await cmsFetch(cfg, session, { method: "GET", path: `/api/topics?${clauses.join("&")}` }, fetchImpl);
      return {
        ok: true,
        total: res.totalDocs,
        items: (res.docs || []).map((t) => ({
          id: t.id,
          title: t.title,
          _status: t._status || "draft",
          pinned: Boolean(t.pinned),
          enabled: t.enabled,
          sortWeight: t.sortWeight,
          itemsCount: Array.isArray(t.items) ? t.items.length : 0,
        })),
      };
    }

    if (action === "get") {
      const doc = await resolveUniqueDocument(cfg, session, "topics", { id: flags.id, title: flags.title }, fetchImpl);
      return { ok: true, doc: redactSecrets(doc) };
    }

    if (action === "create" || action === "update") {
      const isUpdate = action === "update";
      const spec = await loadOptionalSpecJson(flags.spec);
      const existingDoc = isUpdate
        ? await resolveUniqueDocument(
            cfg,
            session,
            "topics",
            { id: flags.id || spec.id, title: flags["lookup-title"] || (!flags.id ? flags.target : undefined) },
            fetchImpl,
          )
        : null;

      const data = {};
      const mediaActions = [];

      const titleVal = flags.title ?? spec.title;
      if (titleVal !== undefined) {
        const trimmed = String(titleVal).trim();
        if (!trimmed || trimmed.length > 100) throw fail("专题 title 必填且不超过 100 字符", "invalid_input");
        data.title = trimmed;
      } else if (!isUpdate) {
        throw fail("新建专题缺少 --title", "invalid_input");
      }

      const summaryVal = flags.summary ?? spec.summary;
      if (summaryVal !== undefined) {
        const trimmed = String(summaryVal).trim();
        if (!trimmed || trimmed.length > 300) throw fail("专题 summary 必填且不超过 300 字符", "invalid_input");
        data.summary = trimmed;
      } else if (!isUpdate) {
        throw fail("新建专题缺少 --summary", "invalid_input");
      }

      const coverInput = flags.cover ?? spec.cover;
      if (coverInput !== undefined) {
        const m = await prepareMediaInput(
          cfg,
          session,
          coverInput,
          { expectedKind: "image", alt: `${data.title || existingDoc?.title || "专题"} 封面`, yes },
          fetchImpl,
        );
        if (m) {
          mediaActions.push({ field: "cover", ...m });
          data.cover = m.mediaId;
        }
      }

      const descMd = await readTextOrFile(flags["desc-md"] ?? spec.descriptionMarkdown, flags["desc-file"]);
      if (descMd !== undefined) {
        data.description = markdownToLexical(descMd);
      }

      const itemsInput = flags.items ?? spec.items;
      if (itemsInput !== undefined) {
        data.items = await parseTopicItemsSpec(cfg, session, itemsInput, fetchImpl);
      }

      if (flags.pinned !== undefined || spec.pinned !== undefined) {
        data.pinned = parseBool(flags.pinned ?? spec.pinned, "pinned");
      }
      if (flags.enabled !== undefined || spec.enabled !== undefined) {
        data.enabled = parseBool(flags.enabled ?? spec.enabled, "enabled");
      } else if (!isUpdate) {
        data.enabled = true;
      }
      if (flags["sort-weight"] !== undefined || spec.sortWeight !== undefined) {
        data.sortWeight = Number(flags["sort-weight"] ?? spec.sortWeight);
      }
      const tenantsInput = flags.tenants ?? spec.tenantIds;
      if (tenantsInput !== undefined) {
        data.tenantIds = Array.isArray(tenantsInput) ? tenantsInput : parseTenantsFlag(tenantsInput);
      } else if (!isUpdate) {
        data.tenantIds = [];
      }

      const targetStatus =
        flags.status ?? spec._status ?? spec.status ?? (existingDoc ? existingDoc._status || "draft" : "draft");
      if (targetStatus !== "draft" && targetStatus !== "published") {
        throw fail("--status 仅支持 draft 或 published", "invalid_input");
      }
      data._status = targetStatus;

      const feedImpact = predictFeedImpact("topics", existingDoc, data);

      if (!yes) {
        return {
          ok: true,
          preview: true,
          action: `topics.${action}`,
          ...(isUpdate
            ? {
                id: existingDoc.id,
                before: {
                  title: existingDoc.title,
                  summary: existingDoc.summary,
                  pinned: existingDoc.pinned,
                  _status: existingDoc._status,
                  enabled: existingDoc.enabled,
                },
              }
            : {}),
          mediaActions,
          feedImpact,
          data,
        };
      }

      const draftParam = data._status === "published" ? "false" : "true";
      const res = await cmsFetch(
        cfg,
        session,
        {
          method: isUpdate ? "PATCH" : "POST",
          path: isUpdate
            ? `/api/topics/${encodeURIComponent(existingDoc.id)}?draft=${draftParam}`
            : `/api/topics?draft=${draftParam}`,
          body: data,
        },
        fetchImpl,
      );
      const doc = res.doc || res;
      return {
        ok: true,
        preview: false,
        action: `topics.${action}`,
        id: doc.id,
        title: doc.title,
        _status: doc._status,
        feedImpact,
      };
    }

    if (action === "takedown" || action === "restore") {
      const isRestore = action === "restore";
      const targetDoc = isRestore
        ? await cmsFetch(
            cfg,
            session,
            {
              method: "GET",
              path: `/api/topics/${encodeURIComponent(String(flags.id || ""))}?trash=true&draft=true&depth=0`,
            },
            fetchImpl,
          )
        : await resolveUniqueDocument(cfg, session, "topics", { id: flags.id, title: flags.title }, fetchImpl);

      const mode = isRestore ? "restore" : String(flags.mode || "disable");
      const patch =
        mode === "disable"
          ? { enabled: false }
          : mode === "unpublish"
            ? { _status: "draft" }
            : mode === "trash"
              ? { deletedAt: new Date().toISOString() }
              : mode === "restore"
                ? { deletedAt: null }
                : null;
      if (!patch) throw fail("--mode 仅支持 disable / unpublish / trash", "invalid_input");

      if (!yes) {
        return { ok: true, preview: true, action: `topics.${action}`, id: targetDoc.id, title: targetDoc.title, mode, patch };
      }

      const query = isRestore ? "trash=true&draft=true" : "draft=true";
      const updated = await cmsFetch(
        cfg,
        session,
        { method: "PATCH", path: `/api/topics/${encodeURIComponent(targetDoc.id)}?${query}`, body: patch },
        fetchImpl,
      );
      const doc = updated.doc || updated;
      return { ok: true, preview: false, action: `topics.${action}`, id: doc.id, title: doc.title, mode };
    }

    throw fail(`未知 topics 子命令: ${action || "(空)"}`, "invalid_input");
  }

  // ---------------- BANNERS ----------------
  if (domain === "banners") {
    if (action === "list") {
      const res = await cmsFetch(cfg, session, { method: "GET", path: "/api/banners?limit=50&depth=1&sort=sort" }, fetchImpl);
      return {
        ok: true,
        total: res.totalDocs,
        items: (res.docs || []).map((b) => ({
          id: b.id,
          url: b.url,
          sort: b.sort,
          enabled: b.enabled,
          image: b.image?.url || b.image?.id || b.image,
          tenantIds: b.tenantIds || [],
        })),
      };
    }

    if (action === "create" || action === "update") {
      const isUpdate = action === "update";
      const existing = isUpdate
        ? await cmsFetch(
            cfg,
            session,
            { method: "GET", path: `/api/banners/${encodeURIComponent(String(flags.id || ""))}?depth=0` },
            fetchImpl,
          )
        : null;

      const data = {};
      const mediaActions = [];

      if (flags.image !== undefined) {
        const m = await prepareMediaInput(
          cfg,
          session,
          flags.image,
          { expectedKind: "image", alt: flags.alt ? String(flags.alt) : "门户轮播 Banner", yes },
          fetchImpl,
        );
        mediaActions.push({ field: "image", ...m });
        data.image = m.mediaId;
      } else if (!isUpdate) {
        throw fail("新建 Banner 缺少必填图片参数 --image <文件路径或媒体ID>", "invalid_input");
      }

      if (flags.url !== undefined) {
        data.url = String(flags.url).trim();
      } else if (!isUpdate) {
        throw fail("新建 Banner 缺少必填跳转地址 --url", "invalid_input");
      }

      if (flags.sort !== undefined) data.sort = Number(flags.sort);
      else if (!isUpdate) data.sort = 0;

      if (flags.enabled !== undefined) data.enabled = parseBool(flags.enabled, "enabled");
      else if (!isUpdate) data.enabled = true;

      if (flags.tenants !== undefined) data.tenantIds = parseTenantsFlag(flags.tenants);
      else if (!isUpdate) data.tenantIds = [];

      if (!yes) {
        return {
          ok: true,
          preview: true,
          action: `banners.${action}`,
          ...(isUpdate ? { id: existing.id, before: existing } : {}),
          mediaActions,
          data,
        };
      }

      const res = await cmsFetch(
        cfg,
        session,
        {
          method: isUpdate ? "PATCH" : "POST",
          path: isUpdate ? `/api/banners/${encodeURIComponent(existing.id)}` : "/api/banners",
          body: data,
        },
        fetchImpl,
      );
      const doc = res.doc || res;
      return { ok: true, preview: false, action: `banners.${action}`, id: doc.id, url: doc.url, enabled: doc.enabled, sort: doc.sort };
    }

    if (action === "takedown") {
      if (!flags.id) throw fail("停用 Banner 必须指定 --id", "invalid_input");
      const before = await cmsFetch(
        cfg,
        session,
        { method: "GET", path: `/api/banners/${encodeURIComponent(String(flags.id))}?depth=0` },
        fetchImpl,
      );
      if (!yes) {
        return { ok: true, preview: true, action: "banners.takedown", id: before.id, url: before.url, patch: { enabled: false } };
      }
      const res = await cmsFetch(
        cfg,
        session,
        { method: "PATCH", path: `/api/banners/${encodeURIComponent(before.id)}`, body: { enabled: false } },
        fetchImpl,
      );
      const doc = res.doc || res;
      return { ok: true, preview: false, action: "banners.takedown", id: doc.id, enabled: doc.enabled };
    }

    throw fail(`未知 banners 子命令: ${action || "(空)"}`, "invalid_input");
  }

  // ---------------- FEEDS ----------------
  if (domain === "feeds") {
    if (action === "list") {
      const limit = Math.min(Number(flags.limit || 20), 100);
      const clauses = [`limit=${limit}`, "depth=0", "sort=-eventAt"];
      if (!flags["include-hidden"]) clauses.push("where[hidden][equals]=false");
      if (flags["source-type"]) {
        clauses.push(`where[sourceType][equals]=${encodeURIComponent(String(flags["source-type"]))}`);
      }
      const res = await cmsFetch(cfg, session, { method: "GET", path: `/api/feeds?${clauses.join("&")}` }, fetchImpl);
      return {
        ok: true,
        total: res.totalDocs,
        items: (res.docs || []).map((f) => ({
          id: f.id,
          title: f.title,
          eventType: f.eventType,
          sourceType: f.sourceType,
          sourceName: f.sourceName,
          sourceVersion: f.sourceVersion || null,
          hidden: f.hidden,
          eventAt: f.eventAt,
        })),
      };
    }

    if (action === "set-hidden" || action === "update") {
      if (!flags.id) throw fail("操作动态必须提供 --id", "invalid_input");
      const before = await cmsFetch(
        cfg,
        session,
        { method: "GET", path: `/api/feeds/${encodeURIComponent(String(flags.id))}?depth=0` },
        fetchImpl,
      );
      const patch = {};
      if (flags.hidden !== undefined) patch.hidden = parseBool(flags.hidden, "hidden");
      if (flags.title !== undefined) patch.title = String(flags.title).trim();
      if (flags.summary !== undefined) patch.summary = String(flags.summary).trim();
      if (Object.keys(patch).length === 0) throw fail("未提供待修改字段 (--hidden / --title / --summary)", "invalid_input");

      if (!yes) {
        return {
          ok: true,
          preview: true,
          action: `feeds.${action}`,
          id: before.id,
          before: { title: before.title, summary: before.summary || null, hidden: before.hidden },
          patch,
        };
      }
      const updated = await cmsFetch(
        cfg,
        session,
        { method: "PATCH", path: `/api/feeds/${encodeURIComponent(before.id)}`, body: patch },
        fetchImpl,
      );
      const doc = updated.doc || updated;
      return { ok: true, preview: false, action: `feeds.${action}`, id: doc.id, title: doc.title, hidden: doc.hidden };
    }

    throw fail(`未知 feeds 子命令: ${action || "(空)"}`, "invalid_input");
  }

  throw fail(`未知命令域: ${domain}`, "invalid_input");
}

async function main() {
  try {
    const result = await executeCommand(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(redactSecrets(result), null, 2)}\n`);
  } catch (err) {
    const out = {
      ok: false,
      code: err instanceof CliError ? err.code : "unexpected_error",
      message: err?.message || String(err),
      ...(err instanceof CliError && err.details ? { details: redactSecrets(err.details) } : {}),
    };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
