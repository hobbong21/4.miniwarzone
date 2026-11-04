# 4_서버 — 백엔드 (계정 · 클라우드 저장 · 순위표 · PVP)

외부 패키지 없음 · Node.js **22.5 이상**(내장 SQLite). 프로젝트 폴더에서 `npm start` (= `node 4_서버/server.js`) → http://localhost:8080

- 게임 파일은 `../3_게임/`에서, DB는 `../data/miniwarzone.db`에서 찾습니다 (`DB_PATH`로 변경)
- 테스트: `npm test` (`../2_QA/서버_테스트/`)

## 환경 변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `8080` | 접속 포트 |
| `DB_PATH` | `./data/miniwarzone.db` | SQLite 파일 위치 |
| `TRUST_PROXY` | (꺼짐) | `1`이면 리버스 프록시의 `X-Forwarded-For`로 실제 IP 확인 (요청 제한용) |
| `ALLOWED_ORIGINS` | (같은 주소만) | 다른 도메인에서 API·WebSocket 접속을 허용할 출처 목록 (쉼표로 구분) |
| `NODE_ENV` | | `production`이면 index.html을 메모리에 캐시 |

## 백엔드 구조

| 파일 | 역할 |
|---|---|
| `server.js` | HTTP 서버 · 공개 파일 허용 목록(3_게임/ 안의 index.html · member/ 페이지만) · 보안 헤더(CSP 등) · 출처 검사 · 종료 처리 |
| `db.js` | SQLite 스키마와 쿼리 (계정 · 세션 · 저장 · 레이팅 · 대전 기록) |
| `api.js` | REST API · 입력 검증 · 크기 제한 · IP별 요청 제한 |
| `ws.js` | WebSocket · 로비 · 매칭 · 친구 방 코드 · 재접속 · 결과 합의 · 하트비트 |
| `rating.js` | Elo 레이팅(K=32) · 시즌 이월 |
| `../2_QA/서버_테스트/server.test.js` | 통합 테스트 (`npm test`) |
| `../3_게임/member/` | 예전 회원가입 · 로그인 주소 → 게임 안 탭으로 넘김 |
| `../2_QA/브라우저_테스트/회원가입_로그인_e2e.mjs` | 게임 안 회원가입 · 로그인 · 로그아웃 브라우저 테스트 (`npm run test:auth`) |

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

## 회원가입 · 로그인 · 로그아웃 (게임 안)

- 게임 첫 화면의 탭: **🔑 로그인 · 📝 회원가입(① 계정 만들기: 아이디 · 비밀번호 · 약관 → ② 지휘관 등록: 이름 · 국가) · 🎖️ 게스트(지휘관 등록만)**. 프로필의 **🚪 로그아웃**
- 회원: 아이디 · 비밀번호 계정이 서버 DB에 저장되고(비밀번호는 솔트를 넣은 scrypt 해시), 가입하면 클라우드 저장이 자동으로 켜져 어느 기기에서든 로그인해 이어 함
- 게스트: 이 브라우저에만 저장 (서버 없이 파일로 열면 게스트만). 나중에 [프로필 → 설정 → 📝 회원가입]으로 기록을 그대로 옮김
- 예전 주소 `/member/signup.html` · `/member/login.html`은 `/?auth=signup` · `/?auth=login`으로 넘김
- 테스트: `npm run test:auth` (임시 DB로 서버를 띄우고 헤드리스 Chrome으로 가입 2단계 → 로그아웃 → 로그인 → 다른 기기 → 게스트 전환 · 세계 지도까지 36개 항목)
