'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ui-shell', 'ui-shell.manifest.source.json'), 'utf8'));
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('declares the canonical Main Shell identity and API surface', () => {
  assert.equal(manifest.id, 'ai-workbench');
  assert.equal(manifest.kind, 'subShell');
  assert.equal(manifest.hostRef, 'main');
  assert.equal(manifest.apiBase, '/api/plugins/ai-workbench');
  assert.equal(manifest.contributions.cli.namespace, 'ai-workbench');
  assert.equal(manifest.contributions.cli.manifestPath, '/admin/native/agent-tools');
  assert.deepEqual(manifest.permissions, [
    'page:register', 'api:proxy', 'nav:contribute', 'search:contribute',
    'manual:contribute', 'notify:publish',
  ]);
});

test('implements every production integration contribution', () => {
  for (const name of ['page', 'navigation', 'api', 'cli', 'manual', 'search', 'notification', 'observability']) {
    assert.equal(manifest.contributions[name].enabled, true, `${name} must be implemented`);
  }
  assert.equal(manifest.contributions.manual.sourceId, 'opensphere-ai-hub');
  assert.equal(manifest.contributions.manual.mode, 'runtime');
  assert.deepEqual(
    [manifest.contributions.observability.logs, manifest.contributions.observability.metrics, manifest.contributions.observability.traces],
    [true, true, true],
  );
});

test('ships actual navigation, search, manual and notification implementations', () => {
  const entry = fs.readFileSync(path.join(root, 'ui-shell', 'ui-shell.plugin.js'), 'utf8');
  const manual = fs.readFileSync(path.join(root, 'ui-shell', 'manual', 'ai.ko.md'), 'utf8');
  assert.match(entry, /extensions\.nav\?\.contribute/);
  assert.match(entry, /extensions\.search\?\.contribute/);
  assert.match(entry, /extensions\.manual\.contribute/);
  assert.match(entry, /notify\?\.publish/);
  assert.match(entry, /extensions\.manual\?\.clear/);
  assert.match(manual, /OpenSphere AI Hub/);
  assert.match(manual, /os ai-workbench readiness/);
  assert.match(manual, /opensphere\.v1/);
});

test('derives every host route from the host-owned plugin id', () => {
  const entry = fs.readFileSync(path.join(root, 'ui-shell', 'ui-shell.plugin.js'), 'utf8');
  assert.match(entry, /ctx\.routing\?\.basePath/);
  assert.doesNotMatch(entry, /'\/p\/ai/);
  assert.doesNotMatch(entry, /__OPENSPHERE_HOST_CONTEXTS__\.ai\b/);
});

test('keeps signed release artifacts generated and the source manifest authoritative', () => {
  assert.equal(Object.hasOwn(manifest, 'entrySha256'), false);
  assert.equal(Object.hasOwn(manifest, 'assets'), false);
  const packager = fs.readFileSync(path.join(root, 'tools', 'package-module.mjs'), 'utf8');
  const verifier = fs.readFileSync(path.join(root, 'tools', 'verify-artifacts.mjs'), 'utf8');
  const ignored = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(packager, /ui-shell\.manifest\.source\.json/);
  assert.match(packager, /source manifest must not contain generated entrySha256 or assets/);
  assert.match(verifier, /entry is not a closed ESM artifact/);
  for (const artifact of [
    '/module-package.json',
    '/module-package.json.sig',
    '/ui-shell/ui-shell.manifest.json',
    '/ui-shell/ui-shell.manifest.json.sig',
  ]) assert.match(ignored, new RegExp(artifact.replaceAll('.', '\\.')));
});

test('keeps the compatibility version plain and aligned across source and runtime defaults', () => {
  const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const escaped = packageInfo.version.replaceAll('.', '\\.');
  // CONSTITUTION-0005 §2.3 — channel suffix는 compatibility version에 넣지 않는다.
  assert.match(packageInfo.version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageLock.version, packageInfo.version);
  assert.equal(packageLock.packages[''].version, packageInfo.version);
  assert.equal(manifest.version, packageInfo.version);
  assert.match(dockerfile, new RegExp(`ARG APP_VERSION=${escaped}`));
  assert.match(server, new RegExp(`APP_VERSION \\|\\| '${escaped}'`));
  // §2.1 — 공식 version label은 KST release tag를 그대로 받는다.
  assert.match(dockerfile, /org\.opencontainers\.image\.version=\$OS_RELEASE_TAG/);
  assert.match(dockerfile, /io\.opensphere\.compatibility-version=\$APP_VERSION/);
});

test('declares the standard runtime observability and status endpoints', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const route of ['/healthz', '/readyz', '/metrics', '/api/info', '/api/status', '/api/contract', '/openapi.json']) {
    assert.ok(server.includes(`'${route}'`), `missing route ${route}`);
  }
  for (const field of [
    'schema: LOG_SCHEMA', 'resourceKind:', 'resourceName:', 'correlationId:',
    'operationId:', 'traceId:', 'actorType:', 'durationMs:',
  ]) assert.ok(server.includes(field), `missing structured log field ${field}`);
  assert.match(server, /opensphere_subshell_http_requests_total/);
  assert.match(server, /opensphere_subshell_ready/);
});

test('keeps the legacy static package aligned with the signed source identity', () => {
  const resources = yaml.loadAll(fs.readFileSync(path.join(root, 'uipluginpackage.yaml'), 'utf8'));
  const pkg = resources.find((item) => item?.kind === 'UIPluginPackage');
  const registration = resources.find((item) => item?.kind === 'UIPluginRegistration');
  assert.equal(pkg.metadata.name, manifest.id);
  assert.equal(registration.spec.packageRef.name, manifest.id);
  assert.equal(pkg.spec.version, manifest.version);
  assert.equal(pkg.spec.api.basePath, manifest.apiBase);
  assert.equal(pkg.spec.cli.namespace, manifest.contributions.cli.namespace);
  // 이 정적 manifest는 `os extensions install` 경로로 대체되었으므로 image digest와
  // manifest.sha256은 release마다 exact digest로 교체해야 하는 값이다.
  assert.equal(pkg.spec.image.repository, `opensphere-shell-${manifest.id}`);
});

test('generates the AI domain operator descriptor from the signed source manifest', () => {
  const packager = fs.readFileSync(path.join(root, 'tools', 'package-module.mjs'), 'utf8');
  assert.match(packager, /permissionProfile: 'ai-domain-operator-v1'/);
  assert.match(packager, /healthPath: '\/readyz'/);
  assert.match(packager, /automountServiceAccountToken: true/);
  assert.match(packager, /serviceAccountName: 'ai-runtime'/);
  // descriptor.id/apiBase는 source manifest에서 파생되므로 신원 drift가 생길 수 없다.
  assert.match(packager, /id: manifest\.id/);
  assert.match(packager, /basePath: manifest\.apiBase/);
  assert.equal(sha256(fs.readFileSync(path.join(root, 'ui-shell', 'ui-shell.plugin.js'))).length, 64);
});
