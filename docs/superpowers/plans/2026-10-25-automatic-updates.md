# Automatic Private Study Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 과목 레포 main push를 계기로 다섯 원격 자료를 수집·검증하고, 본인 전용 Cloudflare 사이트를 안전하게 자동 갱신한다.

**Architecture:** 과목 레포의 알림 workflow가 앱 main의 고정 workflow를 호출한다. 앱의 단일 runner가 다섯 main SHA를 고정해 새 checkout에서 빌드·검증한다. 초기 사람의 접근 검증과 매 배포의 보호 설정 확인을 구분한 CI 전용 경로를 추가하며, 기존 수동 릴리스 guard는 유지한다. 외부 미검증 사항은 Task 5에 격리하고 그 전에는 무인 업로드를 구현하지 않는다.

**Tech Stack:** 기존 Node 24.15.0, TypeScript, Vitest, Playwright, Wrangler 4.152.0. GitHub Actions ubuntu-24.04, GitHub App 단기 토큰, Cloudflare Workers Static Assets + Access. workflow 구조 검사용 devDependency yaml 2.9.1(Node >=14.6)은 Task 2에서 설치한다.

**Spec:** [설계와 결정](../specs/2026-10-25-automatic-updates-design.md), [가정 검증](../specs/2026-10-25-automatic-updates-assumptions.md), [기존 PRD v1.0](../../prd/PRD.md). 작성일 2026-10-25. 사용자 선택: push 알림용 파일 추가. **현재 요청은 계획만이며 모든 Task는 미실행이다.** 기존 SDD 실행 방식 선호는 보존하되, 별도의 구현 요청이 있기 전에는 시작하지 않는다.

## Global Constraints

- “본인 한 명만 접근, 무료 범위 운영, 원본 자료 보존” 조건을 유지한다. Access는 이메일 한 주소, worker-wide, preview 비활성, workers.dev 주소 하나를 기본으로 한다.
- “과목 레포 5개에 알림용 workflow 파일만 추가”한다. 기존 학습 자료·커밋되지 않은 작업을 자동 커밋·reset·덮어쓰기하지 않는다. 실제 source workflow는 Task 8에서 격리한 브랜치로 준비한다.
- “PC에만 있는 수정·미추적 파일·push하지 않은 커밋은 원격 자동 배포에 들어가지 않는다.” 로컬 dirty 입력 모드는 유지한다.
- “SHA 고정 후에는 해당 실행 중 latest를 다시 checkout하지 않는다.” 앱 SHA와 다섯 source SHA를 최종 기록에 결합한다.
- “같은 checkout에서 build·verify·release를 실행한다.” Windows/다른 job의 proof를 재사용하지 않는다.
- “기존 금지 파일·허용 경로·child symlink 차단·전후 원본/출력 hash·Git 추적·전체 HTML/대표 브라우저 검증을 유지한다.” 문서 수는 고정하지 않는다.
- “사람의 OTP 세션을 GitHub Secrets에 넣거나, 오래된 성공 플래그를 새 증거처럼 작성하는 방식은 채택하지 않는다.” 기존 manual guard의 24시간 요건을 제거하지 않는다.
- 무인 경로는 초기 human 검증 + 현재 설정/비로그인 검증이라는 별도 보증 계약이다. 매 배포에 owner/other 로그인 성공을 실측했다고 주장하지 않는다. 이 변경의 승인과 실계정 실증은 Task 5의 선행 조건이다.
- “Cloudflare 배포 token은 배포 단계에서만 제공한다.” 자료 checkout token은 checkout 후 폐기하고 브라우저·서버·잔여 프로세스는 secret 주입 전에 종료한다.
- “결과가 불명확한 업로드를 단순 취소·중복 재시도하지 않는다.” 단일 배포 실행을 끝까지 확인한다.
- “유료 업그레이드·도메인 구매를 자동 실행하지 않는다.” 예산 도달 시 초과 사용 중단 설정을 확인하고, 용량·시간 한도 실패는 사이트 공개나 검사 생략으로 우회하지 않는다.
- 원격 workflow 게시·GitHub App 설치/secrets 등록·Cloudflare 변경은 각각 실제 실행 시 사용자 승인을 확인한다. 계획 작성은 이 권한을 부여하지 않는다.

## Review Focus

1. 위조 dispatch·임의 repo/ref·shell 문자열: 실행 요청은 정해진 알림으로만 처리하고 소스/앱 main은 독립 조회한다(Task 1~2).
2. push 도중 SHA 이동·dirty/다른 root·검증 후 소스 변경: clean 고정 checkout과 같은 경로의 proof를 결합하고 혼합 결과를 게시하지 않는다(Task 1,4,6).
3. 배포 메타데이터와 보호 정책 변화의 혼동: 정상 버전/시각 변화는 허용하되 이메일·Worker ID·우회·인증/호스트 변경은 멈춘다(Task 3,5,6).
4. 중복 실행·강제 종료·업로드 결과 불명: 완료된 receipt만 중복 생략에 쓰고 미완료 upload intent가 있으면 운영자 확인 전 중지한다(Task 4,6~7).
5. 원본 스크립트/로그/보고서의 secret 접근과 공개 노출: 단계별 최소 권한, 프로세스 종료, 작은 비공개 보고서, 배포 후 차단 검사/회수를 검증한다(Task 2,4~8).

## 파일 책임과 공통 계약

| 경로 | 책임 |
| --- | --- |
| tools/ci/sources.ts, sources-cli.ts | 고정 레포 main 조회, checkout 검증, source-settings/snapshot 작성 |
| tools/ci/notify.ts, config/ci/notify-study-hub.yml.template | 고정 workflow 실행 요청과 과목별 알림 파일 생성 |
| tools/ci/receipts.ts, receipts-cli.ts | 작은 upload intent/완료 receipt, 중복·불명 결과 판정 |
| tools/deploy/access-policy.ts, access-baseline.ts | 보안 의미 fingerprint와 초기 승인 기준 |
| tools/deploy/auto-readiness.ts | 실계정·권한·Linux·회수 선행 조건의 증거 |
| tools/deploy/release-artifact.ts | 기존/자동 경로가 공유하는 검증된 사본 staging·고정 업로더 |
| tools/deploy/auto-release.ts, anonymous-probe.ts, emergency-disable.ts | CI 전용 인가, 게시 후 비로그인 검사, 해당 주소만 회수 |
| .github/workflows/study-hub-update.yml | 단일 runner의 수집·검증·조건부 배포 orchestration |
| docs/operations/automatic-updates.md | 설정, 비용, 상태 판독, 중단/재승인/회수 절차 |

`SourceRevision={courseId:string;repository:string;sha:string;root:string}`. `SourceSnapshot={version:1;appSha:string;revisions:SourceRevision[];inputFingerprint:string;settingsPath:string}`. inputFingerprint는 정렬한 `(appSha,courseId,repository,sha)`로 계산하며 runner 절대 경로는 제외한다. root/settingsPath는 해당 실행의 검증에 별도로 결합한다.

`AccessInspection={snapshot:AccessSnapshot;workerId:string;protectionFingerprint:string}`. `AutomationBaseline={version:1;contract:'initial-human-current-policy-v1';settingsFingerprint:string;protectionFingerprint:string;workerId:string;approvedAt:string;initialEvidenceSha256:string}`. baseline은 인증 세션이 아닌 승인 자료이며 배포 대상·정책이 달라지면 사람이 다시 승인한다. Repository Secret `STUDY_HUB_BASELINE_JSON`에서 읽고 실행 중 자동 갱신하지 않는다.

`AutoReceipt={version:1;runId:string;attempt:number;inputFingerprint:string;state:'upload-intent'|'verified'|'outcome-unknown'|'quarantined';versionId?:string;bundleHash?:string}`. verified는 게시 후 검사가 끝난 경우에만 사용하고 versionId/bundleHash를 필수 검증한다. 과거의 성공만으로 unresolved intent를 무시하지 않는다. historyComplete는 마지막 verified checkpoint와 그 이후 모든 시도의 원격 실행/intent/receipt가 확인됐다는 뜻이다. 그 checkpoint 이전의 이미 해결된 기록까지 영구 보관할 필요는 없다. checkpoint가 7일 보관 기한을 넘겨 복원할 수 없으면 사람이 원격 상태를 확인하고 새 checkpoint를 승인한다.

검증 모드에는 Cloudflare token/baseline이 없다. 원격 활성화 전 기본 변수 `STUDY_HUB_AUTO_DEPLOY_ENABLED=false`; 최초 활성화는 true 전환 + Task 5 readiness 통과 + baseline 등록이 모두 있어야 한다. 이후 각 실행은 승인된 baseline과 현재 정책을 비교하며, 최초 readiness의 24시간 제한을 매일 다시 적용하지 않는다. 설정 누락을 fixture 사이트 게시나 자동 계정 생성으로 대체하지 않는다.

## Actions·권한 고정값

2026-10-25 연결된 GitHub의 공식 태그 ref를 GET으로 확인했다. 구현 시 SHA의 action.yml 계약을 읽고 해당 Linux/Node에서 확인한다. 떠 있는 태그만 workflow에 넣지 않는다.

| Action | 확인한 태그 | 전체 commit SHA |
| --- | --- | --- |
| actions/checkout | v6 | d23441a48e516b6c34aea4fa41551a30e30af803 |
| actions/setup-node | v6 | 249970729cb0ef3589644e2896645e5dc5ba9c38 |
| actions/create-github-app-token | v2 | fee1f7d63c2ff003460e3d139729b119787bc349 |
| actions/upload-artifact | v4 | ea165f8d65b6e75b540449e92b4886f43607fa02 |

자료 읽기 App은 지정한 다섯 레포 Contents:read만 요청한다(`STUDY_HUB_READER_APP_ID`, `STUDY_HUB_READER_PRIVATE_KEY`). 알림용 App은 앱 레포 Actions:write만 요청한다(`STUDY_HUB_DISPATCH_APP_ID`, `STUDY_HUB_DISPATCH_PRIVATE_KEY`). 두 App을 하나의 광범위 PAT로 대체하지 않는다. 앱의 기본 GITHUB_TOKEN은 Contents:read와 Actions:read만 요청해 해당 앱의 실행/receipt를 읽는다. 자동 모드의 빌드 전 버전·정책 조회는 별도 읽기 전용 `CLOUDFLARE_READ_TOKEN`으로 한다. 배포 단계의 `CLOUDFLARE_API_TOKEN`은 대상 계정의 배포/읽기/해당 Worker 주소 비활성화에 필요한 실제 최소 scope를 Task 5에서 확정한다. Access 정책 수정 권한은 자동화에 주지 않는다.

---

### Task 1: 허용된 원격 main을 고정된 입력으로 수집

**Files:** Create `tools/ci/sources.ts`, `tools/ci/sources-cli.ts`, `tests/ci/sources.test.ts`; Modify `package.json`(ci:sources 명령).

**Interfaces:** `resolveRevisions(request:typeof fetch,token:string):Promise<Pick<SourceRevision,'courseId'|'repository'|'sha'>[]>`; `createSourceSnapshot({project,appSha,checkouts}:{project:string;appSha:string;checkouts:Record<string,string>}):Promise<SourceSnapshot>`. config/courses.ts의 다섯 repo/main만 조회한다. `ci:sources resolve`는 비밀 없는 SHA JSON, `ci:sources bind`는 `.local/ci-sources.json`과 `.reports/ci-sources.json`을 작성한다.

- [ ] **Step 1: 실패 테스트 작성.** `sources.test.ts`에서 조회 URL이 다섯 고정 repo/main뿐인지, 거짓 repo/ref·API redirect·실패/누락 repo·잘못된 SHA를 거절하는지 검사한다. 실제 임시 Git checkout으로 dirty/미추적/다른 origin/예정 SHA와 다른 HEAD를 거절하고, 같은 SHA 집합은 경로가 달라도 같은 fingerprint임을 검증한다. checkout 뒤 원격 main이 이동해도 고정된 HEAD를 유지한다.
- [ ] **Step 2:** `npx vitest run tests/ci/sources.test.ts` → 새 함수 미구현으로 FAIL 확인.
- [ ] **Step 3:** 조회·bind를 구현한다. HTTPS 고정 GitHub API, redirects:error, JSON 구조·40자리 SHA 검사, shell 문자열 대신 execFile 배열을 쓴다. app clean SHA도 확인하고 설정을 안전한 프로젝트 `.local` 안에만 작성한다. CI source roots는 앱의 형제 `sources/<courseId>` checkout이며 원본 PC 폴더에는 접근하지 않는다.
- [ ] **Step 4:** 같은 테스트와 `npm run typecheck` → PASS. 외부 fetch는 가짜 boundary로 대체하고 실제 원본/GitHub에는 쓰지 않는다.
- [ ] **Step 5:** 해당 네 파일만 stage하고 `feat: pin trusted remote study source revisions`로 commit.

### Task 2: 과목별 알림 파일과 고정 실행 요청

**Files:** Create `tools/ci/notify.ts`, `tools/ci/notifier-templates.ts`, `config/ci/notify-study-hub.yml.template`, `tests/ci/notify.test.ts`, `tests/ci/notifier-templates.test.ts`; Modify `package.json`, `package-lock.json`(yaml 2.9.1과 ci:notify/ci:notifiers).

**Interfaces:** `dispatchUpdate({sourceRepository,token}:{sourceRepository:string;token:string},request:typeof fetch):Promise<void>`; `generateNotifiers(project:string):Promise<Record<string,string>>`. Task 1 allowlist를 소비한다. 생성 파일은 `.generated/source-notifiers/<courseId>/.github/workflows/notify-study-hub.yml`; 원본 레포에 자동 설치하지 않는다.

- [ ] **Step 1: 실패 테스트 작성.** `yaml.parse`로 main push만, 자료 checkout/npm 실행 없음, workflow의 고정 endpoint/ref, App 최소 권한·full SHA pin을 검증한다. 악성 repo 문자열은 POST가 호출되지 않아야 한다. 정상 요청은 `/repos/jjundev/ajou-study-hub/actions/workflows/study-hub-update.yml/dispatches`, body `{ref:'main',inputs:{source_repository:<allowlisted repo>}}` 하나뿐이어야 한다. 비정상 HTTP·응답 구조·redirect는 실패하고 token/원문 오류가 로그에 없어야 한다.
- [ ] **Step 2:** `npx vitest run tests/ci/notify.test.ts tests/ci/notifier-templates.test.ts` → 미구현 FAIL 확인. 이 단계에서만 `npm install --save-dev --save-exact yaml@2.9.1`로 필요한 parser를 추가한다.
- [ ] **Step 3:** notifier와 생성기를 구현한다. 과목 workflow에는 npm 설치 없이 실행 가능한 작은 고정 요청만 넣고 request 동작은 모듈 테스트와 같은 구조로 검증한다. token은 단계 환경으로만 전달한다. API version은 확인한 `2026-03-10`; 공식 dispatch 응답의 200/run ID·URL을 검증하며 모호한 결과를 무한 재시도하지 않는다. App action post-cleanup이 단기 token을 폐기하게 한다.
- [ ] **Step 4:** 위 테스트·typecheck·`npm run ci:notifiers` → PASS; 다섯 파일이 생성됐고 source 루트에는 변화가 없는지 확인한다.
- [ ] **Step 5:** 위 task 파일만 commit: `feat: generate scoped source push notifications`.

### Task 3: 수동 경로를 유지하는 보호 의미·초기 승인 모델

**Files:** Create `tools/deploy/access-policy.ts`, `tools/deploy/access-baseline.ts`, `tests/deploy/access-policy.test.ts`, `tests/deploy/access-baseline.test.ts`; Modify `tools/deploy/access.ts`, `package.json`(access:approve-automation).

**Interfaces:** `readAccessInspection(settings:DeploymentSettings,options?:ReadOptions):Promise<AccessInspection>`; 기존 `readAccessSnapshot`은 같은 검증의 snapshot만 반환하는 호환 wrapper. `approveAutomation({settings,evidence,inspection,now}:{settings:DeploymentSettings;evidence:ProtectionEvidence;inspection:AccessInspection;now:number}):AutomationBaseline`; `assertAutomationAllowed({settings,inspection,baseline,now}:{settings:DeploymentSettings;inspection:AccessInspection;baseline:AutomationBaseline;now:number}):void`. initialEvidenceSha256는 canonical JSON으로 직렬화한 ProtectionEvidence의 SHA-256이다.

- [ ] **Step 1: 실패 테스트 작성.** 기존 raw fingerprint 의미/수동 guard 유지; 배포 version·수정 시각 변화만으로 protectionFingerprint가 달라지지 않음; worker ID·email·IdP·bypass·호스트·목적지/Free 변화는 실패/기준 변경; unknown 보안 의미 거절을 검증한다. 초기 approval은 실제 기존 human evidence가 24시간 이내이고 current snapshot/settings와 맞아야 하며 synthetic scope/미완료/미래 시각을 거절한다. CI 보고서는 현재 owner/other 검증으로 둔갑하지 않아야 한다.
- [ ] **Step 2:** `npx vitest run tests/deploy/access-policy.test.ts tests/deploy/access-baseline.test.ts` → FAIL.
- [ ] **Step 3:** 기존 한 번의 GET 자료 수집·엄격한 normalize 검사를 재사용해 inspection을 만든다. semantic projection은 계정·immutable Worker ID·허용 email·단일 worker 목적지·단일 OTP IdP·인증 우회 부재·호스트/preview/route 상태·확인된 Free 조건만 정규화한다. 타임스탬프·활성 버전은 포함하지 않는다. 새 보안 의미 필드는 명시적 검토 전 거절한다. approval은 별도 canonical `.reports/automation-baseline.json`에 기록하며 Secrets 등록을 자동 실행하지 않는다.
- [ ] **Step 4:** 새 두 테스트와 기존 `tests/deploy/access.test.ts`, `npm run typecheck` → PASS. 실제 브라우저 세션·Cloudflare를 사용하지 않는다.
- [ ] **Step 5:** task 파일 commit: `feat: separate automation policy approval from human access evidence`.

### Task 4: 배포 없이 실행되는 단일 runner 검증 workflow

**Files:** Create `.github/workflows/study-hub-update.yml`, `tools/ci/receipts.ts`, `tools/ci/receipts-cli.ts`, `tests/ci/receipts.test.ts`, `tests/ci/workflow.test.ts`, `docs/operations/automatic-updates.md`; Modify `package.json`(ci:receipts).

**Interfaces:** `classifyPreviousAttempts({receipts,currentVersionId,inputFingerprint,historyComplete,firstApprovedRun}:{receipts:AutoReceipt[];currentVersionId:string|null;inputFingerprint:string;historyComplete:boolean;firstApprovedRun:boolean}):'build'|'skip'|'blocked'`; `createUploadIntent(snapshot:SourceSnapshot,manifest:BuildReport,run:{id:string;attempt:number}):AutoReceipt`. `confirmRemoteIntent(expected:AutoReceipt,artifact:{id:number;digest:string},options:{request:typeof fetch;token:string}):Promise<void>`는 고정 앱의 artifact metadata/run provenance와 upload 단계의 ID/digest를 대조한다. workflow는 Task 1 snapshot·Task 2 dispatch 입력을 소비한다. 이 Task는 remote deploy step 없이 검증 결과만 만든다.

- [ ] **Step 1: 실패 테스트 작성.** 완료 receipt+현재 원격 버전+입력 일치만 skip한다. 이전 CI 시도가 없다고 확인한 최초 승인 run 또는 완전한 기록의 정상 입력 변경은 build, intent/unknown/quarantine·삭제/만료로 기록 완전성을 확인할 수 없으면 blocked로 판정한다. 현재 버전이 마지막 verified receipt와 다르면 수동 변경/불명 상태로 중지한다. 임의 artifact·다른 workflow/branch/run provenance는 거절한다. 배포와 무관한 verify-only 실행은 이 remote release 판정을 사용하지 않고 항상 검증한다. YAML 구조에서 PR/fork secret 사용 없음, 단일 job·전체 workflow concurrency group `study-hub-production`, `cancel-in-progress:false`, 배포 token 없음, fixture fallback 없음, 동일 checkout 경로/명령 순서, 전체 dist artifact 금지를 검사한다.
- [ ] **Step 2:** `npx vitest run tests/ci/receipts.test.ts tests/ci/workflow.test.ts` → FAIL.
- [ ] **Step 3:** main push + workflow_dispatch를 연결한다. app checkout은 실행의 신뢰 main SHA에 고정하고 five SHA를 조회한 후 다섯 checkout을 같은 runner에 만든다(`persist-credentials:false`). Reader token을 즉시 폐기한 뒤 `npm ci`, 세 브라우저 설치, typecheck/단위/E2E, 실제 `build --sources .local/ci-sources.json`, `verify:content --sources .local/ci-sources.json` 순으로 실행한다. 검증 뒤 재빌드하지 않는다. small report는 1MiB 이하·보관 7일로 제한하고 dist·원본·쿠키·config secret은 업로드하지 않는다. timeout-minutes는 job 60, notifier 5로 시작하며 실제 계측으로 판단한다.
- [ ] **Step 4:** 새 테스트/typecheck → PASS. 별도로 승인된 GitHub 수동 검증 실행에서 ubuntu-24.04/Node 24.15.0/세 브라우저·한글 경로·공간·프로세스 종료를 검증한다. Linux 실행을 못 하면 UNVERIFIED로 남기며 무인 배포 준비 완료로 표시하지 않는다. 원격 실행 자체도 실제 실행 시 승인 대상이다.
- [ ] **Step 5:** task 파일 commit: `feat: validate pinned study updates in a secret-limited workflow`.

### Task 5: 실계정 준비·무인 계약의 선행 실증 게이트

**Files:** Create `tools/deploy/auto-readiness.ts`, `tests/deploy/auto-readiness.test.ts`; Modify `docs/operations/automatic-updates.md`, `package.json`(access:automation-readiness). 로컬 출력 `.reports/automation-readiness.json`과 `.reports/automation-baseline.json`은 Git 제외.

**Interfaces:** 이 파일에서 `AutomationReadiness`를 정의한다. `assertAutomationReady({baseline,readiness,inspection,settings}:{baseline:AutomationBaseline;readiness:AutomationReadiness;inspection:AccessInspection;settings:DeploymentSettings},now?:number):void`. readiness는 `version:1`, `passed:boolean`, `checkedAt:string`, `baselineSha256:string`, `settingsFingerprint:string`, `protectionFingerprint:string`, `linuxRunId:string`, `credentialIsolationVerified:boolean`, `emergencyDisableVerified:boolean`, `contractApproved:boolean`를 포함하고 생성 후 24시간 이내에만 최초 활성화/Secret 등록을 허용한다. 이후 실행은 Task 3의 baseline과 현재 inspection을 사용한다. CI source 변경마다 사람의 세션을 새로 보관하는 증거가 아니다.

- [ ] **Step 1: 실패 테스트 작성.** missing/expired/다른 baseline/타깃/정책·실증 항목 하나라도 false인 readiness를 거절하며, 승인만 있고 live 실증이 없는 경우도 거절한다. 순수 synthetic 성공을 live 준비 완료로 기록하는 경로를 막는다.
- [ ] **Step 2:** `npx vitest run tests/deploy/auto-readiness.test.ts` → FAIL.
- [ ] **Step 3:** 준비 검증기와 운영 체크리스트를 구현한다. 검증되지 않은 계정 응답을 Free/보호 성공으로 추정하지 않는다. 이후 실제 실행 승인을 받은 경우만, 기존 빈 bootstrap → Access → owner/independent other/anonymous 실증을 수행하고 Task 3 approval을 만든다. baseline 자체에는 일별 human-proof 만료를 적용하지 않는 대신 정책/대상 변경 시 반드시 재승인하는 보증 변경을 사용자에게 명시해 승인받는다.
- [ ] **Step 4:** 단위/typecheck PASS 후, 승인된 실제 계정에서 GET schema/Free/최소 token 권한·배포에 따른 semantic fingerprint 안정성·프로세스/자격 증명 격리·이 Worker workers.dev 비활성화/재활성화와 재검증을 실증한다. 주소 하나·preview 비활성 조건을 확인한다. 격리/정책 projection/긴급 회수 중 하나라도 성립하지 않으면 게이트 실패로 기록하고 Task 6~8을 실행하지 않는다. 자료가 없는 앱만 사용한다.
- [ ] **Step 5:** 코드/운영 문서만 commit: `feat: gate unattended publishing on explicit live readiness`. 실제 증거·인증·secrets·자료는 commit하지 않는다.

### Task 6: 같은 결과물만 게시하는 CI 릴리스와 실패 회수

**Depends on:** Task 5 실제 통과·계약 승인. 이 조건 전에 uploader 구현·활성화를 진행하지 않는다.

**Files:** Create `tools/deploy/release-artifact.ts`, `tools/deploy/auto-release.ts`, `tools/deploy/anonymous-probe.ts`, `tools/deploy/emergency-disable.ts`, `tests/deploy/auto-release.test.ts`, `tests/deploy/anonymous-probe.test.ts`, `tests/deploy/emergency-disable.test.ts`; Modify `tools/deploy/release.ts`, `package.json`(deploy:automatic).

**Interfaces:** `releaseAutomatic({settings,baseline,snapshot,run,intentArtifact}:{settings:DeploymentSettings;baseline:AutomationBaseline;snapshot:SourceSnapshot;run:{id:string;attempt:number};intentArtifact:{id:number;digest:string}},testOptions?):Promise<AutoReceipt>`; `probeAnonymousAssets(settings:DeploymentSettings,manifest:BuildReport,request:typeof fetch):Promise<void>`; `disableProductionEndpoint(settings:DeploymentSettings,request:typeof fetch):Promise<void>`. releaseAutomatic는 Task 4의 createUploadIntent/confirmRemoteIntent를 사용하며 확인 없는 기본 경로를 제공하지 않는다. 테스트 의존성/주입 경계의 타입은 auto-release.ts의 testOptions에 모아 정의하고 기존 패턴처럼 별도 testProjectRoot에서만 허용한다. 공통 staging helper의 manual/CI authorization callback도 내부 wrapper만 구성하며 CLI/설정으로 전달할 수 없다.

- [ ] **Step 1: 실패 테스트 작성.** 이전 proof를 복사하거나 새 flag만 쓰면 실패; baseline 정책 drift/만료 runtime/소스·settings 변경/미해결 intent에서 uploader 미호출; private manual 24h 보호는 그대로임을 검사한다. 게시 후 catalog/HTML/nested HTML/이미지/PDF/font 각각의 비로그인 원문·generic404·5xx·외부 redirect가 성공으로 오인되지 않아야 한다. 업로드 timeout은 outcome-unknown, 보호 이상은 주소 비활성화 및 실제 비활성 확인 전까지 quarantined로 남는다.
- [ ] **Step 2:** 새 deploy 테스트 세 개를 실행 → 미구현 FAIL.
- [ ] **Step 3:** 기존 release.ts의 source/runtime 검증·소유 staging 사본·고정 업로더·receipt 코드를 공유 helper로 추출한다. manual wrapper는 기존 assertReleaseAllowed, CI wrapper는 Task 3의 baseline/current inspection을 사용한다. 인가를 staging 전/후/업로드 직전에 확인하고 자료/설정/사본 해시 검사를 유지한다. anonymous probe는 manifest의 실제 여섯 종류 파일과 기존 recognizedAccessDenial을 사용한다. 회수는 고정 계정/Worker `/workers/scripts/ajou-study-hub/subdomain`의 enabled:false만 허용하고 Access 정책은 변경하지 않는다. 회수 실패를 성공으로 보고하지 않는다.
- [ ] **Step 4:** 새 테스트, 기존 release/access/bootstrap-upload 테스트와 typecheck → PASS. 기존 manual 경로의 동작 회귀를 확인하고, UI가 바뀌지 않았다면 무관한 전체 브라우저 반복을 요구하지 않는다. helper/API 결과를 합성한 테스트는 실계정 통과로 표시하지 않는다.
- [ ] **Step 5:** task 파일 commit: `feat: publish approved automatic updates with protected recovery`.

### Task 7: 검증 workflow에 제한된 배포·receipt 연결

**Files:** Modify `.github/workflows/study-hub-update.yml`, `tools/ci/receipts.ts`, `tools/ci/receipts-cli.ts`, `tests/ci/workflow.test.ts`, `tests/ci/receipts.test.ts`; Create `tests/ci/pipeline.test.ts`.

**Interfaces:** Task 4 receipt 상태와 Task 6 releaseAutomatic을 연결한다. 고유 artifact 이름 `study-hub-intent-<runId>-<attempt>`와 `study-hub-receipt-<runId>-<attempt>`를 사용한다. inputFingerprint는 snapshot 기준, 완료 receipt는 실제 version/bundleHash 기준이다.

- [ ] **Step 1: 실패 테스트 작성.** 검증 모드/설정 미비에서 배포 자격 증명·uploader가 사용되지 않음; 전체 검사 실패 시 intent 없음; intent의 원격 저장 확인 전 업로드 없음; 업로드 직후 강제 중단이면 다음 run blocked; postcheck 실패·회수 실패가 verified로 덮이지 않음; 최신 queued 변경이 고정 SHA로 새 실행되는지 검사한다. artifact 접근 실패/삭제로 과거 intent 존재를 확인할 수 없으면 자동 skip/배포하지 않고 운영자 확인을 요구한다.
- [ ] **Step 2:** `npx vitest run tests/ci/receipts.test.ts tests/ci/workflow.test.ts tests/ci/pipeline.test.ts` → FAIL.
- [ ] **Step 3:** verify-only 모드는 Cloudflare 자격 증명 없이 항상 검증한다. 자동 모드의 빌드 전 짧은 preflight에는 읽기 전용 token과 baseline/settings만 제공해 원격 버전/정책·receipt를 확인하고 중복을 생략한다. 읽기 token은 그 단계 종료 후 제공하지 않는다. 검증 종료 후 ci:receipts가 `.reports/ci-upload-intent.json` 하나를 작성하고, 고정 upload-artifact 단계가 이 파일만 immutable artifact로 저장한다. artifact ID/digest를 다음 배포 단계에 넘겨 원격 metadata/run·현재 intent를 대조한다. 실제 배포 token은 브라우저/서버 종료 이후의 단일 단계에만 주입한다. 최초 활성화는 Task 5 등록을 거치고 매 실행은 enable 변수·승인 baseline·현재 보호 조건을 확인한다. remote intent 확인이 없으면 releaseAutomatic은 업로드하지 않는다. postcheck 완료 receipt만 성공·중복 생략에 사용한다. 배포 도중 자동 취소·unknown 재시도는 하지 않는다. 큰 artifact·숨김 secret·HTML 본문·raw subprocess 출력은 금지한다.
- [ ] **Step 4:** 위 세 테스트/typecheck PASS. 단일 프로세스 합성 pipeline으로 no-change/build-failure/policy-drift/upload-unknown/postcheck-failure/verified 전이를 검증한다. Actions YAML lint와 실제 수동 verify 실행을 확인하고 단계별 secret 노출이 없는지 검토한다. 업로드 미실행 상태는 검증 완료와 별도로 기록한다.
- [ ] **Step 5:** task 파일 commit: `feat: connect verified source updates to guarded deployment`.

### Task 8: 승인된 원격 배치·실제 push 인수와 운영 인계

**Files:** Modify `docs/operations/automatic-updates.md`, `docs/operations/implementation-status.md`, `README.md`, `docs/prd/PRD.md`. 외부 다섯 source repo는 각각 `.github/workflows/notify-study-hub.yml`만 대상이다.

**Interfaces:** Task 2의 생성 파일과 Task 5~7의 승인/receipt/활성화 계약을 소비한다. 새 JSON/API 계약을 만들지 않는다.

- [ ] **Step 1: 로컬 검증.** 현재 변경에 맞는 전체 단위·typecheck와 workflow/pipeline 테스트를 실행한다. 실제 source/브라우저에 영향을 주는 변경이 있으면 한 번 actual build → runtime verify를 수행하고 정확한 성공 보고서를 보존한다. 기존 canonical proof를 테스트 fixture로 덮어쓰지 않는다. 계획의 모든 Review Focus와 테스트 연결을 자체 점검한다.
- [ ] **Step 2: 원격 변경 승인 확인.** App 설치·최소 권한·secrets·Free/초과 중단·원격 workflow push/merge 범위를 구체적으로 제시한다. 승인 후에만 앱을 먼저 verify 모드로 게시하고, source별 격리 브랜치에 알림 workflow 하나만 반영한다. dirty 원본 작업을 섞지 않는다. source 자료를 인위적으로 편집하지 않고 workflow 추가 push/정상 후속 변경으로 전달을 확인한다.
- [ ] **Step 3: 실제 인수.** 각 다섯 repo/main 이벤트 전달, 다섯 실제 SHA·동일 fingerprint 중복, 자료 변경/추가/삭제 후 catalog, 겹친 push, 실패 시 기존 사이트, 비로그인/독립 다른 계정 차단과 본인 모바일·PC 읽기를 확인한다. 무인 모드에서 현재 owner/other 세션을 매번 검증했다고 표시하지 않는다. 최초 인수 실패는 활성화하지 않는다.
- [ ] **Step 4: 활성화와 회수 확인.** 승인된 readiness/baseline·예산·알림을 확인하고 `STUDY_HUB_AUTO_DEPLOY_ENABLED=true`로 전환한다. 실제 자동 배포의 version/hash/protection을 확인한다. 장애 실증은 빈 검증 배포물로 제한하고 실제 학습 자료를 공개하지 않는다. 이후의 unknown/quarantine은 수동 확인과 새 승인 전까지 중지한다.
- [ ] **Step 5: 문서·commit.** PRD v1.1의 자동갱신 범위, 원격과 local dirty 자료 차이, 비용/시간 실측, secret 갱신, 비활성화·새 baseline 승인·실패 원인과 회수 절차를 기록한다. 실제 AC/클라우드 결과는 관측한 범위만 완료 처리하고 원본/인증/로컬 증거는 Git에 넣지 않는다. 작업별 리뷰 후 전체 변경 리뷰를 수행한다.

## 완료 기준과 계획 자체 점검

| 요구/실패 조건 | 소유 Task·증거 |
| --- | --- |
| 다섯 source main push·수동 갱신·앱 코드 변경 | 1,2,4,8: allowlist dispatch와 실제 이벤트 전달 |
| 원격 SHA 고정·원본 보존·local dirty 구분 | 1,4,6: 실제 임시 Git, source binding·전후 hash |
| 기존 자료/링크/저장 호환 유지 | 4,6,8: 기존 전체 HTML·대표 브라우저 검사 |
| 초기 human와 현재 machine 보증 구분 | 3,5,6: 별도 baseline/inspection, manual guard 회귀·실계정 gate |
| 메타데이터 변화와 실제 정책 변화 구분 | 3,5: projection mutation 테스트·실계정 읽기 비교 |
| 무료 한도·artifact 용량·token/세션 노출 | 2,4,5,7,8: 구조 검사·최소 권한·비밀 없는 요약·실제 예산 설정 |
| 취소/중복/중간 실패·원격 불명 상태 | 4,6,7,8: intent-before-upload·receipt provenance·회수 실증 |
| 실제 owner-only·모바일/PC·자동배포 | 5,8: 실계정 인수. 합성 성공으로 대체하지 않음 |

자체 점검: 설계의 source/권한/보호/회수/비용 조건을 위 Task에 연결했다. 공통 타입은 한 번 정의했고 consumer는 producer를 참조한다. Review Focus 5개 모두 실패 테스트를 갖는다. 검증 모드는 Task 1~4만으로 독립 사용 가능하며, 외부 검증 실패가 수집 기능을 공개 배포로 우회시키지 않는다. Task 6~8은 Task 5 실제 통과 이전에 진행할 수 없다. 현재 모든 체크박스는 미실행이다.

공식 세부 근거: [workflow dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event), [concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency), [기존 설계의 요금·플랫폼 근거](../specs/2026-10-25-automatic-updates-design.md#확인한-서비스-조건). Action SHA는 공식 태그 GET, yaml 2.9.1은 공식 npm registry metadata로 2026-10-25 확인했다. 이는 실제 runner 실행·계정 설정·배포 증거가 아니다.
