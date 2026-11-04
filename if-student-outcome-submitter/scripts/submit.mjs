#!/usr/bin/env node
/**
 * Student outcome submitter. Zero dependencies (Node 20+).
 * Tokens stay in the session file (mode 0600) and are never printed.
 */
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULTS = {
  endpoint: 'https://auth.innerfireai.com',
  listenHost: '127.0.0.1',
  listenPort: 18766,
  redirectUri: 'http://127.0.0.1:18766/callback',
  scopes: ['openid', 'profile', 'email'],
  timeoutMs: 180_000,
  maxFiles: 10,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxCommentLength: 4000,
}

const MIME_BY_EXT = {
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
}

export const SUBMISSION_EXTENSIONS = Object.keys(MIME_BY_EXT).sort()
const REPORT_ALIASES = new Set(['实验报告', '课程总体报告', '课程报告'])
const SECRET_KEYS = new Set(['access_token', 'refresh_token', 'id_token', 'code_verifier'])

const HELP = `学生成果提交

node submit.mjs whoami --json
node submit.mjs login --json
node submit.mjs config --json
node submit.mjs schedules list --json
node submit.mjs tasks list --schedule <scheduleId> --json
node submit.mjs submit --schedule <scheduleId> --task <taskId> [--file <path> ...] [--comment <text>] [--yes] --json

回调固定 http://127.0.0.1:18766/callback
没有 --yes 只预览，不会提交。
`

function fail(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function stripSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function configFilePath() {
  return process.env.XAI_STUDENT_CONFIG_PATH
    || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'xai-student-submit', 'config.json')
}

function sessionFilePath() {
  return process.env.XAI_STUDENT_SESSION_PATH
    || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'xai-student-submit', 'session.json')
}

function readStoredConfig() {
  try {
    return JSON.parse(readFileSync(configFilePath(), 'utf8'))
  }
  catch {
    return {}
  }
}

export function loadRuntimeConfig() {
  const stored = readStoredConfig()
  return {
    endpoint: stripSlash(process.env.XAI_CASDOOR_ENDPOINT ?? stored.endpoint ?? DEFAULTS.endpoint),
    clientId: String(process.env.XAI_STUDENT_CLIENT_ID ?? stored.clientId ?? '').trim(),
    redirectUri: DEFAULTS.redirectUri,
    payloadOrigin: stripSlash(process.env.XAI_PAYLOAD_ORIGIN ?? stored.payloadOrigin ?? ''),
    scopes: [...DEFAULTS.scopes],
  }
}

export function createPkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge, state: randomBytes(16).toString('hex') }
}

export function buildAuthorizeUrl(cfg, pkce) {
  if (!cfg?.clientId) throw fail('缺少学生 clientId', 'config')
  if (cfg.redirectUri && cfg.redirectUri !== DEFAULTS.redirectUri) throw fail('回调端口固定为 18766', 'config')
  const url = new URL('/login/oauth/authorize', `${stripSlash(cfg.endpoint || DEFAULTS.endpoint)}/`)
  url.searchParams.set('client_id', cfg.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', DEFAULTS.redirectUri)
  url.searchParams.set('scope', (cfg.scopes || DEFAULTS.scopes).join(' '))
  url.searchParams.set('state', pkce.state)
  url.searchParams.set('code_challenge', pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export function redact(value) {
  if (Array.isArray(value)) return value.map(item => redact(item))
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue
    out[key] = redact(item)
  }
  return out
}

export function classifyApiError(status, body) {
  if (status === 0 || (status == null && body == null)) return 'unreachable'
  if (status === 413) return 'too_large'
  const code = body && typeof body === 'object' ? body.code : ''
  if (status === 401 || code === 'AUTH_UNAUTHENTICATED') return 'unauthenticated'
  if (status === 403 || code === 'AUTH_FORBIDDEN') return 'forbidden'
  if (status === 409 || code === 'COMMON_IDEMPOTENCY_CONFLICT') return 'idempotency_conflict'
  if (status === 400 || code === 'COMMON_INVALID_ARGUMENT') return 'invalid_input'
  if (status === 500 || code === 'COMMON_INTERNAL_ERROR') return 'internal'
  return 'api'
}

export function unwrapEnvelope(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('响应无法解析', 'protocol')
  if (body.code !== 'OK') throw fail(body.message || '请求失败', classifyApiError(undefined, body))
  return body.data
}

export function idempotencyKeyFor(input) {
  const comment = (input.comment ?? '').trim()
  const files = [...(input.files || [])].sort((a, b) => a.name.localeCompare(b.name) || a.sha256.localeCompare(b.sha256))
  return createHash('sha256').update(JSON.stringify({
    scheduleId: input.scheduleId,
    taskId: input.taskId,
    comment,
    files,
  })).digest('hex')
}

function extensionOf(name) {
  const base = basename(String(name || ''))
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot).toLowerCase()
}

export function validateSubmission(input) {
  const comment = String(input?.comment ?? '').trim()
  const files = Array.isArray(input?.files) ? input.files : []
  if (!comment && files.length === 0) throw fail('说明和文件至少填写一项', 'invalid_input')
  if ([...comment].length > DEFAULTS.maxCommentLength) throw fail('说明超过 4000 字', 'invalid_input')
  if (files.length > DEFAULTS.maxFiles) throw fail('文件超过 10 个', 'invalid_input')
  let total = 0
  for (const file of files) {
    const ext = extensionOf(file.name)
    const expected = MIME_BY_EXT[ext]
    if (!expected) throw fail('文件类型不符合要求', 'invalid_input')
    if (file.mimeType && String(file.mimeType).toLowerCase() !== expected) throw fail('文件类型不符合要求', 'invalid_input')
    const size = Number(file.size || 0)
    if (size > DEFAULTS.maxFileBytes) throw fail('单个文件超过 50 MB', 'too_large')
    total += size
    if (total > DEFAULTS.maxTotalBytes) throw fail('文件合计超过 100 MB', 'too_large')
  }
  return { ok: true, comment, files }
}

function enabledFlag(value) {
  if (typeof value === 'boolean') return value
  if (value && typeof value.enabled === 'boolean') return value.enabled
  return null
}

function chapterIsOpen(chapter) {
  const direct = enabledFlag(chapter?.open)
  if (direct !== null) return direct
  return enabledFlag(chapter?.capability) === true
}

function taskIsOpen(task) {
  const direct = enabledFlag(task?.open)
  if (direct !== null) return direct
  return enabledFlag(task?.submissionCapability) === true
}

export function projectTasks(experience) {
  const tasks = []
  for (const chapter of experience?.chapters || []) {
    for (const task of chapter.tasks || []) {
      tasks.push({
        taskId: task.id,
        kind: task.kind,
        name: task.name,
        chapterTitle: chapter.title,
        open: chapterIsOpen(chapter) && taskIsOpen(task),
        resubmit: task.currentSubmission != null,
      })
    }
  }
  for (const task of experience?.courseTasks || []) {
    tasks.push({
      taskId: task.id,
      kind: task.kind,
      name: task.name,
      chapterTitle: null,
      open: taskIsOpen(task),
      resubmit: task.currentSubmission != null,
    })
  }
  return tasks
}

export function resolveSchedule(items, query = {}) {
  const list = Array.isArray(items) ? items : []
  if (query.scheduleId) {
    const found = list.find(item => item.scheduleId === query.scheduleId)
    if (!found) throw fail('未找到日程', 'not_found')
    if (found.derivedStatus === 'pending') throw fail('课程尚未开始', 'schedule_not_started')
    if (found.derivedStatus === 'completed') throw fail('课程已结课', 'schedule_completed')
    if (found.derivedStatus !== 'learning') throw fail('课程当前不能提交', 'not_submittable')
    return found
  }
  const learning = list.filter(item => item.derivedStatus === 'learning')
  if (learning.length === 0) throw fail('没有正在学习的课程', 'empty')
  if (learning.length > 1) throw fail('有多门正在学习的课程', 'ambiguous')
  return learning[0]
}

export function resolveTask(experience, query = {}) {
  if (experience?.scenario !== 'learning') throw fail('当前不能提交', 'not_submittable')
  const tasks = projectTasks(experience)
  let matches = []
  if (query.id) {
    matches = tasks.filter(task => task.taskId === query.id)
    if (matches.length === 0) throw fail('未找到任务', 'not_found')
  }
  else if (query.name) {
    matches = tasks.filter(task => task.name === query.name || (REPORT_ALIASES.has(query.name) && task.kind === 'course_report'))
    if (matches.length === 0) throw fail('未找到任务', 'not_found')
    if (matches.length > 1) throw fail('任务名称不唯一', 'ambiguous')
  }
  else {
    throw fail('缺少任务', 'invalid_input')
  }
  const task = matches[0]
  if (!task.open) throw fail('任务未开放', 'task_closed')
  return task
}

export async function writeSession(session, file = sessionFilePath()) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
}

async function readSession() {
  try {
    return JSON.parse(await readFile(sessionFilePath(), 'utf8'))
  }
  catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function requireToken() {
  const session = await readSession()
  if (!session?.access_token) throw fail('尚未登录，请先运行 login', 'unauthenticated')
  return session.access_token
}

function parseFlags(argv) {
  const flags = { file: [], yes: false }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--yes') {
      flags.yes = true
      continue
    }
    if (token === '--json' || token === '--no-open') {
      flags[token.slice(2)] = true
      continue
    }
    if (!token.startsWith('--')) throw fail(`无法识别参数 ${token}`, 'invalid_input')
    const key = token.slice(2)
    const value = argv[i + 1]
    if (value == null || value.startsWith('--')) throw fail(`缺少 --${key} 的值`, 'invalid_input')
    i += 1
    if (key === 'file') flags.file.push(value)
    else if (key === 'schedule') flags.schedule = value
    else if (key === 'task') flags.task = value
    else if (key === 'comment') flags.comment = value
    else throw fail(`无法识别参数 --${key}`, 'invalid_input')
  }
  return flags
}

export function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') return { command: 'help' }
  const [command, sub, ...rest] = argv
  if (command === 'whoami') return { command: 'whoami' }
  if (command === 'login') return { command: 'login', ...parseFlags(argv.slice(1)) }
  if (command === 'config') return { command: 'config' }
  if (command === 'schedules' && sub === 'list') return { command: 'schedules-list', ...parseFlags(rest) }
  if (command === 'tasks' && sub === 'list') return { command: 'tasks-list', ...parseFlags(rest) }
  if (command === 'submit') return { command: 'submit', ...parseFlags(argv.slice(1)) }
  throw fail(`未知命令 ${command || ''}`.trim(), 'invalid_input')
}

async function requestJson(url, { method = 'GET', token, body, headers = {} } = {}) {
  let response
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...headers },
      body,
    })
  }
  catch {
    throw fail('无法连接学生端接口', 'unreachable')
  }
  const text = await response.text()
  let json = null
  if (text) {
    try {
      json = JSON.parse(text)
    }
    catch {
      throw fail('响应无法解析', 'protocol')
    }
  }
  if (!json || json.code !== 'OK') throw fail(json?.message || '请求失败', classifyApiError(response.status, json))
  return json
}

function originOrThrow(cfg) {
  if (!cfg.payloadOrigin) throw fail('缺少 XAI_PAYLOAD_ORIGIN', 'config')
  return cfg.payloadOrigin
}

async function listSchedules(token) {
  const origin = originOrThrow(loadRuntimeConfig())
  const items = []
  for (let page = 1; page <= 100; page++) {
    const url = new URL('/v1/me/schedules', `${origin}/`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('pageSize', '100')
    const json = await requestJson(url, { token })
    items.push(...(json.data?.items || []))
    if (!json.meta?.pagination?.hasNextPage) break
  }
  return items
}

async function getExperience(token, scheduleId) {
  const origin = originOrThrow(loadRuntimeConfig())
  const json = await requestJson(`${origin}/v1/schedules/${scheduleId}/experience`, { token })
  return json.data
}

async function prepareFiles(paths, comment) {
  const files = []
  for (const filePath of paths || []) {
    let bytes
    try {
      bytes = await readFile(filePath)
    }
    catch {
      throw fail('找不到成果文件', 'invalid_input')
    }
    const name = basename(filePath)
    files.push({
      name,
      size: bytes.length,
      mimeType: MIME_BY_EXT[extensionOf(name)],
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes,
    })
  }
  const checked = validateSubmission({ files, comment })
  return { comment: checked.comment, files }
}

function cmdConfig() {
  const cfg = loadRuntimeConfig()
  return {
    endpoint: cfg.endpoint,
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    payloadOrigin: cfg.payloadOrigin,
    scopes: cfg.scopes,
    checklist: `Redirect URL 必须包含 ${cfg.redirectUri}`,
  }
}

async function cmdWhoami() {
  const token = await requireToken()
  const items = await listSchedules(token)
  return { authenticated: true, scheduleCount: items.length }
}

async function cmdSchedules() {
  const token = await requireToken()
  return { items: await listSchedules(token) }
}

async function cmdTasks(args) {
  if (!args.schedule) throw fail('缺少 --schedule', 'invalid_input')
  const token = await requireToken()
  const items = await listSchedules(token)
  resolveSchedule(items, { scheduleId: args.schedule })
  const experience = await getExperience(token, args.schedule)
  return { scheduleId: args.schedule, scenario: experience.scenario, tasks: projectTasks(experience) }
}

async function cmdSubmit(args) {
  if (!args.schedule || !args.task) throw fail('缺少 --schedule 或 --task', 'invalid_input')
  const token = await requireToken()
  const items = await listSchedules(token)
  const schedule = resolveSchedule(items, { scheduleId: args.schedule })
  const experience = await getExperience(token, schedule.scheduleId)
  const task = resolveTask(experience, { id: args.task })
  const prepared = await prepareFiles(args.file, args.comment)
  if (!args.yes) {
    return {
      dryRun: true,
      resubmit: task.resubmit,
      taskId: task.taskId,
      scheduleId: schedule.scheduleId,
      taskKind: task.kind,
      name: task.name,
      comment: prepared.comment,
      files: prepared.files.map(file => file.name),
    }
  }
  const key = idempotencyKeyFor({
    scheduleId: schedule.scheduleId,
    taskId: task.taskId,
    comment: prepared.comment,
    files: prepared.files.map(file => ({ name: file.name, sha256: file.sha256 })),
  })
  const form = new FormData()
  if (prepared.comment) form.set('comment', prepared.comment)
  for (const file of prepared.files) form.append('file', new Blob([file.bytes], { type: file.mimeType }), file.name)
  const origin = originOrThrow(loadRuntimeConfig())
  const json = await requestJson(`${origin}/v1/schedules/${schedule.scheduleId}/tasks/${task.taskId}/submissions`, {
    method: 'POST',
    token,
    body: form,
    headers: { 'Idempotency-Key': key },
  })
  return { submitted: true, ...json.data }
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(command, args, { stdio: 'ignore', detached: true }).unref()
}

function waitForCode(pkce) {
  return new Promise((resolveCode, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${DEFAULTS.listenHost}:${DEFAULTS.listenPort}`)
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204)
        res.end()
        return
      }
      const html = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:sans-serif;padding:48px;text-align:center"><h1>${title}</h1><p>${body}</p></body>`
      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (error || state !== pkce.state || !code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html('登录失败', '请回到对话重试 login'))
        server.close()
        reject(fail('登录未完成', 'unauthenticated'))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html('登录成功', '可以关闭此窗口，回到对话继续。'))
      server.close()
      resolveCode(code)
    })
    server.on('error', (error) => {
      reject(fail(error.code === 'EADDRINUSE' ? '端口 18766 已被占用' : '登录监听失败', 'config'))
    })
    server.listen(DEFAULTS.listenPort, DEFAULTS.listenHost)
    const timer = setTimeout(() => {
      server.close()
      reject(fail('等待浏览器登录超时', 'unauthenticated'))
    }, DEFAULTS.timeoutMs)
    server.on('close', () => clearTimeout(timer))
  })
}

async function exchangeToken(cfg, code, verifier) {
  let response
  try {
    response = await fetch(`${cfg.endpoint}/api/login/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: cfg.clientId,
        code,
        redirect_uri: cfg.redirectUri,
        code_verifier: verifier,
      }),
    })
  }
  catch {
    throw fail('无法连接登录服务', 'unreachable')
  }
  const body = await response.json().catch(() => null)
  const access = body?.access_token || body?.data?.access_token
  if (!access) throw fail('登录未完成', 'unauthenticated')
  const expiresIn = Number(body.expires_in || body.data?.expires_in || 0)
  return {
    access_token: access,
    refresh_token: body.refresh_token || body.data?.refresh_token || '',
    expires_at: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : 0,
    obtained_at: new Date().toISOString(),
  }
}

async function cmdLogin(args) {
  const cfg = loadRuntimeConfig()
  const pkce = createPkce()
  const authorizeUrl = buildAuthorizeUrl(cfg, pkce)
  console.error(`在浏览器完成学生登录：\n${authorizeUrl}`)
  if (!args['no-open']) {
    try {
      openBrowser(authorizeUrl)
    }
    catch {
      /* URL already printed */
    }
  }
  const code = await waitForCode(pkce)
  const session = await exchangeToken(cfg, code, pkce.verifier)
  await writeSession(session)
  return { loggedIn: true, endpoint: cfg.endpoint, redirectUri: cfg.redirectUri }
}

export async function dispatch(args) {
  if (!args || args.command === 'help') return { help: HELP }
  switch (args.command) {
    case 'config':
      return cmdConfig()
    case 'login':
      return cmdLogin(args)
    case 'whoami':
      return cmdWhoami()
    case 'schedules-list':
      return cmdSchedules()
    case 'tasks-list':
      return cmdTasks(args)
    case 'submit':
      return cmdSubmit(args)
    default:
      throw fail('未知命令', 'invalid_input')
  }
}

async function main() {
  const json = process.argv.includes('--json')
  try {
    const args = parseArgs(process.argv.slice(2).filter(arg => arg !== '--json'))
    const result = redact(await dispatch(args))
    console.log(JSON.stringify(json ? { ok: true, ...result } : result, null, json ? undefined : 2))
  }
  catch (error) {
    const payload = { ok: false, code: error.code || 'internal', error: error.message }
    if (json) console.log(JSON.stringify(payload))
    else console.error(`${payload.code}: ${payload.error}`)
    process.exitCode = 1
  }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) await main()
