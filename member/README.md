# 회원가입 · 로그인 주소

회원가입 · 로그인 · 로그아웃은 **게임 안 화면**에서 합니다 (`index.html`의 로그인 화면 · 프로필).
이 폴더의 두 페이지는 예전 주소를 위해 게임의 해당 탭으로 넘겨 주기만 합니다.

| 주소 | 넘어가는 곳 |
|---|---|
| `/member/signup.html` | `/?auth=signup` (📝 회원가입 탭) |
| `/member/login.html` · `/member/` | `/?auth=login` (🔑 로그인 탭) |

- 계정은 게임 서버 DB(`accounts.login` · `accounts.pw_hash`)에 저장 — 비밀번호는 솔트를 넣은 scrypt 해시만
- API: `GET /api/signup/check?login=` · `POST /api/signup` · `POST /api/login` · `POST /api/logout` · `POST /api/me/login`
- 테스트: `npm test` (API) · `npm run test:auth` (게임 화면에서 가입 → 로그아웃 → 로그인)
