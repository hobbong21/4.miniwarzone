# 미니워존 (Mini War Zone)

등고선 위의 작은 전쟁 — 브라우저에서 바로 하는 2.5D 실시간 전략 게임.
개발: **휴먼에이드 (HumanAid)**

- `index.html` — 게임 전체 (외부 라이브러리 없음, 파일만 열어도 혼자 플레이 가능)
- `server.js` + `backend/` — 백엔드 (계정 · 클라우드 저장 · 서버 순위표 · PVP 매칭/중계)
- `gameplan.md` — 기획서 (시스템별 상세 설명)

## 실행

Node.js **22.5 이상** (내장 SQLite 사용 · 설치할 패키지 없음)

```bash
npm start            # 또는 node server.js  →  http://localhost:8080
npm test             # 백엔드 통합 테스트 (node --test)
```

같은 네트워크의 다른 PC는 `http://(이 PC의 IP):8080` 으로 접속하면 함께 PVP를 할 수 있습니다.

### 환경 변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `8080` | 접속 포트 |
| `DB_PATH` | `./data/miniwarzone.db` | SQLite 파일 위치 |
| `TRUST_PROXY` | (꺼짐) | `1`이면 리버스 프록시의 `X-Forwarded-For`로 실제 IP 확인 (요청 제한용) |
| `ALLOWED_ORIGINS` | (같은 주소만) | 다른 도메인에서 API·WebSocket 접속을 허용할 출처 목록 (쉼표로 구분) |
| `NODE_ENV` | | `production`이면 index.html을 메모리에 캐시 |

## 배포 (Docker)

```bash
docker build -t miniwarzone .
docker run -d -p 8080:8080 -v miniwarzone-data:/data --name miniwarzone miniwarzone
curl http://localhost:8080/api/health
```

- DB는 `/data` 볼륨에 저장됩니다. **볼륨을 백업하세요** (`/data/miniwarzone.db*`).
- HTTPS는 앞단 리버스 프록시(Caddy · Nginx 등)에서 처리하고 `TRUST_PROXY=1`을 켜세요. WebSocket 경로는 `/ws` 입니다.
- `SIGTERM`을 받으면 접속을 정리하고 DB를 닫은 뒤 종료합니다.

## 백엔드 구조

| 파일 | 역할 |
|---|---|
| `server.js` | HTTP 서버 · 공개 파일 허용 목록(index.html만) · 보안 헤더(CSP 등) · 출처 검사 · 종료 처리 |
| `backend/db.js` | SQLite 스키마와 쿼리 (계정 · 세션 · 저장 · 레이팅 · 대전 기록) |
| `backend/api.js` | REST API · 입력 검증 · 크기 제한 · IP별 요청 제한 |
| `backend/ws.js` | WebSocket · 로비 · 매칭 · 친구 방 코드 · 재접속 · 결과 합의 · 하트비트 |
| `backend/rating.js` | Elo 레이팅(K=32) · 시즌 이월 |
| `test/server.test.js` | 통합 테스트 |

### 계정 방식

이메일·비밀번호 없이 **복구 코드**(`XXXX-XXXX-XXXX`, 60비트)로 다른 기기에서 이어 합니다.
서버에는 접속 토큰과 복구 코드의 **SHA-256 해시만** 저장합니다. 복구 시도는 IP당 분당 10회로 제한됩니다.

### REST API

| 메서드 · 경로 | 인증 | 설명 |
|---|---|---|
| `GET /api/health` | | 상태 · 버전 · 시즌 · 접속자 수 |
| `POST /api/account` `{name, nation}` | | 계정 생성 → `{id, token, code}` (코드는 이때 한 번만) |
| `POST /api/account/recover` `{code}` | | 복구 코드로 새 세션 토큰 발급 |
| `POST /api/account/code` | ✅ | 새 복구 코드 (예전 코드 무효) |
| `GET /api/me` · `PATCH /api/me` · `DELETE /api/me` | ✅ | 내 정보 · 이름/국가 변경 · 계정 삭제(저장·레이팅 삭제, 대전 기록 익명화) |
| `GET /api/save` · `PUT /api/save` `{rev, data}` | ✅ | 클라우드 저장 (512KB, rev가 다르면 `409` + 서버 사본) |
| `GET /api/leaderboard?type=pvp\|xp\|score\|regions` | | 순위표 상위 50 (pvp는 `&season=YYYY-MM`) |

인증: `Authorization: Bearer <token>`

### WebSocket `/ws` (JSON 메시지)

- 보냄: `hello{name,nation,token?}` · `seek{map,seed}` · `cancel` · `room_create{map,seed}` · `room_join{code}` · `relay{d}` · `result{matchId,win}` · `done` · `leave` · `resume{matchId,key}`
- 받음: `welcome` · `lobby` · `matched{role,matchId,key,rated,...}` · `room{code}` · `relay` · `rated{result,delta,rating,...}` · `peer_wait{sec}` · `peer_back` · `peer_left` · `resumed` · `resume_fail` · `error`

PVP 규칙: 클라우드에 연결한 두 계정의 빠른 대전 = 순위전. 양쪽이 보낸 결과가 같을 때만 레이팅 반영(다르면 무효), 대전 중 끊기면 30초 재접속 대기 후 몰수패, 도중에 나가면 패배. 친구 방 코드 대전은 순위 미반영.

## 라이선스 · 정책

© 2026 휴먼에이드. 이용약관 · 개인정보 처리방침은 게임 안 [설정 → 약관 · 정보]에서 볼 수 있습니다.
