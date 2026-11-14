# Android WebView Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 자동 갱신 학습 허브를 Android에서 전체 화면 WebView로 사용하고 설치 가능한 디버그 APK를 제공한다.

**Architecture:** `android/`에 Kotlin Android 앱을 만들고 기존 HTTPS 사이트를 WebView에서 연다. 탐색·인증과 PDF 전달은 별도 경계로 다루며, 실제 Access 및 WebView 동작을 작은 기기 검증으로 먼저 확인한다. 웹앱과 서버의 기존 배포 체계는 변경하지 않는다.

**Tech Stack:** Kotlin, Android Views/WebView, AndroidX, Gradle Wrapper, JUnit, Android instrumentation tests.

**Spec:** `docs/superpowers/specs/2026-10-31-android-webview-design.md`. 후속 대화에서 사용자가 제공한 운영 주소는 `https://ajou-study-hub.johnshin617.workers.dev/`이며, 로그인 리다이렉트 호스트는 `solitary-paper-7635.cloudflareaccess.com`이다. 이는 설계의 기존 로컬 설정 경로가 현재 없다는 사실을 대체하는 계획상의 입력이다. 설계 전체의 승인 여부는 실행 전에 확인한다.

## Global Constraints

- 학습 자료를 APK에 포함하지 않고, 온라인의 기존 자동 갱신 사이트와 기존 Access 정책을 사용한다.
- 인증 쿠키, OTP, Access 임시 로그인 URL 및 query 문자열을 소스·로그·테스트 결과에 저장하지 않는다.
- 앱에서 JavaScript, DOM 저장소, 쿠키 및 기존 iframe을 지원한다. Android 기기에서 동작을 검증하기 전까지 기존 브라우저 호환성을 가정하지 않는다.
- 기본 화면은 시스템 바를 숨기고 사용자의 제스처로 일시 표시한다. 인증·키보드·화면 잘림도 확인한다.
- Android 뒤로 가기는 웹 탐색 기록을 우선 사용하며, 기록이 없을 때 기본 종료 동작을 따른다.
- 외부 링크·새 창·보호된 PDF/다운로드를 지원하고 쿠키를 임의 외부 호스트에 넘기지 않는다.
- 오프라인 자료 동기화, 기존 브라우저 데이터 이전, 푸시 알림, Play 게시, 릴리스 서명은 제외한다.
- 실제 운영 계정·사이트 설정을 변경하지 않는다. 사용자의 OTP 입력 없이 인증 완료를 주장하지 않는다.

## Review Focus

1. 새 창 요청은 신뢰할 수 없는 iframe에서도 올 수 있다: Task 2의 비사용자 제스처와 미허용 스킴 검사.
2. 인증된 PDF가 다른 호스트로 리다이렉트될 수 있다: Task 3의 호스트 이탈 검사.
3. 로그인 HTML 응답이나 403이 PDF로 저장될 수 있다: Task 3의 응답 상태·MIME 검사.
4. 본문 iframe 또는 이미지 실패가 전체 화면 오류로 오인될 수 있다: Task 4의 메인 프레임과 하위 리소스 오류 구분.
5. 키보드나 디스플레이 컷아웃이 입력·조작 버튼을 가릴 수 있다: Task 4의 기기 확인.

## 파일 구조

- `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`, `android/gradlew*`, `android/gradle/wrapper/`: 독립 Android 빌드와 고정된 wrapper.
- `android/app/build.gradle.kts`, `android/app/src/main/AndroidManifest.xml`: 앱 빌드, 최소 권한, HTTPS 설정과 파일 공유 선언.
- `android/app/src/main/java/kr/ac/ajou/studyhub/MainActivity.kt`: WebView 생명주기, 전체 화면, 뒤로 가기, 오류 UI.
- `android/app/src/main/java/kr/ac/ajou/studyhub/NavigationPolicy.kt`: URL·스킴·호스트 및 사용자 제스처 판정.
- `android/app/src/main/java/kr/ac/ajou/studyhub/PdfTransfer.kt`: 인증된 PDF 요청과 제한된 공유.
- `android/app/src/main/res/`: 앱 아이콘, 문자열, 레이아웃 및 FileProvider 경로.
- `android/app/src/test/`와 `android/app/src/androidTest/`: 순수 판정 로직과 Android 동작 검사.
- `android/README.md`, 루트 `.gitignore`: 빌드·기기 검증 안내와 생성물 제외.

---

### Task 1: 최소 앱과 실제 인증 가능성 확인

**Files:** Create Android 빌드 파일, wrapper, manifest, `MainActivity.kt`, 리소스, `android/README.md`; modify `.gitignore`.

**Interfaces:** Produces `MainActivity`, `BuildConfig.STUDY_HUB_URL: String`; 이후 작업은 동일 Activity와 WebView를 사용한다.

- [ ] **Step 1:** Gradle 8.13과 호환되는 AGP·Kotlin 버전을 확인해 고정하고, SDK 경로를 개인별 `local.properties`로 처리한다. API 33 기기에서 실행 가능한 `minSdk`와 설치된 SDK에 맞는 `compileSdk`를 정한다. wrapper 배포의 체크섬을 고정한다.
- [ ] **Step 2:** JavaScript·DOM 저장소가 활성화된 WebView가 `BuildConfig.STUDY_HUB_URL`을 연다. 주소는 `https://ajou-study-hub.johnshin617.workers.dev/`를 기본값으로 하며 build property로 주입 가능하게 한다. INTERNET 권한을 선언하고 cleartext를 허용하지 않는다. 로그인 링크의 일회성 query는 저장하지 않는다.
- [ ] **Step 3:** `cd android; .\gradlew.bat :app:assembleDebug`를 실행한다. 기대 결과: BUILD SUCCESSFUL 및 `android/app/build/outputs/apk/debug/app-debug.apk` 생성. 실패하면 환경 원인을 기록하고 후속 기능 작업을 시작하지 않는다.
- [ ] **Step 4:** 연결 기기에서 설치 후 운영 주소가 Access 로그인 화면까지 도달하는지 확인한다. 사용자가 직접 OTP를 입력해 로그인하고 목록·대표 문서·이미지·문제 상호작용·재실행 후 세션과 저장값을 확인한다. 이메일·OTP·쿠키·인증 URL은 기록하지 않는다. 인증이 실패하거나 사용자가 참여할 수 없으면 결과를 미검증으로 남기고 인증 의존 작업 전에 설계를 다시 검토한다.
- [ ] **Step 5:** 운영 도메인과 Access 도메인 사이 실제 정상 탐색 경로를 기록하되 query·쿠키는 제외한다. 타사 쿠키가 필요한지는 증거로 판단하고 불필요한 전역 허용을 피한다.
- [ ] **Step 6:** 프로젝트 파일과 기기 검증 결과를 검토하고 관련 파일만 커밋한다.

### Task 2: 내부 탐색, 외부 링크 및 새 창

**Files:** Create `NavigationPolicy.kt`, `NavigationPolicyTest.kt`; modify `MainActivity.kt` and Android instrumentation tests.

**Interfaces:** Produces `NavigationPolicy.classify(url: String, userGesture: Boolean): NavigationDecision`; `NavigationDecision`은 `IN_APP`, `EXTERNAL`, `BLOCK` 중 하나다. 이 판정은 최상위 탐색과 새 창에서 공유한다.

- [ ] **Step 1:** JUnit에 `classify` 검사를 작성한다: 운영 및 Access 호스트의 HTTPS는 IN_APP, 다른 HTTPS의 사용자 제스처는 EXTERNAL, HTTP·`javascript:`·`file:` 및 제스처 없는 외부 새 창은 BLOCK. `workers.dev.evil.example`과 사용자 정보가 포함된 URL도 허용 호스트로 판단하지 않는다.
- [ ] **Step 2:** `cd android; .\gradlew.bat :app:testDebugUnitTest`가 새 테스트에서 실패하는지 확인하고, 정책을 구현한 뒤 같은 명령의 성공을 확인한다.
- [ ] **Step 3:** WebView의 최상위 이동과 사용자 제스처 새 창을 정책에 따라 처리한다. Android의 새 창 API는 요청 출처를 신뢰성 있게 식별하지 못하므로 URL과 스킴을 검증하고 임의 iframe을 신뢰하지 않는다. 외부 앱이 없으면 앱이 종료되지 않고 실패를 알린다. 새 창을 거부하는 기본 동작만으로 완료 처리하지 않는다.
- [ ] **Step 4:** Android instrumentation 또는 기기에서 같은 호스트 문서 링크, 외부 HTTPS 링크, 새 탭 열기, 비사용자 팝업, 차단된 스킴을 검증하고 전체 단위 테스트를 실행한다.
- [ ] **Step 5:** 관련 파일만 커밋한다.

### Task 3: 보호된 PDF 및 다운로드

**Files:** Create `PdfTransfer.kt`, `PdfTransferTest.kt`, FileProvider 경로 리소스; modify manifest, `MainActivity.kt` and Android instrumentation tests.

**Interfaces:** Produces `PdfTransfer.open(url: String, onResult: (PdfResult) -> Unit)`; `PdfResult`는 `OPENED`, `AUTH_REQUIRED`, `UNSUPPORTED`, `FAILED`를 포함한다.

- [ ] **Step 1:** 실제 기기에서 보호된 PDF 링크의 이동·응답·콘텐츠 형식을 확인한다. 사용자 세션 값은 출력하지 않는다. 앱 세션으로 안전하게 취득·공유할 수 없는 경우 구현을 계속하지 말고 결과와 필요한 설계 결정을 보고한다.
- [ ] **Step 2:** `PdfTransferTest`에서 신뢰된 운영 HTTPS 호스트의 200 PDF만 공유 대상으로 허용하고, 302의 외부 호스트, 403, 200 HTML 로그인 화면, 비 PDF 응답을 거절하는 검사를 작성한다. 공유 URL 또는 로그에 쿠키가 노출되지 않는지도 검사한다.
- [ ] **Step 3:** `cd android; .\gradlew.bat :app:testDebugUnitTest`에서 새 검사가 실패함을 확인한 뒤 `PdfTransfer.open`을 구현한다. 인증 정보는 요청 대상에만 사용하고 리다이렉트마다 호스트를 재검사한다. 앱 전용 임시 파일과 읽기 권한이 제한된 `content://` URI를 사용하며, 만료·실패 시 사용자에게 알린다.
- [ ] **Step 4:** 단위 테스트를 통과시킨 뒤 기기에서 로그인된 PDF 열기, 인증 만료, PDF 뷰어가 없는 경우, 외부 리다이렉트 차단을 검증한다. 일반 다운로드도 안전하게 열거나 실패를 알리는지 확인한다.
- [ ] **Step 5:** 관련 파일만 커밋한다.

### Task 4: 전체 화면, 뒤로 가기, 복구와 인수

**Files:** Modify `MainActivity.kt`, 화면 리소스, instrumentation tests and `android/README.md`.

**Interfaces:** Consumes `NavigationPolicy.classify` and `PdfTransfer.open`; Activity는 WebView 기록 유무에 따라 뒤로 가기와 종료를 선택한다.

- [ ] **Step 1:** instrumentation 검사에 메인 프레임 네트워크 오류는 재시도 화면을 표시하고, iframe/이미지 등 하위 리소스 오류만으로 메인 화면을 대체하지 않는다는 단언을 추가한다. WebView 기록이 있을 때 뒤로 이동하고 없을 때 기본 종료 경로가 호출되는 검사도 추가한다.
- [ ] **Step 2:** `cd android; .\gradlew.bat :app:connectedDebugAndroidTest`에서 새 검사의 실패를 확인한 뒤 전체 화면, 일시적인 시스템 바 표시, 뒤로 가기와 재시도를 구현한다. 같은 명령의 성공을 확인한다.
- [ ] **Step 3:** API 33 기기에서 인증 입력 중 키보드, 제스처로 시스템 바 표시, 화면 회전·컷아웃 및 버튼 잘림, 문서·앵커 뒤로 가기, 인터넷 중단 후 재시도를 확인한다. 지원 범위의 다른 Android 버전은 접근 가능한 에뮬레이터나 기기에서 확인하고, 불가능하면 미검증으로 기록한다.
- [ ] **Step 4:** `cd android; .\gradlew.bat :app:testDebugUnitTest :app:connectedDebugAndroidTest :app:assembleDebug`를 실행한다. 기대 결과는 모든 테스트와 빌드 성공이다. 사용자 OTP가 필요한 실기기 항목은 자동 테스트 통과와 구분해 기록한다.
- [ ] **Step 5:** `android/README.md`에 빌드·설치 명령, 운영 주소 주입, 수동 검증 결과와 미검증 항목을 적는다. 기존 웹앱에 변경이 있다면 루트의 해당 테스트도 실행한다. 관련 파일만 커밋하고 APK 경로를 전달한다.
