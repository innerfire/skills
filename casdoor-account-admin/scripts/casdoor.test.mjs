import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_PASSWORD,
  DEFAULTS,
  buildAuthorizeUrl,
  classifyCasdoorError,
  dispatch,
  formatSeq,
  generateNames,
  generatedNamePattern,
  jwtExp,
  mergeUserUpdate,
  normalizeGroupId,
  parseArgs,
  parseGroupList,
  publicUser,
  redactUser,
  unwrapEnvelope,
  validateCount,
  validatePrefix,
} from './casdoor.mjs'

test('prefix validation', () => {
  assert.equal(validatePrefix('s').ok, false)
  assert.equal(validatePrefix('thisprefixistoolong1').ok, false)
  assert.equal(validatePrefix('stu_1').ok, false)
  assert.equal(validatePrefix('stu').ok, true)
})

test('count validation', () => {
  assert.equal(validateCount(0).ok, false)
  assert.equal(validateCount(-1).ok, false)
  assert.equal(validateCount(101).ok, false)
  assert.equal(validateCount(3).ok, true)
  assert.equal(validateCount(100).ok, true)
})

test('name generation pads to 3 then expands', () => {
  assert.deepEqual(generateNames('stu', 3), ['stu001', 'stu002', 'stu003'])
  const names = generateNames('stu', 12)
  assert.equal(names[11], 'stu012')
  assert.equal(formatSeq(1), '001')
  assert.equal(formatSeq(999), '999')
  assert.equal(formatSeq(1000), '1000')
})

test('generated-name pattern does not match extra suffix', () => {
  const re = generatedNamePattern('stu')
  assert.equal(re.test('stu001'), true)
  assert.equal(re.test('student'), false)
  assert.equal(re.test('stu-001'), false)
})

test('unwrap envelope', () => {
  assert.deepEqual(unwrapEnvelope({ status: 'ok', data: [1], data2: 1 }).data, [1])
  assert.throws(() => unwrapEnvelope({ status: 'error', msg: 'Please sign in first' }), {
    code: 'unauthenticated',
  })
  assert.throws(() => unwrapEnvelope({ error: 'invalid_grant', error_description: 'authorization code is invalid' }), {
    code: 'casdoor',
  })
})

test('classify errors', () => {
  assert.equal(classifyCasdoorError('Please sign in first'), 'unauthenticated')
  assert.equal(classifyCasdoorError('Access token doesn\'t exist in database'), 'unauthenticated')
  assert.equal(classifyCasdoorError('No permission'), 'forbidden')
  assert.equal(classifyCasdoorError('User already exists'), 'already_exists')
  assert.equal(classifyCasdoorError('redirect_uri is invalid'), 'config')
})

test('group ids', () => {
  assert.equal(normalizeGroupId('acme', 'students'), 'acme/students')
  assert.equal(normalizeGroupId('acme', 'acme/students'), 'acme/students')
  assert.deepEqual(parseGroupList('acme', 'a,b'), ['acme/a', 'acme/b'])
})

test('update merge strips secrets and keeps other fields', () => {
  const { user, columns } = mergeUserUpdate(
    {
      owner: 'acme',
      name: 'stu001',
      displayName: 'stu001',
      email: 'keep@x',
      password: 'hashed',
      passwordSalt: 'salt',
      groups: ['acme/old'],
    },
    { groups: ['acme/new'] },
  )
  assert.equal(user.email, 'keep@x')
  assert.deepEqual(user.groups, ['acme/new'])
  assert.equal(user.password, undefined)
  assert.equal(user.passwordSalt, undefined)
  assert.deepEqual(columns, ['groups'])
})

test('redact and public user', () => {
  const redacted = redactUser({ name: 'stu001', password: 'if123456', totpSecret: 'x' })
  assert.equal(redacted.password, undefined)
  assert.equal(redacted.name, 'stu001')
  const pub = publicUser({
    owner: 'acme',
    name: 'stu001',
    isForbidden: false,
    groups: ['acme/students'],
    createdTime: 't',
  })
  assert.equal(pub.displayName, 'stu001')
  assert.equal(pub.isForbidden, false)
})

test('authorize url includes pkce', () => {
  const url = buildAuthorizeUrl(DEFAULTS, {
    verifier: 'v',
    challenge: 'challenge',
    state: 'st',
  })
  const parsed = new URL(url)
  assert.equal(parsed.origin, 'https://auth.innerfireai.com')
  assert.equal(parsed.searchParams.get('client_id'), DEFAULTS.clientId)
  assert.equal(parsed.searchParams.get('redirect_uri'), DEFAULTS.redirectUri)
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(parsed.searchParams.get('scope')?.includes('offline_access'), true)
})

test('jwt exp decode', () => {
  const payload = base64url(JSON.stringify({ exp: 1700000000 }))
  assert.equal(jwtExp(`a.${payload}.b`), 1700000000)
  assert.equal(jwtExp('not-a-jwt'), null)
})

test('parseArgs and default password', () => {
  const args = parseArgs(['users', 'add-batch', '--owner', 'acme', '--prefix', 'stu', '--count', '3', '--yes', '--json'])
  assert.deepEqual(args._, ['users', 'add-batch'])
  assert.equal(args.owner, 'acme')
  assert.equal(args.yes, true)
  assert.equal(args.json, true)
  assert.equal(DEFAULT_PASSWORD, 'if123456')
})

test('dispatch help and invalid input', async () => {
  const help = await dispatch(parseArgs(['--help']))
  assert.match(help.help, /add-batch/)
  await assert.rejects(() => dispatch(parseArgs(['users', 'add-batch', '--prefix', 'stu', '--count', '3'])), {
    code: 'invalid_input',
  })
  await assert.rejects(() => dispatch(parseArgs(['users', 'add-batch', '--owner', 'acme', '--prefix', 'stu', '--count', '0'])), {
    code: 'invalid_input',
  })
  const preview = await dispatch(
    parseArgs(['users', 'add-batch', '--owner', 'acme', '--prefix', 'stu', '--count', '3', '--groups', 'students']),
  )
  assert.equal(preview.dryRun, true)
  assert.deepEqual(preview.users.map((u) => u.name), ['stu001', 'stu002', 'stu003'])
  assert.deepEqual(preview.groups, ['acme/students'])
  assert.equal(preview.password, DEFAULT_PASSWORD)
})

function base64url(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
