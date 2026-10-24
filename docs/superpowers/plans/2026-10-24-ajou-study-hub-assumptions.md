# Assumption Test: Ajou Study Hub v1.0

**Scope:** 확정 PRD, 앱 저장소와 상위 폴더의 5개 과목 원본, Node 실행 환경, Cloudflare 공식 문서. 확인일: 2026-10-24.

**Gate:** CONDITIONAL. 로컬 자료 구조와 배포 구성의 문서상 지원은 확인했다. 전체 연결 파일·브라우저 호환성은 구현 중 검증하고, 실제 계정의 접근 제어는 빈 배포물로 검증한 뒤에만 학습 자료를 올린다.

## Evidence ledger

| # | 가정 / 증거 분류 | 계획에 미치는 이유 | 수행한 검사와 근거 | 판정 | 계획 영향 |
| --- | --- | --- | --- | --- | --- |
| 1 | 기존 앱 구현이 있다 / LOCAL_FACT | 수정 계획인지 신규 구현인지 결정 | 앱의 전체 파일 목록은 `docs/prd/PRD.md`뿐이었다. `git log -1`은 `8b2c058 docs: define personal study app requirements`, 작업 전 `git status --short`는 비어 있었다. | REFUTED → 해소 | 기존 구현을 확장한다는 전제를 버리고 Task 1부터 신규 구현하는 계획으로 정했다. |
| 2 | 원본 수집 시작점은 5과목·53묶음·217 HTML / LOCAL_FACT | 목록 규칙·기준 입력 결정 | 각 원본의 묶음 바로 아래 HTML 열거와 `git ls-files`를 대조: 논회실 7/27, 생명과학 13/85, 전자회로2 12/25, 자료구조 10/42, 기계학습 11/38. 전부 Git 추적 파일이다. | VERIFIED | Task 1·4·7에서 이 입력의 기준으로 사용. 미래 입력에 강제하지 않는다. |
| 3 | 원본 위치·그룹 명명 규칙을 설정으로 제한할 수 있다 / LOCAL_FACT | 무차별 폴더 노출 방지 | 다섯 레포 모두 `복습노트`; 논회실은 실험01~06·칩 정리, 나머지는 MMDD 그룹이다. 실제 파일에 `인터렉티브` 표기가 있다. | VERIFIED | 고정 과목 설정과 그룹·유형 규칙을 사용한다. |
| 4 | 원본은 모두 깨끗한 main이다 / LOCAL_FACT | 현재 로컬 입력과 커밋 불일치 가능성 | 모두 main이나 생명과학 `git status --porcelain`은 추적 파일 변경 2,783개·untracked 항목 1개. 나머지 네 레포는 clean이다. | REFUTED → 해소 | PRD대로 현재 추적 파일 내용 사용. dirty·커밋·파일 hash 기록, 원본 reset/checkout/자동 커밋 금지. |
| 5 | Node 도구 체인을 로컬에서 실행할 수 있다 / RUNTIME_PROBE | 빌드·검사 실행 환경 | `node --version` → `v24.15.0`; `npm --version` → `11.12.1`; `python --version` → `Python 3.14.7`. [Vite 공식 요구사항](https://vite.dev/guide/)도 확인했다. | VERIFIED | Node 24 고정. 패키지 간 engine/peer 호환·lockfile은 Task 1에서 실제 설치로 검증한다. 현재 패키지 설치는 수행하지 않았다. |
| 6 | 날짜 키 충돌·sessionStorage·잘못된 JSON 타입이 실제로 존재한다 / LOCAL_FACT | 호환 계층과 실패 테스트 필요 | 아래 저장 코드 근거 참조. 자료구조와 기계학습의 1012 키 충돌, 배열 값의 `.filter`, 생명과학 sessionStorage 시도 객체를 확인했다. | VERIFIED | Task 3에서 원본 script보다 앞선 namespace adapter·타입별 기본값을 구현하고 Task 7에서 실자료로 검증한다. |
| 7 | 연결 파일은 숨김 폴더·복습노트 밖·동적 참조를 포함한다 / LOCAL_FACT | 단순 HTML 복사로는 열람 불가 | 아래 경로 근거 참조. `.pack`, `.assets`, 외부 강의록 PDF, inline JSON에서 `img.src`로 만드는 이미지가 있다. | VERIFIED | Task 2에서 정적 closure·좁은 허용 경로를 검증하고 동적 파일은 명시 목록으로 보완한다. |
| 8 | 전체 허용 경로·동적 참조·기존 링크가 모두 정상이다 / NOT_CURRENTLY_VERIFIABLE | 수집 완전성·호환성 판정 | 대표 참조는 읽었지만 전체 resolver·브라우저 실행은 수행하지 않았다. 콘텐츠 하위 reparse point 열거는 다섯 레포 모두 0개였다. | UNRESOLVED | Task 2·4에서 참조 목록과 범위를 먼저 검사하고 Task 7에서 전체 로딩·대표 조작을 검증한다. 현재 symlink가 없어도 탈출 테스트를 유지한다. |
| 9 | Workers 정적 제공이 기존 `.html`과 무료 제한을 지원한다 / EXTERNAL_FACT | 배포 설정·용량 한도 결정 | [HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/#disable-html-handling)의 `none`, [Static Assets 한도](https://developers.cloudflare.com/workers/platform/limits/#static-assets)의 Free 20,000개·25MiB, [정적 요청 요금](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)을 읽었다. | VERIFIED | Task 8에서 Wrangler 로컬 서버로 `.html`·숨김 폴더·404를 확인하고 최종 dist를 재검사한다. |
| 10 | Access가 운영·preview 전체를 보호할 수 있다 / EXTERNAL_FACT | 자료 보호 경계 결정 | [Workers Access 공식 문서](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)에서 Worker 전체 트래픽 보호, preview 전용 보호, hostname/path 우선순위를 확인했다. | VERIFIED | 한 Worker 전체 트래픽에 exact 이메일 정책을 적용하고 더 구체적인 override도 조회한다. |
| 11 | 실제 계정·무료 플랜·허용 이메일·OTP·정책·비허용 계정 차단이 준비되어 있다 / NOT_CURRENTLY_VERIFIABLE | 실제 자료 업로드 허용 여부 결정 | PRD §11에 허용 이메일 미제공이 명시되어 있고 이 작업에서는 계정 로그인·설정 조회·리소스 생성·배포를 수행하지 않았다. | UNRESOLVED | Task 9의 필수 조건. 빈 앱과 합성 sentinel 검증 이전에는 Task 10 실제 자료 업로드 금지. |
| 12 | 단일 사용자·무료 운영·수동 갱신·Vite+TS를 사용한다 / USER_DECISION | 범위·기술 선택 결정 | PRD §7·8·10과 사용자의 최종 확정 요청. | USER_DECISION — 확정 | 계획에 유지. 운영 이메일 값은 구현 후 배포 설정 때 입력한다. |

REFUTED 행 1·4는 요구사항 반박이 아닌 계획 작성 전 확인한 구현 상태 전제의 수정이다. 기존 PRD의 “구현 전”·“현재 로컬 추적 파일 입력” 요구와 일치하도록 해소했으며, 남은 설계 차단 요인은 없다. UNRESOLVED 행 8·11은 각각 초기 수집 검증과 마지막 배포 게이트로 격리한다.

## Verified premises for implementation planning

아래 경로는 각 과목 레포 기준이며 원본은 읽기만 했다.

- 자료구조 `복습노트/1012/정리노트_1012_Queue.html:8`은 초기 theme script, `:334`는 range 1012, `:670`은 JSON 읽기, `:837`·`:876`은 배열 `.filter`다. 문법상 정상인 `{}`·`null`도 고려해야 한다.
- 기계학습 `복습노트/1012/정리노트_1012_Several_Mathematical_Proofs.html:329`, `:1647`~`:1649`는 동일 날짜 읽음 키를 사용한다.
- 논회실 `복습노트/실험01/실험01_문제설명.html:466`~`:472`, `:633`, `:672`는 local/session 저장을 구분한다.
- 생명과학 `복습노트/0901/복습문제_0901_Biomolecules_and_Cells.html:1252`~`:1270`은 `od-review-attempt:v1:*` 키와 `{version,selected,unsure}` 객체, `:1634`는 sessionStorage 선택이다. 카드 버전·선택 유효성은 기존 코드가 검사한다.
- 논회실 `복습노트/실험01/실험01_기출문제.html:7`~`:10`은 `.pack` 리소스, `:289`는 JSON 내 이미지 경로, `:502`는 `img.src = f.src`다. `:323`~`:330`의 sample.json fetch는 내장 데이터가 없거나 query override를 쓰는 조건부 동작이므로 무조건 누락으로 처리하지 않는다.
- 생명과학 `복습노트/0901/문제설명_0901_Biomolecules_and_Cells.html:9`~`:12`는 `.assets`의 폰트·KaTeX를 참조한다.
- 자료구조 `복습노트/1012/정리노트_1012_Queue.html:603`은 `../../자료구조_강의록_2026/Software_5_Stack.pdf`, `Software_6_Queue.pdf`와 이전 묶음의 앵커 링크를 참조한다.
- 전자회로2 `복습노트/0909/문제설명_0909_Cascode_Stage.html:429`는 그림·인코딩된 PDF 링크를 포함한다. 기계학습 `복습노트/1012/정리노트_1012_Several_Mathematical_Proofs.html:1292`는 `.pack`의 문제/답안 PDF를 참조한다.

## Conditions and prohibited assumptions

- 원본 커밋만으로 이번 입력을 재현할 수 있다고 가정하지 않는다. dirty 입력의 실제 파일별 hash가 필요하다.
- HTML/CSS 정적 속성만으로 모든 동적 리소스를 찾았다고 주장하지 않는다. 명시 추가 목록과 브라우저 검사가 필요하다.
- 저장 값의 JSON parse 성공을 정상 데이터의 증거로 사용하지 않는다. key별 타입 검사가 필요하다.
- 공식 문서의 지원 여부를 사용자의 계정 설정 검증으로 대체하지 않는다. 실제 운영·활성 preview URL의 응답 본문을 검증한다.
- 이 작업에서 패키지 설치·앱 테스트·실제 학습 자료 빌드·클라우드 설정·배포는 수행하지 않았다.

## Required next actions

1. 구현 시작 시 Task 1에서 고정 버전의 패키지 호환성과 합성 입력 검사를 수행한다.
2. Task 2·4·7에서 전체 참조 범위·원본 결함·동적 파일·브라우저 호환성을 검증하고 설명 없는 오류를 해결한다.
3. Task 9에서 실제 허용 이메일·계정·무료 플랜·다른 계정 로그인 수단을 준비하고 빈 배포물로 접근 차단 증거를 확보한다.
4. Task 10 직전 실설정을 다시 읽고 검증한 그 결과물만 업로드한다.
