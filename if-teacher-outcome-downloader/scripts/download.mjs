#!/usr/bin/env node
/**
 * Teacher outcome downloader. This slice is login only.
 * Tokens stay in the session file (mode 0600) and are never printed.
 */
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

export const DEFAULTS = {
  endpoint: 'https://auth.innerfireai.com',
  clientId: '2a06575699b7fff7736f',
  listenHost: '127.0.0.1',
  listenPort: 18767,
  redirectUri: 'http://127.0.0.1:18767/callback',
  scopes: ['openid', 'profile', 'email'],
  timeoutMs: 180_000,
}

const FOREIGN_CLIENTS = new Set([
  'f9000a01deab6f84d57c',
  '415e7652f294f1923793',
])
const SECRET_KEYS = new Set(['access_token', 'refresh_token', 'id_token', 'code_verifier'])

const HELP = `教师成果下载

node download.mjs whoami --json
node download.mjs login --json
node download.mjs config --json
node download.mjs export --name <日程名> [--output <目录>] --json

授权地址 https://auth.innerfireai.com
回调固定 http://127.0.0.1:18767/callback
`

function fail(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function stripSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

export function sessionFilePath() {
  return process.env.XAI_TEACHER_SESSION_PATH
    || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'xai-teacher-download', 'session.json')
}

export function loadRuntimeConfig() {
  const clientId = String(process.env.XAI_TEACHER_CLIENT_ID ?? DEFAULTS.clientId).trim() || DEFAULTS.clientId
  return {
    endpoint: stripSlash(process.env.XAI_CASDOOR_ENDPOINT ?? DEFAULTS.endpoint),
    clientId,
    redirectUri: DEFAULTS.redirectUri,
    payloadOrigin: stripSlash(process.env.XAI_TEACHER_PAYLOAD_ORIGIN ?? ''),
    scopes: [...DEFAULTS.scopes],
  }
}

export function assertTeacherClient(clientId) {
  if (!clientId || FOREIGN_CLIENTS.has(clientId) || clientId !== DEFAULTS.clientId)
    throw fail('clientId 必须是教师应用', 'config')
}

export function createPkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge, state: randomBytes(16).toString('hex') }
}

export function buildAuthorizeUrl(cfg, pkce) {
  assertTeacherClient(cfg?.clientId)
  if (cfg.redirectUri && cfg.redirectUri !== DEFAULTS.redirectUri)
    throw fail('回调端口固定为 18767', 'config')
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
  const code = body && typeof body === 'object' ? body.code : ''
  if (status === 401 || code === 'AUTH_UNAUTHENTICATED') return 'unauthenticated'
  if (status === 403 || code === 'AUTH_FORBIDDEN') return 'forbidden'
  if (status === 400 || code === 'COMMON_INVALID_ARGUMENT') return 'invalid_input'
  if (status === 500 || code === 'COMMON_INTERNAL_ERROR') return 'internal'
  return 'api'
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

function originOrThrow(cfg) {
  if (!cfg.payloadOrigin) throw fail('缺少 XAI_TEACHER_PAYLOAD_ORIGIN', 'config')
  return cfg.payloadOrigin
}

async function requestJson(url, token) {
  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit',
    })
  }
  catch {
    throw fail('无法连接教师端接口', 'unreachable')
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
  if (!json || json.code !== 'OK')
    throw fail(json?.message || '请求失败', classifyApiError(response.status, json))
  return json
}

function teacherScheduleCount(json) {
  const page = json?.meta?.pagination?.page
  const total = json?.meta?.pagination?.totalItems
  if (!Array.isArray(json?.data?.items) || typeof page !== 'number' || typeof total !== 'number')
    throw fail('当前账号没有教师资格', 'forbidden')
  return total
}

export function safeSegment(value) {
  const cleaned = String(value ?? '').replace(/[\\/:*?"<>|]/g, '_').replace(/[\u0000-\u001f]/g, '').trim()
  return cleaned || '未命名'
}

export function outcomeFolder(studentName, studentId, kind, milestoneName) {
  const who = `${safeSegment(studentName)}-${safeSegment(studentId).slice(-6)}`
  if (kind === 'course_report') return `${who}-实验报告`
  if (kind === 'milestone') return `${who}-里程碑-${safeSegment(milestoneName)}`
  return ''
}

function allowedFileUrl(raw, origin) {
  let url
  try {
    url = new URL(raw, `${origin}/`)
  }
  catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const apiHost = new URL(origin).host
  if (url.host === apiHost) return { href: url.toString(), authed: true }
  if (url.protocol === 'https:' && (url.host === 'oss.innerfireai.com' || url.host.endsWith('.innerfireai.com')))
    return { href: url.toString(), authed: false }
  return null
}

async function listTeacherSchedules(token, origin) {
  const items = []
  for (let page = 1; page <= 100; page++) {
    const url = new URL('/v1/schedules', `${origin}/`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('pageSize', '100')
    const json = await requestJson(url, token)
    teacherScheduleCount(json)
    items.push(...json.data.items)
    if (!json.meta.pagination.hasNextPage) break
  }
  return items
}

async function listScheduleStudents(token, origin, scheduleId) {
  const students = []
  for (let page = 1; page <= 100; page++) {
    const url = new URL(`/v1/teacher/schedules/${scheduleId}/students`, `${origin}/`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('pageSize', '100')
    const json = await requestJson(url, token)
    students.push(...(json.data?.students || []))
    if (!json.meta?.pagination?.hasNextPage) break
  }
  return students
}

function submissionFiles(submission, origin, fallbackName) {
  const files = []
  for (const file of submission?.files || []) {
    const located = file?.url ? allowedFileUrl(file.url, origin) : null
    if (!located) continue
    files.push({ name: file.name || fallbackName || '文件', ...located, size: Number(file.size || 0) })
  }
  if (files.length === 0 && submission?.filename && submission?.contentUrl) {
    const located = allowedFileUrl(submission.contentUrl, origin)
    if (located) files.push({ name: submission.filename, ...located, size: 0 })
  }
  return files
}

async function saveFile(target, source, token) {
  let response
  try {
    response = await fetch(source.href, {
      headers: source.authed ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'omit',
      redirect: 'error',
    })
  }
  catch {
    throw fail('下载失败', 'unreachable')
  }
  if (!response.ok || !response.body) throw fail(`下载失败 ${response.status}`, 'api')
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target))
}

async function uniqueTarget(dir, fileName, size) {
  const clean = safeSegment(fileName)
  const ext = extname(clean)
  const stem = basename(clean, ext)
  for (let i = 0; i < 100; i++) {
    const name = i === 0 ? clean : `${stem}(${i})${ext}`
    const target = join(dir, name)
    try {
      const info = await stat(target)
      if (size > 0 && info.size === size) return { target, skipped: true }
    }
    catch (error) {
      if (error.code === 'ENOENT') return { target, skipped: false }
      throw error
    }
  }
  throw fail('同名文件过多', 'invalid_input')
}

async function cmdExport(args) {
  const token = await requireToken()
  const origin = originOrThrow(loadRuntimeConfig())
  const schedules = await listTeacherSchedules(token, origin)
  const matches = schedules.filter(item => item.name === args.name)
  if (matches.length === 0) throw fail('未找到日程', 'not_found')
  if (matches.length > 1) throw fail('日程名称不唯一', 'ambiguous')
  const schedule = matches[0]
  const students = await listScheduleStudents(token, origin, schedule.scheduleId)
  const root = join(args.output || join(homedir(), 'Downloads'), `${safeSegment(schedule.name)}-教学成果`)
  await mkdir(root, { recursive: true })
  const failed = []
  let fileCount = 0
  let studentCount = 0
  let submittedTaskCount = 0
  for (const student of students) {
    const detailUrl = new URL(`/v1/schedules/${schedule.scheduleId}/students/${encodeURIComponent(student.studentId)}`, `${origin}/`)
    let detail
    try {
      detail = (await requestJson(detailUrl, token)).data
    }
    catch (error) {
      failed.push({ student: student.studentDisplayName, error: error.message })
      continue
    }
    let wrote = false
    for (const task of detail?.tasks || []) {
      const folder = outcomeFolder(student.studentDisplayName, student.studentId, task.kind, task.name)
      if (!folder || !task.submission) continue
      submittedTaskCount += 1
      const files = submissionFiles(task.submission, origin, task.name)
      const comment = String(task.submission.comment || '').trim()
      if (files.length === 0 && comment) {
        const dir = join(root, folder)
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, '说明.txt'), `${comment}\n`, { mode: 0o644 })
        fileCount += 1
        wrote = true
      }
      if (files.length === 0 && (task.submission.files?.length || task.submission.filename))
        failed.push({ student: student.studentDisplayName, task: task.name, error: '没有可用来源的下载地址' })
      for (const file of files) {
        const dir = join(root, folder)
        await mkdir(dir, { recursive: true })
        try {
          const { target, skipped } = await uniqueTarget(dir, file.name, file.size)
          if (!skipped) await saveFile(target, file, token)
          fileCount += 1
          wrote = true
        }
        catch (error) {
          failed.push({ student: student.studentDisplayName, task: task.name, file: file.name, error: error.message })
        }
      }
    }
    if (wrote) studentCount += 1
  }
  const summary = [
    `日程: ${schedule.name}`,
    `报名学生: ${students.length}`,
    `有提交的任务: ${submittedTaskCount}`,
    `已落盘学生: ${studentCount}`,
    `文件数: ${fileCount}`,
    `失败: ${failed.length}`,
    ...failed.map(item => `- ${item.student} ${item.task || ''} ${item.file || ''} ${item.error}`.replace(/\s+/g, ' ').trim()),
  ].join('\n')
  await writeFile(join(root, '下载汇总.txt'), `${summary}\n`, { mode: 0o644 })
  return {
    scheduleId: schedule.scheduleId,
    scheduleName: schedule.name,
    output: root,
    enrolledCount: students.length,
    submittedTaskCount,
    studentCount,
    fileCount,
    failed,
  }
}

export function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') return { command: 'help' }
  const [command, ...rest] = argv
  if (command === 'whoami') return { command: 'whoami' }
  if (command === 'login') return { command: 'login', noOpen: rest.includes('--no-open') }
  if (command === 'config') return { command: 'config' }
  if (command === 'export') {
    let name = ''
    let output = ''
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--name') name = rest[++i] || ''
      else if (rest[i] === '--output') output = rest[++i] || ''
      else throw fail('未知参数', 'invalid_input')
    }
    if (!name) throw fail('缺少日程名', 'invalid_input')
    return { command: 'export', name, output }
  }
  throw fail(`未知命令 ${command || ''}`.trim(), 'invalid_input')
}

function cmdConfig() {
  const cfg = loadRuntimeConfig()
  assertTeacherClient(cfg.clientId)
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
  const origin = originOrThrow(loadRuntimeConfig())
  const url = new URL('/v1/schedules', `${origin}/`)
  url.searchParams.set('page', '1')
  url.searchParams.set('pageSize', '1')
  const json = await requestJson(url, token)
  return { authenticated: true, scheduleCount: teacherScheduleCount(json) }
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
      reject(fail(error.code === 'EADDRINUSE' ? '端口 18767 已被占用' : '登录监听失败', 'config'))
    })
    server.listen(DEFAULTS.listenPort, DEFAULTS.listenHost)
    const timer = setTimeout(() => {
      server.close()
      reject(fail('等待浏览器登录超时', 'unauthenticated'))
    }, Number(process.env.XAI_TEACHER_LOGIN_TIMEOUT_MS) || DEFAULTS.timeoutMs)
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
  console.error(`在浏览器完成教师登录：\n${authorizeUrl}`)
  if (!args.noOpen) {
    try {
      openBrowser(authorizeUrl)
    }
    catch {
      /* URL already printed */
    }
  }
  const code = await waitForCode(pkce)
  await writeSession(await exchangeToken(cfg, code, pkce.verifier))
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
    case 'export':
      return cmdExport(args)
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
