#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  isNil, cagr, computeMultiples, computeROE,
  buildScorecard, gradeOf, detectSignal, evaluateFlags,
} from '../score.mjs';

const FIN = path.resolve('data/financials.json');
const OUT = path.resolve('data/scores.json');
const CONCURRENCY = 6;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetch52w(code, market) {
  const suffix = market === 'KOSDAQ' ? '.KQ' : '.KS';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}${suffix}?range=1y&interval=1d`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return { low52: null, high52: null, price: null, changePct: null, marketCap: null };
    const j = await res.json();
    const q = j?.chart?.result?.[0]?.indicators?.quote?.[0] || {};
    const meta = j?.chart?.result?.[0]?.meta || {};
    const highs = (q.high || []).filter(Number.isFinite);
    const lows = (q.low || []).filter(Number.isFinite);
    return {
      high52: highs.length ? Math.max(...highs) : (meta.fiftyTwoWeekHigh ?? null),
      low52: lows.length ? Math.min(...lows) : (meta.fiftyTwoWeekLow ?? null),
      price: meta.regularMarketPrice ?? null,
      changePct: meta.regularMarketChangePercent ?? null,
      marketCap: meta.marketCap ?? null,
    };
  } catch { return { low52: null, high52: null, price: null, changePct: null, marketCap: null }; }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
      await sleep(150);
    }
  }));
  return out;
}

function digest(years) {
  const usable = years.filter(y => !isNil(y.net_income) || !isNil(y.equity));
  if (!usable.length) return null;
  const last = usable[usable.length - 1];
  const first = usable[0];
  const span = last.year - first.year;
  const prev = usable.length >= 2 ? usable[usable.length - 2] : null;
  const growthPct = cagr(first.net_income, last.net_income, span);
  const recentYoY = (prev && !isNil(prev.net_income) && prev.net_income > 0 && !isNil(last.net_income))
    ? Number(((last.net_income / prev.net_income - 1) * 100).toFixed(2)) : null;
  return { last, first, span, growthPct, recentYoY, fin_year: last.year };
}

async function main() {
  const fin = JSON.parse(await fs.readFile(FIN, 'utf8'));
  const finByCode = new Map(fin.companies.map(c => [c.code, c]));
  console.log(`· 재무 데이터 ${finByCode.size}종목 로드`);
  const targets = [...finByCode.values()];
  console.log(`· Yahoo Finance 시세+52주 밴드 조회 (${targets.length}종목)`);
  const quotes = await mapLimit(targets, CONCURRENCY, u => fetch52w(u.code, u.market || 'KOSPI'));
  const today = new Date().toISOString().slice(0, 10);

  const items = targets.map((co, idx) => {
    const d = digest(co.years);
    if (!d) return null;
    const { last, growthPct, recentYoY, fin_year, span } = d;
    const q = quotes[idx];
    if (!q.price || !q.marketCap) return null;
    const mult = computeMultiples(q.marketCap, last.net_income, last.equity);
    const roe = computeROE(last.net_income, last.equity);
    const card = buildScorecard({ per: mult.per, per_note: mult.per_note, pbr: mult.pbr, pbr_note: mult.pbr_note, roe, growthPct, price: q.price, low52: q.low52, high52: q.high52 });
    const grade = gradeOf(card.total);
    const sig = detectSignal({ per: mult.per, pbr: mult.pbr, roe, growthPct, recentYoY });
    const fl = evaluateFlags(last);
    const sc = {};
    for (const it of card.items) if (!isNil(it.score)) sc[it.key] = it.score;
    return {
      t: co.code, n: co.name, m: co.market || 'KOSPI', sec: co.sector || null,
      p: q.price, chg: q.changePct, cap: q.marketCap,
      per: mult.per, pbr: mult.pbr, roe, cagr: growthPct, yoy: recentYoY,
      band: card.items.find(i => i.key === 'hist')?.pos ?? null,
      sc, total: card.total, grade: grade.key, sig: sig.type,
      flags: fl.flags.map(f => f.desc), miss: card.missing, fy: fin_year, fspan: span,
    };
  }).filter(Boolean);

  items.sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  const out = { as_of: today, fin_as_of: fin.generated_at.slice(0, 10), fin_report: 'DART 사업보고서', universe: `주요 상장사 ${items.length}종목`, count: items.length, items };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out));
  const dist = {};
  for (const i of items) dist[i.grade] = (dist[i.grade] || 0) + 1;
  console.log(`\n완료 — ${items.length}종목`);
  console.log('등급 분포:', dist);
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
