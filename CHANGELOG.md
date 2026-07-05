# Changelog

이 프로젝트의 단계별 진화 기록이다. 형식은 [Keep a Changelog](https://keepachangelog.com/),
버전은 각 EXPANSION 항목(E1~)마다 minor를 올린다. 상세 릴리스 노트는 `docs/releases/`에 있다.
작성 규칙·템플릿: [docs/releases/README.md](docs/releases/README.md).

## [0.8.0] — 2026-07-05 · 내용 있는 거울 + `aimm today`

거울 한 줄이 활동축(매일 비슷)에서 **영역축 share%**로 바뀌어 날짜를 구별한다:
`🪞 어제: 3세션 · $12 · TypeScript 60%·문서 25%`. 신규 **`aimm today`** — 세션 밖에서
오늘(지금까지)·어제·이번주(오늘 포함)를 3축(활동·영역·명령) 풀뷰로 조회. analyze의 "무엇을 했나"
블록을 `renderContentBlock`으로 추출해 재사용(DRY). **parse-once**: `collectSessions` seam으로
세션을 1회 수집하고 `analyze()`를 범위별로 여러 번 호출(거울 startup 2→1 파싱). `CollectOptions.sinceMtimeMs`
성근 프리필터로 startup 수집을 최근-창으로 상수화(O(전체 히스토리) 회피). claude-only(cost-known),
프라이버시 불변식(닫힌 어휘·경로 0) 유지. 테스트 204 → 228 그린.

→ 상세: [docs/releases/v0.8.0-content-mirror-today.md](docs/releases/v0.8.0-content-mirror-today.md)

## [0.7.0] — 2026-06-28 · SessionStart 거울 — 매일 열 때 한 줄 현황

Claude Code를 열 때마다(startup · resume) SessionStart hook이 어제·이번주(최근7일) 비용-확인 사용 현황을
`top-level systemMessage`로 한 줄 표시. `aimm init`이 SessionStart hook도 멱등 등록(별개 마커, 비교차).
`renderGlance` 포매터(정상 · 어제-없음 · cold-start 세 변형). 헬퍼 `weekdayOf`/`WEEKDAY`/`isoDatePlusDays`를
`patterns.ts`→`day.ts`로 hoist. **스파이크 정정**: top-level `systemMessage`만 Claude Code에 표시됨
(중첩 `hookSpecificOutput.systemMessage` = 미노출). 테스트 178 → 204 그린.

→ 상세: [docs/releases/v0.7.0-session-start-mirror.md](docs/releases/v0.7.0-session-start-mirror.md)

## [0.6.0] — 2026-06-22 · 세션 내용 요약 + 클린 설치/aimm init

파서가 버리던 `message.content`(tool_use·사용자 프롬프트)를 결정적 **닫힌-어휘 다이제스트**로 추출 → analyze/portrait/주간
내러티브에 "무엇을 했나"(활동·영역·명령·대화 깊이). 원시 경로·명령·텍스트는 분류 후 폐기(프라이버시 구성상 보장),
cost-known(Claude Code) 세션만 롤업(내용-미파악 격리). 더불어 `prepare` 빌드훅으로 클론 후 `npm install`만으로 동작
(MCP 설치 버그 해소) + `aimm init` 원커맨드 셋업(센티넬 멱등·백업·.mcp.json 폴백). 적대 spec 리뷰 blocker 5 반영.
테스트 146 → 178 그린.

→ 상세: [docs/releases/v0.6.0-session-content-summary.md](docs/releases/v0.6.0-session-content-summary.md)

## [0.5.0] — 2026-06-17 · E5 Cursor 어댑터 + 멀티소스 통합

Cursor를 두 번째 소스로 추가 — analyze/portrait "도구별 사용" 표에 Cursor 행(비용 미상). `node:sqlite`로
`state.vscdb` 읽기(스파이크: 토큰 불완전·모델 미상 → 시간·빈도만). `providesCost` 능력 모델 + source 태깅 +
cost-unknown 격리(Claude Code 출력 무오염). standup/hook은 claude-only 유지. 테스트 133 → 146 그린.

→ 상세: [docs/releases/v0.5.0-cursor-multisource.md](docs/releases/v0.5.0-cursor-multisource.md)

## [0.4.0] — 2026-06-17 · E3 멀티소스 어댑터 인터페이스

AI 사용 소스를 `SourceAdapter` 계약(`id`·`displayName`·`collect`) 뒤로 격리. 오케스트레이터가
Claude Code 파일 구조를 직접 모르게 하고, 새 소스(E5)는 인터페이스 구현+주입으로 드롭인.
CLI·hook·MCP 무변경(기본 claudeCodeAdapter). 구조 작업(체감 기능 변화 없음). 테스트 123 → 133 그린.

→ 상세: [docs/releases/v0.4.0-e3-adapter-interface.md](docs/releases/v0.4.0-e3-adapter-interface.md)

## [0.3.0] — 2026-06-15 · E2 사용 패턴 발견

초상 `## 발견`에 세션 기반 사용 패턴(케이던스·요일 리듬·사용 추세·비용 급증일) 추가.
결정적·작은 n 가드. git 상관(생산성)은 후속 단계로. 테스트 109 → 123 그린.

→ 상세: [docs/releases/v0.3.0-e2-usage-patterns.md](docs/releases/v0.3.0-e2-usage-patterns.md)

## [0.2.0] — 2026-06-15 · E1 AI craft 초상

`aimm portrait` 명령 추가 — 공유용 AI craft 초상(텍스트+표만, 5필드, 결정적 미니 인사이트).
프로젝트명 비노출. 기존 분석 코어 재사용. 테스트 96 → 109 그린.

→ 상세: [docs/releases/v0.2.0-e1-craft-portrait.md](docs/releases/v0.2.0-e1-craft-portrait.md)

## [0.1.0] — 2026-06-15 · Phase 0 코어 + Phase 1 ①② (baseline 백필)

Claude Code 세션 로그 + Git 커밋을 로컬에서 결합해 일일 스크럼 초안과 개인 AI 사용 분석
문서를 생성하는 PoC 코어. 주간 내러티브(①)·작업 성격 신호(②) 포함. 테스트 96 그린.

→ 상세: [docs/releases/v0.1.0-phase-1-baseline.md](docs/releases/v0.1.0-phase-1-baseline.md)
