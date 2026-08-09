'use strict';

// Phase 0 (Console 표면 경화) 회귀 테스트.
// 이 파일이 지키는 것은 "관리자 채널과 사원 표면이 섞이면서 생긴 인가 구멍"이 다시 열리지 않는 것이다.
// 참조: _DOCS_/AI-WORKBENCH-CHANNEL-SPLIT-AND-BOOTSTRAP-2026-08-08.md §1.4, §4 Phase 0

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'src', 'app', 'app.component.ts'), 'utf8');

test('unauthenticated list reads are fail-closed outside in-cluster loopback', () => {
  // 종전 결함: 토큰이 없으면 전 클러스터 목록을 그대로 반환했다.
  assert.ok(
    !/if \(!req\?\.headers\?\.\['x-os-id-token'\]\) return items \|\| \[\];/.test(serverSource),
    'filterReadableItems/filterReadableProjects must not return every item when the caller is unauthenticated',
  );
  assert.match(
    serverSource,
    /function readableItemsUnauthenticated\(req, items\) \{\s*return requestIsLoopback\(req\) \? items \|\| \[\] : \[\];/,
    'unauthenticated reads must be limited to in-cluster loopback callers',
  );
  for (const fn of ['filterReadableItems', 'filterReadableProjects']) {
    const body = serverSource.slice(serverSource.indexOf(`async function ${fn}(`));
    assert.match(
      body.slice(0, 400),
      /readableItemsUnauthenticated\(req, items\)/,
      `${fn} must delegate the unauthenticated case to readableItemsUnauthenticated`,
    );
  }
});

test('gpu-bridge and cluster configuration writes require admin access', () => {
  // gpu-bridge 경로가 admin 게이트 밖에 있으면 서버가 ServiceAccount 권한으로 읽은 Secret 토큰을
  // 호출자가 지정한 임의 URL 로 Bearer 전송한다(자격증명 유출 + SSRF).
  const required = [
    '/admin/native/gpu-bridge/health',
    '/admin/native/gpu-bridge/capabilities',
    '/admin/native/gpu-bridge/smoke',
    '/admin/native/gpu-bridge/register',
    '/admin/native/gpu-bridge/training-smoke',
    '/admin/native/support-services/serving/configure',
    '/admin/native/support-services/backbone/claim',
    '/admin/native/support-services/backbone/claim/preview',
    '/admin/native/support-services/backbone/bindings',
    '/admin/native/support-services/backbone/bindings/preview',
    '/admin/native/foundation-services/configure',
    '/admin/native/compute-routing',
    '/admin/setup/plan',
  ];
  const block = serverSource.slice(serverSource.indexOf('const adminPaths = new Set(['));
  const adminPaths = block.slice(0, block.indexOf(']);'));
  for (const route of required) {
    assert.ok(adminPaths.includes(`'${route}'`), `${route} must be admin-gated`);
  }
});

test('setup plan writes are not exempted from authorization', () => {
  assert.ok(
    !/if \(pathname === '\/admin\/setup\/plan'\) return;/.test(serverSource),
    '/admin/setup/plan must not short-circuit authorization for mutating requests',
  );
});

test('cluster settings reads require operational read access', () => {
  const block = serverSource.slice(serverSource.indexOf('const ADMIN_READ_PATHS = new Set(['));
  const readPaths = block.slice(0, block.indexOf(']);'));
  assert.ok(readPaths.includes("'/admin/cluster-settings'"), '/admin/cluster-settings must require operational read access');
});

test('workbench launch and pipeline run detail reads are authorized', () => {
  assert.match(serverSource, /if \(pathname === '\/workbenches\/launch'\)/, 'workbench launch must be authorized explicitly');
  assert.match(
    serverSource,
    /const RUN_DETAIL_READ_PATHS = new Set\(\['\/pipeline\/runs\/logs', '\/pipeline\/runs\/lineage'\]\);/,
    'pipeline run logs and lineage must require read access to the owning claim',
  );
});

test('provider-only create pages require admin access', () => {
  // compute = 외부 GPU 백엔드(DGX Spark 포함) 등록 경로. 네임스페이스 편집권만으로 등록되면 안 된다.
  assert.match(
    serverSource,
    /const PROVIDER_ONLY_CREATE_PAGES = new Set\(\['compute', 'llm-routes', 'eval-policy'\]\);/,
    'compute, llm-routes and eval-policy creation must be provider-only',
  );
  assert.match(
    serverSource,
    /if \(PROVIDER_ONLY_CREATE_PAGES\.has\(body\.page\)\) \{\s*await requireAdminAccess\(req, `\$\{pathname\}:\$\{body\.page\}`\);/,
    'provider-only create pages must call requireAdminAccess',
  );
});

test('model promotion decisions need a separate approver grant', () => {
  // 종전에는 승인이 retry/suspend 와 동일한 patch 권한이면 통과했다.
  assert.match(
    serverSource,
    /const PROMOTION_DECISION_VERBS = \{ approve: 'approve', promote: 'approve', reject: 'reject' \};/,
    'promotion decisions must map to dedicated RBAC verbs',
  );
  assert.match(serverSource, /async function requirePromotionDecisionAccess\(/, 'promotion decisions need a dedicated authorization path');
  assert.match(
    serverSource,
    /if \(target\.kind === 'ModelPromotionClaim' && PROMOTION_DECISION_VERBS\[body\.action\]\)/,
    'promotion approve/reject must not fall through to the generic patch check',
  );
});

test('training lifecycle is a reachable operation instead of a dead button', () => {
  // 핸들러는 실재하는데 operationTarget 미등록이라 항상 HTTP 400 으로 죽었다.
  assert.match(
    serverSource,
    /if \(pathname === '\/operations\/training\/lifecycle'\) \{[\s\S]{0,220}resource: 'trainingjobclaims'/,
    '/operations/training/lifecycle must resolve to a training job claim target',
  );
});

test('retrieval query and ACL target a selected collection instead of a hardcoded one', () => {
  // 최초 생성(bootstrap)만 기본 이름을 쓰고, 질의·ACL 은 선택한 컬렉션을 대상으로 해야 한다.
  assert.ok(
    !appSource.includes("collection: 'oah-vector-memory'"),
    'vector query and ACL must not hardcode the oah-vector-memory collection',
  );
  assert.match(
    appSource,
    /const DEFAULT_VECTOR_COLLECTION = 'oah-vector-memory';/,
    'the bootstrap default must be a named constant, not an inline literal',
  );
  const aclBody = appSource.slice(appSource.indexOf("/memory/vector/collections`"));
  assert.match(
    aclBody.slice(0, 500),
    /namespace: selected\.namespace,\s*collection: selected\.name,/,
    'vector access updates must apply to the selected collection',
  );
  assert.ok(
    !appSource.includes("signal('AI-Workbench model registry and object storage')"),
    'vector query must not ship a developer placeholder as the default question',
  );
  assert.match(appSource, /readonly selectedVectorCollection = computed\(/, 'the queried collection must be selectable');
});

test('navigation is grouped by provider verbs and every leaf declares an audience', () => {
  const navBlock = appSource.slice(appSource.indexOf('const NAV_NODES: NavNode[] = ['));
  const nav = navBlock.slice(0, navBlock.indexOf('\n];'));
  for (const group of ['g-configure', 'g-govern', 'g-operate']) {
    assert.ok(nav.includes(`id: '${group}'`), `navigation must define the ${group} group`);
  }
  const leaves = nav.match(/kind: 'leaf'/g) || [];
  const audiences = nav.match(/audience: '(provider|shared|workforce)'/g) || [];
  assert.equal(
    leaves.length,
    audiences.length,
    'every navigation leaf must declare an audience — this is the Workspace migration spec',
  );
  assert.match(appSource, /type NavAudience = 'provider' \| 'shared' \| 'workforce';/);
});
