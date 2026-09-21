import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DEFAULTS,
  buildAuthorizeUrl,
  classifyCasdoorError,
  createPkce,
  dispatch,
  loadRuntimeConfig,
  mergeUserUpdate,
  parseArgs,
  publicUser,
  unwrapEnvelope,
} from '../scripts/casdoor.mjs'

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

test('C-013 whoami without session is unauthenticated', async () => {
  process.env.CASDOOR_SESSION_PATH = join(tmpdir(), `casdoor-ab-${Date.now()}-missing.json`)
  await assert.rejects(() => dispatch(parseArgs(['whoami'])), { code: 'unauthenticated' })
})

test('C-014 config matches production defaults', async () => {
  delete process.env.CASDOOR_ENDPOINT
  delete process.env.CASDOOR_CLIENT_ID
  delete process.env.CASDOOR_REDIRECT_URI
  const cfg = await dispatch(parseArgs(['config']))
  assert.equal(cfg.endpoint, 'https://auth.innerfireai.com')
  assert.equal(cfg.clientId, 'f9000a01deab6f84d57c')
  assert.equal(cfg.redirectUri, 'http://127.0.0.1:18765/callback')
  assert.ok(cfg.casdoorAppChecklist.some((line) => line.includes(cfg.redirectUri)))
  const runtime = loadRuntimeConfig()
  assert.equal(runtime.endpoint, DEFAULTS.endpoint)
})

test('C-016 disable maps to isForbidden and keeps email', () => {
  const { user } = mergeUserUpdate(
    { owner: 'acme', name: 'stu001', email: 'keep@x', isForbidden: false, password: 'hashed' },
    { isForbidden: true },
  )
  assert.equal(user.isForbidden, true)
  assert.equal(user.email, 'keep@x')
  assert.equal(user.password, undefined)
})

test('C-018 already_exists from envelope and classifier', () => {
  assert.equal(classifyCasdoorError('User already exists'), 'already_exists')
  assert.throws(() => unwrapEnvelope({ status: 'error', msg: 'User already exists' }), {
    code: 'already_exists',
  })
})

test('C-019 help lists reset-password and yes gate', async () => {
  const { help } = await dispatch(parseArgs(['--help']))
  assert.match(help, /reset-password/)
  assert.match(help, /\[--yes\]/)
  assert.match(help, /delete/)
})

test('C-020 help lists CRUD and three list modes', async () => {
  const { help } = await dispatch(parseArgs(['--help']))
  assert.match(help, /users add /)
  assert.match(help, /users list/)
  assert.match(help, /users update/)
  assert.match(help, /users delete /)
  assert.match(help, /--exact/)
  assert.match(help, /--query/)
  assert.match(help, /--all/)
  assert.match(help, /orgs/)
})

test('C-021 SKILL hard rules present', () => {
  const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8')
  assert.match(skill, /不要手写 curl/)
  assert.match(skill, /--yes/)
  assert.match(skill, /Group/)
  assert.match(skill, /if123456/)
  assert.match(skill, /casdoor\.mjs/)
})

test('C-022 authorize URL has no secret or verifier', () => {
  const pkce = createPkce()
  const url = buildAuthorizeUrl(DEFAULTS, pkce)
  assert.equal(url.includes('client_secret'), false)
  assert.equal(url.includes(pkce.verifier), false)
  assert.ok(url.includes(pkce.challenge))
  assert.ok(url.includes(pkce.state))
})

test('C-023 unwrap rejects non-envelope shapes', () => {
  assert.throws(() => unwrapEnvelope([]), { code: 'casdoor' })
  assert.throws(() => unwrapEnvelope(null), { code: 'casdoor' })
})

test('C-024 merge without existing user is not_found', () => {
  assert.throws(() => mergeUserUpdate(null, { displayName: 'x' }), { code: 'not_found' })
})

test('C-015 publicUser omits password', () => {
  const pub = publicUser({ owner: 'acme', name: 'stu001', password: 'if123456', groups: [] })
  assert.equal(Object.hasOwn(pub, 'password'), false)
})
