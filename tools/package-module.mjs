import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const keyPath = process.env.DUPA_SIGNING_KEY;
if (!keyPath) throw new Error('DUPA_SIGNING_KEY must point to the approved P-256 signing key');
const keyId = process.env.DUPA_SIGNING_KEY_ID || 'opensphere-plugins-v1';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const signature = (text, key) => sign('sha256', Buffer.from(text), { key, dsaEncoding: 'ieee-p1363' }).toString('base64');
const key = createPrivateKey(readFileSync(keyPath));

const entry = readFileSync(resolve(root, 'ui-shell/ui-shell.plugin.js'), 'utf8');
const manifestSourcePath = resolve(root, 'ui-shell/ui-shell.manifest.source.json');
const manifestPath = resolve(root, 'ui-shell/ui-shell.manifest.json');
const manifest = JSON.parse(readFileSync(manifestSourcePath, 'utf8'));
if ('entrySha256' in manifest || 'assets' in manifest) {
  throw new Error('source manifest must not contain generated entrySha256 or assets');
}
manifest.entrySha256 = hash(entry);
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
writeFileSync(manifestPath, manifestText);
writeFileSync(resolve(root, 'ui-shell/ui-shell.manifest.json.sig'), `${signature(manifestText, key)}\n`);

const descriptor = {
  schemaVersion: 1,
  id: manifest.id,
  kind: manifest.kind,
  displayName: manifest.title,
  version: manifest.version,
  owner: 'platform-experience',
  description: manifest.description,
  hostRef: manifest.hostRef,
  hostApiVersion: manifest.hostApiVersion,
  hostCompat: manifest.hostCompat,
  shellCompat: manifest.shellCompat,
  sdkVersion: manifest.sdkVersion,
  nav: manifest.nav,
  permissions: manifest.permissions,
  permissionProfile: 'ai-domain-operator-v1',
  runtime: {
    port: 8080,
    healthPath: '/readyz',
    serviceAccountName: 'ai-runtime',
    resources: { cpuRequest: '200m', memoryRequest: '512Mi', cpuLimit: '1000m', memoryLimit: '1Gi' },
    security: {
      automountServiceAccountToken: true,
      runAsNonRoot: true,
      runAsUser: 1000,
      runAsGroup: 1000,
      readOnlyRootFilesystem: true,
      seccompProfile: 'RuntimeDefault',
    },
    availability: {
      replicas: 2,
      minAvailable: 1,
      topologySpread: true,
      autoscaling: { enabled: true, minReplicas: 2, maxReplicas: 4, targetCPUUtilization: 70 },
    },
    networkPolicy: { enabled: true, allowMonitoring: true },
    observability: {
      metricsPath: '/metrics',
      scrapeInterval: '30s',
      logs: { format: 'json', schema: 'opensphere.v1', stream: 'stdout' },
      traces: { propagation: 'w3c', responseHeaders: true },
    },
  },
  manifest: {
    path: '/plugins/ui-shell.manifest.json',
    sha256: hash(manifestText),
    signaturePath: '/plugins/ui-shell.manifest.json.sig',
  },
  trust: { keyId },
  api: { basePath: manifest.apiBase },
  contributions: manifest.contributions,
  // 모듈이 자기 의존성을 선언한다. CONSTITUTION-0004 §8.3 이 "machine-readable descriptor 가
  // dependency DAG 를 선언한다" 고 전제하는 자리이며, 서명 대상에 포함되어 변조되지 않는다.
  dependencies: manifest.dependencies || [],
};

// SDK 는 아직 dependencies 를 모른다(미지 필드를 거부하지 않으므로 하위호환).
// 플랫폼 차원 강제가 생기기 전까지 여기서 검증한다.
const REQUIRED_FOR = ['Stage', 'Install', 'Activate', 'Ready', 'DataChange']; // 0004 규정 1.5 어휘
const DEPENDENCY_TYPES = ['resource', 'connection'];
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const seenDependencyIds = new Set();
for (const dependency of descriptor.dependencies) {
  const where = `dependencies[${dependency?.id || '?'}]`;
  if (!DNS_LABEL.test(String(dependency?.id || ''))) throw new Error(`${where}: id must be an RFC1123 DNS label`);
  if (seenDependencyIds.has(dependency.id)) throw new Error(`${where}: duplicate dependency id`);
  seenDependencyIds.add(dependency.id);
  if (!String(dependency.capability || '').trim()) throw new Error(`${where}: capability is required`);
  if (!DEPENDENCY_TYPES.includes(dependency.type)) throw new Error(`${where}: type must be one of ${DEPENDENCY_TYPES.join('|')}`);
  if (!REQUIRED_FOR.includes(dependency.requiredFor)) throw new Error(`${where}: requiredFor must be one of ${REQUIRED_FOR.join('|')}`);
  if (dependency.type === 'connection' && !['operator', 'workforce', 'customer'].includes(dependency.scope)) {
    throw new Error(`${where}: connection dependencies must declare scope`);
  }
  if (!dependency.provider?.shell && dependency.manual !== true) throw new Error(`${where}: provider.shell is required unless manual is true`);
  if (!dependency.verify?.probe) throw new Error(`${where}: verify.probe is required — a dependency must be observable`);
}

const sdkEntry = resolve(process.env.OPENSPHERE_SDK || resolve(root, '../OpenSphere-SDK'), 'dist/index.js');
const { validateModulePackage } = await import(pathToFileURL(sdkEntry));
const issues = validateModulePackage(descriptor);
if (issues.length) throw new Error(`OpenSphere SDK rejected module package: ${JSON.stringify(issues)}`);

const descriptorText = JSON.stringify(descriptor);
writeFileSync(resolve(root, 'module-package.json'), descriptorText);
writeFileSync(resolve(root, 'module-package.json.sig'), `${signature(descriptorText, key)}\n`);
console.log(`packaged ${descriptor.id}@${descriptor.version} manifest=${descriptor.manifest.sha256}`);
