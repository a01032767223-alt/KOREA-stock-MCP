/* =====================================================================
 * ksa-proxy — 한국주식 분석기용 Cloudflare Worker
 *
 * 왜 필요한가: DART·KRX·야후는 브라우저에 CORS 허용 헤더를 주지 않는다.
 * GitHub Pages의 index.html 이 직접 부르면 전부 차단된다.
 * 또한 DART 인증키를 공개 저장소에 두면 안 되므로, 키는 여기(환경변수)에만 둔다.
 *
 * 배포: Cloudflare Workers → 이 파일 붙여넣기 → Settings → Variables 에
 *       DART_API_KEY 등록(Secret) → Deploy
 *
 * 엔드포인트
 *   GET /health              점검용
 *   GET /corps               상장사 색인 [[종목코드, 고유번호, 회사명], ...]
 *   GET /dart/<api>?<params> DART OpenAPI 통과 (crtfc_key 자동 주입)
 *   GET /price/<6자리코드>    야후 파이낸스 1년 일봉
 *   GET /naver/<6자리코드>    네이버 금융 시세(보고 시가총액 교차검증용)
 * ===================================================================== */

const DART_BASE = "https://opendart.fss.or.kr/api";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });

const fail = (message, status = 502, detail) =>
  json({ ok: false, error: message, detail: detail ?? null }, status);

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return fail("GET만 지원합니다.", 405);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/" || path === "/health") {
        return json({
          ok: true,
          service: "ksa-proxy",
          dart_key: env.DART_API_KEY ? "설정됨" : "없음",
          endpoints: ["/corps", "/dart/<api>", "/price/<code>", "/naver/<code>"],
        });
      }
      if (path === "/corps") return await handleCorps(env, ctx);
      if (path.startsWith("/dart/")) return await handleDart(path.slice(6), url, env);
      if (path.startsWith("/price/")) return await handlePrice(path.slice(7), url);
      if (path.startsWith("/naver/")) return await handleNaver(path.slice(7));
      return fail("알 수 없는 경로입니다.", 404);
    } catch (err) {
      return fail("프록시 처리 중 오류가 발생했습니다.", 500, String(err && err.message || err));
    }
  },
};

/* ------------------------- /corps : 상장사 색인 ------------------------- */

async function handleCorps(env, ctx) {
  if (!env.DART_API_KEY) return fail("DART_API_KEY 가 설정되지 않았습니다.", 500);

  const cache = caches.default;
  const cacheKey = new Request("https://ksa-proxy.internal/corps-v1");
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const res = await fetch(`${DART_BASE}/corpCode.xml?crtfc_key=${env.DART_API_KEY}`);
  if (!res.ok) return fail(`DART corpCode 요청 실패 (HTTP ${res.status})`);

  const buf = await res.arrayBuffer();
  let entry;
  try {
    entry = await unzipFirstEntry(buf);
  } catch (e) {
    // 키 오류·쿼터 초과 시 DART는 zip 대신 XML 오류 문서를 준다
    const snippet = new TextDecoder().decode(new Uint8Array(buf).slice(0, 300));
    return fail("DART corpCode 응답이 ZIP이 아닙니다 (인증키/쿼터 확인).", 502, snippet);
  }

  const corps = parseListedCorps(entry.bytes);
  const body = json({ ok: true, count: corps.length, corps }, 200, {
    "Cache-Control": "public, max-age=86400",
  });
  ctx.waitUntil(cache.put(cacheKey, body.clone()));
  return body;
}

/* --------------------------- /dart 통과 --------------------------- */

const DART_ALLOWED = new Set([
  "fnlttSinglAcntAll.json",  // 전체 재무제표
  "list.json",               // 공시 목록
  "stockTotqySttus.json",    // 주식의 총수 현황
  "company.json",            // 기업개황
]);

async function handleDart(api, url, env) {
  if (!env.DART_API_KEY) return fail("DART_API_KEY 가 설정되지 않았습니다.", 500);
  if (!DART_ALLOWED.has(api)) return fail(`허용되지 않은 DART API: ${api}`, 400);

  const params = new URLSearchParams(url.search);
  params.set("crtfc_key", env.DART_API_KEY);

  const res = await fetch(`${DART_BASE}/${api}?${params}`);
  if (!res.ok) return fail(`DART 요청 실패 (HTTP ${res.status})`);

  const body = await res.text();
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      ...CORS,
    },
  });
}

/* ------------------------ /price : 야후 일봉 ------------------------ */

async function handlePrice(code, url) {
  if (!/^\d{6}$/.test(code)) return fail("종목코드는 6자리 숫자여야 합니다.", 400);
  const range = url.searchParams.get("range") || "1y";

  // KOSPI(.KS) 우선, 없으면 KOSDAQ(.KQ)
  for (const suffix of [".KS", ".KQ"]) {
    const target =
      `https://query1.finance.yahoo.com/v8/finance/chart/${code}${suffix}` +
      `?range=${encodeURIComponent(range)}&interval=1d`;
    const res = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    if (!res.ok) continue;
    const data = await res.json().catch(() => null);
    const result = data && data.chart && data.chart.result && data.chart.result[0];
    if (!result) continue;
    return json({ ok: true, suffix, chart: result }, 200, {
      "Cache-Control": "public, max-age=600",
    });
  }
  return fail("야후 파이낸스에서 해당 종목 시세를 찾지 못했습니다.", 404);
}

/* ------------------- /naver : 보고 시가총액 교차검증 ------------------- */

async function handleNaver(code) {
  if (!/^\d{6}$/.test(code)) return fail("종목코드는 6자리 숫자여야 합니다.", 400);
  const res = await fetch(`https://m.stock.naver.com/api/stock/${code}/integration`, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
  });
  if (!res.ok) return fail(`네이버 금융 요청 실패 (HTTP ${res.status})`, res.status);
  const body = await res.text();
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=600",
      ...CORS,
    },
  });
}

/* ----------------------- ZIP / corpCode 파싱 ----------------------- */

async function unzipFirstEntry(buffer) {
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  const maxBack = Math.min(buffer.byteLength, 0xffff + 22);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= buffer.byteLength - maxBack; i--) {
    if (i < 0) break;
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("EOCD 없음");

  const cdOffset = dv.getUint32(eocd + 16, true);
  if (dv.getUint32(cdOffset, true) !== 0x02014b50) throw new Error("중앙디렉터리 서명 불일치");

  const method = dv.getUint16(cdOffset + 10, true);
  const compressedSize = dv.getUint32(cdOffset + 20, true);
  const nameLen = dv.getUint16(cdOffset + 28, true);
  const localOffset = dv.getUint32(cdOffset + 42, true);
  const name = new TextDecoder().decode(u8.subarray(cdOffset + 46, cdOffset + 46 + nameLen));

  if (dv.getUint32(localOffset, true) !== 0x04034b50) throw new Error("로컬 헤더 서명 불일치");
  const lfNameLen = dv.getUint16(localOffset + 26, true);
  const lfExtraLen = dv.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + lfNameLen + lfExtraLen;
  const raw = u8.subarray(dataStart, dataStart + compressedSize);

  if (method === 0) return { name, bytes: raw };
  if (method !== 8) throw new Error(`지원하지 않는 압축방식 ${method}`);

  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return { name, bytes };
}

function parseListedCorps(xmlBytes) {
  const text = new TextDecoder("utf-8").decode(xmlBytes);
  const out = [];
  const re = /<list>([\s\S]*?)<\/list>/g;
  const pick = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : "";
  };
  let m;
  while ((m = re.exec(text)) !== null) {
    const block = m[1];
    const stock = pick(block, "stock_code");
    const corp = pick(block, "corp_code");
    if (!stock || !corp || !/^\d{6}$/.test(stock)) continue;
    out.push([stock, corp, pick(block, "corp_name")]);
  }
  return out;
}
