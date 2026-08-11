#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const KEY = process.env.DART_API_KEY;
const BASE = 'https://opendart.fss.or.kr/api';
const OUT = path.resolve('data/financials.json');
const UA = { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' };
const REPRT_CODE = '11011';
const BATCH = 100;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const toNum = s => {
  if (typeof s !== 'string') return null;
  const v = s.replace(/,/g, '').trim();
  if (!v || v === '-') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function fetchUniverse() {
  const KRX_URL = 'http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Referer': 'http://data.krx.co.kr/',
    'Accept': 'application/json, text/javascript, */*',
  };
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const day = kst.getUTCDay();
  if (day === 0) kst.setUTCDate(kst.getUTCDate() - 2);
  else if (day === 6) kst.setUTCDate(kst.getUTCDate() - 1);
  const trdDd = kst.toISOString().slice(0, 10).replace(/-/g, '');
  const items = [];
  for (const [mktId, market] of [['STK','KOSPI'],['KSQ','KOSDAQ']]) {
    const body = new URLSearchParams({ bld: 'dbms/MDC/STAT/standard/MDCSTAT01501', locale: 'ko_KR', mktId, trdDd, share: '1', money: '1', csvxls_isNo: 'false' });
    try {
      const res = await fetch(KRX_URL, { method: 'POST', headers: HEADERS, body });
      if (!res.ok) { console.warn(`  KRX ${market} ${res.status} — 건너뜀`); continue; }
      const json = await res.json();
      const rows = (json.OutBlock_1 || []).filter(r => r.MKT_ID !== 'KNX');
      for (const r of rows) {
        const cap = toNum(r.MKTCAP), price = toNum(r.TDD_CLSPRC);
        if (!r.ISU_SRT_CD || !price || !cap) continue;
        items.push({ code: r.ISU_SRT_CD.trim(), name: (r.ISU_ABBRV||'').trim(), market, sector: (r.IDX_IND_NM||'').trim()||null, price, changePct: toNum(r.FLUC_RT), marketCap: cap });
      }
      console.log(`  ${market}: ${rows.length}종목`);
    } catch(e) { console.warn(`  KRX ${market} 실패: ${e.message}`); }
  }
  if (!items.length) throw new Error('KRX 종목 없음');
  const kospi = items.filter(i=>i.market==='KOSPI').sort((a,b)=>b.marketCap-a.marketCap).slice(0,200);
  const kosdaq = items.filter(i=>i.market==='KOSDAQ').sort((a,b)=>b.marketCap-a.marketCap).slice(0,150);
  return { items: [...kospi,...kosdaq], trade_date: `${trdDd.slice(0,4)}-${trdDd.slice(4,6)}-${trdDd.slice(6,8)}` };
}

async function fetchCorpIndex() {
  const res = await fetch(`${BASE}/corpCode.xml?crtfc_key=${KEY}`, { headers: UA });
  if (!res.ok) throw new Error(`corpCode 오류 ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const method = buf.readUInt16LE(8);
  let xml;
  if (method === 0) {
    xml = buf.subarray(start).toString('utf8');
  } else {
    const { inflateRawSync } = await import('node:zlib');
    const cd = buf.lastIndexOf(Buffer.from('PK\x01\x02'));
    xml = inflateRawSync(buf.subarray(start, cd > start ? cd : undefined)).toString('utf8');
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
  if (!map.size) throw new Error('corpCode 파싱 결과 없음');
  return map;
}

const ACCOUNTS = {
  '매출액':'revenue','수익(매출액)':'revenue','영업수익':'revenue',
  '영업이익':'operating_income','영업이익(손실)':'operating_income',
  '당기순이익':'net_income','당기순이익(손실)':'net_income',
  '자산총계':'assets','부채총계':'liabilities','자본총계':'equity','자본금':'issued_capital',
};

async function fetchBatch(corpCodes, year, fsDiv) {
  const qs = new URLSearchParams({ crtfc_key: KEY, corp_code: corpCodes.join(','), bsns_year: String(year), reprt_code: REPRT_CODE, fs_div: fsDiv });
  const res = await fetch(`${BASE}/fnlttMultiAcnt.json?${qs}`, { headers: UA });
  if (!res.ok) throw new Error(`fnlttMultiAcnt 오류 ${res.status}`);
  const json = await res.json();
  if (json.status !== '000' && json.status !== '013') throw new Error(`DART ${json.status}: ${json.message}`);
  return json.list || [];
}

function absorb(store, row) {
  const field = ACCOUNTS[row.account_nm];
  if (!field) return;
  const corp = row.corp_code;
  const thisYear = Number(row.bsns_year);
  for (const [y, v] of [[thisYear, toNum(row.thstrm_amount)],[thisYear-1, toNum(row.frmtrm_amount)],[thisYear-2, toNum(row.bfefrmtrm_amount)]]) {
    if (v === null) continue;
    const byCorp = store.get(corp) || new Map();
    const yr = byCorp.get(y) || { year: y };
    if (yr[field] === undefined || yr[field] === null) yr[field] = v;
    byCorp.set(y, yr);
    store.set(corp, byCorp);
  }
}

async function main() {
  if (!KEY) throw new Error('DART_API_KEY 환경변수 없음');
  console.log('· 유니버스 구성 (KRX 전종목 시세)');
  const { items: universe, trade_date } = await fetchUniverse();
  console.log(`  → ${universe.length}종목 (기준일 ${trade_date})`);
  console.log('· 상장사 색인 내려받는 중');
  const corpIndex = await fetchCorpIndex();
  const targets = universe.map(u => ({ ...u, corp: corpIndex.get(u.code) })).filter(u => u.corp);
  console.log(`  → ${targets.length}종목 매핑 완료`);
  const nowYear = new Date().getFullYear();
  const years = [nowYear - 1, nowYear - 4];
  const store = new Map();
  let calls = 0;
  for (const fsDiv of ['CFS', 'OFS']) {
    for (const year of years) {
      for (let i = 0; i < targets.length; i += BATCH) {
        const chunk = targets.slice(i, i + BATCH);
        try {
          const rows = await fetchBatch(chunk.map(c => c.corp), year, fsDiv);
          rows.forEach(r => absorb(store, r));
          calls++;
          console.log(`  ${fsDiv} ${year} ${i+1}~${i+chunk.length} · ${rows.length}행`);
        } catch(e) { console.warn(`  ! ${fsDiv} ${year} 실패: ${e.message}`); }
        await sleep(250);
      }
    }
  }
  const out = {
    generated_at: new Date().toISOString(),
    source: 'DART 사업보고서',
    report_code: REPRT_CODE,
    api_calls: calls,
    companies: targets.map(t => {
      const byYear = store.get(t.corp);
      const yearsArr = byYear ? [...byYear.values()].sort((a,b)=>a.year-b.year) : [];
      return { code: t.code, name: t.name, corp_code: t.corp, years: yearsArr };
    }).filter(c => c.years.length),
  };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out));
  console.log(`\n완료 — ${out.companies.length}종목 · DART 호출 ${calls}회`);
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
