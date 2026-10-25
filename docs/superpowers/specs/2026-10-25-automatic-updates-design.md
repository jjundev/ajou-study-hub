# 자동 자료 동기화·비공개 배포 설계 초안

작성일: 2026-10-25. 상태: 제안·검토 중, 사용자 미승인. 이 문서는 기존 PRD v1.0을 변경하거나 배포를 활성화하지 않는다. 구현 계획은 선택 사항과 보안 계약을 확정한 뒤 작성한다.

## 목적과 기존 조건

사용자는 현재 로컬 앱을 클라우드에서 사용하고, 각 과목 GitHub 레포가 바뀌면 사이트도 자동 갱신되기를 원한다. 기존의 본인 한 명만 접근, 무료 범위 운영, 원본 자료 보존 조건을 유지하는 제안이다. 실제 계정 준비·게시 보류를 해제하는 승인은 아직 없다.

권장 구성은 GitHub Actions가 수집·빌드·검증·배포를 실행하고, Cloudflare Workers Static Assets가 사이트를 제공하며, Cloudflare Access가 본인 이메일 한 주소만 허용하는 방식이다. 웹사이트 접속과 빌드는 사용자의 PC 전원에 의존하지 않는다. 기기 간 학습 기록 동기화는 이번 범위에 포함하지 않는다.

## 확인한 서비스 조건

2026-10-25 공식 문서를 읽고 확인했다. 실제 사용자 계정 요금제·잔여 한도·API 응답은 아직 확인하지 않았다.

| 항목 | 확인한 사실 | 이 앱에 주는 영향 |
| --- | --- | --- |
| GitHub Pages | 정적 호스팅과 자동 게시 지원. 비공개 레포 사용과 사이트 비공개는 별개이며 사이트 접근 제어는 Enterprise Cloud 조직 기능 | 기존 본인 전용 요구에 일반 개인 Free/Pro Pages는 부합하지 않음 |
| Pages 용량 | 게시 사이트 최대 1GB | 현재 배포물 1,106,504,248바이트는 한도 초과 |
| Workers Static Assets | 정적 요청 무료·무제한, assets 저장 추가 비용 없음. Free는 버전당 20,000파일·파일당 25MiB | 현재 4,803파일, 최대 파일 12,182,784바이트는 이 두 한도 이내. 실제 업로드 성공과 계정 Free 여부는 미검증 |
| Access | Free 요금제 제공. 공식 가격표는 50명 미만 팀을 대상으로 안내 | 본인 한 명용으로 무료 구성 제안 가능. 가입 시 결제 정보 입력이 필요할 수 있음 |
| GitHub Actions | 비공개 레포의 표준 runner 월 포함 시간: Free 2,000분, Pro 3,000분. 무료 artifact 저장 Free 500MB, Pro 1GB | 호스팅 비용과 빌드 비용을 구분. 약 1.1GB dist 전체를 장기 artifact로 보관하지 않음 |
| 다른 private 레포 checkout | 기본 GITHUB_TOKEN은 현재 레포 범위 | 다섯 자료 레포 읽기용 별도 최소 권한 필요 |

공식 근거:

- [GitHub Pages 설명](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Pages 접근 제어](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)
- [Pages 제한](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Workers 정적 자산 요금](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Workers 제한](https://developers.cloudflare.com/workers/platform/limits/)
- [Access 요금](https://www.cloudflare.com/sase/products/access/)
- [Zero Trust 계정 생성](https://developers.cloudflare.com/cloudflare-one/setup/)
- [Actions 요금·포함량](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Actions 이벤트](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [다중 private checkout](https://github.com/actions/checkout#checkout-multiple-repos-private)
- [Cloudflare의 GitHub Actions 배포 안내](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)

## 사용자가 보게 될 동작

1. 과목 자료를 해당 GitHub 레포의 main에 push하거나 PR을 merge한다.
2. 변경 알림을 받은 앱의 Actions가 다섯 원격 main의 커밋 SHA를 고정하고 자료를 읽는다.
3. 이전 성공 배포와 앱·자료·설정 버전이 같으면 배포하지 않는다.
4. 자료 수집·앱 빌드·브라우저 검증과 비공개 배포 검사를 모두 통과한 결과만 게시한다.
5. 실패하면 Actions에 원인을 남기고, 업로드 전 실패는 기존 사이트를 유지한다.
6. 성공 기록에 다섯 커밋 SHA, 앱 SHA, 최종 bundle hash, 배포 버전을 남긴다.

반영 시간은 큐 대기·다운로드·검증·업로드를 포함한다. 즉시 반영이나 고정된 완료 시각을 보장하지 않는다. 기존 로컬 실제 자료 검증만 약 6.46분이 걸렸으므로 최초 CI 계측 전에는 분 단위 추정만 제공한다.

PC에만 있는 수정·미추적 파일·push하지 않은 커밋은 원격 자동 배포에 들어가지 않는다. 현재 검증된 로컬 생명과학 자료에는 dirty 변경이 있으므로 최초 원격 배포와의 차이를 별도로 보고하고, 자동으로 커밋하거나 덮어쓰지 않는다.

## 변경 감지 방식: 사용자 선택 필요

**A. 권장안 — 과목 push로 시작.** 다섯 과목 레포에 알림용 workflow 파일 하나씩을 추가한다. 이 workflow는 main push에서 앱 레포의 정해진 workflow 실행만 요청하고 자료를 변환하지 않는다. 학습 자료 파일은 수정하지 않는다. 앱 main 변경과 수동 실행도 지원한다. 기본 GITHUB_TOKEN만으로 다른 private 레포를 읽거나 알림 권한이 생긴다고 가정하지 않는다. 읽기와 실행 요청 권한은 분리하고 GitHub App의 짧은 수명 토큰을 우선 검토한다. 외부 레포 파일 추가·push·secrets 등록은 사용자 승인 후에만 수행한다.

**B. 원본 레포 무변경안 — 앱에서 1시간 간격 확인.** 앱 workflow가 다섯 main SHA만 주기적으로 확인해 변경이 있을 때만 빌드한다. 하루 24회·30일이면 720회 확인이며 실제 runner 청구 시간은 계측해야 한다. 정각을 피해서 예약하되 GitHub schedule은 지연·누락될 수 있으므로 정확한 1시간 반영 SLA로 설명하지 않는다. 수동 실행도 지원한다.

선택 전에는 어느 방식도 활성화하지 않는다. 다른 방식으로 바꾸면 이벤트 전달과 권한 설계가 달라진다.

## 원본과 빌드의 경계

- 소스는 config/courses.ts의 다섯 레포 allowlist로만 선택하고, 이벤트 payload의 임의 URL·브랜치·명령은 실행하지 않는다.
- 신뢰하는 앱 main의 workflow가 자료 레포 main의 실제 SHA를 독립적으로 조회한다. SHA 고정 후에는 해당 실행 중 latest를 다시 checkout하지 않는다. 여러 레포 전체에 하나의 원자적 커밋이 존재한다고 가정하지 않는다.
- 깨끗한 checkout을 CI 입력 정책으로 새로 도입한다. 기존 로컬 모드는 현재 추적 파일의 dirty 바이트를 허용하는 동작을 유지한다.
- CI용 source-settings를 실제 runner의 경로로 새로 만들고, 같은 checkout에서 build·verify·release를 실행한다. 기존 Windows proof를 Linux에 복사하지 않는다.
- 기존 금지 파일·허용 경로·child symlink 차단·전후 원본/출력 hash·Git 추적·전체 HTML/대표 브라우저 검증을 유지한다.
- 최초 Linux 검증에서 Node 24, 브라우저 세 종류, 한글/대소문자 파일 경로, 디스크 여유를 확인한다. 현재 Windows 성공만으로 Linux 호환을 확정하지 않는다.
- 빌드·검증이 끝나면 로컬 서버/브라우저/잔여 자식 프로세스를 종료하고 자격 증명 흔적을 제거한다. Cloudflare 배포 token은 배포 단계에서만 제공한다. source checkout 토큰은 checkout 후 유지하지 않는다. 이 경계가 성립하는지 보안 검토한다.
- 약 1.1GB 배포물을 동일 job 안에서 검증·게시하고, Actions artifact에는 작은 검증 요약·커밋 목록·실패 진단만 짧게 보관한다. HTML·PDF·쿠키·토큰을 로그나 공개 artifact로 내보내지 않는다.
- 실행을 직렬화하고 최신 pending 변경을 합치되, 결과가 불명확한 업로드를 단순 취소·중복 재시도하지 않는다. 실제 배포의 실행 순서와 원격 버전을 확인한다.

## 무인 배포의 접근 제어 계약: 선행 설계·검증 조건

현재 guard는 24시간 이내의 본인·독립된 다른 계정·비로그인 실증을 요구한다. 사람의 OTP 세션을 GitHub Secrets에 넣거나, 오래된 성공 플래그를 새 증거처럼 작성하는 방식은 채택하지 않는다. API token 하나로 사람 identity 검증을 대신했다고 주장하지 않는다.

권장 후보는 **초기 실계정 검증 + 매 배포의 보호 설정 확인**이다.

1. 빈 앱의 실제 owner/other/anonymous 검증과 모바일·PC 인수 후 계정·immutable Worker ID·Access 앱·정확한 owner 이메일·호스트·정책 기준을 운영자가 승인한다.
2. 무인 CI는 별도 증거 형식으로 매 배포 전후 실제 읽기 API의 보호 정책·worker-wide 적용·bypass 부재·호스트·Free 조건을 확인하고 비로그인 자료 본문 차단을 검사한다. 승인된 기준에서 달라지거나 증거가 불완전하면 업로드하지 않는다.
3. 본인 이메일·앱·정책·호스트·Worker 신원이 바뀌면 사람의 재확인까지 무인 배포를 중지한다. Access 정책을 자동 완화하거나 service-auth 허용 정책을 추가하지 않는다.
4. 이 방식은 매 배포에 새로운 사람 identity·정상 로그인 성공을 실측하는 것과 다르다. 초기 실증과 현재 설정 일치로 판단하는 부분은 추론으로 기록하고, 기존 24시간 human-proof 계약의 변경임을 명시한다. 기존 수동 guard를 조용히 제거하거나 같은 proof 형식에 성공을 대입하지 않는다.
5. 위 계약의 실제 API 호환성·자동 실행 권한·자격 증명 격리를 검증하고 승인하기 전에는 무인 업로드를 구현·활성화하지 않는다. 성립하지 않으면 자동 수집·빌드·검증까지만 가능하며 배포 승인 단계는 남는다. 이 상태를 완전 자동 배포 완료로 보고하지 않는다.

이 항목은 보안 설계의 선행 조건이다. 현재 사용자 계정과 실제 Access가 없으므로 검증 완료로 간주할 수 없다. 초기 설정·보호 검증을 완료하기 전 workflow는 검증 모드만 지원한다.

## 실패·회수·비용

- 수집·검증·한도·보호 확인 실패는 업로드 전에 중단한다. 현재 정상 사이트를 그대로 유지한다.
- 업로드 결과가 불명확하면 자동 재시도를 멈추고 원격 버전을 확인해야 하는 상태로 기록한다.
- 게시 후 보호 이상이 확인되면 자동화를 정지한다. 무인 운영을 활성화하려면 이 Worker의 유일한 workers.dev 공개 진입점만 비활성화하고 확인하는 긴급 회수 경로도 먼저 실증·승인해야 한다. 검증되지 않은 rollback이나 계정 전체 변경을 회수로 사용하지 않는다.
- 실패 알림은 GitHub의 Actions 결과·사용자가 설정한 기본 알림을 사용한다. 별도 Slack/메일 전송 서비스를 만들지 않는다.
- Linux 표준 runner를 사용하고 불필요한 중복 빌드를 합친다. 한 번 15분·월 60회이면 900 runner분이라는 예시일 뿐, 실제 시간과 다른 레포의 사용량은 별도로 확인한다.
- Workers/Access Free, 무료 workers.dev 주소를 기본으로 하고 유료 업그레이드·도메인 구매를 자동 실행하지 않는다. Actions 사용 한도·결제 설정·초과 사용 차단을 실제 계정에서 확인한다. Free 포함량만으로 무조건 0원을 보장하지 않는다.

## 이번 승인으로 정해야 할 것과 이후 작업

사용자 선택: Cloudflare + GitHub Actions 구성 채택 여부, A(push 알림용 workflow를 과목 레포에 추가) 또는 B(과목 레포를 수정하지 않고 주기 확인).

이후 빌더가 결정할 것: 테스트 및 모듈 분리, 이벤트 API의 세부 선택, 최소 권한 토큰 발급 방법, 중복 실행 합치기, 작은 보고서의 보관 기간. 비공개·무료·원본 보존 계약은 바꾸지 않는다.

현재 사실 검증에서 무인 인증 계약이 BLOCKED이므로 구현 계획을 쓰거나 제품 코드를 변경하지 않는다. 선택된 방식의 설계를 확정하고 선행 조건을 해소한 뒤 PRD를 갱신하고 별도 구현 계획을 작성한다. 기존 수동 운영과 로컬 미리보기는 유지한다.
