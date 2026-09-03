# Value Investment Dashboard

시각적 탐색과 근거 확인을 중심으로 다시 설계하는 개인용 투자 학습 대시보드입니다.

## Product direction

- Radar는 종목 추천기가 아니라 아이디어 발견 도구입니다.
- 단일 종합점수보다 포착 근거, 반대 근거, 데이터 커버리지를 함께 보여줍니다.
- AI는 리포트나 투자의견을 만드는 중심 기능이 아니라, 연결된 수치와 원문을 설명하는 보조 기능입니다.
- 모든 데이터는 기준일, 수집 시각, 출처, 최신성 상태를 가집니다.
- 포트폴리오 운용과 주문 기능은 범위에 포함하지 않습니다.

## Current slice

현재 화면은 KOSPI·KOSDAQ 전체시장을 새로 수집한 Radar 실행 결과를 표시합니다. 첫 전체 실행 기준 상장 보통주 2,528개, 규모 사전필터 1,820개, 공통 유동성 게이트 945개를 평가했고 DART 재무 원천 커버리지는 943/946개였습니다. 강화 규칙 v6는 각 렌즈의 엄격한 절대조건을 통과한 종목을 개수 상한 없이 모두 표시합니다. 현재 Quality 18개, Improvement 14개, Dislocation 6개, Event 13개이며 중복 제거 후보는 49개입니다.

`/markets`는 FinanceDataReader 기반 글로벌·한국 벤치마크 11개와 로컬 전체시장 가격 이력으로 계산한 breadth를 표시합니다. 각 자산은 독립 수집되며 누락·지연 상태와 원천 관측일을 화면에 남깁니다.

```bash
npm install
npm run dev
```

Windows 로컬 개발은 `next dev --webpack`을 사용합니다. Turbopack 개발 서버에서
`.next/dev/server/chunks/ssr` 파일 쓰기 잠금(`os error 1224`)과 HMR 오류가 반복되어
개발 번들러만 전환했습니다. 배포 빌드는 기존 `next build`를 유지합니다.
페이지 HTTP 200만으로 복구를 판단하지 않고 개발 서버의 HMR/오류 로그도 확인합니다.

## Full-market Radar run

Radar 규칙은 `radar/rules.v1.json`에 버전 관리합니다. 전체 실행은 KRX 상장 목록과 완료 거래일 가격을 새로 확인하고, DART 기업코드·최근 8개 분기 재무·최근 120일 중요 공시를 수집한 뒤 동일 기준일의 SQLite 스냅샷에서 네 렌즈를 평가합니다. 모든 단계가 검증된 경우에만 `public/data/radar/latest.json`을 원자적으로 교체하며 실패하면 기존 게시 결과를 유지합니다.

```powershell
python -m venv .venv
.\.venv\Scripts\pip.exe install -r requirements-radar.txt
Copy-Item .env.example .env.local
# .env.local의 DART_API_KEY를 입력한 뒤 실행
.\.venv\Scripts\python.exe -m scripts.run_full_market_radar
```

동일한 검증 스냅샷에서 규칙만 조정해 다시 평가:

```powershell
.\.venv\Scripts\python.exe -m scripts.reevaluate_radar
```

시장 상황판 최신 수집:

```powershell
.\.venv\Scripts\python.exe -m scripts.collect_markets
```

최신성 정책:

- 매 실행마다 KRX Universe와 DART 기업코드를 갱신합니다.
- 가격은 장중이면 직전 완료 거래일, 장 마감 뒤면 당일 완료 거래일까지 검증합니다.
- 동일 완료 시장일의 가격 체크포인트만 재사용하며 날짜나 대상 종목 해시가 달라지면 전량 재수집합니다.
- DART 최신 2개 주요재무 기간, 최신 전체재무 기간, 최근 이벤트 구간은 강제 갱신합니다.
- 과거 확정 구간만 캐시하고 실패·누락·stale 상태를 정상값으로 게시하지 않습니다.

검증:

```bash
npm run test:radar
npm run lint
npm run build
```

Vercel은 생성된 정적 Radar 스냅샷을 제공하는 웹 배포 대상으로 사용합니다. 수 분 이상 걸리는 전체시장 수집기는 Vercel 요청 안에서 실행하지 않고 로컬 또는 별도 스케줄러에서 실행한 뒤 검증된 스냅샷을 GitHub/호스팅 저장소로 게시하도록 구성합니다.

## 관심종목 팔로업

- `/watchlist`에서 실제 종가·등락률, 추가 공시·재무 분기, 자료 상태를 비교합니다. 우측 패널에는 실제 가격/거래량 차트, 전년 동기 실적, 공시 원문과 출처를 표시합니다.
- 첫 방문은 과거 자료를 새 항목으로 세지 않습니다. `현재 자료 확인` 버튼을 누른 이후의 공시 접수번호·재무 값/접수번호 차이를 표시합니다. 열람, 목록 조회, 자료 갱신만으로 확인 처리하지 않습니다.
- 확인 기준은 `watchlist_reviews` 별도 테이블에 저장합니다. 시간보다 접수번호/값을 비교하므로 과거 공시 추가 수집도 감지합니다. 조회 기간에서 빠진 공시의 확인 기록도 유지합니다. 재무 수집 시각만 바뀌면 수정으로 세지 않습니다.
- 확인 요청에는 표시된 자료의 버전을 포함합니다. 동시에 자료가 바뀌거나 다른 화면에서 확인 처리하면 409로 막아, 보지 않은 자료가 확인 처리되지 않도록 합니다. 수집 중에는 확인할 수 없고, 실패한 출처의 이전 확인 기준은 유지합니다.
- 실적 증감률은 동일 연결/별도 기준, 전년 동기 값이 양수인 경우에만 표시합니다. 결측·0·음수 기준값의 증감률은 `—`입니다. 가격은 실제 원 단위이며 확인 시점의 종가와 비교합니다.
- `research/config.json`: 최신 수집 후 72시간이 지났거나 수집 시각이 미확인이면 자료 점검으로 표시합니다. 이 값은 수집 신선도 기준이지 시세 실시간성 보장이 아닙니다.
- API: `GET /api/watchlist/followup`, `POST /api/watchlist/{code}/review` (`revision`). 상세 연결은 `?tab=price|financials|events`, 공시 전체 보기는 `&scope=all`입니다.
- 목록 상태 확인은 저장소를 다시 읽습니다. 우측 `자료 갱신`은 해당 종목의 실제 수집 작업을 실행합니다. Radar 조건·판정은 변경하지 않습니다.

## Documents

### Stock Detail v2

- `/stocks/{code}`: 핵심 현황, 재무 추이(8개 지표·차트/수치표), 실제 가격과 거래량(1개월/3개월/1년/전체), 유형별 공시 타임라인.
- 좌우 패널은 접기/펼치기, 좁은 화면에서는 서랍으로 표시합니다. 본문·목록·우측 패널은 독립 스크롤입니다.
- 자료 출처, 기준 분기, 연결 실행과 계산식은 우측 `지표·출처`에 표시합니다. 관심종목 보강 후에는 최근 1년 전체 공시 유형을 조회하며 분기별 재무 원문도 연결합니다.
- 원 자료의 금액을 억원으로 단위 환산하며 지수화하지 않습니다. 결측은 0 대신 null/차트의 끊김으로 유지합니다.
- 기존 `ev_ebitda` 저장값은 실제로 EV/영업이익 근사치이므로 상세 자료에서는 `ev_operating_profit`으로 내보냅니다. ROE는 평균자본이 아닌 기말자본 기준임을 표시합니다.
- 과거 Radar 보강기의 첫 비1분기 현금흐름은 누적자료일 수 있습니다. 신규 관심종목 수집기는 해당 연도의 앞선 보고서까지 가져와 단독 분기로 계산하고, 원화·연결/별도·연속성·접수번호를 확인합니다. 기존 Radar 판정 자체는 이 작업에서 재평가하지 않습니다.
- `generated_at`과 각 출처의 실제 수집 시점을 구분합니다. 아직 AI 호출은 없습니다.

### 관심종목 워크플로

- Radar는 `scripts.export_radar_previews`로 가격·기본 지표만 게시합니다. 전체 후보의 심화 자료를 미리 생성하지 않습니다.
- 후보 미리보기나 Radar 우측 패널에서 관심종목 등록 → 등록 즉시 저장 → 분리된 Python 작업에서 가격, 재무, 공시를 보강합니다. 진행 상태와 자료는 화면 이동/새로고침 이후에도 유지됩니다.
- `/watchlist`와 상세 좌측 패널에서 등록한 종목을 탐색합니다. 새로운 Radar 결과에 없더라도 그대로 유지합니다.
- 로컬 영구 저장: `data/research/watchlist.sqlite`(등록·작업 상태·자료), `data/research/raw/`(재무 원자료). 둘 다 Git에서 제외합니다. 백업 시 디렉터리 전체를 보관하세요. 브라우저 저장소를 원본으로 쓰지 않습니다.
- API: `GET /api/watchlist`, `GET/PUT/DELETE /api/watchlist/{code}`, `POST /api/watchlist/{code}` with `mode: all | retry`. 등록은 idempotent하며 종목당 실행 하나만 허용합니다. 해제는 논리적 숨김으로 자료를 지우지 않습니다.
- 가격·재무·공시 단위로 성공/실패를 보존하고, 실패 재시도는 성공한 출처를 재수집하지 않습니다. 재무 일부 보고서가 실패하면 성공한 원자료를 저장해 재시도에 재사용합니다. 기존 화면 자료는 실패로 덮어쓰지 않습니다.
- `research/config.json`에 경로·상태 폴링·수집 범위를 정의합니다. `RESEARCH_STORAGE_DIR`은 테스트/로컬 데이터 분리용 선택 환경변수입니다. 수집기는 서버의 `DART_API_KEY`를 사용하며 키와 원본 예외 URL을 API 응답에 노출하지 않습니다.
- Vercel에서는 로컬 저장 기능을 차단합니다. 배포 전에 인증, hosted DB/blob storage, 외부 작업 큐/수집기를 연결해야 합니다. 현재 로컬 SQLite를 배포용 영구 저장소라고 취급하지 않습니다.

원자료 해석 기준: [DART 전체 재무제표 가이드](https://engopendart.fss.or.kr/guide/detail.do?apiGrpCd=DE003&apiId=AE00036), [DART 공시검색 가이드](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001).

검증: `npm run test:stock`, `.venv\\Scripts\\python.exe -m unittest discover -s tests -p "test_*.py"`, `npm run lint`, `npm run build`.

- [Product blueprint](docs/PRODUCT_BLUEPRINT.md)
- [Radar v2 specification](docs/RADAR_V2.md)
- [AI evidence contract](docs/AI_EVIDENCE_COPILOT.md)
