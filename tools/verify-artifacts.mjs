// Release gate for the signed subShell artifacts produced by tools/package-module.mjs.
// CONSTITUTION-0005 §4.2 requires every module image to carry a signed Module Package,
// a manifest hash and an entry digest. This verifies those locally so a drifted or
// unloadable bundle fails on the build host instead of at Console activation.
import { createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const read = (relative) => readFileSync(resolve(root, relative));

const angular = JSON.parse(read('angular.json'));
const project = Object.values(angular.projects)[0];
const output = project.architect.build.options.outputPath;
const appRoot = resolve(root, typeof output === 'string' ? output : output.base, 'browser');

const source = JSON.parse(read('ui-shell/ui-shell.manifest.source.json'));
const manifestBytes = read('ui-shell/ui-shell.manifest.json');
const manifest = JSON.parse(manifestBytes);
const descriptorText = read('module-package.json').toString('utf8');
const descriptor = JSON.parse(descriptorText);
const packageInfo = JSON.parse(read('package.json'));

// ① 생성 manifest는 source manifest에 entry digest만 더한 것이어야 한다.
const sourceProjection = structuredClone(manifest);
delete sourceProjection.entrySha256;
assert.deepEqual(sourceProjection, source, 'generated manifest source fields drifted');

// ② entry digest — Console이 /plugins/<entry>를 받아 대조하는 값과 같아야 한다.
const entryBytes = read('ui-shell/ui-shell.plugin.js');
if (hash(entryBytes) !== manifest.entrySha256) {
  throw new Error('ui-shell.plugin.js does not match manifest.entrySha256');
}

// ③ Host는 검증한 entry를 Blob URL에서 실행하므로 상대·외부 module specifier를 해석할 수
//    없다. Controller의 NonClosedModuleArtifact 판정을 빌드 호스트에서 먼저 잡는다.
const entryText = entryBytes.toString('utf8');
for (const expression of [
  /(?:^|[;}\r\n])\s*import[ \t]*(['"])([^'"\r\n]+)\1/g,
  /(?:^|[;}\r\n])\s*(?:import|export)[ \t]+[^;\r\n]*?[ \t]+from[ \t]*(['"])([^'"\r\n]+)\1/g,
  /\bimport[ \t]*\([ \t]*(['"])([^'"\r\n]+)\1[ \t]*\)/g,
]) {
  const match = expression.exec(entryText);
  if (match) throw new Error(`entry is not a closed ESM artifact: imports ${match[2]}`);
}

// ④ entry가 주입하는 Angular 번들이 실제로 build되어 있어야 한다. 없으면 image는
//    빈 화면을 서빙하고 activation만 Ready로 보인다.
for (const asset of ['main.js', 'styles.css']) {
  if (!existsSync(resolve(appRoot, asset))) {
    throw new Error(`Angular bundle asset is missing, run npm run build first: ${asset}`);
  }
}

// ⑤ descriptor는 signed manifest와 같은 신원·API 표면을 선언해야 한다.
assert.equal(descriptor.id, manifest.id, 'descriptor id drifted from the signed manifest');
assert.equal(descriptor.kind, manifest.kind, 'descriptor kind drifted from the signed manifest');
assert.equal(descriptor.version, manifest.version, 'descriptor version drifted from the signed manifest');
assert.equal(descriptor.api?.basePath, manifest.apiBase, 'descriptor apiBase drifted from the signed manifest');
assert.equal(descriptor.api?.basePath, `/api/plugins/${descriptor.id}`, 'apiBase must be the host canonical namespace');
assert.equal(descriptor.manifest.sha256, hash(manifestBytes), 'descriptor manifest digest drifted');

// ⑥ CONSTITUTION-0005 §2.3 — compatibility version은 channel suffix 없는 plain SemVer다.
if (!/^\d+\.\d+\.\d+$/.test(descriptor.version)) {
  throw new Error(`compatibility version must be plain SemVer without a channel suffix: ${descriptor.version}`);
}
assert.equal(descriptor.version, packageInfo.version, 'package.json version drifted from the manifest');

// ⑦ 서명 round-trip. 개인키는 읽되 내용을 출력하지 않고 공개키만 파생한다.
const keyPath = process.env.DUPA_SIGNING_KEY;
if (keyPath) {
  const publicKey = createPublicKey(createPrivateKey(readFileSync(keyPath)));
  const check = (text, signature, label) => {
    const ok = verify('sha256', Buffer.from(text), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64'));
    if (!ok) throw new Error(`${label} signature does not verify against the signing key`);
  };
  check(manifestBytes.toString('utf8'), read('ui-shell/ui-shell.manifest.json.sig').toString('utf8').trim(), 'manifest');
  check(descriptorText, read('module-package.json.sig').toString('utf8').trim(), 'module package');
  assert.equal(descriptor.trust.keyId, process.env.DUPA_SIGNING_KEY_ID || 'opensphere-plugins-v1', 'descriptor key id drifted');
}

console.log(`verified ${descriptor.id}@${descriptor.version} entry=${manifest.entrySha256.slice(0, 12)} manifest=${descriptor.manifest.sha256.slice(0, 12)}${keyPath ? ' signature=ok' : ' signature=skipped'}`);
