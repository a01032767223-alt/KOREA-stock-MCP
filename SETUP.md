# 종목 스크리너 설치 안내

KOSPI 시총 상위 200 + KOSDAQ 시총 상위 150, 총 350종목을 종합점수 등급으로 걸러 보는 화면입니다.

## 저장소에 올릴 파일

기존 `KOREA-stock-MCP` 저장소 루트에 그대로 올리면 됩니다.

```
screener.html                              ← 스크리너 화면
engine/score.mjs                           ← 공용 채점 엔진
scripts/krx.mjs                            ← KRX 전종목 시세
scripts/collect-financials.mjs             ← DART 재무 수집 (분기)
scripts/build-scores.mjs                   ← 점수 계산 (매일)
data/scores.json                           ← 샘플 데이터 (첫 실행 후 실제 데이터로 교체됨)
.github/workflows/collect-financials.yml
.github/workflows/build-scores.yml
```

`index.html`, `worker.js`, 아이콘 파일은 기존 것을 그대로 두시면 됩니다.

## 설정 (한 번만)

**1. DART 키를 저장소 시크릿에 등록**

Worker에 넣은 것과 별개로, GitHub Actions에서도 쓸 수 있게 한 번 더 등록해야 합니다.

```
저장소 → Settings → Secrets and variables → Actions → New repository secret
  Name:  DART_API_KEY
  Value: 발급받은 키
```

**2. Actions 쓰기 권한 확인**

```
저장소 → Settings → Actions → General → Workflow permissions
  → "Read and write permissions" 선택 → Save
```

워크플로가 `data/*.json`을 커밋해야 하므로 이 설정이 필요합니다.

**3. 첫 데이터 수집**

```
저장소 → Actions 탭 → "재무 수집 (분기)" → Run workflow
```

10~20분 정도 걸립니다. 끝나면 `data/financials.json`과 `data/scores.json`이 자동으로 커밋되고, 샘플 데이터가 실제 데이터로 바뀝니다.

## 이후 자동 갱신

| 워크플로 | 주기 | 하는 일 |
|---|---|---|
| 점수 갱신 | 평일 매일 18:30 (KST) | KRX 시세 + 52주 밴드 → 점수 재계산 |
| 재무 수집 | 4·6·9·12월 1일 | DART 사업보고서 재수집 후 점수 재계산 |

주가는 매일 바뀌지만 재무제표는 분기에 한 번만 바뀌므로 분리했습니다. 덕분에 매일 도는 작업은 몇 분이면 끝납니다.

## DART 호출량

다중회사 주요계정 API가 한 번에 100개 회사 × 3개년을 돌려주기 때문에, 350종목 6개년치를 **20회 내외**의 호출로 끝냅니다. 일일 한도(20,000회)에 부담이 없습니다.

## 유니버스에 대해

KOSPI200·KOSDAQ150 지수의 실제 편입 종목 명단은 별도 구독 데이터라, **시가총액 상위 200개·150개**로 근사했습니다. 지수와 완전히 같지는 않지만 대형주 중심이라는 성격은 동일하며, 매일 시총 순위로 다시 뽑기 때문에 편입·편출이 자동 반영됩니다.

## 점수 기준을 바꾸고 싶을 때

`engine/score.mjs`의 `scorePER`, `scoreROE` 등 임계값을 고치면 됩니다. **단, `index.html`의 동일 함수도 함께 고쳐야 합니다.** 두 화면이 다른 점수를 보여주면 혼란스러워지므로, 임계값을 바꿀 때는 항상 양쪽을 같이 확인하세요.

## 스크리너에서 축약된 항목

주요계정 API는 매출·영업이익·순이익·자산·부채·자본·자본금만 제공합니다. 그래서 스크리너의 재무 적신호는 **적자·자본잠식·부채비율 200% 초과**만 검사합니다. 이자보상배율, 영업현금흐름 같은 항목은 전체 재무제표가 필요하므로 종목을 눌러 들어가는 **정밀분석 화면에서 검사**합니다.

즉 스크리너는 후보를 추리는 1차 필터, 정밀분석은 확정 검토용입니다.
