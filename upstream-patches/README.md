# Upstream 패치 보존소

이 디렉터리는 OpenSphere 가 업스트림 소스에 얹는 패치의 **정본**이다.

## 왜 여기에 있는가

vendored 체크아웃(`_upstream/data-science-pipelines`)은 부모 저장소에서 `.gitignore` 되고
자체 원격은 업스트림(`opendatahub-io/data-science-pipelines`)이라 우리 브랜치를 밀 수 없다.
즉 패치가 그 작업 트리에만 있으면 `git checkout` 한 번, 디스크 장애 한 번에 사라지고
배포 중인 이미지와 소스의 대응을 증명할 수 없다.

패치가 사라지면 깨지는 것은 이 저장소(AI-Workbench)다 — DSPA/KFP 파이프라인 전체가
PostgreSQL Backbone 위에서 동작하지 못한다. 그래서 정본을 여기에 둔다.

## data-science-pipelines — PostgreSQL 방언 패치

| 항목 | 값 |
|---|---|
| 업스트림 | `opendatahub-io/data-science-pipelines` |
| base commit | `fdfb9ac` (master, `VERSION` = 2.16.1) |
| 패치 | `data-science-pipelines/0001-feat-opensphere-PostgreSQL-dialect-via-opensphere-pg.patch` |
| 산출 이미지 | `ghcr.io/opensphere-platform/oah-ds-pipelines-api-server` |
| 다이제스트 고정 위치 | `server.js` `DSPA_API_SERVER_IMAGE` |

### 무엇을 바꾸는가

DSP API server 는 MySQL 방언을 전제하는데 OpenSphere Backbone 의 데이터 권위는
PostgreSQL 이다. 패치는 3파일을 건드린다.

- `backend/src/apiserver/client_manager/opensphere_pgx_driver.go` (신규 313줄)
  — `?` → `$N` 리바인딩, 식별자 quoting, GROUP BY 확장
- `backend/src/apiserver/client_manager/client_manager.go` (+14) — driver 등록/선택
- `backend/src/apiserver/storage/db.go` (+64) — PostgreSQL 방언 분기

### 재적용 절차

```bash
# 1. 업스트림 체크아웃을 원하는 기준으로 맞춘다
cd _upstream/data-science-pipelines
git fetch origin
git checkout -b opensphere/pgx-postgres <upstream-ref>

# 2. 패치를 적용한다
git am ../../OpenSphere-shell-ai-workbench/upstream-patches/data-science-pipelines/0001-*.patch

# 충돌하면 3-way 로 재시도하고, 해소 후 반드시 갱신된 패치를 다시 내보낸다
#   git am --3way ...   →   해소   →   git am --continue
#   git format-patch -1 --keep-subject -o <이 디렉터리>
```

### 재빌드 후 반드시 할 일

이미지를 새로 빌드했다면 **다이제스트를 코드에 반영하지 않으면 아무 효과가 없다.**
`DSPA_API_SERVER_IMAGE` 는 sha256 다이제스트로 고정돼 있고, `verify-support-services.js`
가 이 상수를 regex 로 강제한다.

1. 새 이미지를 push 하고 다이제스트를 확보한다.
2. `server.js` 의 `DSPA_API_SERVER_IMAGE` 를 갱신한다.
3. 빌드에 소스 revision 라벨을 실어 다이제스트↔커밋 대응을 증명 가능하게 한다.
4. `npm run test:support-services` 로 상수 정합을 확인한다.

### 업스트림 추적 주의

ODH 는 3.x 라인으로 넘어갔고(3.0 GA 2025-11), 2.x→3.0 에서 ModelMesh·KServe Serverless·
LAB-tuning 등을 제거한 전례가 있다. 이 패치는 2.16.1 기준이므로 3.x rebase 시
이식 비용을 먼저 실측(스파이크 1회)한 뒤 진행할 것.

## mlmd-postgres-wrapper

`../mlmd-postgres-wrapper` 는 패치가 아니라 entrypoint 래퍼(셸)다.
업스트림 `quay.io/opendatahub/mlmd-grpc-server` 의 MySQL env 를 Postgres 플래그로 변환한다.
소스가 이 저장소 안에 있으므로 별도 보존이 필요 없다.
