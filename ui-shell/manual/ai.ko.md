# OpenSphere AI Hub

OpenSphere AI Hub는 Workbench, Pipeline, Training, Model Registry, Inference, Evaluation,
Monitoring을 하나의 AI 운영 도메인으로 제공합니다. Main Shell의 인증·권한·감사·검색·알림
경계를 그대로 사용하며 별도 로그인이나 독립 전역 UI를 만들지 않습니다.

## 시작하기

1. [AI Hub 개요](/p/ai-workbench)에서 기반 서비스와 최종 준비 상태를 확인합니다.
2. [Workbenches](/p/ai-workbench/workbenches)에서 대화형 개발 환경을 준비합니다.
3. [Pipelines](/p/ai-workbench/pipelines)와 [Training](/p/ai-workbench/training/jobs)에서 학습 실행을 관리합니다.
4. [Models](/p/ai-workbench/models/registry)에서 모델 버전과 승격 상태를 확인합니다.
5. [Inference](/p/ai-workbench/inference)에서 서빙 대상을 배포하고 상태를 점검합니다.
6. [Evaluation](/p/ai-workbench/evaluation/jobs)과 [Monitoring](/p/ai-workbench/monitoring/trustyai)에서 품질·정책·관측 증거를 확인합니다.

## CLI

AI 명령은 Console Registry가 광고하는 동일 API와 권한을 사용합니다.

```text
os ai-workbench readiness
os ai-workbench support-services list
os ai-workbench gpu list
os ai-workbench model versions list
os ai-workbench audit list
```

변경 명령은 correlation ID와 idempotency key를 사용하며, 고위험 작업은 preview·승인·apply
경계를 통과해야 합니다. CLI 전용 우회 API는 제공하지 않습니다.

## 운영 및 진단

- Readiness: `/api/plugins/ai-workbench/readyz`
- 통합 상태: `/api/plugins/ai-workbench/api/status`
- Host 계약: `/api/plugins/ai-workbench/api/contract`
- OpenAPI: `/api/plugins/ai-workbench/openapi.json`
- Prometheus: `/api/plugins/ai-workbench/metrics`
- Tool Manifest: `/api/plugins/ai-workbench/admin/native/agent-tools`
- 감사 원장: `/api/plugins/ai-workbench/operations/ledger`

HTTP 요청 로그는 `opensphere.v1` JSON 스키마로 stdout에 기록합니다. Main Shell에서 전달한
correlation ID, operation ID와 W3C trace context는 응답·로그·지표에 연결됩니다. 인증 토큰,
요청 본문과 자격 증명은 로그에 기록하지 않습니다.

## 기능 저하 상태

공유 Foundation, Backbone 또는 AI operand가 준비되지 않았으면 실제 source와 Pending/Degraded
상태를 표시해야 합니다. fallback이나 예시 데이터를 운영 준비 상태로 간주해서는 안 됩니다.
