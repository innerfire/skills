import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DEFAULTS,
  SUBMISSION_EXTENSIONS,
  buildAuthorizeUrl,
  classifyApiError,
  createPkce,
  dispatch,
  idempotencyKeyFor,
  loadRuntimeConfig,
  parseArgs,
  projectTasks,
  redact,
  resolveSchedule,
  resolveTask,
  unwrapEnvelope,
  validateSubmission,
  writeSession,
} from '../scripts/submit.mjs'

const fixtureDir = fileURLToPath(new URL('./fixtures/', import.meta.url))
const schedules = JSON.parse(readFileSync(join(fixtureDir, 'schedules.json'), 'utf8'))
const experience = JSON.parse(readFileSync(join(fixtureDir, 'experience-learning.json'), 'utf8'))

const S_LEARN = '018f0000-0000-7000-8000-000000000101'
const S_PENDING = '018f0000-0000-7000-8000-000000000102'
const S_DONE = '018f0000-0000-7000-8000-000000000103'
const S_LEARN_2 = '018f0000-0000-7000-8000-000000000104'
const T_MILE = '018f0000-0000-7000-8000-000000000201'
const T_CLOSED = '018f0000-0000-7000-8000-000000000202'
const T_SUBMITTED = '018f0000-0000-7000-8000-000000000203'
const T_CHAPTER_CLOSED = '018f0000-0000-7000-8000-000000000204'
const T_REPORT = '018f0000-0000-7000-8000-000000000301'
const TOKEN = 'token-secret'
const ENV_KEYS = [
  'XAI_STUDENT_SESSION_PATH',
  'XAI_STUDENT_CONFIG_PATH',
  'XAI_PAYLOAD_ORIGIN',
  'XAI_STUDENT_CLIENT_ID',
  'XAI_CASDOOR_ENDPOINT',
  'XAI_STUDENT_REDIRECT_URI',
]

const EXPECTED_EXTENSIONS = [
  '.csv', '.doc', '.docx', '.htm', '.html', '.jpeg', '.jpg', '.json', '.m4a', '.mp3', '.mp4',
  '.pdf', '.png', '.ppt', '.pptx', '.txt', '.wav', '.webm', '.webp', '.xls', '.xlsx', '.zip',
]

function canonicalKey(input) {
  const comment = (input.comment ?? '').trim()
  const files = [...input.files].sort((a, b) => a.name.localeCompare(b.name) || a.sha256.localeCompare(b.sha256))
  return createHash('sha256').update(JSON.stringify({
    scheduleId: input.scheduleId,
    taskId: input.taskId,
    comment,
    files,
  })).digest('hex')
}

function okEnvelope(data, meta) {
  return {
    code: 'OK',
    message: 'success',
    data,
    traceId: '018f0000-0000-7000-8000-000000000099',
    ...(meta ? { meta } : {}),
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function header(init, name) {
  return new Headers(init?.headers).get(name)
}

async function withEnv(fn) {
  const previous = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
  const dir = mkdtempSync(join(tmpdir(), 'student-submit-'))
  process.env.XAI_STUDENT_SESSION_PATH = join(dir, 'session.json')
  process.env.XAI_STUDENT_CONFIG_PATH = join(dir, 'config.json')
  process.env.XAI_PAYLOAD_ORIGIN = 'https://payload.example.com/'
  process.env.XAI_STUDENT_CLIENT_ID = 'student-public-client'
  process.env.XAI_CASDOOR_ENDPOINT = 'https://auth.example.com'
  delete process.env.XAI_STUDENT_REDIRECT_URI
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
    const href = String(url)
    calls.push({ url: href, init })
    return handler(href, init)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

function pdf(name = 'a.pdf', bytes = 'hello') {
  return { name, size: Buffer.byteLength(bytes), mimeType: 'application/pdf' }
}

describe('student-outcome-submitter A-line', { concurrency: false }, () => {
  test('C-001 authorize URL is student PKCE on port 18766', () => {
    const pkce = createPkce()
    const url = new URL(buildAuthorizeUrl({
      endpoint: 'https://auth.example.com',
      clientId: 'student-public-client',
      redirectUri: DEFAULTS.redirectUri,
      scopes: DEFAULTS.scopes,
    }, pkce))
    assert.equal(url.origin, 'https://auth.example.com')
    assert.equal(url.searchParams.get('client_id'), 'student-public-client')
    assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:18766/callback')
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.get('code_challenge'), pkce.challenge)
    assert.equal(url.searchParams.get('state'), pkce.state)
    assert.equal(url.searchParams.get('scope'), 'openid profile email')
    assert.equal(url.searchParams.has('client_secret'), false)
    assert.equal(url.searchParams.has('code_verifier'), false)
    assert.equal(url.searchParams.get('scope').includes('offline_access'), false)
    assert.equal(DEFAULTS.listenPort, 18766)
    assert.notEqual(DEFAULTS.listenPort, 18765)
  })

  test('C-002 PKCE challenge is S256 of the verifier', () => {
    const pkce = createPkce()
    const expected = createHash('sha256').update(pkce.verifier).digest('base64url')
    assert.equal(pkce.challenge, expected)
    assert.notEqual(pkce.verifier, pkce.challenge)
    assert.ok(pkce.verifier.length >= 43)
    const url = buildAuthorizeUrl({
      endpoint: 'https://auth.example.com',
      clientId: 'student-public-client',
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

  test('C-004 client id is required and redirect port stays 18766', async () => {
    await withEnv(async () => {
      process.env.XAI_STUDENT_REDIRECT_URI = 'http://127.0.0.1:18765/callback'
      const cfg = loadRuntimeConfig()
      assert.equal(cfg.endpoint, 'https://auth.example.com')
      assert.equal(cfg.clientId, 'student-public-client')
      assert.notEqual(cfg.clientId, 'f9000a01deab6f84d57c')
      assert.equal(cfg.redirectUri, 'http://127.0.0.1:18766/callback')
      assert.equal(cfg.payloadOrigin, 'https://payload.example.com')
      assert.deepEqual(cfg.scopes, ['openid', 'profile', 'email'])
      delete process.env.XAI_STUDENT_CLIENT_ID
      const missing = loadRuntimeConfig()
      assert.equal(missing.clientId, '')
      assert.throws(() => buildAuthorizeUrl(missing, createPkce()), { code: 'config' })
      const listed = await dispatch(parseArgs(['config']))
      assert.equal(JSON.stringify(listed).includes('token-secret'), false)
      assert.equal(JSON.stringify(listed).includes('client_secret'), false)
      assert.match(JSON.stringify(listed), /18766/)
      delete process.env.XAI_CASDOOR_ENDPOINT
      assert.equal(loadRuntimeConfig().endpoint, 'https://auth.innerfireai.com')
    })
  })

  test('C-005 multiple learning schedules are ambiguous and unknown ids miss', () => {
    const items = [
      ...schedules.items,
      { scheduleId: S_LEARN_2, name: '另一门正在学习', derivedStatus: 'learning', teacherDisplayName: '王老师' },
    ]
    assert.throws(() => resolveSchedule(items), { code: 'ambiguous' })
    assert.throws(() => resolveSchedule(items, { scheduleId: '018f0000-0000-7000-8000-000000000199' }), { code: 'not_found' })
    assert.equal(resolveSchedule(items, { scheduleId: S_LEARN_2 }).scheduleId, S_LEARN_2)
  })

  test('C-006 pending and completed schedules are refused before experience fetch', async () => {
    await withEnv(async (dir) => {
      await writeSession({ access_token: TOKEN }, join(dir, 'session.json'))
      const net = installFetch((url) => {
        assert.match(url, /\/v1\/me\/schedules/)
        assert.equal(header(net.calls.at(-1).init, 'authorization'), `Bearer ${TOKEN}`)
        assert.equal(header(net.calls.at(-1).init, 'cookie'), null)
        return jsonResponse(okEnvelope(schedules))
      })
      try {
        await assert.rejects(
          () => dispatch(parseArgs(['submit', '--schedule', S_PENDING, '--task', T_MILE, '--comment', 'hi'])),
          { code: 'schedule_not_started' },
        )
        await assert.rejects(
          () => dispatch(parseArgs(['submit', '--schedule', S_DONE, '--task', T_MILE, '--comment', 'hi'])),
          { code: 'schedule_completed' },
        )
        assert.equal(net.calls.some(call => call.url.includes('/experience') || call.url.includes('/submissions')), false)
      }
      finally {
        net.restore()
      }
    })
  })

  test('C-007 the only learning schedule is selected and later pages are kept', async () => {
    assert.equal(resolveSchedule(schedules.items).scheduleId, S_LEARN)
    assert.throws(() => resolveSchedule([]), { code: 'empty' })
    await withEnv(async (dir) => {
      await writeSession({ access_token: TOKEN }, join(dir, 'session.json'))
      const net = installFetch((url) => {
        const page = new URL(url).searchParams.get('page') ?? '1'
        if (page === '1') {
          return jsonResponse(okEnvelope(
            { items: [schedules.items[0]] },
            { pagination: { page: 1, pageSize: 100, totalItems: 2, totalPages: 2, hasNextPage: true, hasPreviousPage: false } },
          ))
        }
        return jsonResponse(okEnvelope({
          items: [{ scheduleId: S_LEARN_2, name: '第二页', derivedStatus: 'learning', teacherDisplayName: '王老师' }],
        }))
      })
      try {
        const listed = await dispatch(parseArgs(['schedules', 'list']))
        assert.deepEqual(listed.items.map(item => item.scheduleId), [S_LEARN, S_LEARN_2])
        assert.equal(JSON.stringify(listed).includes(TOKEN), false)
        assert.equal(net.calls.length >= 2, true)
      }
      finally {
        net.restore()
      }
    })
  })

  test('C-008 projectTasks keeps milestone chapter and a single course report', () => {
    const tasks = projectTasks(experience)
    const mile = tasks.find(task => task.taskId === T_MILE)
    const closed = tasks.find(task => task.taskId === T_CLOSED)
    const submitted = tasks.find(task => task.taskId === T_SUBMITTED)
    const locked = tasks.find(task => task.taskId === T_CHAPTER_CLOSED)
    const report = tasks.find(task => task.taskId === T_REPORT)
    assert.equal(mile.kind, 'milestone')
    assert.equal(mile.chapterTitle, '认识问题')
    assert.equal(mile.open, true)
    assert.equal(mile.resubmit, false)
    assert.equal(closed.open, false)
    assert.equal(submitted.resubmit, true)
    assert.equal(locked.open, false)
    assert.equal(locked.chapterTitle, '未开放章节')
    assert.equal(report.kind, 'course_report')
    assert.equal(report.chapterTitle, null)
    assert.equal(report.name, '课程总体报告')
    assert.equal(tasks.filter(task => task.kind === 'course_report').length, 1)
    assert.equal(tasks.some(task => task.chapterTitle === '认识问题' && task.kind === 'course_report'), false)
  })

  test('C-009 task names resolve uniquely and report aliases do not guess', () => {
    assert.equal(resolveTask(experience, { name: '基础任务' }).taskId, T_MILE)
    assert.equal(resolveTask(experience, { id: T_MILE, name: '已交任务' }).taskId, T_MILE)
    for (const name of ['实验报告', '课程总体报告', '课程报告']) {
      assert.equal(resolveTask(experience, { name }).taskId, T_REPORT)
    }
    assert.throws(() => resolveTask(experience, { name: '不存在' }), { code: 'not_found' })
    const duplicated = structuredClone(experience)
    duplicated.chapters.push({
      id: '018f0000-0000-7000-8000-000000000153',
      title: '另一章',
      open: true,
      tasks: [{ id: '018f0000-0000-7000-8000-000000000205', kind: 'milestone', name: '基础任务', description: '', open: true, currentSubmission: null }],
    })
    assert.throws(() => resolveTask(duplicated, { name: '基础任务' }), { code: 'ambiguous' })
  })

  test('C-010 closed tasks and non-learning scenarios cannot be submitted', () => {
    assert.throws(() => resolveTask(experience, { id: T_CLOSED }), { code: 'task_closed' })
    assert.throws(() => resolveTask(experience, { id: T_CHAPTER_CLOSED }), { code: 'task_closed' })
    for (const scenario of ['review', 'schedule_preview']) {
      assert.throws(() => resolveTask({ ...experience, scenario }, { id: T_MILE }), { code: 'not_submittable' })
      assert.throws(() => resolveTask({ ...experience, scenario }, { id: T_CLOSED }), { code: 'not_submittable' })
    }
  })

  test('C-011 submission precheck enforces comment, count, size, and type', () => {
    assert.throws(() => validateSubmission({ files: [], comment: '   ' }), { code: 'invalid_input' })
    assert.equal(validateSubmission({ files: [], comment: '  完成  ' }).comment, '完成')
    assert.equal(validateSubmission({ files: [pdf()], comment: '' }).files.length, 1)
    assert.equal(validateSubmission({ files: [], comment: 'x'.repeat(4000) }).comment.length, 4000)
    assert.throws(() => validateSubmission({ files: [], comment: 'x'.repeat(4001) }), { code: 'invalid_input' })
    assert.equal(validateSubmission({ files: Array.from({ length: 10 }, (_, i) => pdf(`f${i}.pdf`)), comment: '' }).files.length, 10)
    assert.throws(() => validateSubmission({ files: Array.from({ length: 11 }, (_, i) => pdf(`f${i}.pdf`)), comment: '' }), { code: 'invalid_input' })
    const maxFile = 50 * 1024 * 1024
    const maxTotal = 100 * 1024 * 1024
    assert.equal(validateSubmission({ files: [{ name: 'a.pdf', size: maxFile, mimeType: 'application/pdf' }], comment: '' }).ok, true)
    assert.throws(() => validateSubmission({ files: [{ name: 'a.pdf', size: maxFile + 1, mimeType: 'application/pdf' }], comment: '' }), { code: 'too_large' })
    assert.equal(validateSubmission({
      files: [
        { name: 'a.pdf', size: maxFile, mimeType: 'application/pdf' },
        { name: 'b.pdf', size: maxTotal - maxFile, mimeType: 'application/pdf' },
      ],
      comment: '',
    }).ok, true)
    assert.throws(() => validateSubmission({
      files: [
        { name: 'a.pdf', size: 40 * 1024 * 1024, mimeType: 'application/pdf' },
        { name: 'b.pdf', size: 40 * 1024 * 1024, mimeType: 'application/pdf' },
        { name: 'c.pdf', size: 30 * 1024 * 1024, mimeType: 'application/pdf' },
      ],
      comment: '',
    }), { code: 'too_large' })
    assert.throws(() => validateSubmission({ files: [{ name: 'a.EXE', size: 4, mimeType: 'application/pdf' }], comment: '' }), { code: 'invalid_input' })
    assert.throws(() => validateSubmission({ files: [{ name: 'dir/a.pdf', size: 4, mimeType: 'text/plain' }], comment: '' }), { code: 'invalid_input' })
    assert.equal(validateSubmission({ files: [{ name: 'dir/a.PDF', size: 4 }], comment: '' }).ok, true)
  })

  test('C-012 dry-run does not POST and reports resubmit', async () => {
    await withEnv(async (dir) => {
      await writeSession({ access_token: TOKEN }, join(dir, 'session.json'))
      const file = join(dir, 'a.pdf')
      writeFileSync(file, 'hello')
      const net = installFetch((url, init) => {
        assert.notEqual(init.method, 'POST')
        if (url.includes('/v1/me/schedules')) return jsonResponse(okEnvelope(schedules))
        if (url.includes('/experience')) return jsonResponse(okEnvelope(experience))
        throw new Error(`unexpected ${url}`)
      })
      try {
        const first = await dispatch(parseArgs(['submit', '--schedule', S_LEARN, '--task', T_MILE, '--file', file, '--comment', '  说明  ']))
        assert.equal(first.dryRun, true)
        assert.equal(first.resubmit, false)
        assert.equal(first.taskId, T_MILE)
        assert.equal(JSON.stringify(first).includes(TOKEN), false)
        const again = await dispatch(parseArgs(['submit', '--schedule', S_LEARN, '--task', T_SUBMITTED, '--file', file]))
        assert.equal(again.dryRun, true)
        assert.equal(again.resubmit, true)
        assert.equal(net.calls.some(call => call.url.includes('/submissions')), false)
      }
      finally {
        net.restore()
      }
    })
  })

  test('C-013 redact removes nested tokens', () => {
    const out = redact({
      access_token: TOKEN,
      refresh_token: 'refresh-secret',
      scheduleId: S_LEARN,
      nested: { id_token: 'id-secret', code_verifier: 'verifier-secret', name: '学生' },
      items: [{ refresh_token: 'refresh-secret' }],
    })
    const text = JSON.stringify(out)
    assert.equal(out.scheduleId, S_LEARN)
    assert.equal(out.nested.name, '学生')
    assert.equal(text.includes(TOKEN), false)
    assert.equal(text.includes('refresh-secret'), false)
    assert.equal(text.includes('id-secret'), false)
    assert.equal(text.includes('verifier-secret'), false)
  })

  test('C-014 idempotency key is stable for the same trimmed payload', () => {
    const base = {
      scheduleId: S_LEARN,
      taskId: T_MILE,
      comment: '  说明  ',
      files: [
        { name: 'b.pdf', sha256: 'b'.repeat(64) },
        { name: 'a.pdf', sha256: 'a'.repeat(64) },
      ],
    }
    const key = idempotencyKeyFor(base)
    assert.equal(key, canonicalKey(base))
    assert.match(key, /^[0-9a-f]{64}$/)
    assert.equal(idempotencyKeyFor({ ...base, files: [...base.files].reverse() }), key)
    assert.equal(idempotencyKeyFor({ ...base, comment: '说明' }), key)
    assert.notEqual(idempotencyKeyFor({ ...base, comment: '另一份说明' }), key)
    assert.notEqual(idempotencyKeyFor({
      ...base,
      files: [{ name: 'a.pdf', sha256: 'c'.repeat(64) }],
    }), key)
  })

  test('C-015 API errors map to stable codes and OK unwraps data', () => {
    assert.equal(classifyApiError(401, { code: 'AUTH_UNAUTHENTICATED' }), 'unauthenticated')
    assert.equal(classifyApiError(403, { code: 'AUTH_FORBIDDEN' }), 'forbidden')
    assert.equal(classifyApiError(409, { code: 'COMMON_IDEMPOTENCY_CONFLICT' }), 'idempotency_conflict')
    assert.equal(classifyApiError(413, { code: 'COMMON_INVALID_ARGUMENT' }), 'too_large')
    assert.equal(classifyApiError(400, { code: 'COMMON_INVALID_ARGUMENT' }), 'invalid_input')
    assert.equal(classifyApiError(500, { code: 'COMMON_INTERNAL_ERROR' }), 'internal')
    assert.equal(classifyApiError(0, null), 'unreachable')
    assert.deepEqual(unwrapEnvelope(okEnvelope({ submissionId: T_MILE })), { submissionId: T_MILE })
    assert.throws(() => unwrapEnvelope({ code: 'AUTH_FORBIDDEN', message: 'no', traceId: 'x' }), { code: 'forbidden' })
    assert.throws(() => unwrapEnvelope([]), { code: 'protocol' })
    assert.throws(() => unwrapEnvelope(null), { code: 'protocol' })
  })

  test('C-016 help lists student commands and the yes gate', async () => {
    await withEnv(async () => {
      const net = installFetch(() => {
        throw new Error('fetch must not run')
      })
      try {
        const { help } = await dispatch(parseArgs(['--help']))
        assert.match(help, /whoami/)
        assert.match(help, /login/)
        assert.match(help, /schedules list/)
        assert.match(help, /tasks list/)
        assert.match(help, /submit/)
        assert.match(help, /--yes/)
        assert.match(help, /--schedule/)
        assert.match(help, /--task/)
        assert.match(help, /--file/)
        assert.match(help, /--comment/)
        assert.match(help, /18766/)
        assert.equal(help.includes('client_secret'), false)
        assert.equal(help.includes('f9000a01deab6f84d57c'), false)
        assert.equal(help.includes('add-user'), false)
        assert.equal(net.calls.length, 0)
      }
      finally {
        net.restore()
      }
    })
  })

  test('C-017 confirmed submit posts one multipart request', async () => {
    await withEnv(async (dir) => {
      await writeSession({ access_token: TOKEN }, join(dir, 'session.json'))
      const file = join(dir, 'a.pdf')
      writeFileSync(file, 'hello')
      const sha = createHash('sha256').update('hello').digest('hex')
      const expectedKey = canonicalKey({
        scheduleId: S_LEARN,
        taskId: T_MILE,
        comment: '说明',
        files: [{ name: 'a.pdf', sha256: sha }],
      })
      let posts = 0
      const net = installFetch(async (url, init) => {
        if (url.includes('/v1/me/schedules')) return jsonResponse(okEnvelope(schedules))
        if (url.includes('/experience')) return jsonResponse(okEnvelope(experience))
        posts += 1
        assert.equal(init.method, 'POST')
        assert.equal(url, `https://payload.example.com/v1/schedules/${S_LEARN}/tasks/${T_MILE}/submissions`)
        assert.equal(header(init, 'authorization'), `Bearer ${TOKEN}`)
        assert.equal(header(init, 'cookie'), null)
        assert.equal(header(init, 'idempotency-key'), expectedKey)
        assert.equal(init.body.get('comment'), '说明')
        assert.equal(init.body.getAll('file').length, 1)
        return jsonResponse(okEnvelope({
          submissionId: '018f0000-0000-7000-8000-000000000401',
          taskId: T_MILE,
          taskKind: 'milestone',
          versionId: '018f0000-0000-7000-8000-000000000402',
          versionNo: 1,
          filename: 'a.pdf',
          submittedAt: '2026-09-23T02:00:00.000Z',
        }), 201)
      })
      try {
        const result = await dispatch(parseArgs(['submit', '--schedule', S_LEARN, '--task', T_MILE, '--file', file, '--comment', '  说明  ', '--yes']))
        assert.equal(posts, 1)
        assert.equal(result.dryRun, undefined)
        assert.equal(result.submitted, true)
        assert.equal(result.versionNo, 1)
        assert.equal(result.taskKind, 'milestone')
        assert.equal(JSON.stringify(result).includes(TOKEN), false)
      }
      finally {
        net.restore()
      }
    })
  })

  test('C-018 failed submit is not reported as submitted', async () => {
    await withEnv(async (dir) => {
      await writeSession({ access_token: TOKEN }, join(dir, 'session.json'))
      const file = join(dir, 'a.pdf')
      writeFileSync(file, 'hello')
      const fail = (status, code) => installFetch((url) => {
        if (url.includes('/v1/me/schedules')) return jsonResponse(okEnvelope(schedules))
        if (url.includes('/experience')) return jsonResponse(okEnvelope(experience))
        return jsonResponse({ code, message: '服务内部错误', traceId: '018f0000-0000-7000-8000-000000000098' }, status)
      })
      const internal = fail(500, 'COMMON_INTERNAL_ERROR')
      try {
        await assert.rejects(
          () => dispatch(parseArgs(['submit', '--schedule', S_LEARN, '--task', T_MILE, '--file', file, '--yes'])),
          (error) => {
            assert.equal(error.code, 'internal')
            assert.equal(error.submitted, undefined)
            assert.equal(String(error.message).includes(TOKEN), false)
            return true
          },
        )
      }
      finally {
        internal.restore()
      }
      const conflict = fail(409, 'COMMON_IDEMPOTENCY_CONFLICT')
      try {
        await assert.rejects(
          () => dispatch(parseArgs(['submit', '--schedule', S_LEARN, '--task', T_MILE, '--file', file, '--yes'])),
          { code: 'idempotency_conflict' },
        )
      }
      finally {
        conflict.restore()
      }
    })
  })

  test('C-019 submit without a session does not call fetch', async () => {
    await withEnv(async (dir) => {
      const net = installFetch(() => {
        throw new Error('fetch must not run')
      })
      try {
        await assert.rejects(
          () => dispatch(parseArgs(['submit', '--schedule', S_LEARN, '--task', T_MILE, '--file', join(dir, 'missing.pdf'), '--yes'])),
          { code: 'unauthenticated' },
        )
        assert.equal(net.calls.length, 0)
      }
      finally {
        net.restore()
      }
    })
  })

  test('C-020 session file mode is 0600', async () => {
    await withEnv(async (dir) => {
      const path = join(dir, 'session.json')
      await writeSession({ access_token: TOKEN }, path)
      assert.equal(statSync(path).mode & 0o777, 0o600)
    })
  })

  test('C-021 submission extensions match the result policy', () => {
    assert.deepEqual([...SUBMISSION_EXTENSIONS].sort(), EXPECTED_EXTENSIONS)
  })

  test('C-022 unknown or incomplete commands fail before fetch', async () => {
    await withEnv(async () => {
      const net = installFetch(() => {
        throw new Error('fetch must not run')
      })
      try {
        assert.throws(() => parseArgs(['nope']), { code: 'invalid_input' })
        await assert.rejects(() => dispatch(parseArgs(['submit', '--task', T_MILE, '--comment', 'hi'])), { code: 'invalid_input' })
        await assert.rejects(() => dispatch(parseArgs(['tasks', 'list'])), { code: 'invalid_input' })
        assert.equal(net.calls.length, 0)
      }
      finally {
        net.restore()
      }
    })
  })
})
