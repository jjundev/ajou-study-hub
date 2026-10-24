# Ajou Study Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5개 과목의 기존 HTML을 원본 수정 없이 수집하고, 모바일·PC에서 본인만 접근하는 학습 웹앱으로 제공한다.

**Architecture:** 로컬 수집기가 Git 추적 파일의 현재 내용을 읽어 연결 파일을 재귀 수집하고, 저장·탐색 호환 코드를 배포 사본에 주입한다. Vite + TypeScript 탐색 앱이 같은 출처의 HTML을 iframe으로 열며, 배포물은 Workers Static Assets와 Cloudflare Access로 보호한다. 수집·호환·UI·배포 검사를 함수 경계로 분리하고 실제 계정 검증은 마지막 배포 단계에 둔다.

**Tech Stack:** Node.js 24, npm, TypeScript, Vite, Vitest, Playwright, parse5, PostCSS + postcss-value-parser, esbuild(호환 코드의 classic IIFE 번들), Wrangler. 초기 UI 프레임워크·DB·Worker 서버 로직 없음. 의존성은 Task 1에서 호환 버전을 확인해 정확한 버전과 package-lock.json을 고정한다.

**Spec:** [확정 PRD v1.0](../../prd/PRD.md). [사전 가정 검증](2026-10-24-ajou-study-hub-assumptions.md)도 먼저 읽는다. 작성일: 2026-10-24, 상태: 구현 전·검토용.

## Global Constraints

- 사용자: “과목 자료의 소유자 본인 1명”. 지원 환경: “모바일·PC의 최신 주요 브라우저”.
- “기존 과목 레포 5개 유지, 별도 비공개 앱 레포 생성”. 현재 앱 레포를 계속 사용하며 과목 레포에는 쓰지 않는다.
- “Vite + TypeScript, 초기 UI 프레임워크·DB 없음”.
- “Git이 추적하는 로컬 파일의 현재 내용을 입력으로 사용한다. 추적되지 않은 파일은 명시적으로 추가한 경우에만 포함한다.”
- “과목·학습 묶음별 저장 영역을 구분해 같은 날짜의 다른 과목이 기록을 공유하지 않도록 한다.”
- “정확한 허용 주소와 접근 제어 설정을 확인할 수 없는 상태에서는 실제 학습 자료 업로드를 막는다.”
- “먼저 자료가 없는 빈 앱을 배포하고 Access를 설정한 뒤, 비로그인·다른 계정의 접근 차단을 검증한다. 검증을 마친 후 실제 자료를 업로드한다.”
- “무료 요금제를 사용하고 유료 플랜·추가 기능을 자동 활성화하지 않는다.” 한도 초과 시 중단한다.
- “390px 모바일과 1440px PC”에서 검증한다. 기준 입력은 “5과목·53묶음·217개 HTML”이며 향후 입력 수를 고정하지 않는다.
- 오프라인 캐시·서비스 워커, 기기 간 동기화, 북마크·최근 학습, 전체 본문 검색, 자동 원격 동기화·자동배포는 구현하지 않는다.
- 수집 결과·보고서·실제 자료·계정 설정·인증 상태는 Git에서 제외한다. 합성 fixture만 테스트 코드에 포함한다.

## Review Focus

1. 한글·공백·퍼센트 인코딩·Windows 경로·심볼릭 링크가 섞여도 실제 허용 파일만 수집하고 URL과 파일을 혼동하지 않는다 → Task 2.
2. JSON 문법은 맞지만 타입이 잘못된 저장 값(`{}`를 배열 키에 저장, `null`)과 저장소 접근 예외가 있어도 본문과 풀이가 열린다 → Task 3.
3. 빠른 자료 전환 중 이전 iframe 메시지가 도착하거나 내부 링크를 연달아 눌러도 주소·제목·본문·뒤로가기가 일치한다 → Task 6.
4. 수집 중 원본 변경, 직전 빌드의 잔여 파일, 설정 밖 동적 참조가 있어도 누락·유출·혼합 입력을 성공으로 보고하지 않는다 → Task 4, 7.
5. 운영 주소만 보호되거나 더 구체적인 bypass 정책·새 미리보기 주소가 생기면 실제 자료 업로드를 막는다 → Task 9, 10.

---

## 실행 경계와 순서

이 요청은 문서 확정과 계획 작성까지다. 아래 체크박스는 모두 미실행이다. 구현은 계획 검토와 실행 방식 선택 후 시작한다. Task 1→2→3→4는 명령행으로 검증 가능한 수집 결과, Task 5→6→7은 로컬 학습 앱, Task 8→9→10은 보호된 배포를 만든다. 서로 같은 목록·파일 계약을 쓰는 하나의 제품이므로 하나의 계획 안에서 단계별로 완료한다.

계정 접근·실제 허용 이메일은 Task 1~8의 전제 조건이 아니다. Task 9에서 계정·무료 플랜·허용 이메일·Access 관리 권한·다른 계정 검증 수단이 준비되지 않으면 그 이후만 대기하고, 로컬 완료와 클라우드 완료를 구분해 보고한다. 생명과학의 로컬 변경을 취소하거나 자동 커밋·push하지 않는다.

## 파일 구조와 책임

| 파일 | 책임 |
| --- | --- |
| `package.json`, `package-lock.json`, `.node-version`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore` | 고정 도구 체인, 검사 명령, 로컬 전용 산출물 제외 |
| `config/courses.ts`, `config/sources.example.json` | 고정 과목·유형·허용 경로와 로컬 원본 위치 설정 예제 |
| `src/content/model.ts` | Node와 브라우저가 공유하는 직렬화 가능한 목록 타입 |
| `tools/content/source.ts`, `tools/content/catalog.ts` | Git 입력 선택·읽기, 묶음·제목·ID·유형 생성 |
| `tools/content/paths.ts`, `tools/content/references.ts`, `tools/content/collect.ts` | 허용 경로 검사, HTML/CSS 참조 추출, 순환 방지 의존 파일 수집 |
| `src/compat/storage.ts`, `config/storage-rules.ts`, `tools/content/transform.ts` | 기기 내 저장 호환과 사본 HTML 주입 |
| `tools/content/build.ts`, `tools/content/preflight.ts`, `tools/content/report.ts`, `tools/cli.ts` | 수집·검사·재현 가능한 결과물과 로컬 보고서 |
| `index.html`, `src/main.ts`, `src/app/catalog-view.ts`, `src/app/styles.css` | 과목·묶음·검색·자료 목록 및 반응형 앱 |
| `src/app/router.ts`, `src/app/reader.ts`, `src/compat/reader-bridge.ts` | URL 상태, iframe 수명, 문서 이동·앵커 동기화 |
| `tools/verify-content.ts`, `tools/create-fixture.ts`, `tests/fixtures/source.ts` | 실제 자료 검사 명령과 합성 원본 fixture 생성 |
| `wrangler.jsonc`, `config/hosting/_redirects`, `config/hosting/_headers`, `config/hosting/404.html`, `tools/deploy/bootstrap.ts` | 로컬·운영 정적 제공 설정과 자료 없는 검증용 번들 |
| `tools/deploy/access.ts`, `tools/deploy/guard.ts`, `tools/deploy/release.ts` | Access 실설정 조회, 검증 증거 검사, 수동 배포 진입점 |
| `tests/content/*.test.ts`, `tests/deploy/*.test.ts`, `tests/e2e/*.spec.ts` | 각 Task에 명시한 행동 검증 |
| `README.md`, `docs/operations/deployment.md` | 로컬 갱신·보고서 읽기·계정 설정·배포·회수 절차 |

로컬 설정은 `.local/sources.json`, `.local/deployment.json`; 생성 결과는 `.generated/content/`, `.generated/bootstrap/`, `dist/`; 보고서·인증 증거는 `.reports/`, 브라우저 로그인 상태는 `.local/auth/`에 둔다. 전부 ignore한다. 원본 절대 경로·이메일·커밋별 입력 파일 목록은 브라우저 목록에 넣지 않는다.

## 공통 데이터 계약

`src/content/model.ts`가 아래 타입을 소유한다. ID는 course ID와 `/` 구분·NFC 정규화된 원본 상대 경로의 SHA-256 전체 hex에 종류 접두어를 붙인다. 제목·정렬 순서는 ID에 넣지 않는다. 대소문자를 임의로 접지 않고, 정규화 후 충돌은 오류로 처리한다. URL은 원본 경로를 세그먼트별 인코딩한 `/content/<courseId>/<repo-relative-path>`다.

```ts
type MaterialType = 'note' | 'review' | 'explanation' | 'interactive' | 'other';
type Course = { id: string; name: string; repo: string; semester: '2026-2' };
type Group = { id: string; courseId: string; title: string; sourcePath: string;
  kind: 'date' | 'experiment' | 'supplement'; date: string | null; order: number };
type DocumentInfo = { id: string; courseId: string; groupId: string | null;
  title: string; type: MaterialType; sourcePath: string; url: string; listed: boolean };
type Catalog = { version: 1; courses: Course[]; groups: Group[]; documents: DocumentInfo[] };
type Issue = { code: string; courseId: string; sourcePath: string;
  target: string; reason: string; severity: 'error' | 'warning' };
```

`listed:true`는 목록 시작 HTML만 뜻한다. 연결된 추가 HTML은 `listed:false`로 등록해 앱 안에서 열되 217개 기준·자료 수·검색에는 더하지 않는다. 연결 HTML이 학습 묶음 밖에 있으면 `groupId:null`로 두고 저장 namespace는 문서 부모 경로 ID를 쓴다. 한 과목의 서로 다른 묶음에서 참조하더라도 동일 파일은 하나만 수집한다.

`config/courses.ts`의 `CourseConfig = Course & { contentRoot:string; allowedRoots:string[]; groupRules:GroupRule[]; typeRules:TypeRule[]; extraFiles:string[] }`. `GroupRule = {kind:Group['kind']; pattern:string; title?:string}`, `TypeRule = {pattern:string; type:MaterialType}`는 정규식 문자열을 사용한다. `.local/sources.json`은 `{roots:Record<string,string>, explicitUntracked:Record<string,string[]>}`. 절대 원본 위치는 여기에서만 받는다.

| ID / 과목 | 로컬 위치 기본 예 | repo / 그룹 / 초기 listed HTML |
| --- | --- | --- |
| `logic-lab` / 논리회로실험 | `../논회실` | `jjundev/ajou-nonhoesil` / 7 / 27 |
| `life-science` / 생명과학 | `../생명과학` | `jjundev/ajou-life-science` / 13 / 85 |
| `circuits-2` / 전자회로2 | `../ajou-electronic-circuits-2` | `jjundev/ajou-electronic-circuits-2` / 12 / 25 |
| `data-structures` / 자료구조 | `../ajou-jagual` | `jjundev/ajou-jagual` / 10 / 42 |
| `ml-basics` / 기계학습기초 | `../ajou-ml-basics` | `jjundev/ajou-ml-basics` / 11 / 38 |

모두 `contentRoot:'복습노트'`. 날짜 그룹은 `^\d{4}$`의 MMDD를 2026년 유효 날짜로 검사한다. 실험 그룹은 `^실험0[1-6]$`, 보충 그룹은 `^칩 정리$`로 시작한다. 새로운 그룹 규칙은 설정으로 추가한다. 허용 경로는 복습노트와 실제로 참조되는 강의록·추가 설명 경로만 Task 2에서 확인해 명시하며 레포 전체 `.` 허용은 금지한다.

## Task 1: Git 입력에서 학습 목록 생성 (AC-01, AC-02)

**Files:** Create `package.json`, `package-lock.json`, `.node-version`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `config/courses.ts`, `config/sources.example.json`, `src/content/model.ts`, `tools/content/source.ts`, `tools/content/catalog.ts`, `tools/create-fixture.ts`, `tests/fixtures/source.ts`, `tests/content/catalog.test.ts`.

**Interfaces:**
- Consumes: PRD §3·§6.1과 위 설정 계약.
- Produces: `inspectSources(configs:CourseConfig[], settings:SourceSettings):Promise<SourceSnapshot>`, `buildCatalog(snapshot:SourceSnapshot):Promise<Catalog>`.
- `SourceSettings`는 로컬 설정 JSON 타입이다. `SourceSnapshot`은 `{catalogInputs:SourceEntry[], readFile:(courseId:string,path:string)=>Promise<Uint8Array>, provenance:SourceProvenance[]}`. `SourceEntry={courseId:string,groupPath:string,sourcePath:string}`, `SourceProvenance={courseId:string,commit:string,dirty:boolean,trackedPaths:string[],explicitUntracked:string[]}`; 이 타입은 `source.ts`가 소유한다. readFile은 상대 경로·realpath·추적 여부·허용 경로를 다시 검사하고 선택 파일의 입력 바이트·해시를 기록한다. Task 2에서 URL 정규화와 공유 경로 판정을 `paths.ts`로 추출한다.
- 테스트 도우미 `createSourceFixture():Promise<{root:string;config:CourseConfig;settings:SourceSettings;write:(path:string,text:string)=>Promise<void>;track:()=>Promise<void>;dispose:()=>Promise<void>}>`는 임시 Git 레포를 만들고 각 테스트가 finally에서 회수한다. `tools/create-fixture.ts`는 같은 도우미로 5과목 합성 입력과 `.local/fixture-sources.json`을 만들며 `npm run fixtures:create`로 실행한다.

- [ ] **Step 1: 실행 환경과 테스트 도구를 준비한다.** Node 24·npm 버전, Git 상태를 확인하고 Node `>=24 <25`를 고정한다. TypeScript·Vitest·tsx와 이후 사용할 도구의 peer/engine 호환을 확인해 exact 버전으로 설치하고 lockfile을 만든다. `typecheck`, `test`, `content:build`, `build`, `dev`, `test:e2e`, `verify:content`, `hosting:dev`, `deploy:bootstrap`, `access:verify`, `deploy:private` 명령 이름을 예약한다. 아직 구현되지 않은 명령은 성공을 가장하는 stub을 두지 않는다.
- [ ] **Step 2: `catalog.test.ts`에 실패 테스트를 쓴다.** 합성 레포에 날짜·실험·보충 그룹, 제목 없는 문서, 알려지지 않은 파일명, `.backup-*`·제작 HTML, untracked HTML을 만든다. 추가/삭제 시 목록 증감과 제목만 변경했을 때 ID 유지를 검사한다.

```ts
// tests: lists_only_tracked_entry_html, stable_ids, updates_catalog, classifies_types
expect(catalog.documents.filter(d => d.listed)).toHaveLength(3);
expect(renamedTitleDocument.id).toBe(originalDocument.id);
expect(experiment.date).toBeNull();
expect(unknown.type).toBe('other');
```

- [ ] **Step 3: `npm test -- tests/content/catalog.test.ts`를 실행한다.** 아직 없는 source/catalog export 때문에 FAIL이어야 한다.
- [ ] **Step 4: 입력·목록 함수를 구현한다.** `git ls-files -z`로 추적 파일을 얻고 main을 checkout하거나 fetch하지 않는다. MMDD는 최신순, 실험은 번호순, 보충은 별도 마지막으로 정렬한다. `정리노트*→note`, `복습문제*·실험NN_기출문제*·문제풀이.html→review`, `문제설명*·실험NN_문제설명*·실험NN_기출풀이*→explanation`, `인터렉티브*·인터랙티브*→interactive`; 나머지는 other다. 과목별 규칙 순서로 판정하고 parse5로 title을 추출한다. 숨김·백업·제작 파일은 시작 목록에서 제외한다.
- [ ] **Step 5: 테스트와 `npm run typecheck`를 실행해 PASS를 확인하고 명시한 파일만 커밋한다.** `git add package.json package-lock.json .node-version tsconfig.json vitest.config.ts .gitignore config src/content tools/content/source.ts tools/content/catalog.ts tools/create-fixture.ts tests`; `git commit -m "feat: generate course catalog from local git sources"`. 도구 설치 자체를 기능 검증으로 보고하지 않는다.

## Task 2: 연결 파일 수집과 허용 범위 검사 (AC-03, AC-11)

**Files:** Create `tools/content/paths.ts`, `tools/content/references.ts`, `tools/content/collect.ts`, `tests/content/collect.test.ts`; Modify `config/courses.ts`, `tests/fixtures/source.ts`.

**Interfaces:**
- Consumes: Task 1 `SourceSnapshot`, `Catalog`, `CourseConfig[]`.
- Produces: `resolveReference(input:{courseId:string;from:string;ref:string}, config:CourseConfig, repoRoot:string):Promise<ResolvedReference>` in `paths.ts`; `ResolvedReference={kind:'local';sourcePath:string;suffix:string}|{kind:'external'|'anchor'|'ignored'}|{kind:'invalid';reason:string}`.
- `extractReferences(text:string, kind:'html'|'css'):string[]` in `references.ts`; `collectDependencies(snapshot:SourceSnapshot,catalog:Catalog,configs:CourseConfig[]):Promise<FileGraph>` in `collect.ts`.
- `FileGraph={files:CollectedFile[];linkedDocuments:DocumentInfo[];issues:Issue[]}`, `CollectedFile={courseId:string;sourcePath:string;bytes:Uint8Array;sha256:string;kind:'html'|'css'|'asset'}`. Node 전용 타입은 `collect.ts`가 소유한다.

- [ ] **Step 1: `collect.test.ts`에 실패 테스트를 쓴다.** `한글 폴더/a%20b.html?mode=1#풀이`, `.pack/x.css`의 `@import`·폰트 url, `.assets/x.png`, 복습노트 밖 허용 PDF, 순환 HTML, srcset·SVG href·script src·base href를 포함한다. `../` 탈출·인코딩 탈출·역슬래시·Windows drive/UNC·외부 대상 심볼릭 링크·명시하지 않은 untracked 참조·서로 다른 파일의 정규화 충돌은 실패해야 한다. OS가 symlink 생성을 거부하면 실제 realpath 탈출 검사는 별도 실행 환경에서 필수 검증하고 skip을 통과로 세지 않는다.

```ts
// tests: encoded_paths_and_hidden_assets, rejects_escape, rejects_alias_collision
expect(graph.files.some(f => f.sourcePath.endsWith('.assets/x.png'))).toBe(true);
expect(graph.linkedDocuments.every(d => !d.listed)).toBe(true);
expect(escapeResult.kind).toBe('invalid');
expect(graph.issues.filter(i => i.severity === 'error')).toEqual([]);
```

- [ ] **Step 2: `npm test -- tests/content/collect.test.ts`를 실행한다.** 미구현 resolver/collector 때문에 FAIL이어야 한다.
- [ ] **Step 3: resolver·parser·collector를 구현한다.** 쿼리·앵커를 분리하고 URL을 한 번 디코딩한 뒤 논리 경로와 realpath 모두 허용 루트·레포 안인지 확인한다. `http(s)`·protocol-relative·data URL은 외부/내장으로 구분하며 javascript 링크는 실행 파일 참조로 수집하지 않는다. HTML은 parse5, CSS는 PostCSS/value parser로 처리하고 `<base>`를 반영한다. 링크는 원본 디렉터리 관계를 유지하고 원본 root-relative 참조는 과목별 `/content/<id>/`로 재기준화한다. 레포 전체 후보 파일 목록과 외부 CDN·동적 참조 후보를 로컬 보고서에 남긴다. 동적 파일은 `extraFiles`, 추적되지 않은 파일은 `explicitUntracked` 양쪽 규칙에 맞을 때만 추가한다. 참조된 금지 경로는 조용히 제외하지 않고 error로 반환한다.
- [ ] **Step 4: `npm test -- tests/content/collect.test.ts`와 `npm run typecheck`를 실행한다.** fixture의 허용 참조는 모두 존재하고 탈출 사례는 모두 차단되어야 한다. 실제 5개 입력을 읽어 필요한 복습노트 외 허용 경로를 `config/courses.ts`에 좁게 등록한다.
- [ ] **Step 5: 해당 파일만 커밋한다.** `git add tools/content/paths.ts tools/content/references.ts tools/content/collect.ts tests/content/collect.test.ts tests/fixtures/source.ts config/courses.ts`; `git commit -m "feat: collect referenced assets within approved source paths"`.

## Task 3: 저장 충돌·저장 불가·손상 데이터 호환 (AC-08, AC-09)

**Files:** Create `src/compat/storage.ts`, `config/storage-rules.ts`, `tools/content/transform.ts`, `playwright.config.ts`, `tests/e2e/storage.spec.ts`, `tests/content/transform.test.ts`; Modify `package.json`.

**Interfaces:**
- Consumes: Task 1 `DocumentInfo`; Task 2 `CollectedFile`.
- Produces: `installStorage(namespace:string,rules:StorageRule[]):void` in `storage.ts`; `StorageRule={pattern:string;format:'array'|'object'|'theme'|'attempt';fallback:string|null}` in `config/storage-rules.ts`.
- `transformHtml(html:string, doc:DocumentInfo, bootstrap:string):string` in `transform.ts`. `bootstrap`는 esbuild가 만든 자기완결 classic IIFE 문자열이며 저장 규칙과 해당 문서 metadata를 포함한다. Task 6부터 reader bridge도 함께 번들한다.

- [ ] **Step 1: 브라우저·변환 실패 테스트를 쓴다.** 다른 과목의 1012와 같은 과목의 서로 다른 묶음은 `od-note-read:v1:1012`를 공유하지 않고 같은 묶음의 다른 문서는 공유해야 한다. local/sessionStorage를 getter부터 차단하거나 setItem에서 quota 예외를 던져도 문제 버튼이 작동해야 한다. native storage에 불완전 JSON, `{}`, `null`을 배열 키에 넣고 정상 기본값으로 돌아오는지 검사한다.

```ts
// tests: isolates_namespaces, shares_within_group, survives_storage_failure, validates_shape
expect(otherCourseReadState).toEqual([]);
expect(sameGroupReadState).toEqual(['q1']);
expect(recoveredArrayReadState).toEqual([]);
expect(await page.locator('[data-test=answer]').isVisible()).toBe(true);
```

- [ ] **Step 2: `npm test -- tests/content/transform.test.ts`와 `npm run test:e2e -- tests/e2e/storage.spec.ts`를 실행한다.** 호환 계층 미구현으로 FAIL이어야 한다. 이 단계는 아직 Vite 앱이 없으므로 Playwright `page.route`로 합성 HTML과 변환된 bootstrap만 응답하고 실제 원본·클라우드에는 접근하지 않는다.
- [ ] **Step 3: window별 저장 adapter와 사본 주입을 구현한다.** 원래 storage 참조를 먼저 보관하고 window의 localStorage/sessionStorage getter를 namespace adapter로 교체한다. `getItem/setItem/removeItem/clear/key/length` 및 property 접근·삭제·열거의 Storage 의미를 유지하며 clear는 자기 namespace만 지운다. `study-hub:v1:<courseId>:<groupId 또는 부모경로ID>:`를 원래 키 앞에 붙이고 storage 종류는 구분한다. 예외 시 메모리 저장소로 전환한다. `od-note-read:*`, `od-review-solved:*`는 문자열 배열 `[]`, `od-panels:*`는 객체 `{}`, `od-theme`는 light/dark 문자열을 검증한다. `od-review-attempt:v1:*`는 `{version,selected,unsure}` 형태를 검증하고 손상 값은 null로 돌린다. 카드 버전 일치·선택지 유효성은 기존 readAttempt가 판단하므로 이를 재구현하지 않는다. 알 수 없는 JSON 저장 패턴은 추측으로 고치지 않고 Task 7에서 규칙 누락으로 보고한다. JSON 전역 함수는 바꾸지 않는다. parse5 source offset으로 문서의 첫 실행 스크립트 전에 metadata·bootstrap을 삽입하고 원본 bytes는 수정하지 않는다.
- [ ] **Step 4: 두 테스트와 `npm run typecheck`를 실행한다.** 읽기·쓰기·삭제·clear·열거, 정상 JSON 중 잘못된 타입, 저장 금지 조건이 Chromium·Firefox·WebKit에서 PASS여야 한다. 부트스트랩이 원본 스크립트보다 먼저 실행되는지도 검사한다.
- [ ] **Step 5: 해당 파일만 커밋한다.** `git add src/compat/storage.ts config/storage-rules.ts tools/content/transform.ts playwright.config.ts tests/e2e/storage.spec.ts tests/content/transform.test.ts package.json`; `git commit -m "feat: isolate document storage and recover invalid state"`.

## Task 4: 재현 가능한 빌드와 업로드 전 검사 (AC-02, AC-03, AC-10, AC-11)

**Files:** Create `tools/content/build.ts`, `tools/content/preflight.ts`, `tools/content/report.ts`, `tools/cli.ts`, `config/content-exceptions.json`, `tests/content/build.test.ts`; Modify `package.json`, `.gitignore`.

**Interfaces:**
- Consumes: Task 1~3의 공개 함수와 타입.
- Produces: `buildContent(options:{settings:SourceSettings;outputDir:string;reportDir:string}):Promise<BuildResult>`; `BuildResult={catalog:Catalog;outputDir:string;bundleHash:string;reportPath:string;issues:Issue[]}` in `build.ts`.
- `checkBundle(files:{path:string;size:number}[],limits:{maxFiles:number;maxFileBytes:number}):Issue[]` in `preflight.ts`; `writeReport(report:BuildReport,path:string):Promise<void>` in `report.ts`.
- `BuildReport={createdAt:string;bundleHash:string;sources:SourceProvenance[];inputs:{courseId:string;path:string;sha256:string}[];outputs:{path:string;sha256:string;size:number}[];issues:Issue[]}`. `config/content-exceptions.json`의 항목은 `{courseId,sourcePath,target,reason}`이며 기본 `[]`; exact match만 warning으로 낮춘다.

- [ ] **Step 1: `build.test.ts`에 실패 테스트를 쓴다.** 두 번 빌드한 catalog·배포 파일 해시 동일, 원본 전후 해시 동일, 삭제한 입력의 이전 사본 제거, 명시적 untracked만 포함, 수집 도중 입력 변경 시 중단, 설명 없는 누락·연결된 `.env`·`.git`·자격 증명·제작 로그 차단을 검사한다. 경계는 다음 값 그대로 사용한다.

```ts
// tests: reproducible_output, immutable_sources, no_stale_files, refuses_mixed_snapshot, limits
expect(second.bundleHash).toBe(first.bundleHash);
expect(afterSourceHashes).toEqual(beforeSourceHashes);
expect(checkBundle(twentyThousandFiles, limits)).toEqual([]);
expect(checkBundle(twentyThousandAndOneFiles, limits)).not.toEqual([]);
expect(checkBundle([{path:'x.pdf', size:25*1024*1024+1}], limits)).not.toEqual([]);
```

- [ ] **Step 2: `npm test -- tests/content/build.test.ts`를 실행한다.** build/preflight 미구현 때문에 FAIL이어야 한다.
- [ ] **Step 3: staging 빌드·보고서·CLI를 구현한다.** 선택 파일의 입력 bytes를 고정하고 완료 전 다시 해시를 확인해 변경 시 실패한다. 새 임시 디렉터리에서 완성·검사한 뒤 앱 소유 출력 디렉터리만 교체한다. 재귀 삭제·이동 전 절대 경로가 이 프로젝트의 지정 출력 하위인지 검사한다. 목록·출력 경로는 결정적으로 정렬하고 생성 시각·원본 로컬 상태 보고서는 배포물 밖에 둔다. 전체 결과물의 경로+파일 해시로 bundleHash를 만든다. 정적 참조를 변환 후 다시 검사한다. 기본 제한은 20,000개·25×1024×1024 bytes이며 앱 자산을 합친 최종 dist도 Task 8·10에서 검사한다. 예외가 없는 error는 nonzero exit다.
- [ ] **Step 4: 위 테스트와 `npm run content:build -- --sources .local/sources.json`을 실행한다.** 실제 입력 기준을 보고서에 기록하고 설명 없는 누락이 0일 때만 성공한다. 현재 입력이 사전 조사와 같다면 5/53/217을 확인하며, 다르면 추가·삭제 경로와 이유를 보고한다. 원본 hash 불변을 확인한다.
- [ ] **Step 5: 해당 파일만 커밋한다.** `git add tools/content/build.ts tools/content/preflight.ts tools/content/report.ts tools/cli.ts config/content-exceptions.json tests/content/build.test.ts package.json .gitignore`; `git commit -m "feat: build reproducible content bundles with preflight checks"`.

## Task 5: 과목·묶음·자료 탐색 화면 (AC-01, AC-02, AC-06)

**Files:** Create `index.html`, `src/main.ts`, `src/app/catalog-view.ts`, `src/app/styles.css`, `vite.config.ts`, `tests/e2e/catalog.spec.ts`; Modify `package.json`, `playwright.config.ts`.

**Interfaces:**
- Consumes: `/catalog.json`의 `Catalog` v1, `DocumentInfo.listed`.
- Produces: `mountCatalog(root:HTMLElement,catalog:Catalog,onSelect:(documentId:string)=>void,onBrowse?:(state:BrowseState)=>void):{setSelection:(id:string|null)=>void;setBrowseState:(state:BrowseState)=>void;destroy:()=>void}` in `catalog-view.ts`. `BrowseState={courseId?:string;groupId?:string;query?:string}`도 이 파일이 export한다. Task 6에서 onBrowse를 router와 연결하고 setBrowseState는 복원 중 변경 이벤트를 재발행하지 않는다.
- `main.ts`는 목록 fetch·version/필수 필드 검사·로딩·실패 후 재시도를 담당한다. reader 호출은 Task 6에서 연결한다.

- [ ] **Step 1: `catalog.spec.ts`에 실패 테스트를 쓴다.** 390×844와 1440×900에서 5과목·묶음별 제목·날짜/실험 번호·실제 유형·자료 수를 검사한다. 날짜·묶음명·자료 제목으로 검색되고 본문 전용 검색어는 결과에 없어야 한다. 없는 유형 버튼 없음, 검색 결과 0에서 지우기 복구, 목록 요청 실패 후 재시도, keyboard 선택과 모바일 목록 접기/열기를 검사한다.

```ts
// tests: browses_courses, searches_metadata_only, empty_and_error_states, responsive_catalog
await expect(page.getByRole('button', {name:'검색어 지우기'})).toBeVisible();
expect(await page.locator('[data-material-type=review][disabled]').count()).toBe(0);
expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
```

- [ ] **Step 2: `npm run test:e2e -- tests/e2e/catalog.spec.ts`를 실행한다.** 앱 화면 미구현 때문에 FAIL이어야 한다.
- [ ] **Step 3: 탐색 화면과 빌드 설정을 구현한다.** 한국어 UI, semantic button/nav/main, 분명한 포커스, `aria-expanded` 목록 토글과 검색 label을 둔다. 768px 미만은 접을 수 있는 목록, 이상은 목록·본문 2열로 구성한다. 과목명·문서 제목은 textContent로 출력한다. 자료 수는 listed HTML만 집계한다. Vite는 앱 코드만 번들하고 기존 HTML은 재해석하지 않으며 수집 자산을 publicDir로 복사한다. `npm run build`는 `content:build` 후 Vite build를 실행한다. `dev`도 먼저 목록·사본을 생성해 같은 결과를 제공한다. 기본 E2E는 합성 입력만 쓰고 실제 자료 검사는 `verify:content`, 실계정 검사는 `access:verify` 명령으로만 활성화한다.
- [ ] **Step 4: `npm run fixtures:create`, `npm run build -- --sources .local/fixture-sources.json`, `npm run test:e2e -- tests/e2e/catalog.spec.ts`, `npm run typecheck`를 실행한다.** `tools/cli.ts`가 `--sources`를 소비하고 Vite에는 전달하지 않도록 연결한다. 스크린샷으로 두 폭의 앱 UI 잘림·목록 접기·제목 가독성을 확인한다.
- [ ] **Step 5: 해당 파일만 커밋한다.** `git add index.html src/main.ts src/app/catalog-view.ts src/app/styles.css vite.config.ts tests/e2e/catalog.spec.ts package.json playwright.config.ts`; `git commit -m "feat: add responsive course and material navigation"`.

## Task 6: iframe 읽기·문서 이동·주소 동기화 (AC-05, AC-07)

**Files:** Create `src/app/router.ts`, `src/app/reader.ts`, `src/compat/reader-bridge.ts`, `tests/e2e/reader.spec.ts`; Modify `src/main.ts`, `tools/content/transform.ts`.

**Interfaces:**
- Consumes: Task 5 `mountCatalog`; `Catalog`의 listed·연결 HTML 전체.
- Produces: `parseRoute(hash:string):Route`, `formatRoute(route:Route):string`, `Route={kind:'catalog';courseId?:string;groupId?:string;query?:string}|{kind:'read';documentId:string;anchor?:string}|{kind:'invalid'}` in `router.ts`.
- `mountReader(root:HTMLElement,catalog:Catalog,onNavigate:(documentId:string,anchor?:string)=>void):{open:(id:string,anchor?:string)=>void;destroy:()=>void}` in `reader.ts`; bridge 메시지는 `{type:'study-hub:navigate';documentId:string;url:string}`. 수신 측은 실제 event.origin·event.source와 현재 iframe URL을 모두 검사한다.

- [ ] **Step 1: `reader.spec.ts`에 실패 테스트를 쓴다.** 내부 상대·인코딩 링크→목록 제목/URL 동기화, 추가 HTML 이동, 문서 앵커·새로고침·직접 진입·뒤로/앞으로, PDF·외부 링크·새 탭·수정키 클릭, 알 수 없는 ID·누락 파일 오류 복귀를 검사한다. 빠른 A→B 전환 후 A iframe 메시지와 외부 source의 위조 메시지는 무시해야 한다.

```ts
// tests: follows_internal_links, restores_route, ignores_stale_frame, opens_external_documents
await expect(page).toHaveURL(/#\/read\/doc-[a-f0-9]+/);
await expect(page.getByRole('heading', {name:'연결된 설명'})).toBeVisible();
expect(await page.locator('iframe').getAttribute('src')).toContain(expectedEncodedPath);
await expect(page.getByRole('link', {name:'목록으로'})).toBeVisible();
```

- [ ] **Step 2: `npm run test:e2e -- tests/e2e/reader.spec.ts`를 실행한다.** router/reader/bridge 미구현 때문에 FAIL이어야 한다.
- [ ] **Step 3: 세 인터페이스와 main 연결을 구현한다.** 라우트는 `/index.html#/catalog?course=<id>&group=<id>&q=<query>` 또는 `/index.html#/read/<documentId>?anchor=<encoded-anchor>`다. iframe은 same-origin 신뢰 자료로 실행하며 스크립트·폼·다운로드를 불필요한 sandbox로 막지 않는다. bridge는 일반 내부 HTML 클릭만 parent에 위임하고 기본 동작을 취소한다. standalone에서는 원본 링크가 작동한다. JS location 이동·hashchange·iframe load도 현재 URL을 통해 반영한다. 같은 선택을 되풀이해 history가 무한 증가하지 않게 하고 자료 교체 시 이전 iframe을 폐기해 stale 메시지를 차단한다. 앵커만 바뀌면 본문을 다시 로드하지 않는다. PDF·외부 링크·별도 열기는 `noopener`를 사용하고 원본 새 탭 의도를 보존한다. 로딩 실패·알 수 없는 경로는 오류와 목록 복귀를 제공한다.
- [ ] **Step 4: reader·storage·catalog E2E와 `npm run typecheck`를 실행한다.** 세 브라우저에서 새로고침과 연속 뒤로가기가 중복 이동 없이 PASS여야 한다.
- [ ] **Step 5: 해당 파일만 커밋한다.** `git add src/app/router.ts src/app/reader.ts src/compat/reader-bridge.ts tests/e2e/reader.spec.ts src/main.ts tools/content/transform.ts`; `git commit -m "feat: preserve document navigation and browser history"`.

## Task 7: 실제 자료 전체 로딩과 대표 기능 검증 (AC-04 및 AC-01~AC-11)

**Files:** Create `tools/verify-content.ts`, `tests/e2e/content.spec.ts`, `tests/e2e/representatives.spec.ts`, `docs/operations/content-verification.md`; Modify `package.json`, `config/courses.ts`, `config/storage-rules.ts`, `config/content-exceptions.json`.

**Interfaces:**
- Consumes: Task 4 `BuildResult`, Task 6 route·reader; 출력된 `catalog.json`.
- Produces: `verifyContent(options:{baseUrl:string;catalog:Catalog;reportDir:string}):Promise<{passed:boolean;documentsChecked:number;issues:Issue[]}>` in `verify-content.ts`. 각 문서의 요청 실패·pageerror·응답 상태·입력/사본 차이를 `.reports/verification.json`에 기록한다.

- [ ] **Step 1: 전체 로딩 검사기의 실패 fixture를 쓴다.** 합성 HTML의 누락 이미지·CSS 하위 누락·JS 동적 fetch 누락·실행 예외를 하나씩 주입하고 문서별 error가 보고되는지 검증한다. CDN 장애는 외부로, 원본에서도 깨진 로컬 링크는 원본 결함으로, 변환 후에만 깨지는 링크는 수집/호환 오류로 분류하되 명시 예외 없는 오류는 모두 실패로 처리한다.

```ts
// tests: reports_every_document, catches_runtime_fetch, distinguishes_source_and_copy
expect(result.passed).toBe(false);
expect(result.documentsChecked).toBe(catalog.documents.length);
expect(result.issues.some(i => i.target.endsWith('dynamic.json'))).toBe(true);
```

- [ ] **Step 2: `npm run test:e2e -- tests/e2e/content.spec.ts`를 실행한다.** 검사기 미구현 때문에 FAIL이어야 한다.
- [ ] **Step 3: 로딩 검사기와 대표 행동 시나리오를 구현한다.** listed HTML 전체와 수집된 추가 HTML을 독립된 페이지로 순회하고 상대 리소스·동적 요청·script 오류를 기록한다. iframe 경로도 대표 문서에서 검사한다. 생명과학 `복습노트/0901/복습문제_0901_Biomolecules_and_Cells.html`, 자료구조 `복습노트/1012/정리노트_1012_Queue.html`, 기계학습 `복습노트/1012/정리노트_1012_Several_Mathematical_Proofs.html`·`복습노트/1014/인터렉티브_01_사전분포와_사후분포.html`, 논회실 `복습노트/실험01/실험01_문제설명.html`·`실험01_기출문제.html`, 전자회로2 `복습노트/0909/문제설명_0909_Cascode_Stage.html`을 사용한다. 제목·수식 렌더·이미지 naturalWidth·문제 버튼·해설·시뮬레이션·sessionStorage 시도 기록·같은 날짜 충돌을 사용자 조작으로 검증한다. 논회실의 inline JSON→img.src 이미지도 열어 extraFiles에 실제 참조 경로를 명시하고, 실행되지 않는 선택적 sample.json fallback은 무조건 누락으로 세지 않는다. 각 문서의 실제 selector를 확인해 테스트에 고정하고 네트워크/로드 완료를 기다린다. screenshot만으로 기능 통과를 주장하지 않는다.
- [ ] **Step 4: `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run verify:content -- --sources .local/sources.json`을 실행한다.** Chromium에서 모든 HTML, 세 브라우저·390/1440px에서 대표 기능을 검증한다. 실제 디렉터리 이름이 바뀌었으면 Task 1 입력 보고서를 근거로 fixture 선택을 갱신한다. 동적 파일 누락은 extraFiles에, 저장 스키마 누락은 storage-rules에 반영한 뒤 영향받은 검증을 재실행한다. 설명 없는 오류 0·원본 해시 불변이 통과 기준이다.
- [ ] **Step 5: 합성 테스트·코드·규칙·검증 절차만 커밋한다.** `git add tools/verify-content.ts tests/e2e/content.spec.ts tests/e2e/representatives.spec.ts docs/operations/content-verification.md package.json config`; `git commit -m "test: verify full content loading and representative study flows"`. 실제 자료·보고서·로그인 상태는 포함하지 않는다.

## Task 8: Workers 정적 제공과 빈 배포물 로컬 검증 (AC-03, AC-07, AC-11)

**Files:** Create `wrangler.jsonc`, `config/hosting/_redirects`, `config/hosting/_headers`, `config/hosting/404.html`, `tools/deploy/bootstrap.ts`, `tests/deploy/hosting.test.ts`, `tests/e2e/hosting.spec.ts`, `README.md`; Modify `package.json`, `tools/cli.ts`, `playwright.config.ts`.

**Interfaces:**
- Consumes: Task 4 결과·최종 Vite dist, `checkBundle`.
- Produces: `buildBootstrap(outputDir:string):Promise<{directory:string;sentinelPaths:string[];bundleHash:string}>` in `bootstrap.ts`. 학습 자료 없는 앱과 합성 HTML·PNG·PDF·목록 sentinel만 생성한다.
- `wrangler.jsonc`: `name:'ajou-study-hub'`, `compatibility_date:'2026-10-24'`, `assets.directory:'./dist'`, `assets.html_handling:'none'`, `assets.not_found_handling:'404-page'`. Worker script·run_worker_first는 추가하지 않는다.

- [ ] **Step 1: hosting 실패 테스트를 쓴다.** 실제 Wrangler 로컬 서버에서 `/` 진입, `.html` 정확한 URL, 한글·공백 파일, `.pack`·`.assets`, font·PDF content-type, 누락 PDF/HTML의 404와 본문 비노출을 검사한다. bootstrap에 실제 source 파일이 하나라도 섞이면 실패해야 한다.

```ts
// tests: serves_exact_html_and_hidden_paths, missing_is_404, bootstrap_has_no_sources
expect((await request.get('/content/test/.assets/x.png')).status()).toBe(200);
expect((await request.get('/missing.pdf')).status()).toBe(404);
expect(bootstrapSourcePaths).toEqual([]);
```

- [ ] **Step 2: `npm test -- tests/deploy/hosting.test.ts`와 `npm run test:e2e -- tests/e2e/hosting.spec.ts`를 실행한다.** hosting 설정 미구현 때문에 FAIL이어야 한다.
- [ ] **Step 3: 정적 설정·bootstrap·CLI 연결을 구현한다.** `/ /index.html 302`를 `_redirects`에 넣고 404.html에는 “자료를 찾을 수 없습니다”와 `/index.html#/catalog`의 “목록으로” 링크를 둔다. `.html` 자동 제거와 SPA fallback은 끈다. 기존 iframe의 스크립트/CDN/임베딩을 막는 전역 CSP·X-Frame-Options를 임의로 추가하지 않는다. `_headers`에 `Cache-Control: private, no-store`를 적용하고 동작을 검사한다. 숨김 부속 파일은 Wrangler emulator에서 실제 제공 여부를 확인한다. `hosting:dev`는 로컬 서버만 연다. README에 원본 설정·수동 갱신·보고서·최종 dist 검사 명령을 기록한다.
- [ ] **Step 4: 위 테스트, `npm run build -- --sources .local/sources.json`, `npm run hosting:dev` 기반 smoke 검사를 실행한다.** 전체 dist에 한도 검사를 다시 실행한다. 여기서는 배포·Access 설정·계정 로그인 없이 로컬 정적 제공만 검증한다.
- [ ] **Step 5: 해당 파일만 커밋한다.** `git add wrangler.jsonc config/hosting tools/deploy/bootstrap.ts tests/deploy/hosting.test.ts tests/e2e/hosting.spec.ts README.md package.json tools/cli.ts playwright.config.ts`; `git commit -m "feat: configure exact static asset serving and empty deployment bundle"`.

## Task 9: 실제 Access 설정과 자료 업로드 차단 장치 (AC-12 전제)

**Files:** Create `tools/deploy/access.ts`, `tools/deploy/guard.ts`, `tests/deploy/access.test.ts`, `tests/e2e/access.spec.ts`, `docs/operations/deployment.md`; Modify `tools/cli.ts`, `package.json`.

**Interfaces:**
- Consumes: bootstrap sentinel, 로컬 DeploymentSettings와 Cloudflare 읽기 API.
- Produces: `readAccessSnapshot(settings:DeploymentSettings):Promise<AccessSnapshot>`, `verifyProtection(settings:DeploymentSettings):Promise<ProtectionEvidence>` in `access.ts`; `assertReleaseAllowed(input:{settings:DeploymentSettings;snapshot:AccessSnapshot;evidence:ProtectionEvidence}):void` in `guard.ts`.
- `DeploymentSettings={accountId:string;workerName:string;allowedEmail:string;accessAppId:string;productionUrl:string;previewUrls:string[]}`는 `.local/deployment.json`에 저장한다. 토큰은 환경변수/로그인 세션만 사용한다.
- `AccessSnapshot={accountId:string;workerName:string;accessAppId:string;allowedEmails:string[];workerWide:boolean;hasBypass:boolean;hosts:string[];freePlan:boolean;fingerprint:string}`는 실제 앱·정책·Workers route 설정을 정규화한 값이다.
- `ProtectionEvidence={accountId:string;workerName:string;accessAppId:string;checkedAt:string;settingsFingerprint:string;policyFingerprint:string;hosts:string[];anonymousBlocked:boolean;otherAccountBlocked:boolean;ownerAllowed:boolean;sentinelHashes:Record<string,string>}`. 로컬 `.reports/access-evidence.json`에만 기록한다.

- [ ] **Step 1: `access.test.ts`에 실패 테스트를 쓴다.** 이메일 없음·도메인 허용·everyone·bypass·허용 이메일 추가·production만 보호·구체적인 path override·유료 플랜·읽기 API 오류·다른 계정 미검증·바뀐 host/policy·만료 증거는 전부 거절한다. 실제 Access API shape는 구현 당일 공식 GET 응답으로 adapter를 맞추고 fixture는 비식별화한다.

```ts
// tests: rejects_broad_policy, requires_all_hosts, rejects_stale_evidence, fails_closed_on_api_error
expect(() => assertReleaseAllowed(bypassInput)).toThrow();
expect(() => assertReleaseAllowed(otherAccountUntested)).toThrow();
expect(() => assertReleaseAllowed(changedPolicyInput)).toThrow();
expect(() => assertReleaseAllowed(validSingleOwnerInput)).not.toThrow();
```

- [ ] **Step 2: `npm test -- tests/deploy/access.test.ts`를 실행한다.** guard/access 미구현 때문에 FAIL이어야 한다.
- [ ] **Step 3: Access adapter·guard·검증 코드를 구현한다.** 이 Worker의 모든 트래픽에만 Access를 적용하는 절차를 문서화하며 계정의 다른 Worker 설정은 바꾸지 않는다. worker destination의 전체 트래픽 보호, exact 이메일 1개 Allow와 OTP, 더 구체적인 hostname/path 정책까지 검사한다. 불명확한 정책은 거절한다. 증거 유효 기간은 24시간이고 host·정책·설정 변경 즉시 무효다. status만 검사하지 말고 비로그인·다른 계정 응답에서 sentinel body/hash가 없고 본인 응답에서 일치하는지 검증한다. 무인 검증 불가한 다른 계정 OTP는 사용자 직접 로그인으로 완료하며 토큰·코드·쿠키를 출력하거나 커밋하지 않는다.
- [ ] **Step 4: 단위 테스트 PASS 후 실제 계정의 준비 조건을 확인하고 빈 bootstrap만 배포한다.** `deploy:bootstrap`은 `buildBootstrap` 결과 외 업로드를 거절한다. 무료 플랜, 대상 계정·Worker 이름, 실제 허용 이메일을 확인한다. Access를 설정한 뒤 `npm run access:verify`로 운영·활성 미리보기 주소의 목록/HTML/이미지/PDF sentinel 전부에 대해 비로그인·다른 계정 차단과 본인 허용을 검증한다. 미사용 preview는 비활성화하고 설정을 읽어 확인한다. 신규 preview를 활성화하면 다시 검증한다. 계정/이메일/로그인 수단 부족이면 이 단계는 미완료로 남기고 실제 자료를 올리지 않는다.
- [ ] **Step 5: 코드·비식별 테스트·운영 문서만 커밋한다.** `git add tools/deploy/access.ts tools/deploy/guard.ts tests/deploy/access.test.ts tests/e2e/access.spec.ts docs/operations/deployment.md tools/cli.ts package.json`; `git commit -m "feat: gate private content uploads on verified access protection"`.

## Task 10: 수동 비공개 배포와 최종 인수 (AC-12, AC-13)

**Files:** Create `tools/deploy/release.ts`, `tests/deploy/release.test.ts`; Modify `README.md`, `docs/operations/deployment.md`, `tools/cli.ts`, `package.json`.

**Interfaces:**
- Consumes: Task 4 BuildResult·보고서, Task 7 로컬 검증 결과, Task 8 최종 dist, Task 9 live snapshot·보호 증거.
- Produces: `releasePrivate(options:{settings:DeploymentSettings;distDir:string;reportPath:string},deps?:ReleaseDependencies):Promise<{url:string;versionId:string;bundleHash:string}>` in `release.ts`; `ReleaseDependencies={readAccessSnapshot:typeof readAccessSnapshot;upload:(directory:string)=>Promise<{url:string;versionId:string}>}`. 기본 deps는 실제 Cloudflare 조회와 로컬 Wrangler 실행을 사용한다. 유일한 실제 자료 업로드 진입점은 `npm run deploy:private`다.

- [ ] **Step 1: `release.test.ts`에 실패 테스트를 쓴다.** uploader는 주입 가능한 테스트 adapter로 두고 보호 증거 미확인·동적 참조 오류·한도 초과·dist 변조·검증 후 policy/host 변경 시 한 번도 호출되지 않아야 한다. 정상 배포에서 전달 파일 집합은 검사한 dist와 같아야 한다.

```ts
// tests: never_uploads_before_all_gates, rechecks_live_policy, uploads_verified_bundle_only
await expect(releasePrivate(invalidOptions, {readAccessSnapshot, upload})).rejects.toThrow();
expect(upload).not.toHaveBeenCalled();
expect(uploadedBundleHash).toBe(verifiedBundleHash);
```

- [ ] **Step 2: `npm test -- tests/deploy/release.test.ts`를 실행한다.** release 미구현 때문에 FAIL이어야 한다.
- [ ] **Step 3: release 함수를 구현한다.** 실제 업로드 직전에 설정·무료 플랜·Access 정책·현재 host를 다시 조회하고 Task 9 guard를 실행한다. 실제 파일 집합과 로컬 검증 결과의 bundleHash를 대조하고 최종 dist 한도·금지 파일·미해결 issue를 검사한다. Wrangler는 검사한 그 디렉터리만 업로드하며 재빌드하지 않는다. 배포 URL·버전·해시·시각을 로컬 보고서에 남기고 무료 사용량 확인 위치·갱신 명령·실패 시 원인을 운영 문서에 기록한다. 로그인 자료를 공개 preview에 복제하지 않는다.
- [ ] **Step 4: 단위 테스트 PASS와 모든 게이트 확인 후 실제 자료를 배포한다.** 운영·활성 preview에서 비로그인/다른 계정으로 실제 HTML·이미지·PDF·catalog 본문을 못 받는지 재검증한다. 본인은 모바일·PC에서 인증 후 대표 자료·문제풀이·내부 링크를 연다. 인가 실패 시 배포 성공으로 보고하지 않고 Access 전체 차단 또는 자료 없는 검증 배포물로 회수한다. rollback도 현재 Access 보호가 유지되는 버전만 선택한다. 다른 주소가 생기면 Task 9 검증을 다시 거친다.
- [ ] **Step 5: `npm run typecheck`, `npm test`, `npm run test:e2e`의 필요한 변경 범위 검증과 실계정 인수 결과를 정리하고 커밋한다.** `git add tools/deploy/release.ts tests/deploy/release.test.ts README.md docs/operations/deployment.md tools/cli.ts package.json`; `git commit -m "feat: release verified study content behind cloudflare access"`. 보고서에는 로컬 완료/클라우드 완료, 각 AC의 실제 증거, 예외 목록, 남은 운영 조치를 구분한다.

## 완료 기준 추적과 자체 검토

| PRD 요구사항 | 소유 Task | 완료 증거 |
| --- | --- | --- |
| §3·§5.1·§6.1 / AC-01~02 | 1, 4, 5, 7 | 실제 5/53/217 보고서, 추가·삭제·제목 변경 테스트, 검색·정렬·유형 화면 |
| §5.2·§6.2 / AC-03~07 | 2, 5, 6, 7, 8 | 정적 closure·동적 요청 검사, 모든 HTML 로딩, 대표 상호작용, 주소 복원, 두 화면 폭 |
| §5.3 / AC-08~09 | 3, 7 | 과목/묶음 격리, local/sessionStorage 예외, 손상 JSON 타입 복구 |
| §6.3 / AC-10 | 1, 4, 7 | 현재 작업 파일 입력, 커밋·dirty·입력/출력 hash, 원본 불변·동일 입력 재현 |
| §6.2·§8 / AC-11 | 2, 4, 8, 10 | 허용 범위·금지 파일·symlink 차단, 최종 파일 수/크기 경계 테스트 |
| §8 / AC-12 | 9, 10 | 실제 계정·운영/preview·비로그인/다른 계정의 body 비노출 |
| §8 / AC-13 | 9, 10 | 본인 OTP 인증 후 모바일·PC 실제 자료 열람 |
| §10 범위 밖 | 전 Task | 신규 서버 저장·본문 검색·PWA·자동 sync·유료 기능 없음 |

자체 검토: PRD §1~12와 위 추적표를 대조했다. Review Focus 5개는 각각 명시된 실패 테스트에 연결했고 공통 타입·함수는 소유 파일과 소비 Task를 명시했다. 알려진 계정 미준비 조건은 Task 9의 게이트로 격리했다. 이 문서는 테스트나 배포가 이미 통과했다는 증거가 아니며 모든 실행 결과는 구현 시 새로 수집한다.

## 계획 근거 자료

2026-10-24 확인. 실제 구현·배포 때 다시 확인하고 정책 변경 시 PRD와 계획을 함께 갱신한다.

- [Vite 환경 요구사항](https://vite.dev/guide/): Node 20.19+/22.12+를 안내한다. 현재 로컬 Node 24로 버전을 고정하고 선택 패키지의 engine/peer 검사도 수행한다.
- [Workers Static Assets 제한](https://developers.cloudflare.com/workers/platform/limits/#static-assets): Free 20,000개, 파일당 25MiB.
- [정적 자산 요금](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/): 정적 요청은 무료이며 Worker 코드를 실행하는 요청은 별도 한도를 따른다.
- [HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/#disable-html-handling): `none`으로 기존 `.html` 경로를 보존한다.
- [Custom 404 pages](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/#custom-404-pages): `404-page`와 루트 404.html로 404 상태와 목록 복귀 링크를 제공한다.
- [Workers와 Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/): Worker 전체 트래픽 보호와 preview 전용 보호를 구분하고 더 구체적인 hostname/path 규칙이 우선한다. 실제 정책은 exact 이메일 한 주소로 좁힌다.
