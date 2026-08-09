# OpenSphere GPU Bridge MVP

This directory contains the Phase 1 containerized External GPU Compute Backend for OpenSphere AI Hub.

The bridge is intentionally small:

- Runs as a Docker container.
- Uses Docker `--gpus all` to access the host GPU.
- Exposes the OAH External Compute Backend MVP API.
- Accepts only allowlisted `jobType` values. Arbitrary commands are not accepted.
- Supports `smoke` jobs backed by `nvidia-smi`.

## Build

```powershell
docker build -t localhost:5000/opensphere-gpu-bridge:v0.1.0 .
```

## Run

브리지는 bearer token 없이 기동하지 않는다(`OSP_GPU_BRIDGE_TOKEN` 미설정 시 종료).
먼저 토큰을 만든다.

```powershell
$token = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

```powershell
docker run --rm -d `
  --name opensphere-gpu-bridge `
  --gpus all `
  -p 18080:18080 `
  -e OSP_GPU_BRIDGE_TOKEN=$token `
  localhost:5000/opensphere-gpu-bridge:v0.1.0
```

같은 `$token` 값을 아래 Kubernetes Secret 에 넣는다. OAH 가 그 Secret 을 읽어 브리지를
호출하며, 브리지는 토큰을 상수시간으로 비교한다.

From OpenSphere AI Hub running inside Docker Desktop Kubernetes, use:

```text
http://host.docker.internal:18080
```

## API

Public:

```http
GET /health
```

Bearer token required:

```http
GET /capabilities
POST /jobs
GET /jobs/{jobId}
GET /jobs/{jobId}/logs
POST /jobs/{jobId}/cancel
```

Submit a smoke job:

```powershell
curl.exe -s `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d "{\"jobType\":\"smoke\"}" `
  http://localhost:18080/jobs
```

## OAH Fields

| OAH field | Value |
| --- | --- |
| Usage option | External GPU endpoint |
| External endpoint | `http://host.docker.internal:18080` |
| Credential Secret | `oah-external-gpu-credentials` |
| Resource name | `external.opensphere.io/gpu` |
| Max concurrency | `1` |

Kubernetes Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: oah-external-gpu-credentials
  namespace: opensphere-system
type: Opaque
stringData:
  token: <위 $token 과 동일한 값>
```

## 네트워크 경계

OAH 는 GPU bridge endpoint 로 loopback·링크로컬(클라우드 메타데이터)·클러스터 내부 서비스
DNS 를 허용하지 않는다. 브리지는 정의상 클러스터 밖 호스트이며, 이 차단이 없으면 호출자가
지정한 임의 주소로 서버가 Secret 토큰을 실어 보낼 수 있다(SSRF).

운영 환경에서 등록된 호스트만 허용하려면 OAH 런타임에 allowlist 를 설정한다.

```text
OSP_GPU_BRIDGE_HOST_ALLOWLIST=gpu-1.example.com,gpu-2.example.com
```

값이 설정되면 그 목록이 정본이 되고 위 기본 차단 규칙보다 우선한다.
