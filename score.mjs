/* =====================================================================
 * 한국주식 정밀분석 · 공용 채점 엔진
 * ---------------------------------------------------------------------
 * 이 파일이 점수 산출의 단일 기준입니다.
 * index.html(정밀분석 화면)과 build-scores.mjs(스크리너 배치)가
 * 모두 이 로직을 따라야 두 화면의 점수가 어긋나지 않습니다.
 * 임계값을 바꿀 때는 반드시 index.html의 동일 함수도 함께 수정하세요.
 * ===================================================================== */

export const isNil = v => v === null || v === undefined;
const round = (x, d = 0) => {
  if (isNil(x) || !Number.isFinite(x)) return null;
  const m = Math.pow(10, d);
  return Math.round(x * m) / m;
};
const clamp100 = x => Math.max(0, Math.min(100, x));

/* ---------- CAGR ---------- */
export function cagr(first, last, span) {
  if (isNil(first) || isNil(last) || !span || span <= 0) return null;
  if (first <= 0 || last <= 0) return null;          // 적자 구간은 정의 불가
  return round((Math.pow(last / first, 1 / span) - 1) * 100, 2);
}

/* ---------- 멀티플 ----------
 * 시가총액 기준으로 계산합니다.
 *   PER = 시가총액 / 당기순이익,  PBR = 시가총액 / 자본총계
 * 주당 기준(주가/EPS)과 수학적으로 동일하며,
 * 발행주식수를 종목마다 따로 조회하지 않아도 되어 배치 처리에 유리합니다.
 */
export function computeMultiples(marketCap, netIncome, equity) {
  const r = { per: null, pbr: null, per_note: null, pbr_note: null };
  if (isNil(marketCap) || marketCap <= 0) {
    r.per_note = r.pbr_note = '시가총액 없음';
    return r;
  }
  if (isNil(netIncome)) r.per_note = '순이익 없음';
  else if (netIncome <= 0) r.per_note = '적자 기업 — PER 정의 불가';
  else r.per = round(marketCap / netIncome, 2);

  if (isNil(equity)) r.pbr_note = '자본총계 없음';
  else if (equity <= 0) r.pbr_note = '자본잠식 — PBR 정의 불가';
  else r.pbr = round(marketCap / equity, 2);
  return r;
}

export function computeROE(netIncome, equity) {
  if (isNil(netIncome) || isNil(equity) || equity <= 0) return null;
  return round(netIncome / equity * 100, 2);
}

/* ---------- 지표별 점수 (0~100, 높을수록 가격 매력) ---------- */
export function scorePER(per, note) {
  if (note || isNil(per) || per <= 0) return { score: null, note: note || '산출 불가' };
  if (per <= 5) return { score: 100, note: '매우 저평가 구간' };
  const s = clamp100(100 - (per - 5) * 4);            // 5배→100점, 30배→0점
  return { score: round(s), note: per < 10 ? '저평가 구간' : (per <= 20 ? '평균 구간' : '고평가 구간') };
}
export function scorePBR(pbr, note) {
  if (note || isNil(pbr) || pbr <= 0) return { score: null, note: note || '산출 불가' };
  if (pbr <= 0.5) return { score: 100, note: '순자산 대비 크게 할인' };
  const s = clamp100(100 - (pbr - 0.5) * 40);         // 0.5배→100점, 3.0배→0점
  return { score: round(s), note: pbr < 1 ? '순자산 이하 거래' : (pbr <= 3 ? '평균 구간' : '고평가 구간') };
}
export function scoreROE(roe) {
  if (isNil(roe)) return { score: null, note: '산출 불가' };
  const s = clamp100(roe * 4);                        // 25%→100점, 0%→0점
  return {
    score: round(s),
    note: roe >= 15 ? '수익성 우수' : (roe >= 10 ? '수익성 양호' : (roe >= 5 ? '수익성 보통' : '수익성 미흡'))
  };
}
export function scoreGrowth(g) {
  if (isNil(g)) return { score: null, note: '산출 불가' };
  const s = clamp100((g + 20) * 2.5);                 // -20%→0점, +20%→100점
  return { score: round(s), note: g >= 10 ? '고성장' : (g > 0 ? '완만한 성장' : '역성장') };
}
export function scoreHistorical(price, low52, high52) {
  if (isNil(price) || isNil(low52) || isNil(high52) || high52 <= low52)
    return { score: null, note: '52주 밴드 데이터 부족', pos: null };
  const pos = (price - low52) / (high52 - low52) * 100;
  return { score: round(clamp100(100 - pos)), note: `52주 밴드 하단에서 ${Math.round(pos)}% 지점`, pos: round(pos) };
}

export const SCORE_WEIGHTS = { per: 25, pbr: 20, roe: 25, growth: 20, hist: 10 };

export function buildScorecard({ per, per_note, pbr, pbr_note, roe, growthPct, price, low52, high52 }) {
  const items = [
    { key: 'per',    label: 'PER (주가수익비율)',        ...scorePER(per, per_note) },
    { key: 'pbr',    label: 'PBR (주가순자산비율)',      ...scorePBR(pbr, pbr_note) },
    { key: 'roe',    label: 'ROE (자기자본이익률)',      ...scoreROE(roe) },
    { key: 'growth', label: '이익 성장률 (순이익 CAGR)', ...scoreGrowth(growthPct) },
    { key: 'hist',   label: '과거 밸류에이션 (52주 밴드)', ...scoreHistorical(price, low52, high52) },
  ];
  let wSum = 0, sSum = 0;
  for (const it of items) {
    const w = SCORE_WEIGHTS[it.key];
    if (!w || isNil(it.score)) continue;
    wSum += w; sSum += it.score * w;
  }
  const missing = items.filter(i => isNil(i.score)).map(i => i.key);
  return {
    items,
    total: wSum ? round(sSum / wSum) : null,
    covered: items.length - missing.length,
    missing
  };
}

/* ---------- 등급 구간 ---------- */
export const SCORE_BANDS = [
  { min: 80, label: '매우 매력적', key: 'S' },
  { min: 65, label: '매력적',     key: 'A' },
  { min: 50, label: '보통',       key: 'B' },
  { min: 35, label: '신중',       key: 'C' },
  { min: 0,  label: '관망',       key: 'D' },
];
export function gradeOf(total) {
  if (isNil(total)) return { label: '판단 불가', key: 'N' };
  return SCORE_BANDS.find(b => total >= b.min) || SCORE_BANDS[SCORE_BANDS.length - 1];
}

/* ---------- 매수/매도 후보 판정 ---------- */
export function detectSignal({ per, pbr, roe, growthPct, recentYoY }) {
  const have = v => !isNil(v);
  const slowing = have(recentYoY) && have(growthPct) ? recentYoY < growthPct : null;

  if (have(per) && have(pbr) && have(roe) && have(growthPct) &&
      per < 10 && pbr < 1 && roe >= 15 && growthPct > 0) {
    return { type: 'buy', title: '매수 후보 조건 충족' };
  }
  if (have(per) && have(pbr) && per > 20 && pbr > 3 && slowing === true) {
    return { type: 'sell', title: '매도 검토 조건 충족' };
  }
  return { type: 'neutral', title: '뚜렷한 매수·매도 신호 없음' };
}

/* ---------- 재무 적신호 (스크리너 축약판) ----------
 * 주요계정만으로 확인 가능한 항목만 검사합니다.
 * 이자보상배율·영업현금흐름 등은 전체 재무제표가 필요해
 * 스크리너에서는 «미확인»으로 남기고 정밀분석 화면에서 검사합니다.
 */
export const SCREENER_CHECKS = ['high_debt_ratio', 'capital_impairment', 'net_loss', 'operating_loss'];
export const DEBT_RATIO_LIMIT_PCT = 200;

export function evaluateFlags(f) {
  const flags = [], unchecked = [];
  const { liabilities, equity, issued_capital, net_income, operating_income } = f;

  if (!isNil(liabilities) && !isNil(equity) && equity > 0) {
    const dr = liabilities / equity * 100;
    if (dr > DEBT_RATIO_LIMIT_PCT)
      flags.push({ key: 'high_debt_ratio', desc: `부채비율 ${Math.round(dr)}% (200% 초과)` });
  } else unchecked.push('high_debt_ratio');

  if (!isNil(equity)) {
    if (equity <= 0 || (!isNil(issued_capital) && equity < issued_capital))
      flags.push({ key: 'capital_impairment', desc: '자본잠식 또는 자본잠식 근접' });
  } else unchecked.push('capital_impairment');

  if (!isNil(net_income)) {
    if (net_income < 0) flags.push({ key: 'net_loss', desc: '당기순손실' });
  } else unchecked.push('net_loss');

  if (!isNil(operating_income)) {
    if (operating_income < 0) flags.push({ key: 'operating_loss', desc: '영업손실' });
  } else unchecked.push('operating_loss');

  return { flags, unchecked, checked_count: SCREENER_CHECKS.length - unchecked.length };
}
