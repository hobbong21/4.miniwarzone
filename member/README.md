# 회원가입 · 로그인 페이지

아주 심플한 정적 페이지입니다. 미니워존 서버에서 `/member/signup.html` · `/member/login.html`로 열리고, 파일을 직접 열어도 됩니다.

| 파일 | 역할 |
|---|---|
| `signup.html` | 회원가입 (4단계 표시 · 기본정보 표 · 아이디 중복검색) |
| `login.html` | 로그인 |
| `style.css` | 공통 스타일 (휴대폰 폭에서는 한 칸씩) |
| `auth.js` | 입력 검사 · 저장 · 로그인 |
| `test/e2e.mjs` | 헤드리스 Chrome으로 가입 → 로그인 흐름 검사 |

## 규칙
- 아이디: 6~20자 영문 소문자 + 숫자 조합, 중복검색 필수
- 비밀번호: 영문 · 숫자 · 특수문자(`!@#$%^&*`) 조합 6자리 이상, 확인 일치

## 저장 방식 (데모)
- 회원 정보는 그 브라우저의 `localStorage`(`member.users`)에만 저장됩니다. 다른 기기 · 다른 브라우저와 공유되지 않습니다
- 비밀번호와 힌트 답변은 SHA-256 해시로만 저장합니다. 실제 서비스에는 서버 쪽 저장과 솔트가 있는 해시(bcrypt 등)가 필요합니다
- 로그인 상태는 `sessionStorage`(`member.me`) — [로그아웃]을 누르거나 브라우저를 닫으면 풀립니다
- `crypto.subtle`이 없는 비보안 주소에서는 `auth.js`의 내장 SHA-256(`sha256js`)으로 같은 값을 계산합니다

## 테스트
```bash
npm run test:member                                          # 파일 직접 열기
BASE=http://127.0.0.1:8080/member npm run test:member        # 실행 중인 서버
BASE=http://127.0.0.1:8080/member LAN=1 npm run test:member  # 보안 연결이 아닌 주소 (대체 SHA-256)
```
Chrome 경로가 다르면 `CHROME=경로`.
