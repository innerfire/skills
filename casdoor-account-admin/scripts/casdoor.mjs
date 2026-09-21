#!/usr/bin/env node
/**
 * Casdoor account-admin CLI. Zero dependencies (Node 18+).
 * Tokens are stored in ~/.config/casdoor-account-admin/session.json (mode 0600)
 * and never printed.
 */
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_PASSWORD = 'if123456'
export const DEFAULTS = {
  endpoint: 'https://auth.innerfireai.com',
  clientId: 'f9000a01deab6f84d57c',
  redirectUri: 'http://127.0.0.1:18765/callback',
  listenHost: '127.0.0.1',
  listenPort: 18765,
  scope: 'openid profile email offline_access',
  timeoutMs: 180_000,
  batchLimit: 100,
  concurrency: 3,
}

const USER_AGENT = 'casdoor-account-admin/0.1'
const REDACT_KEYS = new Set([
  'password',
  'passwordSalt',
  'accessSecret',
  'totpSecret',
  'recoveryCodes',
  'clientSecret',
  'secret',
])

export function configDir() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'casdoor-account-admin')
}

export function sessionPath() {
  return process.env.CASDOOR_SESSION_PATH || join(configDir(), 'session.json')
}

export function loadRuntimeConfig() {
  return {
    endpoint: stripSlash(process.env.CASDOOR_ENDPOINT || DEFAULTS.endpoint),
    clientId: process.env.CASDOOR_CLIENT_ID || DEFAULTS.clientId,
    redirectUri: process.env.CASDOOR_REDIRECT_URI || DEFAULTS.redirectUri,
    sessionFile: sessionPath(),
  }
}

export function stripSlash(url) {
  return String(url).replace(/\/+$/, '')
}

export function validatePrefix(prefix) {
  const value = String(prefix ?? '').trim()
  if (value.length < 2 || value.length > 16) {
    return { ok: false, error: '账号前缀长度必须是 2–16 位' }
  }
  if (!/^[A-Za-z0-9]+$/.test(value)) {
    return { ok: false, error: '账号前缀只能包含字母和数字' }
  }
  return { ok: true, value }
}

export function validateCount(count, limit = DEFAULTS.batchLimit) {
  const n = Number(count)
  if (!Number.isInteger(n) || n < 1 || n > limit) {
    return { ok: false, error: `数量必须是 1–${limit} 的整数` }
  }
  return { ok: true, value: n }
}

export function formatSeq(i) {
  return String(i).padStart(3, '0')
}

export function generateNames(prefix, count, { limit } = {}) {
  const p = validatePrefix(prefix)
  if (!p.ok) throw fail(p.error, 'invalid_input')
  const c = validateCount(count, limit ?? DEFAULTS.batchLimit)
  if (!c.ok) throw fail(c.error, 'invalid_input')
  const names = []
  for (let i = 1; i <= c.value; i++) names.push(`${p.value}${formatSeq(i)}`)
  return names
}

export function generatedNamePattern(prefix) {
  const p = validatePrefix(prefix)
  if (!p.ok) throw fail(p.error, 'invalid_input')
  return new RegExp(`^${p.value}\\d+$`)
}

export function unwrapEnvelope(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw fail('Casdoor 返回了无法解析的响应', 'casdoor')
  }
  if (body.error) {
    throw fail(body.error_description || body.error, classifyCasdoorError(body.error_description || body.error))
  }
  if (body.status && body.status !== 'ok') {
    throw fail(body.msg || 'Casdoor 业务失败', classifyCasdoorError(body.msg || ''))
  }
  return { data: body.data, data2: body.data2, data3: body.data3, msg: body.msg }
}

export function classifyCasdoorError(msg = '') {
  const m = String(msg).toLowerCase()
  if (/please sign in|access token doesn't exist|invalid token|token.*(expir|invalid)|unauthorized/.test(m)) {
    return 'unauthenticated'
  }
  if (/no permission|forbidden|not an admin|has no permission/.test(m)) return 'forbidden'
  if (/already exists/.test(m)) return 'already_exists'
  if (/not found|does not exist|wrong username or password/.test(m)) return 'not_found'
  if (/redirect_uri|redirect uri/.test(m)) return 'config'
  if (/econnrefused|enotfound|etimedout|network|fetch failed|socket/.test(m)) return 'unreachable'
  return 'casdoor'
}

export function classifyNetworkError(err) {
  const msg = err?.cause?.code || err?.code || err?.message || ''
  return /econnrefused|enotfound|etimedout|enetunreach|fetch failed|connect tunnel|socket/i.test(String(msg))
    ? 'unreachable'
    : classifyCasdoorError(String(msg))
}

export function normalizeGroupId(owner, group) {
  const raw = String(group || '').trim()
  if (!raw) return ''
  if (raw.includes('/')) return raw
  return `${owner}/${raw}`
}

export function parseGroupList(owner, raw) {
  if (raw == null || raw === true) return []
  const items = Array.isArray(raw) ? raw : String(raw).split(',')
  return items.map((item) => normalizeGroupId(owner, item)).filter(Boolean)
}

export function mergeUserUpdate(existing, patch) {
  if (!existing || typeof existing !== 'object') throw fail('账号不存在，无法修改', 'not_found')
  const next = { ...existing }
  delete next.password
  delete next.passwordSalt
  delete next.accessSecret
  delete next.totpSecret
  delete next.recoveryCodes
  const columns = []
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    next[key] = value
    columns.push(key)
  }
  return { user: next, columns }
}

export function redactUser(user) {
  if (!user || typeof user !== 'object') return user
  const out = Array.isArray(user) ? user.map(redactUser) : { ...user }
  if (Array.isArray(user)) return out
  for (const key of Object.keys(out)) {
    if (REDACT_KEYS.has(key)) delete out[key]
  }
  return out
}

export function publicUser(user) {
  if (!user) return null
  const groups = Array.isArray(user.groups) ? user.groups : []
  return {
    owner: user.owner,
    name: user.name,
    displayName: user.displayName || user.name,
    groups,
    isForbidden: Boolean(user.isForbidden),
    email: user.email || '',
    phone: user.phone || '',
    createdTime: user.createdTime || '',
    type: user.type || '',
  }
}

export function publicOrg(org) {
  return {
    owner: org.owner,
    name: org.name,
    displayName: org.displayName || org.name,
  }
}

export function publicGroup(group) {
  return {
    owner: group.owner,
    name: group.name,
    displayName: group.displayName || group.name,
    id: `${group.owner}/${group.name}`,
  }
}

function fail(message, code = 'casdoor') {
  const err = new Error(message)
  err.code = code
  return err
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function createPkce() {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge, state: randomBytes(16).toString('hex') }
}

export function buildAuthorizeUrl(cfg, pkce) {
  const url = new URL('/login/oauth/authorize', `${cfg.endpoint}/`)
  url.searchParams.set('client_id', cfg.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', cfg.redirectUri)
  url.searchParams.set('scope', DEFAULTS.scope)
  url.searchParams.set('state', pkce.state)
  url.searchParams.set('code_challenge', pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export function jwtExp(token) {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof json.exp === 'number' ? json.exp : null
  } catch {
    return null
  }
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

async function writeSession(session) {
  const file = sessionPath()
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
}

async function loadSession() {
  return readJsonFile(sessionPath())
}

function tokenStillValid(session, skewSec = 30) {
  if (!session?.access_token) return false
  const exp = session.expires_at || jwtExp(session.access_token)
  if (!exp) return true
  return exp - skewSec > Date.now() / 1000
}

async function readResponseJson(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw fail(`Casdoor 返回了非 JSON（HTTP ${res.status}）`, res.status >= 500 ? 'unreachable' : 'casdoor')
  }
}

async function exchangeToken(cfg, form) {
  let res
  try {
    res = await fetch(`${cfg.endpoint}/api/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: new URLSearchParams(form).toString(),
    })
  } catch (err) {
    throw fail(`无法连接 Casdoor：${err.message}`, 'unreachable')
  }
  const body = await readResponseJson(res)
  if (body.error || (body.status && body.status !== 'ok')) {
    throw fail(body.error_description || body.msg || body.error || '换票失败', classifyCasdoorError(body.error_description || body.msg || body.error || ''))
  }
  const access = body.access_token || body.data?.access_token
  if (!access) throw fail('换票成功但响应里没有 access_token', 'casdoor')
  const expiresIn = Number(body.expires_in || body.data?.expires_in || 0)
  const exp = jwtExp(access)
  return {
    access_token: access,
    refresh_token: body.refresh_token || body.data?.refresh_token || '',
    token_type: body.token_type || 'Bearer',
    expires_at: exp || (expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : 0),
    obtained_at: new Date().toISOString(),
  }
}

async function refreshSession(cfg, session, force = false) {
  if (!force && tokenStillValid(session)) return session
  if (!session?.refresh_token) throw fail('登录已过期，请先运行 login', 'unauthenticated')
  const next = await exchangeToken(cfg, {
    grant_type: 'refresh_token',
    refresh_token: session.refresh_token,
    client_id: cfg.clientId,
  })
  if (!next.refresh_token) next.refresh_token = session.refresh_token
  await writeSession(next)
  return next
}

async function getAccessToken(cfg) {
  const session = await loadSession()
  if (!session?.access_token) throw fail('尚未登录，请先运行 login', 'unauthenticated')
  try {
    const fresh = await refreshSession(cfg, session)
    return fresh.access_token
  } catch (err) {
    if (err.code === 'unauthenticated') throw fail('登录已过期，请先运行 login', 'unauthenticated')
    throw err
  }
}

export async function api(cfg, method, path, { query, body, form, retry = true } = {}) {
  const url = new URL(path, `${cfg.endpoint}/`)
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  const token = await getAccessToken(cfg)
  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': USER_AGENT,
  }
  let payload
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    payload = new URLSearchParams(form).toString()
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(url, { method, headers, body: payload })
  } catch (err) {
    throw fail(`无法连接 Casdoor：${err.message}`, 'unreachable')
  }
  const json = await readResponseJson(res)
  const authFail =
    json?.status && json.status !== 'ok' && classifyCasdoorError(json.msg || '') === 'unauthenticated'
  if (authFail && retry) {
    const session = await loadSession()
    await refreshSession(cfg, session, true)
    return api(cfg, method, path, { query, body, form, retry: false })
  }
  return unwrapEnvelope(json)
}

async function paginate(cfg, path, query = {}, pageSize = 100) {
  const all = []
  let total = Infinity
  for (let p = 1; p <= 1000 && all.length < total; p++) {
    const { data, data2 } = await api(cfg, 'GET', path, { query: { ...query, p, pageSize } })
    const items = Array.isArray(data) ? data : []
    const n = Number(data2)
    if (Number.isFinite(n) && n >= 0) total = n
    all.push(...items)
    if (items.length === 0 || items.length < pageSize) break
  }
  return all
}

function openBrowser(url) {
  const platform = process.platform
  if (platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
  else if (platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref()
  else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
}

function waitForCode(pkce, timeoutMs) {
  return new Promise((resolveP, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${DEFAULTS.listenHost}:${DEFAULTS.listenPort}`)
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204)
        res.end()
        return
      }
      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const html = (title, body) =>
        `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:sans-serif;padding:48px;text-align:center"><h1>${title}</h1><p>${body}</p></body>`
      if (error) {
        const desc = url.searchParams.get('error_description') || error
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html('登录失败', desc))
        server.close()
        reject(fail(desc, classifyCasdoorError(desc)))
        return
      }
      if (state !== pkce.state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html('登录失败', 'state 不匹配，请重试 login'))
        server.close()
        reject(fail('OAuth state 不匹配', 'unauthenticated'))
        return
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html('登录失败', 'callback 缺少 code'))
        server.close()
        reject(fail('OAuth callback 缺少 code', 'unauthenticated'))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html('登录成功', '可以关闭此窗口，回到 Cursor 继续。'))
      server.close()
      resolveP(code)
    })
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(fail(`端口 ${DEFAULTS.listenPort} 已被占用，请结束后再运行 login`, 'config'))
      } else reject(fail(err.message, 'casdoor'))
    })
    server.listen(DEFAULTS.listenPort, DEFAULTS.listenHost)
    const timer = setTimeout(() => {
      server.close()
      reject(fail('等待浏览器登录超时（3 分钟）', 'unauthenticated'))
    }, timeoutMs)
    server.on('close', () => clearTimeout(timer))
  })
}

async function cmdLogin(args) {
  const cfg = loadRuntimeConfig()
  const pkce = createPkce()
  const authorizeUrl = buildAuthorizeUrl(cfg, pkce)
  console.error(`在浏览器完成 Casdoor 登录：\n${authorizeUrl}`)
  if (!args['no-open']) {
    try {
      openBrowser(authorizeUrl)
    } catch {
      /* URL already printed */
    }
  }
  const code = await waitForCode(pkce, DEFAULTS.timeoutMs)
  const session = await exchangeToken(cfg, {
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: pkce.verifier,
  })
  await writeSession(session)
  let account = null
  try {
    account = publicUser((await api(cfg, 'GET', '/api/get-account')).data)
  } catch {
    account = null
  }
  return {
    loggedIn: true,
    endpoint: cfg.endpoint,
    redirectUri: cfg.redirectUri,
    account,
    authorizeUrlPrinted: Boolean(args['no-open']),
    authorizeUrl: args['no-open'] ? authorizeUrl : undefined,
  }
}

async function cmdLogout() {
  const file = sessionPath()
  await rm(file, { force: true })
  return { loggedOut: true, sessionFile: file }
}

async function cmdWhoami() {
  const cfg = loadRuntimeConfig()
  const { data, data2 } = await api(cfg, 'GET', '/api/get-account')
  return { account: publicUser(data), organization: data2 ? publicOrg(data2) : null }
}

async function cmdOrgs(args) {
  const cfg = loadRuntimeConfig()
  const orgs = (await paginate(cfg, '/api/get-organizations')).map(publicOrg)
  if (args['with-counts']) {
    for (const org of orgs) {
      const { data2 } = await api(cfg, 'GET', '/api/get-users', { query: { owner: org.name, p: 1, pageSize: 1 } })
      org.userCount = Number(data2) || 0
    }
  }
  return { organizations: orgs, total: orgs.length }
}

async function cmdGroups(args) {
  const owner = requireOwner(args)
  const cfg = loadRuntimeConfig()
  const groups = (await paginate(cfg, '/api/get-groups', { owner })).map(publicGroup)
  return { owner, groups, total: groups.length }
}

async function cmdNames(args) {
  const prefix = requireValue(args, 'prefix', '缺少 --prefix')
  const count = requireValue(args, 'count', '缺少 --count')
  const names = generateNames(prefix, count)
  return {
    dryRun: true,
    prefix: validatePrefix(prefix).value,
    count: names.length,
    password: args.password || DEFAULT_PASSWORD,
    names,
  }
}

async function getUser(cfg, owner, name) {
  try {
    const { data } = await api(cfg, 'GET', '/api/get-user', { query: { id: `${owner}/${name}` } })
    return data || null
  } catch (err) {
    if (err.code === 'not_found' || /not exist|not found/i.test(err.message)) return null
    throw err
  }
}

async function cmdUsersList(args) {
  const owner = requireOwner(args)
  const cfg = loadRuntimeConfig()
  if (args.exact) {
    const user = await getUser(cfg, owner, args.exact)
    return { owner, total: user ? 1 : 0, users: user ? [publicUser(user)] : [] }
  }
  const pageSize = Number(args['page-size'] || 50)
  const page = Number(args.page || 1)
  if (args.all || args.query) {
    let users = await paginate(cfg, '/api/get-users', { owner })
    if (args.query) {
      const q = String(args.query).toLowerCase()
      users = users.filter(
        (u) =>
          String(u.name || '').toLowerCase().includes(q) ||
          String(u.displayName || '').toLowerCase().includes(q),
      )
    }
    return { owner, total: users.length, users: users.map(publicUser) }
  }
  const { data, data2 } = await api(cfg, 'GET', '/api/get-users', { query: { owner, p: page, pageSize } })
  const users = Array.isArray(data) ? data : []
  return { owner, page, pageSize, total: Number(data2) || users.length, users: users.map(publicUser) }
}

async function cmdUsersGet(args) {
  const owner = requireOwner(args)
  const name = requireName(args)
  const cfg = loadRuntimeConfig()
  const user = await getUser(cfg, owner, name)
  if (!user) throw fail(`未找到账号 ${owner}/${name}`, 'not_found')
  return { user: publicUser(user) }
}

async function addOne(cfg, owner, name, { password, groups, displayName }) {
  try {
    await api(cfg, 'POST', '/api/add-user', {
      body: {
        owner,
        name,
        displayName: displayName || name,
        password: password || DEFAULT_PASSWORD,
        type: 'normal',
        groups,
      },
    })
    return { name, ok: true }
  } catch (err) {
    return { name, ok: false, error: err.message, code: err.code || 'casdoor' }
  }
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  async function run() {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

async function cmdUsersAdd(args) {
  const owner = requireOwner(args)
  const name = requireName(args)
  if (args.groups === true) throw fail('--groups 需要分组标识，多个用逗号分隔', 'invalid_input')
  const groups = parseGroupList(owner, args.groups)
  const password = args.password || DEFAULT_PASSWORD
  const plan = [{ name, displayName: args['display-name'] || name, owner, groups, password }]
  if (!args.yes) return { dryRun: true, owner, groups, password, users: plan }
  const cfg = loadRuntimeConfig()
  const result = await addOne(cfg, owner, name, { password, groups, displayName: args['display-name'] })
  return { owner, groups, password, summary: { success: result.ok ? 1 : 0, failed: result.ok ? 0 : 1 }, results: [result] }
}

async function cmdUsersAddBatch(args) {
  const owner = requireOwner(args)
  const names = generateNames(requireValue(args, 'prefix', '缺少 --prefix'), requireValue(args, 'count', '缺少 --count'))
  if (args.groups === true) throw fail('--groups 需要分组标识，多个用逗号分隔', 'invalid_input')
  const groups = parseGroupList(owner, args.groups)
  const password = args.password || DEFAULT_PASSWORD
  const users = names.map((name) => ({ name, displayName: name, owner, groups, password }))
  if (!args.yes) return { dryRun: true, owner, groups, password, users }
  const cfg = loadRuntimeConfig()
  const results = await mapPool(names, DEFAULTS.concurrency, (name) =>
    addOne(cfg, owner, name, { password, groups }),
  )
  const success = results.filter((r) => r.ok).length
  const payload = {
    owner,
    groups,
    password,
    summary: { success, failed: results.length - success },
    results,
  }
  if (args.csv) payload.csv = await writeCsv(args.csv, results, { owner, groups, password })
  return payload
}

async function cmdUsersUpdate(args) {
  const owner = requireOwner(args)
  const name = requireName(args)
  const cfg = loadRuntimeConfig()
  const existing = await getUser(cfg, owner, name)
  if (!existing) throw fail(`未找到账号 ${owner}/${name}`, 'not_found')
  const patch = {}
  if (args['display-name'] != null) patch.displayName = String(args['display-name'])
  if (args.email != null) patch.email = String(args.email)
  if (args.phone != null) patch.phone = String(args.phone)
  if (args.groups === true) throw fail('--groups 需要分组标识，多个用逗号分隔', 'invalid_input')
  if (args.groups != null) patch.groups = parseGroupList(owner, args.groups)
  if (args['clear-groups']) patch.groups = []
  if (args.enabled != null) patch.isForbidden = String(args.enabled) === 'false'
  if (Object.keys(patch).length === 0) throw fail('没有要修改的字段', 'invalid_input')
  const { user, columns } = mergeUserUpdate(existing, patch)
  if (!args.yes) {
    return { dryRun: true, before: publicUser(existing), after: publicUser(user), columns }
  }
  await api(cfg, 'POST', '/api/update-user', { query: { id: `${owner}/${name}`, columns: columns.join(',') }, body: user })
  const fresh = await getUser(cfg, owner, name)
  return { user: publicUser(fresh) }
}

async function cmdUsersResetPassword(args) {
  const owner = requireOwner(args)
  const name = requireName(args)
  const password = args.password || DEFAULT_PASSWORD
  const cfg = loadRuntimeConfig()
  const existing = await getUser(cfg, owner, name)
  if (!existing) throw fail(`未找到账号 ${owner}/${name}`, 'not_found')
  if (!args.yes) return { dryRun: true, user: publicUser(existing), password }
  await api(cfg, 'POST', '/api/set-password', {
    form: { userOwner: owner, userName: name, newPassword: password },
  })
  return { owner, name, reset: true }
}

async function cmdUsersDelete(args) {
  const owner = requireOwner(args)
  const name = requireName(args)
  const cfg = loadRuntimeConfig()
  const existing = await getUser(cfg, owner, name)
  if (!existing) throw fail(`未找到账号 ${owner}/${name}`, 'not_found')
  const preview = publicUser(existing)
  if (!args.yes) return { dryRun: true, users: [preview] }
  await api(cfg, 'POST', '/api/delete-user', { body: existing })
  return { deleted: [preview] }
}

async function cmdUsersDeleteBatch(args) {
  const owner = requireOwner(args)
  const cfg = loadRuntimeConfig()
  const all = await paginate(cfg, '/api/get-users', { owner })
  let matched = []
  if (args.names) {
    const wanted = new Set(String(args.names).split(',').map((s) => s.trim()).filter(Boolean))
    matched = all.filter((u) => wanted.has(u.name))
  } else if (args.prefix) {
    const re = generatedNamePattern(args.prefix)
    matched = all.filter((u) => re.test(u.name))
  } else {
    throw fail('批量删除需要 --prefix 或 --names', 'invalid_input')
  }
  const users = matched.map(publicUser)
  if (!args.yes) return { dryRun: true, owner, users, total: users.length }
  const results = []
  for (const user of matched) {
    try {
      await api(cfg, 'POST', '/api/delete-user', { body: user })
      results.push({ name: user.name, ok: true })
    } catch (err) {
      results.push({ name: user.name, ok: false, error: err.message })
    }
  }
  return {
    owner,
    summary: { success: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length },
    results,
  }
}

async function writeCsv(path, results, { owner, groups, password }) {
  const header = 'name,owner,groups,password,status,error'
  const lines = results.map((r) =>
    [r.name, owner, groups.join('|'), r.ok ? password : '', r.ok ? 'ok' : 'failed', r.error || '']
      .map((c) => `"${String(c).replaceAll('"', '""')}"`)
      .join(','),
  )
  await writeFile(path, `${header}\n${lines.join('\n')}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
  return path
}

function requireOwner(args) {
  return requireValue(args, 'owner', '缺少 --owner（租户 Organization.name）')
}

function requireName(args) {
  return requireValue(args, 'name', '缺少 --name')
}

function requireValue(args, key, message) {
  const value = args[key]
  if (value == null || value === true || String(value).trim() === '') throw fail(message, 'invalid_input')
  return String(value).trim()
}

function cmdConfig() {
  const cfg = loadRuntimeConfig()
  return {
    endpoint: cfg.endpoint,
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    sessionFile: cfg.sessionFile,
    casdoorAppChecklist: [
      `Redirect URL 必须包含 ${cfg.redirectUri}`,
      'Grant types 包含 authorization_code 与 refresh_token',
      'PKCE / code_challenge_method = S256',
      '登录身份必须是能列举全部组织的平台管理员',
    ],
  }
}

const USAGE = `casdoor-account-admin

Usage:
  node casdoor.mjs login [--no-open] [--json]
  node casdoor.mjs logout [--json]
  node casdoor.mjs whoami [--json]
  node casdoor.mjs config [--json]
  node casdoor.mjs orgs [--with-counts] [--json]
  node casdoor.mjs groups --owner <org> [--json]
  node casdoor.mjs names --prefix stu --count 3 [--json]
  node casdoor.mjs users list --owner <org> [--exact name|--query kw|--all] [--json]
  node casdoor.mjs users get --owner <org> --name <name> [--json]
  node casdoor.mjs users add --owner <org> --name <name> [--groups a,b] [--yes] [--json]
  node casdoor.mjs users add-batch --owner <org> --prefix stu --count 3 [--groups a,b] [--csv path] [--yes] [--json]
  node casdoor.mjs users update --owner <org> --name <name> [--display-name ...] [--email ...] [--phone ...] [--groups a,b|--clear-groups] [--enabled true|false] [--yes] [--json]
  node casdoor.mjs users reset-password --owner <org> --name <name> [--password ...] [--yes] [--json]
  node casdoor.mjs users delete --owner <org> --name <name> [--yes] [--json]
  node casdoor.mjs users delete-batch --owner <org> (--prefix stu|--names a,b) [--yes] [--json]

Write operations require --yes. Omit it to dry-run / preview.
`

export function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--help' || token === '-h') {
      args.help = true
      continue
    }
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next == null || next.startsWith('--')) args[key] = true
      else {
        args[key] = next
        i++
      }
      continue
    }
    args._.push(token)
  }
  return args
}

export async function dispatch(args) {
  const command = args._[0]
  const sub = args._[1]
  if (!command || args.help) return { help: USAGE.trim() }
  switch (command) {
    case 'login':
      return cmdLogin(args)
    case 'logout':
      return cmdLogout()
    case 'whoami':
      return cmdWhoami()
    case 'config':
      return cmdConfig()
    case 'orgs':
      return cmdOrgs(args)
    case 'groups':
      return cmdGroups(args)
    case 'names':
      return cmdNames(args)
    case 'users':
      switch (sub) {
        case 'list':
          return cmdUsersList(args)
        case 'get':
          return cmdUsersGet(args)
        case 'add':
          return cmdUsersAdd(args)
        case 'add-batch':
          return cmdUsersAddBatch(args)
        case 'update':
          return cmdUsersUpdate(args)
        case 'reset-password':
          return cmdUsersResetPassword(args)
        case 'delete':
          return cmdUsersDelete(args)
        case 'delete-batch':
          return cmdUsersDeleteBatch(args)
        default:
          throw fail('users 子命令: list|get|add|add-batch|update|reset-password|delete|delete-batch', 'invalid_input')
      }
    default:
      throw fail(`未知命令 ${command}`, 'invalid_input')
  }
}

function printHuman(command, result) {
  if (result.help) {
    console.log(result.help)
    return
  }
  if (result.dryRun) {
    console.log('DRY RUN — 加 --yes 才会真正执行')
  }
  console.log(JSON.stringify(result, null, 2))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  try {
    const result = await dispatch(args)
    if (args.json) console.log(JSON.stringify({ ok: true, ...result }))
    else printHuman(args._[0], result)
  } catch (err) {
    const code = err.code || classifyNetworkError(err)
    const payload = { ok: false, error: err.message, code }
    if (args.json) console.log(JSON.stringify(payload))
    else console.error(`${code}: ${err.message}`)
    const exit =
      code === 'invalid_input' || code === 'confirm' ? 2 : code === 'unauthenticated' || code === 'forbidden' ? 3 : 1
    process.exitCode = exit
  }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  await main()
}
