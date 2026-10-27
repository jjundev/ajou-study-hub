# Minimal Automatic Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 과목 5개 main push가 현재의 본인 전용 사이트 갱신으로 이어지게 한다.

**Architecture:** 기존 Reader/Dispatcher, SHA 고정 체크아웃, 빌드·실제 자료 검증, 봉인 업로더를 연결한다. 동일 job에서 브라우저 종료·기존 경계 검사 후 배포 단계에만 Cloudflare 키를 제공한다. 별도 ledger·회수 실증·컨테이너 구축은 이번 완료 조건에서 제외한다.

**Tech Stack:** 기존 Node 24.15.0, TypeScript, GitHub Actions ubuntu-24.04, Playwright, Wrangler/Cloudflare Workers·Access.

**Spec:** docs/superpowers/specs/2026-10-27-minimal-automatic-updates-design.md

## Global Constraints

- 기존 Worker/계정/주소/본인 한 명 허용/OTP/preview 비활성/Free를 유지하고 Access 쓰기 권한을 추가하지 않는다.
- 원본 보존, 다섯 SHA 고정, 동일 체크아웃의 build·verify·봉인 배포, 수동 24시간 검증을 유지한다.
- Reader는 자료 실행 전 폐기한다. 배포키는 배포 단계에만 전달하며 HTML/PDF/dist/쿠키/토큰/raw 제공자 오류를 로그·artifact로 내보내지 않는다.
- concurrency study-hub-production, cancel-in-progress:false. 과목에는 알림 workflow 한 파일씩만 추가한다.
- 기존 리소스·키·기록을 삭제하지 않는다. 미구현 ledger/회수/컨테이너 gate로 최소 흐름을 막지 않는다.

## Review Focus

- 원격 SHA/소스/검증 파일이 바뀌면 업로드 호출 0회.
- 현재 Access 정책·Worker/호스트·preview가 승인 baseline과 다르면 업로드 호출 0회.
- 자료 브라우저 단계에는 CF 키가 없고 배포 시작 전에 브라우저/서버가 종료된다.
- 업로드 실패·응답 불명·게시 후 차단 실패는 성공으로 처리하지 않는다.
- 알림 입력의 임의 repo/ref/명령은 키 사용 전에 거절된다.

---

### Task 1: 실제 Linux 검증 통과

**Files:** Modify .github/workflows/study-hub-update.yml, tools/ci/sources.ts 및 해당 focused tests(확인된 원인에 필요한 경우만).
**Interfaces:** 기존 bindSources / SourceSnapshot / .local/ci-sources.json / build / verify:content 계약을 그대로 유지한다.

- [ ] 현재 실패 단계의 안전한 오류 정보를 확인한다. 비용이 큰 브라우저 설치 전에 소스 용량·출처 연결을 검사하도록 정리한다. 합성 테스트 오류는 비밀 없는 테스트 정보로 원인을 확인할 수 있게 한다.
- [ ] 확인된 실패만 재현·수정한다. 원인 없이 guard·기대값·테스트를 지워 통과시키지 않는다.
- [ ] focused tests/typecheck/YAML 검사를 통과한 수정만 commit·review 후 검증 전용 main에 반영한다.
- [ ] 실제 원격 다섯 SHA의 build→verify:content 성공 run을 기록한다. 자료 내용은 artifact로 저장하지 않는다.

### Task 2: 최소 보호 자동 배포 연결

**Files:** Create tools/deploy/release-artifact.ts, tools/deploy/auto-release.ts, tests/deploy/auto-release.test.ts; Modify tools/deploy/release.ts, package.json, .github/workflows/study-hub-update.yml, tests/ci/workflow.test.ts.
**Interfaces:** withSealedArtifact<T>(project:string,authorize:()=>Promise<void>,upload:(directory:string,configPath:string)=>Promise<T>):Promise<T>; releaseAutomatic(settings:DeploymentSettings,baseline:AutomationBaseline):Promise<{url:string;versionId:string;bundleHash:string}>. ledger/intent/store 인수를 추가하지 않는다. CLI deploy:automatic은 대상·경로 override를 받지 않는다.

- [ ] changed_source_or_proof_blocks_upload, changed_access_blocks_upload, manual_24h_guard_preserved, upload_unknown_is_failure_no_retry, postcheck_denial_required 테스트를 먼저 작성하고 FAIL을 확인한다.
- [ ] 기존 봉인 사본 로직을 공통 helper로 추출한다. manual 인가와 24시간 검사는 유지하고 auto는 기존 baseline/current inspection·runtime/source/inventory 검사를 수행한다.
- [ ] 자동 경로는 현재 보호/비로그인 차단을 전후 확인하고 실제 활성 version을 업로드 영수증과 대조한다. 고정 Worker만 업로드하며 성공 확인 뒤 안전한 version/hash만 기록한다. 결과 불명은 실패로 끝낸다.
- [ ] workflow 기본은 verify/disabled로 둔다. 자료 브라우저·서버 종료와 기존 경계 검사 이후 배포 단계에만 CF 토큰을 전달한다. 테스트·typecheck·기존 수동 배포 회귀 확인 후 commit·review한다.

### Task 3: push 연결·실제 인수·짧은 운영 문서

**Files:** 기존 notifier templates 재사용; source 5개의 .github/workflows/notify-study-hub.yml만 추가. Modify docs/operations/automatic-updates.md 및 implementation-status.md, README.md(필요한 현재 상태만).
**Interfaces:** 기존 고정 앱 workflow main dispatch/과목 allowlist를 사용한다. 배포 설정과 승인 baseline은 검토한 GitHub Variables, 키는 Secrets에 전달한다. 원격 변경의 기존 승인은 재사용하고 새 민감 권한 전달만 적용 직전 확인한다.

- [ ] 검토된 diff·실제 verify 성공을 근거로 필요한 Variables/Secrets를 등록한다. CF 토큰 만료(read 2026-11-01 23:59 KST/write 2026-11-02 23:59 KST)를 숨기지 않고 갱신 방법을 남긴다.
- [ ] enable을 켜고 첫 실제 자동 배포 version/hash·Access 유지·비로그인 차단·본인 접근을 확인한다.
- [ ] 기존 승인 범위로 과목 5개 알림 파일을 반영하고 각각 전달을 확인한다. 자료 원본은 변경하지 않는다.
- [ ] 실행 링크, 자동 배포 정지 방법, 실패 확인과 토큰 갱신만 문서화한다. 전체 변경은 최종 한 번 검토하고 실제 성공한 상태만 완료로 표시한다.

## 자체 검토

핵심 동작은 Task1~3, 본인 접근·키·원본 보호는 공통 제약과 Task2, 원격 알림·실제 성공은 Task3이 담당한다. 기존 SDD 실행 선호를 유지한다. 이미 끝낸 준비를 재구현하거나 보존한 추가 리소스를 정리하는 작업을 끼워 넣지 않는다.
