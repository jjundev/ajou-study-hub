# 자동 갱신 운영

허브나 다섯 과목 저장소의 `main`에 푸시하면 [GitHub Actions](https://github.com/jjundev/ajou-study-hub/actions/workflows/study-hub-update.yml)가 다섯 과목의 커밋을 고정해 빌드하고 브라우저로 검증합니다. 검증을 통과하면 같은 번들을 기존 공개 Worker에 배포합니다. 게시 후 활성 버전과 로그인 없이 내려받은 파일의 해시를 대조합니다.

## 설정

- GitHub Actions 변수 `STUDY_HUB_AUTOMATIC_UPDATES`가 정확히 `enabled`일 때 게시합니다. 다른 값이거나 수동 실행에서 `mode:verify`를 선택하면 검증까지만 합니다.
- `STUDY_HUB_PUBLIC_DEPLOYMENT_SETTINGS`에는 [수동 공개 게시](deployment.md#운영-주소에-수동-공개-게시)와 같은 JSON을 넣습니다. 계정과 Worker ID, 운영 주소를 확인하고 설정을 등록합니다.
- Actions Secrets의 `CLOUDFLARE_READ_TOKEN`과 `CLOUDFLARE_API_TOKEN`은 읽기와 업로드에 쓰며 게시 단계에서만 전달됩니다. 2026-11-14에 등록한 토큰은 **2026-11-21 23:59 KST**에 만료됩니다. 새 토큰을 같은 Secrets에 등록한 뒤 실제 실행 결과를 확인합니다.
- 과목 알림은 각 저장소의 `.github/workflows/notify-study-hub.yml`이 담당합니다. `npm run ci:notifiers`로 템플릿을 만들며, 기존 Dispatcher App의 `STUDY_HUB_DISPATCH_APP_ID`와 `STUDY_HUB_DISPATCH_PRIVATE_KEY`를 사용합니다.

## 실행 확인과 정지

Actions 실행 요약에서 `published-public-verified`, 배포 버전 ID, 카탈로그 해시와 검사한 파일 수를 확인합니다. 로컬에서 수동 배포가 필요하면 [배포 운영 안내](deployment.md#운영-주소에-수동-공개-게시)를 따릅니다.

자동 게시를 멈추려면 `STUDY_HUB_AUTOMATIC_UPDATES`를 `disabled`로 바꾸고 실행 중인 배포가 있는지 확인합니다. `upload-started-outcome-unknown` 또는 `uploaded-postcheck-pending`이면 재실행 전에 현재 Worker 버전과 실행 요약의 이전 버전을 대조합니다. 게시 후 운영 응답 확인에 실패한 경우 [수동 복구 절차](deployment.md#운영-주소에-수동-공개-게시)를 따릅니다.

## 비공개 자동 게시 이력

2026-10-27에는 기존 Cloudflare Access 정책을 검사하는 비공개 자동 배포를 운영했습니다. 당시 과목 5개에서 알림 전달을 확인했고, [첫 운영 실행](https://github.com/jjundev/ajou-study-hub/actions/runs/40521732696)이 비공개 배포를 완료했습니다. 공개 사이트는 `deploy:public`을 사용하며, 이전 비공개 배포 명령과 설정은 이 이력에 해당합니다.
