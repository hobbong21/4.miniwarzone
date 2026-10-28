// SQLite 저장소 (Node 내장 node:sqlite · 외부 패키지 없음)
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { sha256, token, recoveryCode, normCode, seasonId } = require('./util');
const R = require('./rating');

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, nation TEXT NOT NULL, code_hash TEXT UNIQUE,
      xp INTEGER NOT NULL DEFAULT 0, best_score INTEGER NOT NULL DEFAULT 0, regions INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL, last_seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created INTEGER NOT NULL, last_used INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_acc ON sessions(account_id);
    CREATE TABLE IF NOT EXISTS saves (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      rev INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ratings (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, season TEXT NOT NULL,
      rating INTEGER NOT NULL, peak INTEGER NOT NULL, w INTEGER NOT NULL DEFAULT 0, l INTEGER NOT NULL DEFAULT 0, d INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, season));
    CREATE INDEX IF NOT EXISTS ratings_rank ON ratings(season, rating DESC);
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY, season TEXT NOT NULL, host_id TEXT, guest_id TEXT, map TEXT NOT NULL, rated INTEGER NOT NULL,
      started INTEGER NOT NULL, ended INTEGER, result TEXT, host_delta INTEGER, guest_delta INTEGER);
  `);
  const q = sql => db.prepare(sql);
  const now = () => Date.now();
  const S = {
    insAcc: q('INSERT INTO accounts (id, name, nation, code_hash, created, last_seen) VALUES (?, ?, ?, ?, ?, ?)'),
    insSess: q('INSERT INTO sessions (token_hash, account_id, created, last_used) VALUES (?, ?, ?, ?)'),
    bySess: q('SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?'),
    touchSess: q('UPDATE sessions SET last_used = ? WHERE token_hash = ?'),
    touchAcc: q('UPDATE accounts SET last_seen = ? WHERE id = ?'),
    byCode: q('SELECT * FROM accounts WHERE code_hash = ?'),
    setCode: q('UPDATE accounts SET code_hash = ? WHERE id = ?'),
    setProfile: q('UPDATE accounts SET name = ?, nation = ? WHERE id = ?'),
    setStats: q('UPDATE accounts SET xp = ?, best_score = ?, regions = ? WHERE id = ?'),
    delAcc: q('DELETE FROM accounts WHERE id = ?'),
    anonMatchH: q('UPDATE matches SET host_id = NULL WHERE host_id = ?'), anonMatchG: q('UPDATE matches SET guest_id = NULL WHERE guest_id = ?'),
    getSave: q('SELECT rev, data, updated FROM saves WHERE account_id = ?'),
    putSave: q('INSERT INTO saves (account_id, rev, data, updated) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET rev = excluded.rev, data = excluded.data, updated = excluded.updated'),
    getRating: q('SELECT * FROM ratings WHERE account_id = ? AND season = ?'),
    prevRating: q('SELECT rating FROM ratings WHERE account_id = ? AND season < ? ORDER BY season DESC LIMIT 1'),
    insRating: q('INSERT INTO ratings (account_id, season, rating, peak) VALUES (?, ?, ?, ?)'),
    updRating: q('UPDATE ratings SET rating = ?, peak = MAX(peak, ?), w = w + ?, l = l + ?, d = d + ? WHERE account_id = ? AND season = ?'),
    insMatch: q('INSERT INTO matches (id, season, host_id, guest_id, map, rated, started) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    endMatch: q('UPDATE matches SET ended = ?, result = ?, host_delta = ?, guest_delta = ? WHERE id = ? AND ended IS NULL'),
    lbPvp: q(`SELECT a.name, a.nation, r.rating AS value, r.w, r.l, r.d FROM ratings r JOIN accounts a ON a.id = r.account_id
              WHERE r.season = ? AND (r.w + r.l + r.d) > 0 ORDER BY r.rating DESC, r.w DESC LIMIT ?`),
    lbXp: q('SELECT name, nation, xp AS value FROM accounts WHERE xp > 0 ORDER BY xp DESC, created LIMIT ?'),
    lbScore: q('SELECT name, nation, best_score AS value FROM accounts WHERE best_score > 0 ORDER BY best_score DESC, created LIMIT ?'),
    lbRegions: q('SELECT name, nation, regions AS value FROM accounts WHERE regions > 0 ORDER BY regions DESC, created LIMIT ?'),
    counts: q('SELECT (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM matches) AS matches'),
  };
  const tx = fn => (...a) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(...a); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  const api = {
    raw: db,
    close: () => db.close(),
    counts: () => S.counts.get(),
    // 계정: 이메일·비밀번호 없이 만듦 → 접속 토큰(이 기기) + 복구 코드(다른 기기용)를 한 번만 돌려줌. DB에는 해시만 저장
    createAccount: tx((name, nation) => {
      const id = token(12), t = token(), code = recoveryCode(), n = now();
      S.insAcc.run(id, name, nation, sha256(normCode(code)), n, n); S.insSess.run(sha256(t), id, n, n);
      return { id, token: t, code };
    }),
    auth(t) {
      if (!t || t.length > 100) return null;
      const h = sha256(t), a = S.bySess.get(h); if (!a) return null;
      const n = now(); if (n - a.last_seen > 60e3) { S.touchSess.run(n, h); S.touchAcc.run(n, a.id); }
      return a;
    },
    recover: tx(code => {   // 복구 코드 → 새 세션 토큰 (기존 기기 세션은 그대로)
      const a = S.byCode.get(sha256(normCode(code))); if (!a) return null;
      const t = token(), n = now(); S.insSess.run(sha256(t), a.id, n, n); S.touchAcc.run(n, a.id);
      return { account: a, token: t };
    }),
    newCode(id) { const code = recoveryCode(); S.setCode.run(sha256(normCode(code)), id); return code; },
    setProfile: (id, name, nation) => S.setProfile.run(name, nation, id),
    deleteAccount: tx(id => { S.anonMatchH.run(id); S.anonMatchG.run(id); S.delAcc.run(id); }),
    getSave(id) { return S.getSave.get(id) || null; },
    // 낙관적 잠금: 클라이언트가 가진 rev와 서버 rev가 같을 때만 저장 (다르면 충돌 → 서버 사본 반환)
    putSave: tx((id, baseRev, data, stats) => {
      const cur = S.getSave.get(id);
      if (cur && cur.rev !== baseRev) return { conflict: true, cur };
      const rev = (cur ? cur.rev : 0) + 1, n = now();
      S.putSave.run(id, rev, data, n);
      if (stats) S.setStats.run(stats.xp, stats.bestScore, stats.regions, id);
      return { rev, updated: n };
    }),
    rating(id, season = seasonId()) {
      let r = S.getRating.get(id, season);
      if (!r) { const p = S.prevRating.get(id, season); const start = R.carry(p ? p.rating : null); S.insRating.run(id, season, start, start); r = S.getRating.get(id, season); }
      return r;
    },
    startMatch(id, hostId, guestId, map, rated) { S.insMatch.run(id, seasonId(), hostId, guestId, map, rated ? 1 : 0, now()); },
    // 결과 반영: result = 'host' | 'guest' | 'draw' | 'void'. 순위전이면 두 계정 레이팅을 한 번에 갱신
    finishMatch: tx((m, result) => {
      let hd = null, gd = null;
      if (m.rated && result !== 'void' && m.hostId && m.guestId) {
        const season = seasonId(), h = api.rating(m.hostId, season), g = api.rating(m.guestId, season);
        const sc = result === 'host' ? 1 : result === 'guest' ? 0 : 0.5;
        [hd, gd] = R.elo(h.rating, g.rating, sc);
        const hn = Math.max(0, h.rating + hd), gn = Math.max(0, g.rating + gd);
        S.updRating.run(hn, hn, +(sc === 1), +(sc === 0), +(sc === 0.5), m.hostId, season);
        S.updRating.run(gn, gn, +(sc === 0), +(sc === 1), +(sc === 0.5), m.guestId, season);
      }
      S.endMatch.run(now(), result, hd, gd, m.id);
      return { hostDelta: hd, guestDelta: gd };
    }),
    leaderboard(type, limit = 50, season = seasonId()) {
      const rows = type === 'pvp' ? S.lbPvp.all(season, limit) : type === 'xp' ? S.lbXp.all(limit) : type === 'score' ? S.lbScore.all(limit) : type === 'regions' ? S.lbRegions.all(limit) : null;
      return rows && rows.map((r, i) => ({ rank: i + 1, ...r }));
    },
  };
  return api;
}
module.exports = { open };
