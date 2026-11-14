# 자동 갱신 운영

공개 복구는 [수동 공개 게시](deployment.md#운영-주소에-수동-공개-게시) 절차를 따른다.
공개 갱신 전 `STUDY_HUB_AUTOMATIC_UPDATES=disabled`로 두고 진행 중인 게시를 확인한다.
기존 Actions의 `mode:verify`로 최신 5과목의 고정 커밋, 실제 빌드와 브라우저 검증을 확인할 수 있다.
공개 자동 게시와 과목별 배포 목록 이관은 후속 요청 범위다.

## 비공개 자동 게시 이력

2026-10-27 main `1922213`의 Linux 전체 검증은 실행 `40463352335`에서 성공했다.
과목 5개 notifier의 push 알림이 앱 dispatch로 전달됐다. 과목 알림 실행 `40521705461`과
앱 실행 `40521732696`은 비공개 게시까지 성공했다. 당시 Worker 버전
`bbebf0b4-53b6-43e2-82dc-5d22c2f204b3`에서 Access baseline, 본인 신원과 5과목
카탈로그 접근, 비로그인 로그인 리다이렉트를 확인했다.

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

[앱 Actions](https://github.com/jjundev/ajou-study-hub/actions/workflows/study-hub-update.yml)에서 실행과 안전한 summary의 status/version/hash를 확인한다. 실제 인수에는 Linux 자료 빌드·검증 성공, 첫 자동 배포 version/hash, Access 유지·비로그인 차단·본인 접근, 과목 5개 알림 전달 확인이 필요하다. 배포 영수증의 `acceptanceComplete:false`는 사람의 실제 인수를 대신하지 않는다. 전체 코드 및 최종 native 재검토는 지적 없이 승인됐고 Linux 영수증은 로컬 `.reports/minimal-linux-acceptance.json`에 보존한다. 첫 실제 자동 게시의 알림→앱 실행→게시→현재 보호/본인 접근 확인을 완료했다. [알림 실행](https://github.com/jjundev/ajou-nonhoesil/actions/runs/40521705461)과 [앱 실행](https://github.com/jjundev/ajou-study-hub/actions/runs/40521732696)을 확인할 수 있다.

자동 게시를 멈추려면 `STUDY_HUB_AUTOMATIC_UPDATES`를 삭제하거나 `enabled`가 아닌 값으로 바꾸고, 진행 중인 실행이 있는지 Actions에서 확인한다. 필요하면 해당 실행을 취소한다. 검증만 재실행할 때는 `mode:verify`를 지정한다. 기존 Free 예산 정지 조건을 유지한다. Actions 포함 사용량·초과 지출 차단과 Cloudflare 무료 상태를 확인하고, 초과/유료 전환 위험 또는 무료 상태 불명확 시 자동 게시를 끄고 원인을 확인한다. 유료 업그레이드는 자동 실행하지 않는다.

실패는 해당 실행의 안전한 오류 코드와 고정 SHA로 조사한다. 업로드 결과가 불명확하거나 `uploaded-postcheck-pending`이면 성공으로 기록하거나 자동 재시도하지 않는다. 현재 고정 Worker의 실제 버전과 Access 상태를 읽어 확인한 뒤 다음 조치를 결정한다. 자동 rollback이나 durable pending 차단은 보장하지 않는다.

## 토큰 갱신

이전 읽기 토큰은 **2026-11-01 23:59 KST**, 쓰기 토큰은 **2026-11-02 23:59 KST**에
만료됐다. 수동 공개 게시는 운영 문서의 로컬 환경변수 전달 경로를 사용한다.
향후 비공개 자동 게시를 다시 요청하면 해당 계정과 고정 Worker 권한의 유효한 토큰을
앱의 Cloudflare Secrets에 넣고 실제 보호와 영수증을 확인한다.

이전 ledger/CAS·복구 실증·별도 컨테이너 격리·readiness 게이트는 승인된 최소 범위의 선행 조건에서 제외됐다. 기존 코드·저장소·App·키·테스트 Worker·기록은 보존하고 일반 자동 게시에서 사용하지 않는다. 현재 경계 검사는 탐지이며 강제 격리 보장이 아니다.
