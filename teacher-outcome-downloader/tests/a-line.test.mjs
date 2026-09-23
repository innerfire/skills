import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import {
  DEFAULTS,
  assertTeacherClient,
  buildAuthorizeUrl,
  createPkce,
  dispatch,
  loadRuntimeConfig,
  parseArgs,
  redact,
  sessionFilePath,
  writeSession,
} from '../scripts/download.mjs'

const ADMIN_CLIENT = 'f9000a01deab6f84d57c'
const STUDENT_CLIENT = '415e7652f294f1923793'
const TOKEN = 'token-secret'
const ENV_KEYS = [
  'XAI_TEACHER_SESSION_PATH',
  'XAI_TEACHER_PAYLOAD_ORIGIN',
  'XAI_TEACHER_CLIENT_ID',
  'XAI_TEACHER_REDIRECT_URI',
  'XAI_CASDOOR_ENDPOINT',
  'XDG_CONFIG_HOME',
]

function okEnvelope(totalItems = 3) {
  return {
    code: 'OK',
    message: 'success',
    data: { items: [{ scheduleId: '018f0000-0000-7000-8000-000000000101' }] },
    meta: {
      pagination: {
        page: 1,
        pageSize: 1,
        totalItems,
        totalPages: totalItems,
        hasNextPage: totalItems > 1,
        hasPreviousPage: false,
      },
    },
    traceId: '018f0000-0000-7000-8000-000000000099',
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function withEnv(fn) {
  const previous = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
  const dir = mkdtempSync(join(tmpdir(), 'teacher-download-'))
  process.env.XAI_TEACHER_SESSION_PATH = join(dir, 'session.json')
  process.env.XAI_TEACHER_PAYLOAD_ORIGIN = 'https://teacher.example.com/'
  delete process.env.XAI_TEACHER_CLIENT_ID
  delete process.env.XAI_TEACHER_REDIRECT_URI
  delete process.env.XAI_CASDOOR_ENDPOINT
  try {
    return await fn(dir)
  }
  finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

function installFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

describe('teacher-outcome-downloader A-line auth', { concurrency: false }, () => {
  test('C-001 authorize URL uses the teacher client on port 18767', () => {
    const pkce = createPkce()
    const url = new URL(buildAuthorizeUrl({
      endpoint: DEFAULTS.endpoint,
      clientId: DEFAULTS.clientId,
      redirectUri: DEFAULTS.redirectUri,
      scopes: DEFAULTS.scopes,
    }, pkce))
    assert.equal(url.origin, 'https://auth.innerfireai.com')
    assert.equal(url.pathname, '/login/oauth/authorize')
    assert.equal(url.searchParams.get('client_id'), '2a06575699b7fff7736f')
    assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:18767/callback')
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.get('code_challenge'), pkce.challenge)
    assert.equal(url.searchParams.get('state'), pkce.state)
    assert.equal(url.searchParams.get('scope'), 'openid profile email')
    assert.equal(url.searchParams.has('client_secret'), false)
    assert.equal(url.searchParams.has('code_verifier'), false)
    assert.equal(url.searchParams.get('scope').includes('offline_access'), false)
    assert.equal(DEFAULTS.listenPort, 18767)
    assert.notEqual(DEFAULTS.listenPort, 18765)
    assert.notEqual(DEFAULTS.listenPort, 18766)
    assert.notEqual(DEFAULTS.clientId, ADMIN_CLIENT)
    assert.notEqual(DEFAULTS.clientId, STUDENT_CLIENT)
  })

  test('C-002 PKCE challenge is S256 of the verifier', () => {
    const pkce = createPkce()
    const expected = createHash('sha256').update(pkce.verifier).digest('base64url')
    assert.equal(pkce.challenge, expected)
    assert.notEqual(pkce.verifier, pkce.challenge)
    assert.ok(pkce.verifier.length >= 43)
    const url = buildAuthorizeUrl({
      endpoint: DEFAULTS.endpoint,
      clientId: DEFAULTS.clientId,
      redirectUri: DEFAULTS.redirectUri,
      scopes: DEFAULTS.scopes,
    }, pkce)
    assert.equal(url.includes(pkce.verifier), false)
    assert.equal(url.includes('client_secret'), false)
  })

  test('C-003 whoami without a session does not call fetch', async () => {
    await withEnv(async () => {
      const net = installFetch(() => {
        throw new Error('fetch must not run')
      })
      try {
        await assert.rejects(() => dispatch(parseArgs(['whoami'])), { code: 'unauthenticated' })
        assert.equal(net.calls.length, 0)
      }
      finally {
        net.restore()
      }
    })
  })

  test('C-004 teacher client stays fixed and redirect cannot move to 18765 or 18766', async () => {
    await withEnv(async () => {
      process.env.XAI_TEACHER_REDIRECT_URI = 'http://127.0.0.1:18765/callback'
      process.env.XAI_CASDOOR_ENDPOINT = 'https://auth.example.com/'
      const cfg = loadRuntimeConfig()
      assert.equal(cfg.endpoint, 'https://auth.example.com')
      assert.equal(cfg.clientId, DEFAULTS.clientId)
      assert.equal(cfg.redirectUri, 'http://127.0.0.1:18767/callback')
      assert.equal(cfg.payloadOrigin, 'https://teacher.example.com')
      assert.deepEqual(cfg.scopes, ['openid', 'profile', 'email'])
      assert.throws(() => buildAuthorizeUrl({ ...cfg, redirectUri: 'http://127.0.0.1:18766/callback' }, createPkce()), { code: 'config' })
      process.env.XAI_TEACHER_CLIENT_ID = ADMIN_CLIENT
      assert.throws(() => assertTeacherClient(loadRuntimeConfig().clientId), { code: 'config' })
      process.env.XAI_TEACHER_CLIENT_ID = STUDENT_CLIENT
      assert.throws(() => assertTeacherClient(loadRuntimeConfig().clientId), { code: 'config' })
      delete process.env.XAI_TEACHER_CLIENT_ID
      delete process.env.XAI_CASDOOR_ENDPOINT
      assert.equal(loadRuntimeConfig().endpoint, 'https://auth.innerfireai.com')
      assert.equal(loadRuntimeConfig().clientId, '2a06575699b7fff7736f')
      const listed = await dispatch(parseArgs(['config']))
      assert.equal(JSON.stringify(listed).includes(TOKEN), false)
      assert.equal(JSON.stringify(listed).includes('client_secret'), false)
      assert.match(listed.checklist, /18767/)
    })
  })

  test('C-005 whoami with a session calls the teacher schedule list once', async () => {
    await withEnv(async (dir) => {
      await writeSession({ access_token: TOKEN }, join(dir, 'session.json'))
      const net = installFetch((url, init) => {
        const parsed = new URL(url)
        assert.equal(parsed.origin, 'https://teacher.example.com')
        assert.equal(parsed.pathname, '/v1/schedules')
        assert.equal(parsed.searchParams.get('page'), '1')
        assert.equal(parsed.searchParams.get('pageSize'), '1')
        assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${TOKEN}`)
        assert.equal(new Headers(init.headers).get('cookie'), null)
        assert.equal(init.credentials, 'omit')
        return jsonResponse(okEnvelope(4))
      })
      try {
        const result = await dispatch(parseArgs(['whoami']))
        assert.equal(result.authenticated, true)
        assert.equal(result.scheduleCount, 4)
        assert.equal(net.calls.length, 1)
        assert.equal(JSON.stringify(result).includes(TOKEN), false)
      }
      finally {
        net.restore()
      }
    })
  })

  test('C-006 a non-teacher body or 401 does not count as logged in', async () => {
    await withEnv(async (dir) => {
      await writeSession({ access_token: TOKEN }, join(dir, 'session.json'))
      const net = installFetch(() => jsonResponse({
        code: 'OK',
        message: 'success',
        data: { items: [] },
        meta: { cursor: 'next' },
        traceId: '018f0000-0000-7000-8000-000000000099',
      }))
      try {
        await assert.rejects(() => dispatch(parseArgs(['whoami'])), { code: 'forbidden' })
      }
      finally {
        net.restore()
      }
      const denied = installFetch(() => jsonResponse({ code: 'AUTH_UNAUTHENTICATED', message: 'login' }, 401))
      try {
        await assert.rejects(() => dispatch(parseArgs(['whoami'])), { code: 'unauthenticated' })
        assert.equal(JSON.stringify(denied.calls).includes('refresh_token'), false)
      }
      finally {
        denied.restore()
      }
    })
  })

  test('C-007 redact removes nested tokens', () => {
    const cleaned = redact({
      ok: true,
      nested: { access_token: TOKEN, refresh_token: 'r', id_token: 'i', code_verifier: 'v', name: '课' },
    })
    assert.deepEqual(cleaned, { ok: true, nested: { name: '课' } })
  })

  test('C-008 help lists login commands and not the other skills', async () => {
    const net = installFetch(() => {
      throw new Error('fetch must not run')
    })
    try {
      const result = await dispatch(parseArgs(['--help']))
      assert.match(result.help, /whoami/)
      assert.match(result.help, /login/)
      assert.match(result.help, /config/)
      assert.match(result.help, /18767/)
      assert.match(result.help, /auth\.innerfireai\.com/)
      assert.equal(result.help.includes('add-user'), false)
      assert.equal(result.help.includes('18765'), false)
      assert.equal(result.help.includes('18766'), false)
      assert.equal(result.help.includes('client_secret'), false)
      assert.equal(result.help.includes(ADMIN_CLIENT), false)
      assert.equal(result.help.includes(STUDENT_CLIENT), false)
      assert.equal(result.help.includes('offline_access'), false)
      assert.equal(net.calls.length, 0)
    }
    finally {
      net.restore()
    }
  })

  test('C-009 session file mode is 0600 and the path is not shared', async () => {
    await withEnv(async (dir) => {
      const file = join(dir, 'session.json')
      await writeSession({ access_token: TOKEN }, file)
      assert.equal(statSync(file).mode & 0o777, 0o600)
      process.env.XDG_CONFIG_HOME = dir
      delete process.env.XAI_TEACHER_SESSION_PATH
      const path = sessionFilePath()
      assert.match(path, /xai-teacher-download\/session\.json$/)
      assert.equal(path.includes('casdoor-account-admin'), false)
      assert.equal(path.includes('xai-student-submit'), false)
    })
  })

  test('C-010 unknown commands and missing origin do not call fetch', async () => {
    await withEnv(async (dir) => {
      await writeSession({ access_token: TOKEN }, join(dir, 'session.json'))
      delete process.env.XAI_TEACHER_PAYLOAD_ORIGIN
      const net = installFetch(() => {
        throw new Error('fetch must not run')
      })
      try {
        await assert.rejects(async () => dispatch(parseArgs(['download'])), { code: 'invalid_input' })
        await assert.rejects(async () => dispatch(parseArgs(['whoami'])), { code: 'config' })
        assert.equal(net.calls.length, 0)
      }
      finally {
        net.restore()
      }
    })
  })
})
