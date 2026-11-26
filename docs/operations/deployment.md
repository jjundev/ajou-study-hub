# 자료실 배포 운영

## 과목 Worker 운영 전환

새 전환은 [과목 Worker 전환 작업](https://github.com/jjundev/ajou-study-hub/actions/workflows/study-hub-course-cutover.yml)에서 실행합니다. Cloudflare Workers Free의 정적 자산과 Service Binding을 사용합니다. 운영 허브가 기존 주소에서 공통 UI와 통합 목록을 제공하고, 연결된 과목의 문서를 해당 과목 Worker에 전달합니다.

1. 검증된 공개 배포의 실행 ID, 시도 번호, 운영 카탈로그 SHA-256을 준비합니다. 전환 작업에서 `verify_only`를 선택하면 고정 커밋으로 기준본을 재현하고 해시를 비교합니다.
2. 재현이 확인되면 자동 게시 변수를 `disabled`로 바꾸고 이미 시작한 게시를 확인합니다. `pilot`을 선택해 생명과학을 먼저 등록합니다. 초기화 중 중단됐다면 작업이 기록한 `course-seed-receipts.json`을 `STUDY_HUB_COURSE_SEED_RETRY`에 기록한 뒤 같은 기준본으로 재실행합니다.
3. `course-cutover.json`에서 `settings`와 `checkpoints`를 각각 `STUDY_HUB_COURSE_WORKER_SETTINGS`와 `STUDY_HUB_COURSE_WORKER_BASELINES`에 반영합니다. 이어서 `STUDY_HUB_STATIC_WORKER_PROFILE`을 `pilot`으로 맞추고 자동 게시를 켭니다.
4. `source_repository=jjundev/ajou-life-science`로 갱신을 실행합니다. 운영 주소의 생명과학 자료와 논리회로실험, 전자회로2, 자료구조, 기계학습기초의 대표 자료를 확인합니다. 과목 실행 전후로 생명과학 활성 버전과 허브 활성 버전을 비교합니다.
5. 같은 순서로 `all` 전환을 실행하고 결과에서 설정과 체크포인트를 반영합니다. 운영 `/_study-hub/routing.json`의 `profile`과 과목 ID를 확인한 뒤 `STUDY_HUB_STATIC_WORKER_PROFILE`을 `all`로 맞추고 자동 게시를 켭니다. 정지 중 누락된 갱신은 과목별로 다시 요청합니다.

각 내부 Worker는 `workers_dev`와 preview를 모두 비활성화합니다. 과목별 새 버전이 공개 응답 검사에 실패하면, 해당 버전이 아직 활성 상태일 때 이전 체크포인트로 복구합니다. 공개 경로는 `content/<과목 ID>/` 아래 원래 주소를 사용합니다. `/catalog.json`을 처리하는 요청과 내부 Worker로 전달되는 자료 요청은 [Workers Free 한도](https://developers.cloudflare.com/workers/platform/limits/)에 포함됩니다.

## 운영 주소에 수동 공개 게시

이 절차는 `legacy` 프로필의 통합 번들에 적용합니다. 운영 주소는 비로그인 요청을 받습니다. 일반 갱신에는 [자동 갱신](automatic-updates.md)을 사용합니다.
수동 배포가 필요하면 기존 Worker `ajou-study-hub`에 게시합니다. 운영 주소 하나를 사용하며 preview,
커스텀 도메인, zone route가 비활성 상태인지 확인합니다.

1. [자동 갱신 운영](automatic-updates.md)에 따라 `STUDY_HUB_AUTOMATIC_UPDATES`를
   `disabled`로 설정하고 진행 중인 게시를 확인합니다. GitHub Actions에서
   `mode:verify`를 실행하고 앱 및 과목별 체크아웃 커밋 5개를 기록합니다.
2. 같은 커밋을 체크아웃하고 `.local/sources.json`에 원본을 지정합니다.
   아래 명령으로 최종 파일 목록과 새 브라우저 검증 증거를 만듭니다.

   ```powershell
   npm run build -- --sources .local/sources.json
   npm run verify:content -- --sources .local/sources.json
   ```

3. Cloudflare에서 독립 조회한 계정과 Worker ID를 `.local/public-deployment.json`에
   넣습니다. `workerId`는 Workers 목록과 상세 조회에서 확인한 고유 ID입니다.

   ```json
   {
     "accountId": "32자리 Cloudflare 계정 ID",
     "workerName": "ajou-study-hub",
     "workerId": "32자리 Cloudflare Worker ID",
     "productionUrl": "https://ajou-study-hub.johnshin617.workers.dev",
     "previewUrls": []
   }
   ```

4. `CLOUDFLARE_READ_TOKEN`에는 Worker·배포·서브도메인과 계정의 zone/route를
   조회할 읽기 토큰을, `CLOUDFLARE_API_TOKEN`에는 기존 계정에 Worker를 배포할
   쓰기 토큰을 환경변수로 전달합니다. 토큰은 기존 비밀 전달 경로에서 불러오고
   설정·명령 인자·로그에는 기록하지 않습니다. 토큰 만료와 조회 가능 여부를 확인합니다.
5. 운영 카탈로그와 새 `dist/catalog.json`을 문서 ID로 대조합니다.
   `.reports/app-build.json`의 PDF·이미지·JS·폰트 경로와 SHA-256을 검토하고
   같은 번들에서 `npm run deploy:public`을 한 번 실행합니다.

공개 명령은 24시간 이내의 검증, 고정 원본, 파일 수와 크기, 봉인된 사본을
확인합니다. 읽기 API로 대상 ID·호스트·단일 활성 버전을 확인하고, 인증정보 없는
GET으로 운영 홈과 카탈로그를 엽니다. 게시 후에는 운영 버전이 Wrangler 영수증과
일치해야 합니다. 배포 목록에서 HTTP로 제공하는 파일의 크기·SHA-256·형식별 MIME을
대조하고, 홈 리다이렉트와 존재하지 않는 경로의 404 본문을 확인합니다.
`checked`는 검사한 배포 파일 수로 404 본문을 포함합니다. `_headers`와
`_redirects`는 호스팅 설정 파일입니다.

`.reports/public-release.json`에는 URL, 이전 버전과 번들 해시를 업로드 직전에
기록합니다. `upload-started-outcome-unknown`이면 Dashboard에서 현재 활성 버전을
먼저 확인합니다. `uploaded-postcheck-pending`이면 영수증의 `versionId`와 현재
활성 버전을 대조합니다. 새 버전에서 자료 확인이 실패하면 같은 Worker의
`previousVersionId`로 트래픽을 복구하고 활성 버전과 비로그인 카탈로그를 확인합니다.
실행이 비정상 종료되어 `.reports/public-release.lock`이 남으면, 같은 명령이 실행 중인지
확인하고 현재 버전과 영수증을 대조한 뒤 남은 잠금 파일을 제거합니다.

`published-public-verified`와 `checked`가 기록되면 새 Chromium 세션에서 5과목,
11월 자료, 실험 07~09의 문서와 동적 그림, 대표 PDF를 엽니다. 운영 버전 ID와
문서·파일 검사 개수를 기록합니다.

## 기존 비공개 배포 이력

2026-10-26(한국시간) 현재 실제 계정 설정·빈 앱의 v2 보호 검증을 마치고 실제 학습 자료를 비공개 사이트에 게시했습니다. 운영 URL·버전 영수증과 게시 후 실제 자료 12개 대표 경로의 원본 바이트·접근 차단 검사를 확인했습니다. 검사 전후 독립된 두 신원과 공식 정책 판정, 보호 설정이 일치했습니다. 실제 휴대폰/PC에서 사용자가 대표 자료를 조작하는 인수는 별도 대기 중입니다. 이 문서의 클라우드 변경 단계는 사용자가 요청한 배포 범위 안에서 수행합니다.

## 명령의 구분

- `npm run bootstrap:build`: 네트워크 업로드 없이 빈 앱과 합성 sentinel만 `.generated/bootstrap/`에 생성합니다.
- `npm run deploy:bootstrap`: 실제 업로드입니다. 로컬 설정과 읽기 API로 계정·무료 플랜·대상 주소를 확인한 뒤 bootstrap을 새로 만들고 빈 sources/inputs·목록·해시를 대조합니다. 전용 Wrangler 설정만 사용하며 임의 디렉터리·main·routes·추가 CLI 인자는 받지 않습니다. `dist`는 이 경로로 업로드할 수 없습니다.
- `npm run access:verify`: 증거를 먼저 무효화하고 실제 API와 인증별 sentinel 응답을 검사합니다. 성공한 경우만 `.reports/access-evidence.json`을 원자적으로 교체합니다. 에러 본문·쿠키·토큰은 출력하지 않습니다.
- `npm run deploy:private`: 별도 릴리스 가드에서 실제 자료 검증과 현재 Access 증거를 모두 확인해야 하는 진입점입니다.

## 승인 후 계정 준비와 빈 앱 게시

무료 Cloudflare Workers와 Zero Trust 계정 및 Access 읽기·관리 권한을 준비합니다. 유료 업그레이드·trial·추가 기능은 활성화하지 않습니다. 토큰은 `CLOUDFLARE_API_TOKEN` 환경변수로만 전달하고 설정 파일에 저장하지 않습니다. 현재 읽기 adapter는 토큰 경로를 지원하며 Wrangler 로그인 세션을 토큰처럼 추출하지 않습니다.

`.local/deployment.json`의 형태는 다음과 같습니다. 실제 값은 Git에 넣지 않습니다.

```json
{
  "accountId": "실제 32자리 계정 ID",
  "workerName": "ajou-study-hub",
  "allowedEmail": "본인의 실제 이메일",
  "accessAppId": "실제 Access 앱 ID",
  "productionUrl": "https://ajou-study-hub.계정서브도메인.workers.dev",
  "previewUrls": []
}
```

최초 Worker 생성 전에는 빈 bootstrap 업로더에 한해 `accessAppId`를 생략하거나 빈 문자열로 둘 수 있습니다. 생성 후 실제 immutable Worker ID를 조회하고 Access 앱을 만든 다음 반드시 실제 앱 ID를 입력합니다. 보호 검증과 실제 자료 릴리스는 pending 앱 ID를 허용하지 않습니다.

업로더는 `/accounts/{id}` 응답의 계정 ID와 계정 workers.dev 서브도메인을 대조합니다. 2026-10-25 실제 읽기 검증으로 API 호환성을 확인했습니다. Workers 목록은 `total_pages`가 없으면 `total_count`·`per_page`로 전체 페이지를 확인하며, 조회 도중 전체 개수가 바뀌거나 건수가 맞지 않으면 거절합니다. 구독 엔드포인트에는 페이지 쿼리를 보내지 않고, 응답의 건수·전체 개수·마지막 페이지 표시로 목록이 완전한지 확인합니다.

구독 검사는 현재 확인한 무료 계정 형식 하나만 허용합니다. 구독이 정확히 하나이며 `state: Paid`, `price: 0`, `currency: USD`, `trial: null`이어야 하고, 플랜은 `teams_free` / `Teams Free Base`, 계정 범위, 비외부관리·비계약 상태여야 합니다. `Paid`는 이 응답의 상태 이름이며 금액 0과 정확한 무료 플랜을 함께 검사합니다. [Workers Free는 기본 플랜](https://developers.cloudflare.com/workers/platform/pricing/)이므로 별도 Workers Free 구독 행을 요구하지 않습니다. 다른 구독·유료 플랜·체험판·빈 목록·알 수 없는 형식은 거절합니다. 이 읽기 검증은 로그인 세션과 실제 배포 파일의 접근 검증을 대신하지 않습니다.

## 이 Worker만 보호

Workers & Pages에서 **ajou-study-hub → Access → Protect this Worker → All traffic**을 선택합니다. 계정 전체 보호를 변경하지 않습니다. 목적지는 `type: worker`, `worker_id: 실제 immutable ID` 하나여야 합니다. 이름을 ID로 가정하지 않습니다. `preview_worker`만으로는 운영을 보호하지 못합니다.

Zero Trust 앱에서 Allow 정책을 하나만 두고 Include를 본인 이메일 정확히 하나로 설정합니다. `email_domain`, everyone, 추가 이메일, bypass, service auth, 복잡한 require/exclude는 이 프로젝트에서 허용하지 않습니다. 인증 공급자는 One-time PIN 하나만 선택합니다. 앱과 목적지의 public path override, preflight bypass, 더 구체적인 hostname/path/wildcard/preview 앱을 모두 확인합니다. 읽기 adapter는 이 Worker에 겹치는 구체적인 앱을 발견하면 거절합니다.

초기 릴리스는 preview URL을 비활성화하고 API의 `previews_enabled:false`를 확인하는 경로만 지원합니다. 활성 preview/사용자 도메인/zone route가 있으면 주소 인벤토리를 완전하게 검증할 수 없어 중단합니다. 새 preview를 켜려면 전체 preview·버전 주소 인벤토리 지원과 각 주소의 인증 검증을 추가한 뒤 새 증거를 만들어야 합니다. worker-wide 목적지는 필수이며 이 제한을 production-only 앱으로 대체하지 않습니다.

## 인증별 실제 검증

본인은 사용자가 직접 OTP를 입력한 정상 세션을 `.local/auth/owner.json`에 저장합니다. 다른 계정은 **같은 Zero Trust 팀에서 이미 독립적으로 인증된 사람의 세션**이 있어야 하며 이를 별도 `.local/auth/other.json`에 저장합니다. 예를 들어 그 계정이 기존의 다른 팀 앱에 정당하게 접근해 이미 발급받은 팀 세션을 사용할 수 있습니다. 기존에 이런 세션이 없으면 다른 계정 검증은 미완료로 남깁니다. 소유자 전용 대상 앱에서 차단된 이메일은 OTP를 받지 못하며, 화면의 “코드를 보냈다”는 안내는 인증 증거가 아닙니다. 임시 이메일 추가·정책 완화·새 앱 생성·세션 위조로 이 조건을 우회하지 않습니다. OTP·쿠키·storageState는 채팅·로그·Git으로 보내지 않고 본인 세션을 다른 계정에 재사용하지 않습니다.

검증기는 계정의 읽기 API `/accounts/{id}/access/organizations`가 반환한 `auth_domain`을 확인하고 **`https://<팀>.cloudflareaccess.com/cdn-cgi/access/get-identity`**로만 identity를 조회합니다. Worker 호스트에 이 경로를 붙이지 않습니다. 팀 도메인·HTTPS·userinfo 없는 주소만 허용하고 리다이렉트를 따라가지 않습니다. 브라우저의 정상 쿠키 범위를 사용하며 API bearer나 Worker 쿠키를 명시적으로 다른 출처에 복사하지 않습니다. 응답의 계정 ID와 user_uuid, 본인/다른 이메일을 확인하고 service token은 거절합니다. 현재 OTP 사용자 응답에서 `service_token_status`가 생략되는 경우가 확인됐습니다. 이때는 실제 앱의 `allowed_idps`와 읽기 API에서 확인한 OTP 공급자 ID가 응답의 `idp.id`와 정확히 일치하고 `idp.type`이 `onetimepin`인 경우만 허용합니다. 계정·이메일·사용자 UUID·service_token_id 검사는 그대로 수행하며, 명시적 true/null/문자열 상태나 공급자 불일치는 거절합니다. 필드가 없다는 이유만으로 서비스 토큰 검사를 생략하지 않습니다. 팀에 유효한 사용자 세션이 없거나 identity 응답을 확인할 수 없으면 증거는 미완료입니다.

운영 호스트의 빈 catalog, HTML, 중첩 `.pack` HTML, PNG, PDF, 폰트 MIME sentinel 모두를 검사합니다. 본인은 정확한 원본 바이트/해시와 200을 받아야 합니다. 비로그인은 sentinel 바이트가 없는 Cloudflare Access 로그인 리다이렉트 또는 식별 가능한 Access 403이어야 합니다.

2026-10-26 사용자는 이메일 OTP와 본인 전용 정책을 유지하면서 다른 계정의 최종 HTTP 403 필수 조건을 아래 결합 증거로 대체하도록 명시적으로 승인했습니다. 이는 최종 대상 앱의 인증·인가 거부 응답을 직접 확인하는 방식과 구별합니다.

- 독립된 두 브라우저 세션에서 같은 팀의 실제 계정 ID·이메일·사용자 UUID를 확인하며, 소유자와 다른 계정의 UUID가 달라야 합니다. service token은 거절합니다.
- 공식 `GET /accounts/{account_id}/access/apps/{app_id}/user_policy_checks?user_id=<독립 확인 UUID>`를 사용합니다. 응답의 계정·앱·사용자 UUID·이메일이 모두 일치하고, 본인은 `success`, 다른 계정은 `fail`이어야 합니다. 현재의 Allow 정책 하나와 정책별 상태도 정확히 대조합니다. 누락·오류·리다이렉트·알 수 없는 상태는 실패입니다.
- 다른 계정으로 모든 sentinel에 실제 요청하고 파일 바이트가 나오지 않는지 확인합니다. 신뢰한 팀과 대상 출처 안의 최대 8회 리다이렉트를 따라 최종 응답까지 검사합니다. 최종 200은 정확한 팀의 `/cdn-cgi/access/login/<대상 호스트>`에서 Cloudflare 표식과 정상 이메일 로그인 폼이 확인될 때만 위 정책 거부 판정과 함께 인정합니다. 로그인 리다이렉트 하나, 임의 200, 외부 출처, 네트워크 오류·일반 오류 응답은 근거가 될 수 없습니다.
- 검사 후 두 신원과 공식 정책 판정을 다시 조회해 같음을 확인하고, 보호 정책·호스트·플랜 전체도 다시 대조합니다.

증거 형식 v2는 검증 방법과 서로 다른 두 신원 해시, 공식 정책 판정 해시, 모든 sentinel 해시를 포함합니다. 예전 형식이나 수동 성공 플래그는 릴리스 가드가 거절합니다. 공식 정책 검사는 가장 최근 인증 신원을 평가하는 보조 근거이므로, 실제 세션 신원·실제 파일 미노출 검사 없이 단독으로 보호 성공을 주장하지 않습니다.

증거는 24시간만 유효합니다. 계정·Worker·앱 ID, 설정·정책 fingerprint, 호스트 목록이 달라지면 릴리스가 중단됩니다. 실패한 재검증이나 새 bootstrap 업로드는 이전 성공 증거를 무효화합니다. `.generated/verification-tests/` 아래 합성 프로젝트는 실제 증거를 만들지 않습니다.

문제가 생기면 실제 자료 업로드를 중단하고 해당 Worker의 공개 주소·preview를 비활성화하거나 보호 설정을 복구합니다. 다른 Worker나 계정 전체 설정은 변경하지 않습니다. 실제 자료를 다시 빌드했다면 자료 검증 보고서도 새로 생성합니다. 전역 CSP/X-Frame-Options는 기존 신뢰 문서의 iframe·인라인 코드 호환성 때문에 여기서 추가하지 않습니다.

## 공식 근거와 남은 확인

2026-10-25에 Cloudflare 공식 [Worker Access 안내](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)와 [TypeScript SDK 앱 스키마](https://github.com/cloudflare/cloudflare-typescript/blob/main/src/resources/zero-trust/access/applications/applications.ts), [immutable Worker 스키마](https://github.com/cloudflare/cloudflare-typescript/blob/main/src/resources/workers/beta/workers/workers.ts), [구독 스키마](https://github.com/cloudflare/cloudflare-typescript/blob/main/src/resources/shared.ts)를 읽었습니다. 합성 fixture는 이 스키마의 비식별 최소 응답이며 실제 계정 GET fixture가 아닙니다.

실제 계정·Free 플랜 응답·Access 앱/정책·페이지네이션·다른 계정 identity 증명·게시 후 sentinel 응답은 모두 실제 준비 이후 재확인이 필요합니다. 실제 AC-12/AC-13 통과를 로컬 테스트로 주장하지 않습니다.

공식 추가 근거: [사용자 identity 조회](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/#user-identity), [OTP 차단 사용자 동작](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/#log-in-with-otp), [조직 auth_domain 조회](https://developers.cloudflare.com/api/resources/zero_trust/subresources/organizations/methods/list/). 2026-10-25 재확인했습니다.

## 실제 자료의 수동 릴리스 게이트

승인 후 실제 자료를 갱신하는 순서는 다음과 같습니다. 원본은 수정하지 않습니다.

```powershell
npm run build -- --sources .local/sources.json
npm run verify:content -- --sources .local/sources.json
npm run access:verify
npm run deploy:private
```

마지막 명령은 재빌드하거나 추가 인자를 받지 않습니다. `releasePrivate`의 `reportPath`는 `.reports/app-build.json` 최종 앱 manifest입니다. `.reports/content-build.json`이나 임의 보고서를 지정할 수 없습니다. runtime proof는 `.reports/verification.json`, 보호 proof는 `.reports/access-evidence.json` 하나씩만 읽습니다. 모두 로컬 파일이며 게시하지 않습니다. 생성 시각이 24시간을 넘거나 최종 manifest보다 오래된 runtime proof, 바뀐 입력 hash/provenance·catalog hash·출력 hash·크기·파일 집합, 미완료 문서/요청, 부족한 대표 시나리오, 정적/동적 error와 알려지지 않은 warning은 업로드 전에 중단합니다. 알려진 warning도 현재 `config/content-exceptions.json`의 정확한 외부 요청·종류·이유와 원본/사본 fallback 가독성 증거가 필요합니다. 실제 검증의 220개 HTML과 42개 대표 시나리오를 성공 플래그 하나로 대체하지 않습니다. 문서 수는 고정 상수가 아니라 catalog 전체입니다.

검증기는 symlink와 금지 파일(`.git`, `.env*`, credentials, secret JSON/PEM, 제작/backup, `.local`, `.reports`, `_worker.js`, `.assetsignore`)을 거절하고 Free 한도를 최종 파일 전체에 적용합니다. 업로더는 `.generated/private-release-<UUID>/assets/`에 파일을 복사해 manifest와 다시 대조합니다. hardlink를 사용하지 않으며 동시 dist 재빌드와 분리됩니다. 임시 사본은 실행 후 제거합니다. 이 공간은 현재 약 1.1GB인 dist 외에 같은 크기의 여유 디스크가 더 필요합니다.

프로젝트 `wrangler.jsonc`는 현재 검토한 name/compatibility_date/assets 세 필드만 허용합니다. 설정 확장이 필요하면 먼저 코드와 검증을 함께 검토하세요. 업로드 시 계정 ID, 전용 Worker, 정적 assets, `html_handling:none`, `not_found_handling:404-page`, `workers_dev:true`, `preview_urls:false`로 고정한 별도 설정을 만듭니다. main, run_worker_first, routes, 새 호스트, env, build hook과 CLI override는 허용하지 않습니다. 마지막 live snapshot은 사본 생성 후 다시 읽고, 설정/정책/주소와 proof/config/dist를 재확인한 직후 업로드합니다. API token은 환경변수, 정상 Wrangler 인증은 로컬 세션만 사용하며 토큰·OTP·응답 본문·업로드 로그를 출력하거나 URL 상태에 넣지 않습니다.

실제 설치된 Wrangler 4.152.0의 `deploy --help`와 구현의 `Current Version ID:` 및 trigger URL 출력을 확인해 `deploy --config <전용설정> --strict --autoconfig=false`를 사용합니다. 해당 버전의 변경 후에는 이 계약을 재확인해야 합니다. 영수증은 정확한 운영 URL 하나와 UUID 버전 ID 하나가 있어야 인정합니다. CLI 종료 성공만으로 보호·접근 성공을 주장하지 않습니다. 실제 GET 응답 및 빈 bootstrap upload 호환성은 확인했으며 실제 자료 upload의 영수증과 인수는 별도로 확인합니다. 알 수 없는 응답은 중단합니다.

`.reports/private-release.json`은 배포 영수증 전용입니다. `prepared-not-uploaded`는 업로드 전, `upload-started-outcome-unknown`은 업로드가 시작되어 결과를 확인해야 하는 상태, `uploaded-acceptance-pending`은 URL/버전 영수증만 확인한 상태입니다. 모든 상태에서 `acceptanceComplete:false`입니다. 중간 오류·네트워크 단절·영수증 해석 오류는 실제 게시가 없었다는 뜻이 아닙니다. 중복 재시도 전에 Dashboard에서 전용 Worker의 현재 버전·주소·보호를 확인하세요. 실제 인수 기록은 영수증과 별도 로컬 기록에 남깁니다.

## 게시 후 실제 인수와 회수

빈 bootstrap sentinel을 검증한 `access:verify`는 실제 자료 인수 검사를 대신하지 않습니다. 게시 후 같은 계정·정책·전체 주소를 다시 조회하고 운영 및 활성 preview 각각에서 **실제 catalog, HTML, 중첩 HTML, 이미지, PDF**의 본문이 비로그인 및 독립 인증된 다른 계정에 노출되지 않는지 직접 확인합니다. 비로그인은 확인한 Access 로그인/차단 응답, 다른 계정은 위 v2 절차의 독립 신원·공식 정책 거부 판정·실제 자료 미노출 확인이 필요합니다. 다른 계정의 로그인 페이지 또는 단순 5xx를 보호 성공으로 계산하지 않습니다. 본인은 정상 OTP 후 모바일과 PC에서 대표 자료·문제 선택/풀이·이미지·내부 링크·뒤로가기를 엽니다. 새 preview/주소가 있으면 먼저 완전한 주소 지원과 Task9 보호 검증을 다시 수행합니다. 현재 경로는 preview 비활성만 지원하므로 새 주소가 생기면 중단합니다.

이 단계는 아직 자동화된 실제 자료 검증 명령을 제공하지 않으며 사용자 실계정·독립 witness·모바일/PC 인수가 필요합니다. AC-12/13은 실제 기록이 생길 때까지 미완료입니다. 정책 조회가 바뀌거나 본문 노출/인가 실패가 있으면 성공으로 보고하지 않고 사용자 승인하에 해당 앱을 전체 차단하거나 자료 없는 검증 배포물로 회수합니다. `deploy:bootstrap`은 빈 앱 재게시 경로지만 회수 완료 자체도 보호와 본문 부재를 다시 확인해야 합니다. rollback은 현재 보호가 확인된 버전만 수동 선택하고 새 버전 URL/호스트도 다시 확인합니다. 보호 해제·이메일 추가·임시 bypass로 복구하지 않습니다.

무료 사용량은 Cloudflare Dashboard의 해당 계정 Workers & Pages → 전용 Worker → Metrics 및 계정 Billing/Subscriptions와 Zero Trust 계정 플랜에서 확인합니다. 경로명이 달라지거나 Free 여부가 읽기 API로 확인되지 않으면 무료라고 추정하지 않습니다. 파일 수/단일 파일 한도 통과는 총 전송 성공·무료 API 호환성·원격 접근 인수를 보장하지 않습니다.

### 원본 입력의 현재 상태와 proof v2

릴리스는 최종 사본의 바이트뿐 아니라 현재 원본도 확인합니다. runtime proof v2는 검증에 사용한 프로젝트 내부의 canonical source-settings 경로, 파일 바이트 SHA-256, 해석한 roots/explicitUntracked, 수집 규칙, canonical 원본 root, 전체 catalog 선택을 기록합니다. 과거 v1 proof는 이 identity가 없으므로 재검증이 필요합니다. `.local/sources.json` 등 설정 파일의 공백만 바뀌어도 기존 proof를 재사용하지 않습니다.

배포 시작 시와 두 번째 live Access snapshot 직후 각각 새 Git batch로 추적 목록·HEAD·dirty 상태·선택을 확인하고, 모든 manifest 입력의 현재 허용 경로/realpath와 바이트 hash를 대조합니다. 검사 도중의 추적·바이트·설정 변화도 다시 확인합니다. 원본의 수정/삭제, git 추적 해제/추가, explicitUntracked 변경, root 전환은 업로드를 막습니다. 이 경우 자동으로 다시 빌드하거나 원본을 수정하지 않습니다. 필요한 변경을 검토하고 수동 build/verify를 다시 수행하세요. 동일 root를 공유하는 합성 fixture도 호출마다 새 Git batch를 사용하며 파일마다 Git 프로세스를 시작하지 않습니다.

`.envrc`, `.envproduction`, 중첩 `.ENV*`를 포함해 어느 경로 세그먼트에서든 대소문자 구분 없이 `.env`로 시작하는 파일을 수집기와 릴리스가 함께 거절합니다. 업로드 직전에는 runtime 및 Access proof의 나이도 다시 확인하므로 대형 사본을 준비하는 동안 24시간을 넘긴 증거로 게시할 수 없습니다.
