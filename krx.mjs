/* =====================================================================
 * KRX 전종목 시세 수집
 * ---------------------------------------------------------------------
 * 시장 전체를 한 번의 요청으로 가져옵니다. 종목별로 따로 조회하지 않기
 * 때문에 유니버스 선정(시총 순위)·종가·시가총액을 동시에 해결합니다.
 * ===================================================================== */

const KRX_URL = 'http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'Referer': 'http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020101',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
};

const num = s => {
  if (typeof s !== 'string') return null;
  const v = s.replace(/,/g, '').trim();
  if (!v || v === '-') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 직전 영업일 추정 — 주말이면 금요일로 되돌림 */
export function lastBusinessDay(d = new Date()) {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const day = kst.getUTCDay();
  if (day === 0) kst.setUTCDate(kst.getUTCDate() - 2);
  else if (day === 6) kst.setUTCDate(kst.getUTCDate() - 1);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

async function fetchMarket(mktId, trdDd) {
  const body = new URLSearchParams({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT01501',
    locale: 'ko_KR', mktId, trdDd,
    share: '1', money: '1', csvxls_isNo: 'false',
  });
  const res = await fetch(KRX_URL, { method: 'POST', headers: HEADERS, body });
  if (!res.ok) throw new Error(`KRX ${mktId} 응답 오류 ${res.status}`);
  const json = await res.json();
  const rows = json.OutBlock_1 || [];
  const market = mktId === 'STK' ? 'KOSPI' : 'KOSDAQ';

  return rows
    .filter(r => r.MKT_ID !== 'KNX')
    .map(r => ({
      code: (r.ISU_SRT_CD || '').trim(),
      name: (r.ISU_ABBRV || '').trim(),
      market,
      sector: (r.IDX_IND_NM || '').trim() || null,
      price: num(r.TDD_CLSPRC),
      changePct: num(r.FLUC_RT),
      marketCap: num(r.MKTCAP),
      shares: num(r.LIST_SHRS),
    }))
    .filter(x => x.code && x.price && x.marketCap);
}

/**
 * 전종목 시세를 가져와 시가총액 상위로 유니버스를 구성합니다.
 * KOSPI200·KOSDAQ150 지수 편입 종목 목록은 별도 구독 데이터라
 * 시가총액 상위 N개로 근사합니다. 실제 지수와 완전히 같지는 않지만
 * 대형주 중심이라는 성격은 동일하게 유지됩니다.
 */
export async function fetchUniverse({ kospiTop = 200, kosdaqTop = 150, trdDd = null } = {}) {
  const day = trdDd || lastBusinessDay();
  const [kospi, kosdaq] = await Promise.all([fetchMarket('STK', day), fetchMarket('KSQ', day)]);
  if (!kospi.length && !kosdaq.length)
    throw new Error(`KRX에서 ${day} 시세를 가져오지 못했습니다 (휴장일이거나 응답 형식이 바뀌었을 수 있습니다).`);

  const pick = (arr, n) => arr.slice().sort((a, b) => b.marketCap - a.marketCap).slice(0, n);
  const items = [...pick(kospi, kospiTop), ...pick(kosdaq, kosdaqTop)];
  return { trade_date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`, items };
}
