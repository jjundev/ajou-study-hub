# 아주 학습 허브

기존 5개 과목 저장소를 읽어 Vite 앱과 정적 자료 사본을 만드는 개인 학습 앱입니다. 원본 자료는 보존하고, 과목 저장소에는 알림용 workflow 파일만 추가합니다. 자동 갱신의 실제 Linux 검증과 과목 5개 알림 전달은 통과했습니다. 자동 게시는 비활성이며 첫 배포와 실제 인수는 대기 중입니다. 현재 설정·정지·실패·토큰 갱신은 [자동 갱신 운영](docs/operations/automatic-updates.md)을 확인하세요.

## 로컬 실행과 수동 갱신

Node.js 24와 `npm ci`를 사용합니다. `config/sources.example.json`을 참고해 `.local/sources.json`에 원본 위치와 명시적으로 허용할 미추적 파일을 설정하세요. 실제 절대 경로·자료·보고서는 Git에 넣지 않습니다.

```powershell
npm run dev
npm test
npm run typecheck
npm run test:e2e
```

기본 dev/build 및 E2E는 합성 원본만 사용합니다. 실제 자료를 갱신할 때만 원본 설정을 명시합니다. 원본 변경 후 아래 명령을 수동으로 다시 실행하세요.

```powershell
npm run build -- --sources .local/sources.json
npm run verify:content -- --sources .local/sources.json
npm run hosting:dev
```

`build`는 원본 수집과 Vite 컴파일 후 `_headers`, `_redirects`, `404.html`을 최종 dist에 넣고 전체 파일 수·크기 한도를 다시 검사합니다. 출력은 고정된 프로젝트 `dist/`입니다. 임의 Vite 설정·출력 경로는 허용하지 않습니다. `.reports/content-build.json`은 입력 수집, `.reports/app-build.json`은 최종 dist의 모든 바이트와 해시를 기록합니다. `.reports/verification.json`은 현재 입력·최종 앱 해시에 대한 실제 220개 HTML 및 대표 학습 흐름 검증입니다. 파일 수나 HTML 수는 입력에 따라 변할 수 있습니다. 실패 보고서의 issues와 errors를 확인하고 수정 후 새로 검증하세요. 빌드가 달라지면 과거 성공 보고서는 현재 배포 증거가 아닙니다. 알려진 정확한 외부 Pretendard 폰트 요청 오류 한 건은 원본/사본 모두 읽을 수 있는 대체 글꼴을 사용함을 검증한 warning으로 남습니다.

`hosting:dev`는 Wrangler의 **로컬 emulator를 127.0.0.1**에 열며 로그인·업로드·게시하지 않습니다. 출력 주소에서 `/`의 302, 정확한 `.html` URL, 한글·공백 경로, `.pack`/`.assets`, PDF·폰트를 확인할 수 있습니다. 누락 파일은 전용 404이며 SPA fallback이나 `.html` 제거는 사용하지 않습니다. 실제 정적 본문은 `Cache-Control: private, no-store`입니다. `_headers`와 `_redirects`는 제어 파일로 HTTP 제공되지 않습니다. 리다이렉트는 헤더 적용보다 먼저 처리되므로 루트 302에 같은 캐시 헤더가 붙는다고 가정하지 않습니다. 전역 CSP나 X-Frame-Options를 추가하지 않아 기존 iframe 문서의 스크립트와 외부 리소스 동작을 유지합니다.

## 자료 없는 bootstrap의 로컬 검사

```powershell
npm run bootstrap:build
npm run hosting:dev -- --assets .generated/bootstrap --port 8787
npm test -- tests/deploy/hosting.test.ts
npm run test:e2e -- tests/e2e/hosting.spec.ts
```

`bootstrap:build`는 **로컬 빌드만** 합니다. 기존 dist나 자료를 복사하지 않고 publicDir를 끈 깨끗한 앱 컴파일에 빈 catalog와 합성 HTML·PNG·PDF·폰트 MIME 검사 파일을 더합니다. 합성 폰트는 MIME 검사용 바이트이며 실제 글꼴로 로드하지 않습니다. `.generated/bootstrap/`만 교체하고 `.reports/bootstrap-build.json`에 빈 sources/inputs, 최종 출력 목록과 정확한 해시를 남깁니다. HTML과 부속 파일은 `content/test/` 아래의 합성 sentinel뿐입니다. 실제 원본·로컬 설정·인증 정보는 들어가지 않습니다. 테스트 출력은 별도 `.generated/bootstrap-tests/` 아래에 격리합니다.

Wrangler Free 정적 한도는 버전당 20,000개 파일, 파일당 25 MiB이며 최종 manifest 전체를 대상으로 검사합니다. 총 크기에 대한 업로드 성공을 이 로컬 검사로 보장하지 않습니다. `deploy:bootstrap`은 이제 계정·무료 플랜·대상 주소 확인 후 새로 만든 빈 bootstrap만 실제 업로드하는 명령입니다. `access:verify`는 실제 API와 서로 다른 브라우저 인증 상태를 검사합니다. 기존 실제 배포와 보호 확인 상태는 [구현 상태](docs/operations/implementation-status.md)에 기록하며, 합성 테스트는 실제 보호 증거가 아닙니다. 실행 전 [배포 운영 안내](docs/operations/deployment.md)를 확인하세요. 실제 자료 업로드는 현재의 Access 증거와 실제 자료 검증을 모두 요구합니다.

## 보호된 실제 자료 릴리스

사용자 승인과 실제 계정 보호 검증 후 `npm run deploy:private`를 수동 실행합니다. 명령은 재빌드하지 않으며 인자를 받지 않습니다. `.reports/app-build.json` 최종 앱 manifest, 24시간 이내의 `.reports/verification.json`, `.reports/access-evidence.json` 및 현재 설정·무료 플랜·Access 정책이 모두 일치해야 업로드합니다. 전체 문서 검사와 Chromium/Firefox/WebKit × 390/1440px의 42개 대표 시나리오, 동적 workbook 그림, 정확한 예외를 확인합니다. 실제 220개 HTML 수는 현재 catalog에서 계산하므로 향후 입력 증가도 전부 검사해야 합니다.

검사한 바이트를 별도 소유 디렉터리에 복사한 뒤 그 사본과 전용 Wrangler 설정만 사용합니다. 원본 dist를 동시에 다시 빌드해도 업로드 사본은 바뀌지 않습니다. 결과는 `.reports/private-release.json`에 기록하며 업로드 영수증은 실제 AC-12/13 인수 증거와 구분합니다. 기존 수동 업로드·보호 확인 이력과 남은 인수는 [구현 상태](docs/operations/implementation-status.md)를 확인하세요. 상세한 게이트·실패 처리·인수 절차는 [배포 운영 안내](docs/operations/deployment.md)를 따르세요.

실제 runtime proof v2는 검증에 사용한 source-settings의 canonical 경로·정확한 바이트와 해석한 원본 선택을 묶습니다. 릴리스는 시작 시와 마지막 Access 확인 후 현재 원본 전체의 hash·Git 추적/선택/provenance를 다시 읽습니다. 원본이나 설정이 바뀌면 업로드를 거절하므로 수동 build/verify를 다시 수행하세요. 기존 v1 증거는 v2 재검증이 필요합니다. `.envrc`를 포함한 모든 `.env*` 세그먼트는 금지합니다.
