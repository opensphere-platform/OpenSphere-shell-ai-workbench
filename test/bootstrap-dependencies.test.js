'use strict';

// subShell bootstrap — 의존성 선언·감지·집행의 회귀 테스트.
//
// 배경: 플랫폼은 의존성에 대한 규범(0003 §7 4분류, 0004 규정 1.5 시점 어휘)과 런타임 계약
// (FoundationClaim/Binding, LLMRouteClaim, DependencyPending)을 양쪽 다 갖췄는데, 그 사이를
// 잇는 "모듈이 자기 의존성을 선언하는 필드" 하나가 없었다. 그래서 각 subShell 이 자기
// server.js 에 리터럴로 하드코딩했다(gitlab·developer·edge 3사3색).
//
// 이 테스트가 지키는 경계:
//   - 선언은 서명 대상에 들어간다
//   - 감지는 관측이며 Unknown 을 Satisfied 로 접지 않는다
//   - 집행은 action 단위이고 메뉴를 잠그지 않는다(0006 규정 1.8)
//   - 소비 subShell 은 프로비저닝하지 않는다(0004 규정 2.0.4·§2.2, 0003 §17)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const packageTool = fs.readFileSync(path.join(root, 'tools', 'package-module.mjs'), 'utf8');
const manifestSource = JSON.parse(fs.readFileSync(path.join(root, 'ui-shell', 'ui-shell.manifest.source.json'), 'utf8'));

const REQUIRED_FOR = ['Stage', 'Install', 'Activate', 'Ready', 'DataChange'];

test('the module declares its dependencies in the signed manifest source', () => {
  assert.ok(Array.isArray(manifestSource.dependencies), 'dependencies[] must be declared');
  assert.ok(manifestSource.dependencies.length >= 1, 'a subShell with real dependencies must declare them');
  assert.match(
    packageTool,
    /dependencies: manifest\.dependencies \|\| \[\],/,
    'the declaration must flow into the signed descriptor, not just the source file',
  );
});

test('every declared dependency is well formed and observable', () => {
  const ids = new Set();
  for (const dependency of manifestSource.dependencies) {
    const where = `dependencies[${dependency.id}]`;
    assert.match(dependency.id, /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, `${where}: id must be a DNS label`);
    assert.ok(!ids.has(dependency.id), `${where}: duplicate id`);
    ids.add(dependency.id);
    assert.ok(String(dependency.capability || '').trim(), `${where}: capability is required`);
    assert.ok(['resource', 'connection'].includes(dependency.type), `${where}: type must be resource|connection`);
    assert.ok(REQUIRED_FOR.includes(dependency.requiredFor), `${where}: requiredFor must use the 0004 규정 1.5 vocabulary`);
    // 관측할 수 없는 의존성은 선언해도 판정할 수 없다.
    assert.ok(dependency.verify?.probe, `${where}: verify.probe is required`);
    assert.ok(dependency.provider?.shell || dependency.manual === true, `${where}: an owner or manual:true is required`);
    if (dependency.type === 'connection') {
      assert.ok(['operator', 'workforce', 'customer'].includes(dependency.scope), `${where}: connection needs a scope`);
    }
  }
});

test('packaging rejects a malformed declaration', () => {
  for (const guard of [
    /id must be an RFC1123 DNS label/,
    /duplicate dependency id/,
    /type must be one of/,
    /requiredFor must be one of/,
    /connection dependencies must declare scope/,
    /verify\.probe is required — a dependency must be observable/,
  ]) {
    assert.match(packageTool, guard, 'the packaging step must validate the declaration the SDK does not yet know');
  }
});

test('detection is an observation with four states and never folds Unknown into Satisfied', () => {
  assert.match(serverSource, /async function probeDependency\(dependency\)/);
  const probe = serverSource.slice(serverSource.indexOf('async function probeDependency('));
  assert.match(probe.slice(0, 3600), /state: 'Unknown', evidence: `unsupported probe/, 'an unknown probe must not pass');
  assert.match(
    probe.slice(0, 3600),
    /return \{ state: 'Unknown', evidence: `probe failed/,
    'a failed observation is Unknown, not Satisfied',
  );
  const state = serverSource.slice(serverSource.indexOf('async function bootstrapDependencyState('));
  assert.match(state.slice(0, 1800), /satisfied: probe\.state === 'Satisfied'/, 'only an explicit Satisfied counts');
});

test('no declaration is reported honestly, not as satisfied', () => {
  const state = serverSource.slice(serverSource.indexOf('async function bootstrapDependencyState('));
  assert.match(
    state.slice(0, 1800),
    /phase: !items\.length \? 'NoDeclaredDependencies'/,
    'an empty declaration must not read as a satisfied bootstrap',
  );
});

test('enforcement is per capability so one gap cannot blank the shell', () => {
  assert.match(serverSource, /async function requireSatisfiedDependencies\(requiredFor, action, capabilities\)/);
  assert.match(
    serverSource,
    /await requireSatisfiedDependencies\('DataChange', '\/memory\/vector\/ingest', \['ai\.substrate\.embedding', 'data\.vector'\]\)/,
    'indexing must require only what it uses — a missing GPU backend must not block document indexing',
  );
});

test('a blocked action returns an actionable DependencyPending', () => {
  const start = serverSource.indexOf('async function requireSatisfiedDependencies(');
  const fn = serverSource.slice(start, serverSource.indexOf('\n}', serverSource.indexOf('retryable: true', start)));
  assert.match(fn, /code: 409,/);
  assert.match(fn, /msg: 'DependencyPending'/);
  for (const field of ['action', 'dependency', 'capability', 'requiredFor', 'owner', 'resolveRoute', 'state', 'evidence', 'retryable']) {
    // shorthand(`action,`)와 명시(`capability: ...`) 양쪽을 받는다.
    assert.match(fn, new RegExp(`\\b${field}\\s*[:,]`), `the 409 must carry ${field} so the caller knows what to do`);
  }
});

test('the dependency ledger is readable and does not gate the menu', () => {
  assert.match(serverSource, /p === '\/admin\/native\/dependencies' && req\.method === 'GET'/);
  const readPaths = serverSource.slice(serverSource.indexOf('const ADMIN_READ_PATHS = new Set(['));
  assert.ok(readPaths.slice(0, readPaths.indexOf(']);')).includes("'/admin/native/dependencies'"), 'the ledger is an operational read');
  // 0006 규정 1.8 / arch-004 §5 — readiness 를 route/menu 접근 gate 로 쓰지 않는다.
  assert.ok(
    !/NAV_NODES[\s\S]{0,400}dependenc/i.test(fs.readFileSync(path.join(root, 'src', 'app', 'app.component.ts'), 'utf8')),
    'navigation must not be filtered by dependency state',
  );
});

test('the consuming subShell detects and links out but never provisions', () => {
  const probe = serverSource.slice(serverSource.indexOf('async function probeDependency('), serverSource.indexOf('async function bootstrapDependencyState('));
  for (const forbidden of ['upsertK8s(', 'postK8s(', 'applyK8s(']) {
    assert.ok(!probe.includes(forbidden), `probes must observe only — ${forbidden} would make this shell a provisioner`);
  }
  for (const dependency of manifestSource.dependencies) {
    assert.ok(String(dependency.resolveRoute || '').startsWith('/p/'), `${dependency.id}: a resolve route must point at the owning surface`);
  }
});
