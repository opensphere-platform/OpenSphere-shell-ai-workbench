'use strict';

// 회귀 테스트 — 벡터 메모리가 의미 없는 벡터를 조용히 색인하지 못하게 고정한다.
//
// 종전 결함: 설정과 무관하게 SHA-256 해시를 16차원으로 편 값을 임베딩으로 썼다.
// 결정적이긴 하나 의미를 담지 않아 유사한 문서가 전혀 무관한 벡터를 받는다.
// 저장·조회 배관은 도는데 검색 결과가 무의미했고, 그 사실이 어디에도 표시되지 않았다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('an embedding provider is required rather than silently faked', () => {
  assert.match(serverSource, /async function requireEmbeddingProvider\(namespace, routeRef\)/);
  assert.match(
    serverSource,
    /throw \{ code: 409, msg: state\.reason \|\| 'EmbeddingProviderNotConfigured', details: state\.message \};/,
    'an unbound capability must fail closed instead of producing hash vectors',
  );
});

// CONSTITUTION-0004 규정 2.0.4: AI Substrate 는 PFS core concern 이고, AI training 같은
// domain engine 은 PFS 의 일부가 아니라 그 capability 를 "소비" 한다.
// 약속된 경로: VectorRetrievalClaim.spec.embeddingRouteRef -> LLMRouteClaim.status.endpoint
test('the embedding endpoint is consumed from the PFS AI Substrate capability', () => {
  assert.match(serverSource, /async function resolveEmbeddingCapability\(namespace, routeRef\)/);
  assert.match(
    serverSource,
    /vectorretrievalclaims/,
    'the route must be discovered through VectorRetrievalClaim.spec.embeddingRouteRef',
  );
  assert.match(
    serverSource,
    /llmrouteclaims\/\$\{encodeURIComponent\(route\.name\)\}/,
    'the endpoint must come from the published LLMRouteClaim',
  );
  assert.match(
    serverSource,
    /const endpoint = optionalString\(claim\.status\?\.endpoint\);/,
    'status.endpoint is the published capability, not a local setting',
  );
  assert.match(
    serverSource,
    /claim\.status\?\.ready !== true \|\| !endpoint/,
    'an unready capability must not be used',
  );
});

test('capability binding failures are typed as dependencies, not misconfiguration', () => {
  for (const reason of ['NoVectorRetrievalClaim', 'LLMRouteClaimNotFound', 'LLMRouteClaimNotReady']) {
    assert.ok(serverSource.includes(`'${reason}'`), `${reason} must be a distinct, actionable reason`);
  }
});

test('the env endpoint is an explicit override, not the canonical path', () => {
  const state = serverSource.slice(serverSource.indexOf('async function embeddingProviderState('));
  assert.match(
    state.slice(0, 1800),
    /source: 'env-override',/,
    'an env-provided endpoint must be labelled as an override',
  );
  assert.match(
    serverSource,
    /OAH_EMBEDDING_ENDPOINT overrides the PFS AI Substrate capability\. Bind an LLMRouteClaim for production\./,
    'the override must say what the production path is',
  );
});

test('the hash placeholder is opt-in and labelled simulated', () => {
  assert.match(serverSource, /const EMBEDDING_MODE = optionalString\(process\.env\.OAH_EMBEDDING_MODE\) \|\| 'provider';/);
  const state = serverSource.slice(serverSource.indexOf('function embeddingProviderState('));
  assert.match(
    state.slice(0, 900),
    /if \(EMBEDDING_MODE === 'simulated'\)[\s\S]{0,320}simulated: true,/,
    'the deterministic hash path must require an explicit opt-in',
  );
  assert.match(
    serverSource,
    /Vectors carry no meaning; similarity search results are not semantic\./,
    'the simulated mode must state plainly that results are not semantic',
  );
});

test('ingest and query both go through the provider', () => {
  assert.ok(
    !/pgVectorLiteral\(deterministicEmbedding\(/.test(serverSource),
    'no write or search path may embed with the hash placeholder directly',
  );
  assert.match(serverSource, /const vector = await embedText\(text, ns\);/, 'ingest must embed through the provider');
  assert.match(serverSource, /pgVectorLiteral\(await embedText\(query, namespace\)\)/, 'query must embed through the provider');
});

test('nothing is written when the capability is unavailable', () => {
  // capability 해석이 컬렉션 생성보다 먼저 와야 반쯤 색인된 상태가 남지 않는다.
  const ingest = serverSource.slice(serverSource.indexOf('const embeddingState = await requireEmbeddingProvider(ns);'));
  const upsertAt = ingest.indexOf('upsertVectorCollection');
  const embedAt = ingest.indexOf('await embedText(text, ns)');
  assert.ok(embedAt > 0 && embedAt < upsertAt, 'the embedding must be produced before the collection upsert');
});

test('a dimension mismatch is refused instead of corrupting the index', () => {
  assert.match(serverSource, /msg: 'EmbeddingDimensionMismatch'/);
  assert.match(
    serverSource,
    /vector\.length !== state\.dimensions/,
    'a provider returning a different width must not be written into an existing index',
  );
});

test('the schema width follows the configured dimension', () => {
  assert.match(
    serverSource,
    /embedding vector\(\$\{EMBEDDING_DIMENSIONS\}\) not null,/,
    'the pgvector column must not be pinned to the placeholder width',
  );
});

test('query responses disclose which embedding produced them', () => {
  const response = serverSource.slice(serverSource.indexOf('const embeddingState = await requireEmbeddingProvider(namespace);'));
  assert.match(
    response.slice(0, 3000),
    /source: embeddingState\.source,[\s\S]{0,320}simulated: embeddingState\.simulated,/,
    'a caller must be able to tell whether the search was semantic and where the endpoint came from',
  );
});

test('collections record the embedding that indexed them', () => {
  assert.match(serverSource, /embeddingProvider: embeddingState\.provider,/);
  assert.match(serverSource, /embeddingSimulated: embeddingState\.simulated,/);
  assert.match(serverSource, /dimensions: embeddingState\.dimensions,/);
});
