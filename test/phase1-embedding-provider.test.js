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
  assert.match(serverSource, /function requireEmbeddingProvider\(\)/);
  assert.match(
    serverSource,
    /throw \{ code: 409, msg: 'EmbeddingProviderNotConfigured', details: state\.message \};/,
    'an unconfigured provider must fail closed instead of producing hash vectors',
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
  assert.match(serverSource, /const vector = await embedText\(text\);/, 'ingest must embed through the provider');
  assert.match(serverSource, /pgVectorLiteral\(await embedText\(query\)\)/, 'query must embed through the provider');
});

test('nothing is written when the provider is unavailable', () => {
  const ingest = serverSource.slice(serverSource.indexOf('const vector = await embedText(text);'));
  const upsertAt = ingest.indexOf('upsertVectorCollection');
  assert.ok(upsertAt > 0 && upsertAt < 400, 'the collection upsert must come after the embedding call, not before');
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
  const response = serverSource.slice(serverSource.indexOf('const embeddingState = requireEmbeddingProvider();'));
  assert.match(
    response.slice(0, 2600),
    /embedding: \{\s*provider: embeddingState\.provider,[\s\S]{0,220}simulated: embeddingState\.simulated,/,
    'a caller must be able to tell whether the search was semantic',
  );
});

test('collections record the embedding that indexed them', () => {
  assert.match(serverSource, /embeddingProvider: embeddingState\.provider,/);
  assert.match(serverSource, /embeddingSimulated: embeddingState\.simulated,/);
  assert.match(serverSource, /dimensions: embeddingState\.dimensions,/);
});
