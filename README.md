# 미니워존 (Mini War Zone)

등고선 위의 작은 전쟁 — 브라우저에서 바로 하는 2.5D 실시간 전략 게임.
개발: **휴먼에이드 (HumanAid)**

## 폴더 구성

```
4.miniwarzone/
├─ start.bat · start.sh   ▶ 더블클릭으로 서버 실행 + 게임 열기 (Windows · macOS/Linux)
├─ game/                  🎮 게임 (브라우저에서 여는 파일)
│  ├─ index.html          게임 전체 — 파일만 열어도 혼자 플레이 가능
│  └─ member/             예전 회원가입 · 로그인 주소 → 게임 안 탭으로 넘김
├─ server/                🖥️ 백엔드 (계정 · 클라우드 저장 · 순위표 · PVP)
├─ docs/                  📘 기획 문서
│  ├─ gameplan.md         기획서 (시스템별 상세 설명 · 개발 기록)
│  ├─ member-pages.md     회원가입 · 로그인 주소 안내
│  └─ images/             기획서 그림
├─ deploy/                📦 설치 · 배포 (Docker)
├─ tests/                 ✅ 자동 테스트
├─ data/                  서버 DB (자동 생성 · git 제외 · 백업 대상)
└─ archive/               예전 버전 백업 index_v*.html (로컬 전용 · git 제외)
```

## 실행

Node.js **22.5 이상** (내장 SQLite 사용 · 설치할 패키지 없음)

- **혼자 하기**: `game/index.html`을 브라우저로 열기 (설치 필요 없음)
- **서버와 함께 (회원 · 순위 · PVP)**: `start.bat`(Windows) 또는 `./start.sh`(macOS · Linux) 더블클릭 → 브라우저가 `http://localhost:8080`을 엶

```bash
npm start            # 서버만 실행 (= node server/server.js)
npm test             # 백엔드 통합 테스트
npm run test:auth    # 게임 화면 회원가입 · 로그인 브라우저 테스트
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

## 회원가입 · 로그인 · 로그아웃 (게임 안)

- 게임 첫 화면의 탭: **🔑 로그인 · 📝 회원가입 · 🎖️ 게스트**. 프로필의 **🚪 로그아웃**
- 회원: 아이디 · 비밀번호 계정이 서버 DB에 저장되고(비밀번호는 솔트를 넣은 scrypt 해시), 가입하면 클라우드 저장이 자동으로 켜져 어느 기기에서든 로그인해 이어 함
- 게스트: 이 브라우저에만 저장 (서버 없이 파일로 열면 게스트만). 나중에 [프로필 → 설정 → 📝 회원가입]으로 기록을 그대로 옮김
- 예전 주소 `/member/signup.html` · `/member/login.html`은 `/?auth=signup` · `/?auth=login`으로 넘김
- 테스트: `npm run test:auth` (임시 DB로 서버를 띄우고 헤드리스 Chrome으로 가입 → 로그아웃 → 로그인 → 다른 기기 → 게스트 전환까지 23개 항목)

## 배포 (Docker)

```bash
docker build -f deploy/Dockerfile -t miniwarzone .
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

## 백엔드 구조

| 파일 | 역할 |
|---|---|
| `server/server.js` | HTTP 서버 · 공개 파일 허용 목록(game/ 안의 index.html · member/ 페이지만) · 보안 헤더(CSP 등) · 출처 검사 · 종료 처리 |
| `server/db.js` | SQLite 스키마와 쿼리 (계정 · 세션 · 저장 · 레이팅 · 대전 기록) |
| `server/api.js` | REST API · 입력 검증 · 크기 제한 · IP별 요청 제한 |
| `server/ws.js` | WebSocket · 로비 · 매칭 · 친구 방 코드 · 재접속 · 결과 합의 · 하트비트 |
| `server/rating.js` | Elo 레이팅(K=32) · 시즌 이월 |
| `tests/server.test.js` | 통합 테스트 (`npm test`) |
| `game/member/` | 예전 회원가입 · 로그인 주소 → 게임 안 탭으로 넘김 |
| `tests/auth.e2e.mjs` | 게임 안 회원가입 · 로그인 · 로그아웃 브라우저 테스트 (`npm run test:auth`) |

### 계정 방식

이메일·비밀번호 없이 **복구 코드**(`XXXX-XXXX-XXXX`, 60비트)로 다른 기기에서 이어 합니다.
서버에는 접속 토큰과 복구 코드의 **SHA-256 해시만** 저장합니다. 복구 시도는 IP당 분당 10회로 제한됩니다.

### REST API

| 메서드 · 경로 | 인증 | 설명 |
|---|---|---|
| `GET /api/health` | | 상태 · 버전 · 시즌 · 접속자 수 |
| `GET /api/signup/check?login=` | | 아이디 형식 · 사용 가능 여부 `{valid, available}` |
| `POST /api/signup` `{login, password, name, nation}` | | 회원가입 → `{id, token, code, login}` (409 = 아이디 사용 중) |
| `POST /api/login` `{login, password}` | | 로그인 → 새 토큰 + 계정 정보 (401 = 아이디 또는 비밀번호 틀림) |
| `POST /api/logout` | 토큰 | 이 토큰만 끝냄 (다른 기기는 그대로) |
| `POST /api/me/login` `{login, password}` | 토큰 | 복구 코드 계정에 아이디 · 비밀번호 붙이기 |
| `POST /api/account` `{name, nation}` | | (예전 방식) 아이디 없는 계정 생성 → `{id, token, code}` |
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
