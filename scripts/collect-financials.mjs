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

// KOSPI200 + KOSDAQ150 주요 종목 하드코딩 (KRX API 대체)
const UNIVERSE = [
  {code:'005930',name:'삼성전자',market:'KOSPI',sector:'반도체'},
  {code:'000660',name:'SK하이닉스',market:'KOSPI',sector:'반도체'},
  {code:'005380',name:'현대차',market:'KOSPI',sector:'자동차'},
  {code:'000270',name:'기아',market:'KOSPI',sector:'자동차'},
  {code:'035420',name:'NAVER',market:'KOSPI',sector:'IT서비스'},
  {code:'035720',name:'카카오',market:'KOSPI',sector:'IT서비스'},
  {code:'207940',name:'삼성바이오로직스',market:'KOSPI',sector:'바이오'},
  {code:'068270',name:'셀트리온',market:'KOSPI',sector:'바이오'},
  {code:'051910',name:'LG화학',market:'KOSPI',sector:'화학'},
  {code:'006400',name:'삼성SDI',market:'KOSPI',sector:'2차전지'},
  {code:'247540',name:'에코프로비엠',market:'KOSDAQ',sector:'2차전지'},
  {code:'086520',name:'에코프로',market:'KOSDAQ',sector:'2차전지'},
  {code:'096770',name:'SK이노베이션',market:'KOSPI',sector:'화학'},
  {code:'034020',name:'두산에너빌리티',market:'KOSPI',sector:'기계'},
  {code:'015760',name:'한국전력',market:'KOSPI',sector:'에너지'},
  {code:'032830',name:'삼성생명',market:'KOSPI',sector:'금융'},
  {code:'055550',name:'신한지주',market:'KOSPI',sector:'금융'},
  {code:'105560',name:'KB금융',market:'KOSPI',sector:'금융'},
  {code:'086790',name:'하나금융지주',market:'KOSPI',sector:'금융'},
  {code:'316140',name:'우리금융지주',market:'KOSPI',sector:'금융'},
  {code:'003550',name:'LG',market:'KOSPI',sector:'지주'},
  {code:'066570',name:'LG전자',market:'KOSPI',sector:'가전'},
  {code:'009540',name:'HD한국조선해양',market:'KOSPI',sector:'조선'},
  {code:'010140',name:'삼성중공업',market:'KOSPI',sector:'조선'},
  {code:'042660',name:'한화오션',market:'KOSPI',sector:'조선'},
  {code:'011200',name:'HMM',market:'KOSPI',sector:'해운'},
  {code:'003490',name:'대한항공',market:'KOSPI',sector:'항공'},
  {code:'012330',name:'현대모비스',market:'KOSPI',sector:'자동차부품'},
  {code:'028260',name:'삼성물산',market:'KOSPI',sector:'건설'},
  {code:'000810',name:'삼성화재',market:'KOSPI',sector:'보험'},
  {code:'088350',name:'한화생명',market:'KOSPI',sector:'보험'},
  {code:'032640',name:'LG유플러스',market:'KOSPI',sector:'통신'},
  {code:'017670',name:'SK텔레콤',market:'KOSPI',sector:'통신'},
  {code:'030200',name:'KT',market:'KOSPI',sector:'통신'},
  {code:'011070',name:'LG이노텍',market:'KOSPI',sector:'전자부품'},
  {code:'009830',name:'한화솔루션',market:'KOSPI',sector:'화학'},
  {code:'010950',name:'S-Oil',market:'KOSPI',sector:'정유'},
  {code:'036460',name:'한국가스공사',market:'KOSPI',sector:'에너지'},
  {code:'000720',name:'현대건설',market:'KOSPI',sector:'건설'},
  {code:'047050',name:'포스코인터내셔널',market:'KOSPI',sector:'무역'},
  {code:'005490',name:'POSCO홀딩스',market:'KOSPI',sector:'철강'},
  {code:'004020',name:'현대제철',market:'KOSPI',sector:'철강'},
  {code:'034730',name:'SK',market:'KOSPI',sector:'지주'},
  {code:'018260',name:'삼성에스디에스',market:'KOSPI',sector:'IT서비스'},
  {code:'267250',name:'HD현대',market:'KOSPI',sector:'지주'},
  {code:'329180',name:'HD현대중공업',market:'KOSPI',sector:'조선'},
  {code:'006360',name:'GS건설',market:'KOSPI',sector:'건설'},
  {code:'011780',name:'금호석유',market:'KOSPI',sector:'화학'},
  {code:'021240',name:'코웨이',market:'KOSPI',sector:'가전'},
  {code:'000100',name:'유한양행',market:'KOSPI',sector:'제약'},
  {code:'128940',name:'한미약품',market:'KOSPI',sector:'제약'},
  {code:'326030',name:'SK바이오팜',market:'KOSPI',sector:'바이오'},
  {code:'293490',name:'카카오게임즈',market:'KOSDAQ',sector:'게임'},
  {code:'259960',name:'크래프톤',market:'KOSPI',sector:'게임'},
  {code:'112040',name:'위메이드',market:'KOSDAQ',sector:'게임'},
  {code:'036570',name:'엔씨소프트',market:'KOSPI',sector:'게임'},
  {code:'251270',name:'넷마블',market:'KOSPI',sector:'게임'},
  {code:'035900',name:'JYP Ent.',market:'KOSDAQ',sector:'엔터'},
  {code:'041510',name:'에스엠',market:'KOSPI',sector:'엔터'},
  {code:'352820',name:'하이브',market:'KOSPI',sector:'엔터'},
  {code:'122870',name:'와이지엔터테인먼트',market:'KOSDAQ',sector:'엔터'},
  {code:'196170',name:'알테오젠',market:'KOSDAQ',sector:'바이오'},
  {code:'091990',name:'셀트리온헬스케어',market:'KOSDAQ',sector:'바이오'},
  {code:'145020',name:'휴젤',market:'KOSDAQ',sector:'바이오'},
  {code:'214150',name:'클래시스',market:'KOSDAQ',sector:'의료기기'},
  {code:'226330',name:'신테카바이오',market:'KOSDAQ',sector:'바이오'},
  {code:'035510',name:'신세계I&C',market:'KOSDAQ',sector:'IT서비스'},
  {code:'035250',name:'강원랜드',market:'KOSPI',sector:'레저'},
  {code:'024110',name:'기업은행',market:'KOSPI',sector:'금융'},
  {code:'139480',name:'이마트',market:'KOSPI',sector:'유통'},
  {code:'004170',name:'신세계',market:'KOSPI',sector:'유통'},
  {code:'023530',name:'롯데쇼핑',market:'KOSPI',sector:'유통'},
  {code:'282330',name:'BGF리테일',market:'KOSPI',sector:'유통'},
  {code:'097950',name:'CJ제일제당',market:'KOSPI',sector:'식품'},
  {code:'003230',name:'삼양식품',market:'KOSPI',sector:'식품'},
  {code:'271560',name:'오리온',market:'KOSPI',sector:'식품'},
  {code:'000080',name:'하이트진로',market:'KOSPI',sector:'식음료'},
  {code:'009150',name:'삼성전기',market:'KOSPI',sector:'전자부품'},
  {code:'008770',name:'호텔신라',market:'KOSPI',sector:'여행'},
  {code:'047810',name:'한국항공우주',market:'KOSPI',sector:'방산'},
  {code:'012450',name:'한화에어로스페이스',market:'KOSPI',sector:'방산'},
  {code:'064350',name:'현대로템',market:'KOSPI',sector:'방산'},
  {code:'000150',name:'두산',market:'KOSPI',sector:'지주'},
  {code:'006800',name:'미래에셋증권',market:'KOSPI',sector:'증권'},
  {code:'071050',name:'한국금융지주',market:'KOSPI',sector:'증권'},
  {code:'377300',name:'카카오페이',market:'KOSPI',sector:'핀테크'},
  {code:'403550',name:'쏘카',market:'KOSDAQ',sector:'모빌리티'},
  {code:'357780',name:'솔브레인',market:'KOSDAQ',sector:'소재'},
  {code:'336370',name:'솔브레인홀딩스',market:'KOSDAQ',sector:'소재'},
  {code:'232140',name:'와이씨케이',market:'KOSDAQ',sector:'반도체'},
  {code:'058470',name:'리노공업',market:'KOSDAQ',sector:'반도체'},
  {code:'131970',name:'테크윙',market:'KOSDAQ',sector:'반도체장비'},
  {code:'079550',name:'LIG넥스원',market:'KOSPI',sector:'방산'},
  {code:'298040',name:'효성중공업',market:'KOSPI',sector:'전기'},
  {code:'010620',name:'HD현대미포',market:'KOSPI',sector:'조선'},
  {code:'175330',name:'JB금융지주',market:'KOSPI',sector:'금융'},
  {code:'138040',name:'메리츠금융지주',market:'KOSPI',sector:'금융'},
  {code:'192820',name:'코스맥스',market:'KOSPI',sector:'화장품'},
  {code:'090430',name:'아모레퍼시픽',market:'KOSPI',sector:'화장품'},
  {code:'051900',name:'LG생활건강',market:'KOSPI',sector:'화장품'},
];

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
  const universe = UNIVERSE;
  console.log(`· 유니버스: ${universe.length}종목 (하드코딩)`);
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
      return { code: t.code, name: t.name, corp_code: t.corp, market: t.market, sector: t.sector, years: yearsArr };
    }).filter(c => c.years.length),
  };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out));
  console.log(`\n완료 — ${out.companies.length}종목 · DART 호출 ${calls}회`);
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
