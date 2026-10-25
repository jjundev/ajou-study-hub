# 브라우저와 원본 문서 탐색 호환

전체 탐색·새로고침·뒤로/앞으로 복원은 최신 주요 브라우저의 Navigation API(`window.navigation`, 취소 가능한 `navigate` 이벤트)를 사용한다. 검증 환경은 Playwright Chromium 156, Firefox 157, WebKit 27.2다. Navigation API가 없는 환경에서도 자료 읽기, 일반 내부 링크, 현재 네이티브 URL 동기화는 동작하지만 네이티브 스크립트 이동 이후의 전체 기록 복원은 보장하지 않는다.

앱의 최상위 라우트가 지원하는 탐색 기록을 소유한다. 같은 출처의 목록 등록 HTML로 향하는 취소 가능한 스크립트 이동은 기록 생성 전에 위임한다. 원래 `location.assign`은 새 기록, `location.replace`는 현재 기록 교체로 처리한다. iframe의 실제 교체는 현재 문서 인스턴스·출발 URL·목적 URL·세대가 모두 일치하는 한 번의 승인으로 실행한다. 폼 제출, 다운로드, 외부·미등록 목적지, reload/traverse와 취소할 수 없는 탐색은 네이티브 동작을 유지한다.

원본 슬라이드에서 사용하는 같은 경로의 `history.pushState`/`replaceState`는 배포 사본에 주입한 bridge가 호환 처리한다. 상태 직렬화와 URL 변경은 동기적으로 실행하며, 원래의 직렬화 오류도 유지한다. 각 화면의 원본 상태는 최상위 `history.state.studyHub` 아래에만 저장한다. URL·빌드 보고서·원본 파일에 상태를 쓰지 않는다. 뒤로/앞으로 이동에서는 원본 `history.state`와 URL을 복원하고 `popstate` 및 필요한 `hashchange`를 전달해 기존 화면 렌더러를 실행한다. 연속 호출은 문서 인스턴스와 순번으로 검증하므로 중간 화면도 유지한다.

다른 경로로 URL을 바꾸는 원본 SPA History API 호출은 이 슬라이드 호환 범위 밖이며 원래 브라우저 동작을 유지한다. 원본 코드가 `Event.isTrusted`를 요구하는 경우 합성 복원 이벤트를 받아들이지 않을 수 있다. 폼 등 bridge가 소유하지 않는 네이티브 이동 기록도 완전 복원 대상이 아니다. 같은 출처 iframe은 신뢰하는 학습 자료의 호환 환경이며 보안 격리 경계가 아니다.
