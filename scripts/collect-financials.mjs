#!/usr/bin/env node
/* =====================================================================
 * DART 연간 재무 수집 (분기 1회 실행)
 * ---------------------------------------------------------------------
 * 다중회사 주요계정 API(fnlttMultiAcnt)는 한 번에 100개 회사를,
 * 그리고 한 응답에 당기·전기·전전기 3개년을 함께 돌려줍니다.
 * 덕분에 350종목 6개년치를 20회 내외의 호출로 끝낼 수 있습니다.
 * (종목마다 따로 부르면 2,000회가 넘습니다)
 *
 * 실행: DART_API_KEY=... node scripts/collect-financials.mjs
 * 출력: data/financials.json
 * ===================================================================== */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchUniverse } from './krx.mjs';

const KEY = process.env.DART_API_KEY;
const BASE = 'https://opendart.fss.or.kr/api';
const OUT = path.resolve('data/financials.json');
const UA = { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' };

/* 사업보고서 기준 최근 2개 회계연도를 요청하면 각각 3개년을 주므로
 * 최대 6개년이 확보됩니다. 성장률(CAGR) 계산에 충분합니다. */
const REPORT_YEARS = 2;
const REPRT_CODE = '11011';   // 사업보고서
const BATCH = 100;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const toNum = s => {
  if (typeof s !== 'string') return null;
  const v = s.replace(/,/g, '').trim();
  if (!v || v === '-') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ---------- 1) 상장사 색인: 종목코드 → 고유번호 ---------- */
async function fetchCorpIndex() {
  const res = await fetch(`${BASE}/corpCode.xml?crtfc_key=${KEY}`, { headers: UA });
  if (!res.ok) throw new Error(`corpCode 응답 오류 ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  // corpCode.xml은 ZIP으로 내려옵니다. 압축을 풀어야 XML이 나옵니다.
  const { unzipSync } = await import('node:zlib');
  let xml;
  const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const method = buf.readUInt16LE(8);
  if (method === 0) {
    xml = buf.subarray(start).toString('utf8');
  } else {
    // 중앙 디렉터리 앞까지가 압축 데이터
    const cd = buf.lastIndexOf(Buffer.from('PK\x01\x02'));
    xml = unzipSync(buf.subarray(start, cd > start ? cd : undefined)).toString('utf8');
  }

  const map = new Map();
  const re = /<list>([\s\S]*?)<\/list>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const corp = (block.match(/<corp_code>(.*?)<\/corp_code>/) || [])[1];
    const stock = (block.match(/<stock_code>(.*?)<\/stock_code>/) || [])[1];
    if (corp && stock && stock.trim()) map.set(stock.trim(), corp.trim());
  }
  if (!map.size) throw new Error('corpCode.xml 파싱 결과가 비어 있습니다.');
  return map;
}

/* ---------- 2) 다중회사 주요계정 ---------- */
const ACCOUNTS = {
  '매출액': 'revenue', '수익(매출액)': 'revenue', '영업수익': 'revenue',
  '영업이익': 'operating_income', '영업이익(손실)': 'operating_income',
  '당기순이익': 'net_income', '당기순이익(손실)': 'net_income',
  '자산총계': 'assets', '부채총계': 'liabilities', '자본총계': 'equity', '자본금': 'issued_capital',
};

async function fetchBatch(corpCodes, year, fsDiv) {
  const qs = new URLSearchParams({
    crtfc_key: KEY, corp_code: corpCodes.join(','),
    bsns_year: String(year), reprt_code: REPRT_CODE, fs_div: fsDiv,
  });
  const res = await fetch(`${BASE}/fnlttMultiAcnt.json?${qs}`, { headers: UA });
  if (!res.ok) throw new Error(`fnlttMultiAcnt 응답 오류 ${res.status}`);
  const json = await res.json();
  // status 013 = 조회 데이터 없음 (해당 연도 미제출 등) — 오류가 아닙니다
  if (json.status !== '000' && json.status !== '013')
    throw new Error(`DART 오류 ${json.status}: ${json.message}`);
  return json.list || [];
}

/** 응답 한 줄에는 당기·전기·전전기가 함께 들어 있습니다 */
function absorb(store, row) {
  const field = ACCOUNTS[row.account_nm];
  if (!field) return;
  const corp = row.corp_code;
  const thisYear = Number(row.bsns_year);
  const cols = [
    [thisYear,     toNum(row.thstrm_amount)],
    [thisYear - 1, toNum(row.frmtrm_amount)],
    [thisYear - 2, toNum(row.bfefrmtrm_amount)],
  ];
  for (const [y, v] of cols) {
    if (v === null) continue;
    const byCorp = store.get(corp) || new Map();
    const yr = byCorp.get(y) || { year: y, fs_div: row.fs_div || null };
    if (yr[field] === undefined || yr[field] === null) yr[field] = v;
    byCorp.set(y, yr);
    store.set(corp, byCorp);
  }
}

/* ---------- 실행 ---------- */
async function main() {
  if (!KEY) throw new Error('DART_API_KEY 환경변수가 없습니다.');

console.log('· 유니버스 구성 (KRX 전종목 시세)');
// 임시: KRX API 400 에러 우회
const universe = [
  { code: '005930', name: '삼성전자', market: 'KOSPI', sector: '반도체', price: 70000, changePct: 1.5, marketCap: 420000000000000, shares: 6000000000 },
  { code: '000660', name: 'SK하이닉스', market: 'KOSPI', sector: '반도체', price: 110000, changePct: -0.5, marketCap: 85000000000000, shares: 772727273 },
];
const trade_date = new Date().toISOString().slice(0, 10);
console.log(`  → ${universe.length}종목 (기준일 ${trade_date}) [임시]`);

  console.log('· 상장사 색인 내려받는 중');
  const corpIndex = await fetchCorpIndex();
  const targets = universe
    .map(u => ({ ...u, corp: corpIndex.get(u.code) }))
    .filter(u => u.corp);
  console.log(`  → 고유번호 확인 ${targets.length}종목`);

  const nowYear = new Date().getFullYear();
  const years = Array.from({ length: REPORT_YEARS }, (_, i) => nowYear - 1 - i * 3);
  const store = new Map();
  let calls = 0;

  for (const fsDiv of ['CFS', 'OFS']) {           // 연결 우선, 없으면 별도로 보완
    for (const year of years) {
      for (let i = 0; i < targets.length; i += BATCH) {
        const chunk = targets.slice(i, i + BATCH);
        try {
          const rows = await fetchBatch(chunk.map(c => c.corp), year, fsDiv);
          rows.forEach(r => absorb(store, r));
          calls++;
          console.log(`  ${fsDiv} ${year} ${i + 1}~${i + chunk.length} · ${rows.length}행`);
        } catch (e) {
          console.warn(`  ! ${fsDiv} ${year} 배치 실패: ${e.message}`);
        }
        await sleep(250);                          // DART 부하 배려
      }
    }
  }

  const out = {
    generated_at: new Date().toISOString(),
    source: 'DART 사업보고서 · 다중회사 주요계정',
    report_code: REPRT_CODE,
    api_calls: calls,
    companies: targets.map(t => {
      const byYear = store.get(t.corp);
      const yearsArr = byYear
        ? [...byYear.values()].sort((a, b) => a.year - b.year)
        : [];
      return { code: t.code, name: t.name, corp_code: t.corp, years: yearsArr };
    }).filter(c => c.years.length),
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out));
  console.log(`\n완료 — ${out.companies.length}종목 · DART 호출 ${calls}회 · ${OUT}`);
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
