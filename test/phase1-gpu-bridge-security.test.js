'use strict';

// Phase 1 회귀 테스트 — GPU bridge 의 SSRF·토큰 결함이 되돌아가지 않게 고정한다.
//
// Phase 0 에서 gpu-bridge 5경로를 adminPaths 에 등재해 무인증 호출은 막았다.
// 여기서 막는 것은 그다음 단계다: 인가된 관리자가 호출하더라도 서버가 임의 주소로
// Secret 토큰을 실어 보내지 않을 것, 그리고 브리지가 기본 토큰으로 무방비 기동하지 않을 것.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(root, 'gpu-bridge', 'server.js'), 'utf8');
const bridgeReadme = fs.readFileSync(path.join(root, 'gpu-bridge', 'README.md'), 'utf8');

test('every gpu bridge request passes the host guard', () => {
  // bridgeUrl 은 health/capabilities/smoke/register/training-smoke 가 모두 지나는 단일 관문이다.
  const bridgeUrlFn = serverSource.slice(serverSource.indexOf('function bridgeUrl('));
  assert.match(
    bridgeUrlFn.slice(0, 400),
    /assertGpuBridgeHostAllowed\(url\.hostname\)/,
    'bridgeUrl must validate the target host before building the request URL',
  );
  assert.match(serverSource, /function assertGpuBridgeHostAllowed\(hostname\)/);
});

test('loopback, link-local and cluster-internal hosts are rejected', () => {
  const block = serverSource.slice(serverSource.indexOf('const GPU_BRIDGE_BLOCKED_HOST_PATTERNS'));
  const patterns = block.slice(0, block.indexOf('];'));
  for (const needle of ['localhost', '127\\.', '::1', '169\\.254\\.', 'fe80:', 'svc', 'kubernetes\\.default', 'metadata\\.google\\.internal']) {
    assert.ok(patterns.includes(needle), `the blocked host list must cover ${needle}`);
  }
});

test('an explicit allowlist overrides the default block list', () => {
  assert.match(serverSource, /const GPU_BRIDGE_HOST_ALLOWLIST = String\(process\.env\.OSP_GPU_BRIDGE_HOST_ALLOWLIST/);
  const fn = serverSource.slice(serverSource.indexOf('function assertGpuBridgeHostAllowed('));
  assert.match(
    fn.slice(0, 600),
    /if \(GPU_BRIDGE_HOST_ALLOWLIST\.length\) \{[\s\S]{0,240}return;\s*\}/,
    'when set, the allowlist must be authoritative',
  );
});

test('the bridge refuses to start without a bearer token', () => {
  assert.match(
    bridgeSource,
    /const TOKEN = process\.env\.OSP_GPU_BRIDGE_TOKEN \|\| '';/,
    'the bridge must not ship a default token — an unset env var silently produced an open bridge',
  );
  assert.match(
    bridgeSource,
    /if \(!TOKEN\) \{[\s\S]{0,220}process\.exit\(1\);/,
    'a missing OSP_GPU_BRIDGE_TOKEN must be fatal at startup',
  );
});

test('bearer tokens are compared in constant time', () => {
  assert.match(bridgeSource, /import \{ randomUUID, timingSafeEqual \} from 'node:crypto';/);
  const fn = bridgeSource.slice(bridgeSource.indexOf('function isAuthorized('));
  assert.match(fn.slice(0, 600), /timingSafeEqual\(presented, expected\)/, 'token comparison must use timingSafeEqual');
  assert.ok(
    !/header === `Bearer \$\{TOKEN\}`/.test(bridgeSource),
    'the variable-time string comparison must stay removed',
  );
});

test('the bridge runbook no longer hands out a shared example token', () => {
  assert.ok(!bridgeReadme.includes('dev-token'), 'the runbook must generate a token instead of pasting dev-token');
  assert.match(bridgeReadme, /OSP_GPU_BRIDGE_HOST_ALLOWLIST/, 'the runbook must document the production allowlist');
});
