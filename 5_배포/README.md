# 5_배포 — 설치 · 배포 (Docker)

- `Dockerfile` · `Dockerfile.dockerignore`: 이미지에는 `4_서버/` · `3_게임/` · `package.json`만 들어갑니다 (기획서 · QA · DB 제외)
- GitHub Actions(`.github/workflows/docker.yml`)가 `main`에 올릴 때마다 빌드 → 실행 확인 → GHCR에 올림

## 실행 방법

```bash
docker build -f 5_배포/Dockerfile -t miniwarzone .
docker run -d -p 8080:8080 -v miniwarzone-data:/data --name miniwarzone miniwarzone
curl http://localhost:8080/api/health
```

빌드된 이미지 받아 쓰기 (main에 푸시할 때마다 GitHub Actions `docker` 워크플로가 빌드 · 실행 확인 후 올림):

```bash
docker pull ghcr.io/hobbong21/4.miniwarzone:latest
docker run -d -p 8080:8080 -v miniwarzone-data:/data --name miniwarzone ghcr.io/hobbong21/4.miniwarzone:latest
```

- DB는 `/data` 볼륨에 저장됩니다. **볼륨을 백업하세요** (`/data/miniwarzone.db*`).
- HTTPS는 앞단 리버스 프록시(Caddy · Nginx 등)에서 처리하고 `TRUST_PROXY=1`을 켜세요. WebSocket 경로는 `/ws` 입니다.
- `SIGTERM`을 받으면 접속을 정리하고 DB를 닫은 뒤 종료합니다.
