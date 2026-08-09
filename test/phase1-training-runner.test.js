'use strict';

// Phase 1 회귀 테스트 — TrainingJobClaim 이 실제 워크로드를 만드는지 고정한다.
//
// 종전 결함: kubernetes 백엔드 경로가 어떤 Job 도 만들지 않고 'Ready/TrainingJobPrepared'
// 상태만 찍었다. 즉 "학습됨"으로 보이는데 학습된 것이 없었다.
//
// 실측(2026-08-09, docker-desktop): 아래 형태로 생성되는 Job 이 admission 을 통과하고
// succeeded=1 로 완주하며, datasetRef 가 없으면 실패(fail-closed)하는 것을 확인했다.
// serviceAccountName 을 생략하면 클러스터 admission policy 의 CEL 이
// "no such key: serviceAccountName" 로 Job 을 거부한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

const trainingReconciler = () => {
  const start = serverSource.indexOf('async function reconcileTrainingJobClaim(');
  assert.notEqual(start, -1, 'reconcileTrainingJobClaim must exist');
  return serverSource.slice(start, start + 2600);
};

test('the kubernetes backend creates a real Job instead of stamping status', () => {
  const body = trainingReconciler();
  assert.match(
    body,
    /upsertK8s\(\s*`\/apis\/batch\/v1\/namespaces\/\$\{namespace\}\/jobs`/,
    'training must upsert a batch/v1 Job',
  );
  assert.match(body, /normalizeJobStatus\(current, suspended,/, 'claim status must be derived from the Job status');
  assert.ok(
    !/const status = passiveStatus\(claim, target\);\s*await patchPassiveStatus\(claim, target, status\);\s*return \{/.test(body),
    'the status-only stamp path must stay removed',
  );
});

test('the generated Job sets serviceAccountName so admission can evaluate it', () => {
  const resources = serverSource.slice(serverSource.indexOf('function trainingJobResources('));
  assert.match(
    resources.slice(0, 3200),
    /serviceAccountName: optionalString\(spec\.serviceAccountName\) \|\| 'default',/,
    'omitting serviceAccountName makes cluster admission policies fail with a CEL key error',
  );
  assert.match(resources.slice(0, 3200), /restartPolicy: 'Never'/);
  assert.match(resources.slice(0, 3200), /backoffLimit: 0/);
});

test('a claim without a trainer runs a preflight and says nothing was trained', () => {
  const resources = serverSource.slice(serverSource.indexOf('function trainingJobResources('));
  assert.match(
    resources.slice(0, 3200),
    /const trainer = runnerImage && command \? 'configured' : 'preflight';/,
    'a claim is only "configured" when both an image and a command are declared',
  );
  assert.match(
    serverSource,
    /preflight ok — no trainer image configured, nothing was trained/,
    'the preflight must state plainly that no model was produced',
  );
  const body = trainingReconciler();
  assert.match(body, /producesModel: trainer === 'configured'/, 'status must record whether a model can result');
});

test('the preflight fails closed when the dataset reference is missing', () => {
  assert.match(
    serverSource,
    /if \[ -z "\$\{OPENSPHERE_TRAINING_DATASET:-\}" \]; then echo "\[training\] FAIL no datasetRef"; exit 1; fi/,
    'a training job without a dataset must fail rather than report success',
  );
});

test('a missing runner image reports a dependency instead of emitting an invalid Job', () => {
  const body = trainingReconciler();
  assert.match(body, /if \(!image\) \{/, 'an unresolvable image must short-circuit before upserting a Job');
  assert.match(body, /phase: 'DependencyPending'/);
  assert.match(body, /reason: 'TrainerImageNotConfigured'/);
});

test('external bridge GPU classes are not requested as Pod resources', () => {
  const resources = serverSource.slice(serverSource.indexOf('function trainingJobResources('));
  assert.match(
    resources.slice(0, 3200),
    /gpuClass\.includes\('\/'\) && !gpuClass\.startsWith\('external\.'\)/,
    'external.* GPU classes are bridge identifiers, not Kubernetes extended resources',
  );
});

test('deleting a claim cleans up its Job', () => {
  assert.match(serverSource, /async function cleanupTrainingJobResources\(claim\)/);
  assert.match(
    trainingReconciler(),
    /cleanupClaimResources\(claim, 'trainingjobclaims', cleanupTrainingJobResources\)/,
    'training claims need finalizer-backed cleanup like the other executable claims',
  );
});
