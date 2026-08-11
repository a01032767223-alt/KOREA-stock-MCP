/* =====================================================================
 * 한국주식 정밀분석 · 공용 채점 엔진
 * ===================================================================== */

export const isNil = v => v === null || v === undefined;
const round = (x, d = 0) => {
  if (isNil(x) || !Number.isFinite(x)) return null;
  const m = Math.pow(10, d);
  return Math.round(x * m) / m;
};
const clamp100 = x => Math.max(0, Math.min(100, x));

export function cagr(first, last, span) {
  if (isNil(first) || isNil(last) || !span || span <= 0) return null;
  if (first <= 0 || last <= 0) return null;
  return round((Math.pow(last / first, 1 / span) - 1) * 100, 2);
}

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

export function scorePER(per, note) {
  if (note || isNil(per) || per <= 0) return { score: null, note: note || '산출 불가' };
  if (per <= 5) return { score: 100, note: '매우 저평가 구간' };
  const s = clamp100(100 - (per - 5) * 4);
  return { score: round(s), note: per < 10 ? '저평가 구간' : (per <= 20 ? '평균 구간' : '고평가 구간') };
}
export function scorePBR(pbr, note) {
  if (note || isNil(pbr) || pbr <= 0) return { score: null, note: note || '산출 불가' };
  if (pbr <= 0.5) return { score: 100, note: '순자산 대비 크게 할인' };
  const s = clamp100(100 - (pbr - 0.5) * 40);
  return { score: round(s), note: pbr < 1 ? '순자산 이하 거래' : (pbr <= 3 ? '평균 구간' : '고평가 구간') };
}
export function scoreROE(roe) {
  if (isNil(roe)) return { score: null, note: '산출 불가' };
  const s = clamp100(roe * 4);
  return {
    score: round(s),
    note: roe >= 15 ? '수익성 우수' : (roe >= 10 ? '수익성 양호' : (roe >= 5 ? '수익성 보통' : '수익성 미흡'))
  };
}
export function scoreGrowth(g) {
  if (isNil(g)) return { score: null, note: '산출 불가' };
  const s = clamp100((g + 20) * 2.5);
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
    { key: 'per',    label: 'PER (주가수익비율)',          ...scorePER(per, per_note) },
    { key: 'pbr',    label: 'PBR (주가순자산비율)',        ...scorePBR(pbr, pbr_note) },
    { key: 'roe',    label: 'ROE (자기자본이익률)',        ...scoreROE(roe) },
    { key: 'growth', label: '이익 성장률 (순이익 CAGR)',   ...scoreGrowth(growthPct) },
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

export const SCORE_BANDS = [
  { min: 80, label: '매우 매력적', key: 'S' },
  { min: 65, label: '매력적',     key: 'A' },
  { min: 50, label: '보통',       key: 'B' },
  { min: 35, label: '신중',       key: 'C' },
  { min:
