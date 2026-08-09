'use strict';

// Phase 1 회귀 테스트 — 시뮬레이션 경로가 진짜 실행처럼 보이지 않게 고정한다.
//
// 감사에서 확증된 패턴: fallback 파이프라인·추론이 echo/고정응답인데 상태는 Succeeded/Ready 였다.
// 서명은 진짜인데 서명 대상이 가짜인 구조를 막는다. monitoring 이 이미 'measured-only' 라벨로
// 같은 원칙을 적용했으므로, 그것을 실행 평면까지 확장한 것이다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('the fallback serving runtime does not fabricate predictions', () => {
  assert.ok(
    !serverSource.includes("label:'opensphere-ready'"),
    'a fixed label/score must not be returned as if it were a prediction',
  );
  assert.match(
    serverSource,
    /send\(res,501,\{model,runtime,claim,simulated:true,error:'NoModelLoaded'/,
    'the predict endpoint must refuse rather than answer with a canned result',
  );
  assert.match(
    serverSource,
    /req\.url==='\/healthz'\) return send\(res,200,\{ok:true,model,runtime,claim,simulated:true\}\)/,
    'health must disclose that this runtime is simulated',
  );
});

test('inference claims backed by the fallback runtime are marked simulated', () => {
  assert.match(serverSource, /simulatedReason: 'FallbackRuntimeLoadsNoModel',/);
  const idx = serverSource.indexOf("simulatedReason: 'FallbackRuntimeLoadsNoModel'");
  const window = serverSource.slice(idx - 400, idx);
  assert.match(window, /simulated: true,/, 'the claim status must carry the simulated flag next to its reason');
});

test('the fallback pipeline runner states that it runs no pipeline step', () => {
  assert.match(serverSource, /\[pipeline\]\[simulated\]/, 'fallback pipeline logs must be prefixed as simulated');
  assert.ok(
    !serverSource.includes("console.log('[pipeline] completed successfully');"),
    'a simulated run must not claim it completed the pipeline successfully',
  );
  assert.match(
    serverSource,
    /this runner validates plumbing only and executes no pipeline step/,
    'the log must say plainly that nothing was executed',
  );
});

test('pipeline run claims on the fallback path are marked simulated', () => {
  assert.match(serverSource, /simulatedReason: 'NoUpstreamPipelineBackend',/);
});

test('training without a configured trainer reports that no model results', () => {
  // P1-5 에서 도입한 표기. 학습·파이프라인·추론 세 실행 평면이 같은 규약을 쓰는지 확인한다.
  assert.match(serverSource, /producesModel: trainer === 'configured'/);
  assert.match(serverSource, /nothing was trained/);
});
