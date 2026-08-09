'use strict';

// Phase 1 회귀 테스트 — 승격 게이트가 평가 결과를 정직하게 읽는지 고정한다.
//
// 확증된 결함(2026-08-08 감사, adversarial verify CONFIRMED):
//   reconcileEvaluationJob 은 phase 가 Passed 든 Failed 든 ready=true 를 기록하는데,
//   evaluationState 가 그 ready 를 "통과"로 읽어(`|| ready`) 평가에 실패한 모델이
//   승격 게이트를 통과할 수 있었다. 또한 측정 메트릭이 없어도 요청자가 spec.passed 를
//   직접 써서 Passed 를 만들 수 있었다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

const sliceFn = (name, length = 1200) => {
  const start = serverSource.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  return serverSource.slice(start, start + length);
};

test('ready is never read as passed', () => {
  assert.ok(
    !/\|\| ready\b/.test(serverSource),
    'evaluation pass判定 must not fall back to the ready flag — ready means adjudicated, not passed',
  );
  assert.ok(
    !serverSource.includes("'passed', 'succeeded', 'ready'"),
    "a phase of 'ready' must not count as a passing evaluation",
  );
});

test('evaluationState derives pass only from the recorded verdict', () => {
  const body = sliceFn('evaluationState');
  assert.match(
    body,
    /const passed = job\.status\?\.passed === true \|\| \['passed', 'succeeded'\]\.includes\(String\(phase\)\.toLowerCase\(\)\);/,
    'pass must come from status.passed or an explicitly passing phase',
  );
  assert.match(body, /const adjudicated =/, 'the ready signal must be surfaced separately as "adjudicated"');
  assert.match(body, /return \{ found: true, passed, adjudicated,/, 'callers must be able to tell adjudicated from passed');
});

test('an evaluation with no measured metric cannot self-declare a pass', () => {
  const body = sliceFn('reconcileEvaluationJob', 1400);
  assert.match(
    body,
    /const passed = metrics\.length > 0 && failed\.length === 0;/,
    'a job without measured metrics must not be marked Passed from spec-supplied values',
  );
  assert.ok(
    !/spec\.passed === true \|\| \['passed', 'succeeded'/.test(body),
    'the self-reported spec.passed back door must stay closed',
  );
});

test('promotion approved without a passing evaluation is recorded, not silent', () => {
  assert.match(
    serverSource,
    /const promotedWithoutEvaluation = canPromote && approved && evaluation\.passed !== true;/,
    'approval-only promotion must be computed explicitly',
  );
  assert.match(serverSource, /^\s*promotedWithoutEvaluation,$/m, 'the promotion status must carry promotedWithoutEvaluation');
  assert.match(serverSource, /^\s*evaluationAdjudicated: evaluation\.adjudicated === true,$/m);
});
