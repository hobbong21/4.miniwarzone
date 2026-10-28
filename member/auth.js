// 서버 없이 브라우저(localStorage)에 회원 정보를 저장하는 간단한 데모
const KEY = 'member.users';
const $ = id => document.getElementById(id);
const users = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const saveUsers = u => localStorage.setItem(KEY, JSON.stringify(u));
async function hash(s) {   // 비밀번호는 SHA-256 해시로만 저장
  const data = new TextEncoder().encode(s);
  if (!window.crypto || !crypto.subtle) return sha256js(data);   // http://(서버 IP) 처럼 보안 연결이 아니면 crypto.subtle이 없음
  const b = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function sha256js(bytes) {   // crypto.subtle이 없을 때 쓰는 SHA-256 (같은 결과)
  const K = [], H = [], isP = n => { for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; }, frac = x => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
  for (let n = 2, i = 0; i < 64; n++) if (isP(n)) { if (i < 8) H[i] = frac(n ** 0.5); K[i++] = frac(n ** (1 / 3)); }
  const L = bytes.length, m = new Uint8Array(((L + 9 + 63) >> 6) << 6); m.set(bytes); m[L] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(m.length - 4, L * 8); dv.setUint32(m.length - 8, Math.floor(L / 2 ** 29));
  const W = new Uint32Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < m.length; o += 64) {
    for (let t = 0; t < 64; t++) W[t] = t < 16 ? dv.getUint32(o + t * 4) : (r(W[t - 2], 17) ^ r(W[t - 2], 19) ^ (W[t - 2] >>> 10)) + W[t - 7] + (r(W[t - 15], 7) ^ r(W[t - 15], 18) ^ (W[t - 15] >>> 3)) + W[t - 16];
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const t1 = h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t], t2 = (r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
  }
  return H.map(v => v.toString(16).padStart(8, '0')).join('');
}
const ID_RE = /^(?=.*[a-z])(?=.*\d)[a-z\d]{6,20}$/;   // 6~20자 영문 소문자 + 숫자 조합
const PW_RE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*]).{6,}$/;   // 영문 · 숫자 · 특수문자 6자리 이상
function say(el, text, ok) { el.textContent = text; el.className = (el.classList.contains('msg') ? 'msg ' : 'hint ') + (ok ? 'ok' : 'err'); }

// ---- 회원가입
if ($('signup')) {
  let checkedId = null;
  $('uid').oninput = () => { checkedId = null; $('uidMsg').className = 'hint'; $('uidMsg').textContent = '* 6자이상 20자이하 영문(소문자)/숫자 조합으로 작성, * 한글 아이디 사용불가'; };
  $('dup').onclick = () => {
    const id = $('uid').value.trim();
    if (!ID_RE.test(id)) return say($('uidMsg'), '아이디 형식을 확인해 주세요 (6~20자 영문 소문자 + 숫자)');
    if (users()[id]) return say($('uidMsg'), '이미 사용 중인 아이디입니다');
    checkedId = id; say($('uidMsg'), '등록이 가능합니다.', true);
  };
  $('mailSel').onchange = () => { if ($('mailSel').value) $('mail2').value = $('mailSel').value; $('mail2').readOnly = !!$('mailSel').value; };
  $('zipBtn').onclick = () => $('zip').focus();
  $('signup').onsubmit = async e => {
    e.preventDefault();
    const v = id => $(id).value.trim(), msg = $('msg');
    for (const el of document.querySelectorAll('.bad')) el.classList.remove('bad');
    const need = ['uid', 'pw', 'pw2', 'hintA', 'name', 'birth', 'm1', 'm2', 'm3', 'mail1', 'mail2'].filter(id => !v(id));
    if (need.length) { need.forEach(id => $(id).classList.add('bad')); return say(msg, '필수 항목을 모두 입력해 주세요'); }
    if (checkedId !== v('uid')) return say(msg, '아이디 중복검색을 해 주세요');
    if (!PW_RE.test(v('pw'))) { $('pw').classList.add('bad'); return say(msg, '비밀번호는 영문 · 숫자 · 특수문자 조합 6자리 이상입니다'); }
    if (v('pw') !== v('pw2')) { $('pw2').classList.add('bad'); return say(msg, '비밀번호 확인이 일치하지 않습니다'); }
    const u = users();
    u[v('uid')] = { pw: await hash(v('pw')), hintQ: v('hintQ'), hintA: await hash(v('hintA')), name: v('name'),
      gender: document.querySelector('[name=gender]:checked').value, birth: v('birth'), cal: document.querySelector('[name=cal]:checked').value,
      tel: [v('t1'), v('t2'), v('t3')].join('-'), mobile: [v('m1'), v('m2'), v('m3')].join('-'), email: v('mail1') + '@' + v('mail2'),
      zip: v('zip'), addr: v('addr'), joined: Date.now() };
    saveUsers(u);
    say(msg, '회원가입이 완료되었습니다. 로그인 화면으로 이동합니다', true);
    document.querySelectorAll('.steps div').forEach((d, i) => d.classList.toggle('on', i === 3));
    setTimeout(() => location.href = 'login.html?id=' + encodeURIComponent(v('uid')), 1200);
  };
}

// ---- 로그인
if ($('login')) {
  const q = new URLSearchParams(location.search).get('id'); if (q) { $('lid').value = q; $('lpw').focus(); }
  const show = (on, text) => {   // 로그인 중이면 입력칸 대신 인사말 + 로그아웃 버튼
    $('loginBox').hidden = on; $('logout').hidden = !on;
    if (text) say($('lmsg'), text, true); else $('lmsg').textContent = '';
  };
  const cur = sessionStorage.getItem('member.me');
  if (cur && users()[cur]) show(true, `${users()[cur].name}님, 로그인 중입니다`);
  $('login').onsubmit = async e => {
    e.preventDefault();
    const id = $('lid').value.trim(), u = users()[id];
    if (!id || !$('lpw').value) return say($('lmsg'), '아이디와 비밀번호를 입력해 주세요');
    if (!u || u.pw !== await hash($('lpw').value)) return say($('lmsg'), '아이디 또는 비밀번호가 올바르지 않습니다');
    sessionStorage.setItem('member.me', id);
    $('lpw').value = ''; show(true, `${u.name}님, 환영합니다!`);
  };
  $('logout').onclick = () => {
    sessionStorage.removeItem('member.me');
    show(false, '로그아웃되었습니다'); $('lpw').focus();
  };
}
