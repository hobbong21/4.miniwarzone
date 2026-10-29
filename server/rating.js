// PVP 레이팅 (Elo) · 시즌
'use strict';
const START = 1000, K = 32;
const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));
// score: 1 = 승, 0.5 = 무, 0 = 패 (a 기준). 결과는 정수 변화량 [da, db]
function elo(a, b, score) {
  const da = Math.round(K * (score - expected(a, b)));
  return [da, -da];
}
// 새 시즌 시작 점수: 지난 시즌 점수를 1000 쪽으로 절반 당김 (클라이언트 규칙과 같음)
const carry = prev => prev == null ? START : Math.round((prev + START) / 2);
module.exports = { START, K, elo, expected, carry };
