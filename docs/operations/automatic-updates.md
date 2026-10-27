# 자동 갱신 운영

2026-10-27 최소 범위 기준. main `1922213`의 실제 Linux 전체 검증은 실행 `40463352335`에서 성공했다(단위·E2E·실제 5과목 빌드/검증·최종 native 경계 검사). 과목 5개 notifier 추가와 push 알림의 앱 dispatch 전달도 확인했다. 자동 게시는 계속 비활성이다. Variables·Cloudflare Secrets·enable, 첫 자동 배포와 보호/본인 접근 인수는 대기 중이며 Task 3 전체 완료로 기록하지 않는다.

## 실행 계약

앱 main push 또는 과목 5개 main push의 알림 → 앱 main의 고정 `study-hub-update.yml` → 다섯 main SHA 고정 체크아웃 → 빌드·필수 검증 → 검증한 동일 결과물의 기존 Worker 배포 → 보호 상태 확인 순서다. 로컬 미추적 파일이나 미푸시 변경은 입력에 포함되지 않는다. `study-hub-production` concurrency와 `cancel-in-progress:false`를 유지한다.

Reader 토큰은 자료 실행 전에 폐기한다. Cloudflare 키는 마지막 게시 단계에만 전달한다. 과정에서 원본 자료를 수정하지 않고 dist/HTML/PDF·로그인 증거를 Actions artifact에 올리지 않는다. 기존 한 명 허용·이메일 OTP·Access 정책·preview 비활성·workers.dev·Free 운영을 유지한다. 수동 배포의 24시간 증거 규칙은 그대로다. 자동 경로는 승인 baseline과 배포 전후 현재 Access 의미, 비로그인 자료 차단을 검사하며 OTP 쿠키를 CI에 넣지 않는다.

## 설정과 알림 준비

앱 Repository Variables:

- `STUDY_HUB_DEPLOYMENT_SETTINGS`: 검토한 배포 설정 JSON → `.local/deployment.json`.
- `STUDY_HUB_AUTOMATION_BASELINE`: 승인 baseline JSON → `.reports/automation-baseline.json`.
- `STUDY_HUB_AUTOMATIC_UPDATES`: 정확히 `enabled`일 때만 게시. 미설정/다른 값이면 검증만 한다. 수동 dispatch의 `mode:verify`는 항상 검증만 한다.

앱 Secrets는 기존 `STUDY_HUB_READER_APP_ID`, `STUDY_HUB_READER_PRIVATE_KEY`와 마지막 게시 단계용 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_READ_TOKEN`이다. 게시 명령은 인자 없는 `npm run deploy:automatic`이며 고정 경로·대상만 사용한다.

`npm run ci:notifiers`는 무시되는 `.generated/source-notifiers/<course-id>.yml` 5개를 만든다. 각 과목에 추가할 파일은 `.github/workflows/notify-study-hub.yml` 하나다. 과목 Secrets `STUDY_HUB_DISPATCH_APP_ID`, `STUDY_HUB_DISPATCH_PRIVATE_KEY`로 기존 Dispatcher App을 사용하고, 앱 main의 고정 workflow와 allowlist 과목 이름만 전달한다. 현재 5개 과목의 파일 반영·정확한 템플릿 read-back·한 파일만 추가한 commit diff와 Notify 성공을 확인했다. 실행 ID는 논리회로실험 `40463798433`, 생명과학 `40463806148`, 전자회로2 `40463812642`, 자료구조 `40463820257`, 기계학습기초 `40463826612`다. 앱 dispatch 5개 전달을 확인했으며 게시가 꺼진 상태에서 중복 검증을 합쳐 마지막 중복 실행은 운영자가 취소했다. 상세 SHA/ID는 로컬 `.reports/source-notifier-rollout-2026-10-27.json`에 보존한다.

## 실행 확인과 정지

[앱 Actions](https://github.com/jjundev/ajou-study-hub/actions/workflows/study-hub-update.yml)에서 실행과 안전한 summary의 status/version/hash를 확인한다. 실제 인수에는 Linux 자료 빌드·검증 성공, 첫 자동 배포 version/hash, Access 유지·비로그인 차단·본인 접근, 과목 5개 알림 전달 확인이 필요하다. 배포 영수증의 `acceptanceComplete:false`는 사람의 실제 인수를 대신하지 않는다. 전체 코드 및 최종 native 재검토는 지적 없이 승인됐고 Linux 영수증은 로컬 `.reports/minimal-linux-acceptance.json`에 보존한다. 04:09 UTC의 실제 Cloudflare 조회는 승인 baseline의 Worker/버전과 일치했다. 저장된 본인 세션은 현재 인증 검사를 통과하지 못해 갱신 대기다. 민감 설정 승인 후 첫 실제 자동 배포는 과목 Notify 하나를 수동 dispatch하여 같은 알림 경로로 확인하며 자료를 변경하지 않는다.

자동 게시를 멈추려면 `STUDY_HUB_AUTOMATIC_UPDATES`를 삭제하거나 `enabled`가 아닌 값으로 바꾸고, 진행 중인 실행이 있는지 Actions에서 확인한다. 필요하면 해당 실행을 취소한다. 검증만 재실행할 때는 `mode:verify`를 지정한다. 기존 Free 예산 정지 조건을 유지한다. Actions 포함 사용량·초과 지출 차단과 Cloudflare 무료 상태를 확인하고, 초과/유료 전환 위험 또는 무료 상태 불명확 시 자동 게시를 끄고 원인을 확인한다. 유료 업그레이드는 자동 실행하지 않는다.

실패는 해당 실행의 안전한 오류 코드와 고정 SHA로 조사한다. 업로드 결과가 불명확하거나 `uploaded-postcheck-pending`이면 성공으로 기록하거나 자동 재시도하지 않는다. 현재 고정 Worker의 실제 버전과 Access 상태를 읽어 확인한 뒤 다음 조치를 결정한다. 자동 rollback이나 durable pending 차단은 보장하지 않는다.

## 토큰 갱신

현재 읽기 토큰 만료는 **2026-11-01 23:59 KST**, 쓰기 토큰은 **2026-11-02 23:59 KST**다. 만료 전에 자동 게시를 끄고 기존 계정·고정 Worker의 최소 권한으로 토큰을 갱신한다. 쓰기 토큰에 Access 정책 쓰기 권한을 추가하지 않는다. 새 값은 앱의 대응 Cloudflare Secrets에만 넣고 명령 인자·로그·문서에 남기지 않는다. 읽기 검사와 실제 배포/보호 확인 후 enable을 다시 켜고 실행 영수증을 기록한다. 만료·권한 오류는 실패로 남기며 우회하지 않는다.

이전 ledger/CAS·복구 실증·별도 컨테이너 격리·readiness 게이트는 승인된 최소 범위의 선행 조건에서 제외됐다. 기존 코드·저장소·App·키·테스트 Worker·기록은 보존하고 일반 자동 게시에서 사용하지 않는다. 현재 경계 검사는 탐지이며 강제 격리 보장이 아니다.
