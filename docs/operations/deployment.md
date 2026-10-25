# 개인 자료 배포 운영

현재 상태는 로컬 구현·합성 검증 완료, 실제 계정 준비·빈 앱 게시·Access 보호 검증 대기입니다. 실제 허용 이메일과 계정이 아직 제공되지 않았고 Wrangler 로그인도 확인되지 않았습니다. 실제 자료를 게시하지 마세요. 이 문서의 클라우드 변경 단계는 사용자 승인 후 수행합니다.

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

업로더는 `/accounts/{id}` 응답의 계정 ID와 계정 workers.dev 서브도메인을 대조합니다. 구독 조회는 모든 응답에 명시적 `Provisioned`, 가격 0과 Workers Free·Zero Trust Free 두 제품의 명시적 plan 표시가 있어야 통과합니다. 실제 무료 계정 응답이 이 보수적인 형태와 다르면 중단하고 공식 스키마 및 비식별 실제 GET 응답을 확인해 adapter를 검토하세요. 이름 추측·수동 성공 플래그·빈 구독 목록으로 우회하지 않습니다. 실제 GET 호환성은 아직 미검증입니다.

## 이 Worker만 보호

Workers & Pages에서 **ajou-study-hub → Access → Protect this Worker → All traffic**을 선택합니다. 계정 전체 보호를 변경하지 않습니다. 목적지는 `type: worker`, `worker_id: 실제 immutable ID` 하나여야 합니다. 이름을 ID로 가정하지 않습니다. `preview_worker`만으로는 운영을 보호하지 못합니다.

Zero Trust 앱에서 Allow 정책을 하나만 두고 Include를 본인 이메일 정확히 하나로 설정합니다. `email_domain`, everyone, 추가 이메일, bypass, service auth, 복잡한 require/exclude는 이 프로젝트에서 허용하지 않습니다. 인증 공급자는 One-time PIN 하나만 선택합니다. 앱과 목적지의 public path override, preflight bypass, 더 구체적인 hostname/path/wildcard/preview 앱을 모두 확인합니다. 읽기 adapter는 이 Worker에 겹치는 구체적인 앱을 발견하면 거절합니다.

초기 릴리스는 preview URL을 비활성화하고 API의 `previews_enabled:false`를 확인하는 경로만 지원합니다. 활성 preview/사용자 도메인/zone route가 있으면 주소 인벤토리를 완전하게 검증할 수 없어 중단합니다. 새 preview를 켜려면 전체 preview·버전 주소 인벤토리 지원과 각 주소의 인증 검증을 추가한 뒤 새 증거를 만들어야 합니다. worker-wide 목적지는 필수이며 이 제한을 production-only 앱으로 대체하지 않습니다.

## 인증별 실제 검증

사용자가 직접 OTP를 입력해 서로 다른 브라우저 세션으로 본인과 다른 계정을 준비하고 Playwright storageState를 각각 `.local/auth/owner.json`, `.local/auth/other.json`에 저장합니다. OTP·쿠키·storageState를 채팅·로그·Git으로 보내지 않습니다. 다른 계정은 본인 세션을 재사용하면 안 됩니다.

검증기는 각 호스트의 `/cdn-cgi/access/get-identity`에서 본인 이메일 일치와 다른 이메일임을 확인합니다. 다른 계정이 앱에서 차단되어 이 identity endpoint 자체를 읽을 수 없는 경우에도 성공으로 추정하지 않습니다. 그 경우 실제 환경에 맞는 안전한 identity 증명 경로를 먼저 검토해야 하며 증거는 미완료입니다.

운영 호스트의 빈 catalog, HTML, 중첩 `.pack` HTML, PNG, PDF, 폰트 MIME sentinel 모두를 검사합니다. 본인은 정확한 원본 바이트/해시와 200을 받아야 합니다. 비로그인과 다른 계정 응답은 sentinel 바이트가 없어야 하며 Cloudflare Access 로그인 리다이렉트 또는 식별 가능한 Access 403을 보여야 합니다. 네트워크 오류·5xx·일반 401/404는 차단 성공이 아닙니다. 검증 전후 정책을 다시 조회해 중간 변경도 거절합니다.

증거는 24시간만 유효합니다. 계정·Worker·앱 ID, 설정·정책 fingerprint, 호스트 목록이 달라지면 릴리스가 중단됩니다. 실패한 재검증이나 새 bootstrap 업로드는 이전 성공 증거를 무효화합니다. `.generated/verification-tests/` 아래 합성 프로젝트는 실제 증거를 만들지 않습니다.

문제가 생기면 실제 자료 업로드를 중단하고 해당 Worker의 공개 주소·preview를 비활성화하거나 보호 설정을 복구합니다. 다른 Worker나 계정 전체 설정은 변경하지 않습니다. 실제 자료를 다시 빌드했다면 자료 검증 보고서도 새로 생성합니다. 전역 CSP/X-Frame-Options는 기존 신뢰 문서의 iframe·인라인 코드 호환성 때문에 여기서 추가하지 않습니다.

## 공식 근거와 남은 확인

2026-10-25에 Cloudflare 공식 [Worker Access 안내](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)와 [TypeScript SDK 앱 스키마](https://github.com/cloudflare/cloudflare-typescript/blob/main/src/resources/zero-trust/access/applications/applications.ts), [immutable Worker 스키마](https://github.com/cloudflare/cloudflare-typescript/blob/main/src/resources/workers/beta/workers/workers.ts), [구독 스키마](https://github.com/cloudflare/cloudflare-typescript/blob/main/src/resources/shared.ts)를 읽었습니다. 합성 fixture는 이 스키마의 비식별 최소 응답이며 실제 계정 GET fixture가 아닙니다.

실제 계정·Free 플랜 응답·Access 앱/정책·페이지네이션·다른 계정 identity 증명·게시 후 sentinel 응답은 모두 실제 준비 이후 재확인이 필요합니다. 실제 AC-12/AC-13 통과를 로컬 테스트로 주장하지 않습니다.
