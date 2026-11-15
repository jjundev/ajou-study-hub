# 자동 갱신 운영

허브나 다섯 과목 저장소의 `main`에 푸시하면 [GitHub Actions](https://github.com/jjundev/ajou-study-hub/actions/workflows/study-hub-update.yml)가 다섯 과목의 커밋을 고정해 빌드하고 브라우저로 검증합니다. 검증을 통과하면 같은 번들을 기존 공개 Worker에 배포합니다. 게시 후 활성 버전과 로그인 없이 내려받은 파일의 해시를 대조합니다.

## 설정

- GitHub Actions 변수 `STUDY_HUB_AUTOMATIC_UPDATES`가 정확히 `enabled`일 때 게시합니다. 다른 값이거나 수동 실행에서 `mode:verify`를 선택하면 검증까지만 합니다.
- `STUDY_HUB_PUBLIC_DEPLOYMENT_SETTINGS`에는 [수동 공개 게시](deployment.md#운영-주소에-수동-공개-게시)와 같은 JSON을 넣습니다. 계정과 Worker ID, 운영 주소를 확인하고 설정을 등록합니다.
- Actions Secrets의 `CLOUDFLARE_READ_TOKEN`과 `CLOUDFLARE_API_TOKEN`은 공개 Worker의 읽기와 업로드에 쓰입니다. 배포와 별도 토큰 갱신에서 사용하며, 동일 입력 판정 단계에는 읽기 토큰만 전달합니다.
- 과목 알림은 각 저장소의 `.github/workflows/notify-study-hub.yml`이 담당합니다. `npm run ci:notifiers`로 템플릿을 만들며, 기존 Dispatcher App의 `STUDY_HUB_DISPATCH_APP_ID`와 `STUDY_HUB_DISPATCH_PRIVATE_KEY`를 사용합니다.

## 실행 확인과 정지

Actions 실행 요약에서 `published-public-verified`, 배포 ID와 버전 ID, 카탈로그 해시와 검사한 파일 수를 확인합니다. 로컬에서 수동 배포가 필요하면 [배포 운영 안내](deployment.md#운영-주소에-수동-공개-게시)를 따릅니다.

자동 게시를 멈추려면 `STUDY_HUB_AUTOMATIC_UPDATES`를 `disabled`로 바꾸고 실행 중인 배포가 있는지 확인합니다. `upload-started-outcome-unknown` 또는 `uploaded-postcheck-pending`이면 재실행 전에 현재 Worker 버전과 실행 요약의 이전 버전을 대조합니다. 게시 후 운영 응답 확인에 실패한 경우 [수동 복구 절차](deployment.md#운영-주소에-수동-공개-게시)를 따릅니다.

## 게시 입력이 같은 과목 알림 생략

`STUDY_HUB_UNCHANGED_DEPLOYMENTS`의 기본 동작은 전체 검증 및 게시입니다. `observe`와 `skip`에서는 공개 검증이 끝난 배포의 입력 해시와 배포·버전 ID를 Actions 아티팩트에 7일 동안 보관합니다. 과목 알림을 받으면 다섯 과목의 고정 체크아웃을 검사한 뒤 이 기록을 현재 운영 Worker와 대조합니다. 입력이나 운영 상태가 달라졌거나 기록을 확인할 수 없으면 전체 검증 및 게시를 진행합니다. 허브 푸시, 과목 지정 없는 수동 실행, 토큰 갱신 후 실행, `verify` 실행, Actions 재실행에는 각 실행의 전체 검증 절차를 적용합니다.

1. 변수를 `observe`로 설정하고 전체 공개 배포를 한 번 성공시켜 비교에 쓸 기록을 만듭니다. 실행 요약에서 `published-public-verified`와 `public-checkpoint-<시도 번호>` 아티팩트를 확인합니다.
2. 동일한 입력으로 과목 알림을 한 번 보내고, 기존 수집 범위 밖 파일의 본문만 수정한 뒤 다시 알립니다. 두 실행의 요약에서 `게시 입력 일치 · 빌드 번들 일치`를 확인합니다.
3. 수집 대상 자료를 수정한 알림은 판정에서 불일치하고 전체 검증과 공개 게시가 완료되는지 확인합니다. 입력은 같은데 번들이 다르거나 예상과 다른 판정이 나오면 원인을 확인한 뒤 `skip`을 켭니다.
4. `skip`에서 동일 입력 알림은 `게시 입력 동일 · 기존 운영 버전 확인`으로 끝나고 Worker 배포 ID가 그대로인지 확인합니다. 자료를 바꾼 알림에서는 새 배포 ID와 `published-public-verified`를 확인합니다. 두 실행의 경과 시간은 Actions 작업에서 확인합니다.

생략을 끄려면 `STUDY_HUB_UNCHANGED_DEPLOYMENTS`를 지웁니다.

## 변경 과목 브라우저 검증 측정

`STUDY_HUB_COURSE_VERIFICATION=observe`를 설정하고 전체 공개 배포를 한 번 성공시키면 체크포인트에 과목별 입력 해시가 기록됩니다. 그다음 일부 과목의 게시 입력이 바뀌면 현재 운영 배포 ID, 버전 ID, 허브 커밋이 체크포인트와 일치하는 경우에 한해 같은 번들로 두 경로를 실행합니다. 알림 저장소 이름과 관계없이 다섯 과목의 입력을 모두 비교합니다.

두 경로 모두 전체 소스·빌드 무결성 검사, 워크북과 글꼴 대체 검사, 공통 브라우저 시나리오 42개를 실행합니다. 두 번째 경로의 문서별 Chromium 순회는 변경 과목으로 좁힙니다. 공개 게시에는 기존 전체 검증 결과를 사용하며, 게시 후 최대 10분 동안 관찰을 실행합니다. Actions 요약의 `Changed-course browser verification (observe)`에서 문서별 순회 시간과 검증 전체 시간, 두 경로의 검사 대상 수를 확인할 수 있습니다. 결과는 밀리초입니다. 관찰 경로 실패는 `CI_COURSE_COMPARISON_UNAVAILABLE`로 기록됩니다.

로컬에서 실제 자료의 전체 빌드 후 `npm run verify:content -- --sources .local/sources.json`을 먼저 실행하고, 같은 `dist`와 소스에서 `node --import tsx tools/ci/observe-course-verification.ts .local/sources.json life-science`를 실행하면 측정할 수 있습니다. 운영 측정을 끄려면 `STUDY_HUB_COURSE_VERIFICATION`을 지웁니다.

## 변경 과목 브라우저 검증 적용

`STUDY_HUB_COURSE_VERIFICATION=apply`에서 과목 알림을 받으면 변경 과목만 문서별 Chromium 검사를 실행할 수 있습니다. 전체 소스·산출물 무결성 검사와 공통 브라우저 시나리오 42개, 게시 후 전체 파일 응답 검사는 계속 실행합니다. `Material verification` 요약에서 실제 범위와 문서 수, 경과 시간을 확인합니다.

같은 허브 커밋과 현재 운영 버전에 연결된 체크포인트가 필요합니다. 직전 전체 검증 기록은 24시간까지 유효하며, 워크플로에 필요한 1시간을 남겨 둡니다. 생략할 과목의 빌드 산출물 해시와 이전 문서 로딩 때 관찰한 브라우저 요청을 대조합니다. 다른 과목이나 공통 경로에 대한 요청이 있었거나, 산출물이 달라졌거나, 기준 기록이 없으면 전체 검증으로 돌아갑니다. 전체 검증으로 게시하면 기준 시각이 갱신됩니다.

게시 준비 중 운영 버전이 바뀌면 `CI_COURSE_BASELINE_CHANGED_BEFORE_UPLOAD`와 함께 업로드 전에 멈춥니다. Actions의 해당 실행을 다시 실행하면 전체 검증이 적용됩니다. 비교만 하려면 `observe`를 지정하고, 전체 검증으로 게시하려면 변수를 지웁니다.

## HTML·CSS 변환 재사용 관찰

`STUDY_HUB_DOCUMENT_TRANSFORM_REUSE=observe`에서 전체 빌드와 기존 검증을 거쳐 공개 게시합니다. 첫 게시가 성공하면 브라우저에서 쓰는 HTML·CSS의 변환 키, 크기, SHA-256만 7일간 보관합니다. 다음 실제 자료 변경 알림이 같은 허브 커밋과 현재 운영 배포에 연결된 체크포인트를 찾으면, 게시 완료 후 별도 디렉터리에서 후보를 빌드합니다. 이 설정은 과목별 브라우저 검증 설정과 독립적입니다.

후보는 게시 전에 확인한 이전 인덱스에 키가 있고 공개 파일의 크기와 해시가 일치하는 경우에만 변환을 재사용합니다. 새로 수집한 파일 목록 전체의 링크와 번들 제한을 검사한 뒤 카탈로그와 앱을 포함한 최종 파일 목록·크기·해시, 입력 목록과 빌드 진단을 게시본과 비교합니다. 공개 읽기는 최대 8개 동시 요청, 25초, 64MiB로 제한합니다. 파일을 확인할 수 없으면 일반 변환을 수행합니다. 인덱스, 운영 기준 버전 또는 후보를 확인할 수 없으면 요약에 `unavailable`이 표시됩니다.

Actions 요약의 `Document HTML/CSS reuse (observe)`에서 일치 상태, 재사용 수와 다운로드 시간, 실제 게시 시간, 적용 예상 시간을 확인할 수 있습니다. 예상 시간은 실제 게시 시간에서 기존 빌드 시간을 빼고 인덱스 조회와 후보 빌드 시간을 더한 값입니다. 공개 응답 조회는 게시 후 전체 파일 확인을 마친 시점에 같은 해시의 파일로 재현하므로, 게시 전 조회 지연은 적용 시 별도로 측정합니다. 큐 대기와 게시 후 관찰 작업 시간도 따로 표시합니다. `mismatch` 또는 `no-reuse`에서는 적용 예상 시간을 계산하지 않습니다. 두 과목 이상에서 실제 변경을 세 번 이상 관찰하고, 모든 번들이 일치하며 순절감 중앙값이 10초 이상일 때 적용을 검토합니다. 관찰을 끄려면 변수를 지웁니다.

## Cloudflare 배포 토큰 갱신

[토큰 갱신 워크플로](https://github.com/jjundev/ajou-study-hub/actions/workflows/cloudflare-token-rotation.yml)는 매일 05:19 KST에 Cloudflare API로 두 Secrets의 유효기간을 확인합니다. 하나라도 만료까지 7일 이하이면 30일짜리 토큰 두 개를 발급하고 사용 가능 여부를 확인한 뒤 같은 이름으로 등록합니다. 이전 토큰은 원래 만료일까지 유효하므로 이미 시작된 배포가 마무리될 수 있습니다. 자동 게시가 켜져 있으면 새 배포 실행을 시작합니다. 갱신 요약에서 새 토큰 만료일과 배포 실행 링크를 확인하고, 연결된 배포에서 `published-public-verified`를 확인합니다. 즉시 갱신하려면 워크플로를 수동으로 실행하고 `force`를 선택합니다.

발급 권한이 있는 `CLOUDFLARE_ROTATION_TOKEN`과 Secrets 쓰기용 GitHub App 키 `STUDY_HUB_ROTATION_PRIVATE_KEY`는 `main`에만 열리는 `cloudflare-token-rotation` 환경에 있습니다. App은 허브 저장소에만 설치합니다. Cloudflare 발급 토큰은 **2027-11-14 23:59 KST**에 만료됩니다. 워크플로는 30일 전부터 경고를 남깁니다. 만료 전에 Cloudflare 계정에서 `Account API Tokens: Edit` 권한으로 발급 토큰을 교체한 뒤 갱신 워크플로를 확인합니다.

## 비공개 자동 게시 이력

2026-10-27에는 기존 Cloudflare Access 정책을 검사하는 비공개 자동 배포를 운영했습니다. 당시 과목 5개에서 알림 전달을 확인했고, [첫 운영 실행](https://github.com/jjundev/ajou-study-hub/actions/runs/40521732696)이 비공개 배포를 완료했습니다. 공개 사이트는 `deploy:public`을 사용하며, 이전 비공개 배포 명령과 설정은 이 이력에 해당합니다.
