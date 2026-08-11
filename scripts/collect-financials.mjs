#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('data/financials.json');

// 샘플 데이터: 삼성전자, SK하이닉스, NAVER 등 주요 상장사
const sampleCompanies = [
  { code: '005930', name: '삼성전자', years: [
    { year: 2025, net_income: 6500000000000, equity: 210000000000000, assets: 380000000000000, liabilities: 170000000000000, issued_capital: 10000000000000, revenue: 250000000000000, operating_income: 9000000000000 },
    { year: 2024, net_income: 6000000000000, equity: 200000000000000, assets: 360000000000000, liabilities: 160000000000000, issued_capital: 10000000000000, revenue: 240000000000000, operating_income: 8500000000000 },
    { year: 2023, net_income: 5500000000000, equity: 190000000000000, assets: 340000000000000, liabilities: 150000000000000, issued_capital: 10000000000000, revenue: 230000000000000, operating_income: 8000000000000 },
  ]},
  { code: '000660', name: 'SK하이닉스', years: [
    { year: 2025, net_income: 2800000000000, equity: 28000000000000, assets: 88000000000000, liabilities: 60000000000000, issued_capital: 770000000000, revenue: 55000000000000, operating_income: 3500000000000 },
    { year: 2024, net_income: 2200000000000, equity: 26000000000000, assets: 85000000000000, liabilities: 59000000000000, issued_capital: 770000000000, revenue: 52000000000000, operating_income: 3000000000000 },
    { year: 2023, net_income: 1800000000000, equity: 24000000000000, assets: 82000000000000, liabilities: 58000000000000, issued_capital: 770000000000, revenue: 50000000000000, operating_income: 2500000000000 },
  ]},
  { code: '035720', name: 'NAVER', years: [
    { year: 2025, net_income: 980000000000, equity: 8900000000000, assets: 15000000000000, liabilities: 6100000000000, issued_capital: 140000000000, revenue: 9000000000000, operating_income: 1200000000000 },
    { year: 2024, net_income: 850000000000, equity: 8200000000000, assets: 14000000000000, liabilities: 5800000000000, issued_capital: 140000000000, revenue: 8500000000000, operating_income: 1000000000000 },
    { year: 2023, net_income: 720000000000, equity: 7600000000000, assets: 13000000000000, liabilities: 5400000000000, issued_capital: 140000000000, revenue: 8000000000000, operating_income: 900000000000 },
  ]},
];

const out = {
  generated_at: new Date().toISOString(),
  source: 'Sample Data (DART integration pending)',
  report_code: '11011',
  api_calls: 0,
  companies: sampleCompanies.map(c => ({ code: c.code, name: c.name, corp_code: c.code, years: c.years })),
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(out));
console.log(`\n완료 — ${out.companies.length}종목 (샘플) · ${OUT}`);
