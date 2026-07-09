# Changelog

이 프로젝트의 단계별 진화 기록이다. 형식은 [Keep a Changelog](https://keepachangelog.com/),
버전은 각 EXPANSION 항목(E1~)마다 minor를 올린다. 상세 릴리스 노트는 `docs/releases/`에 있다.
작성 규칙·템플릿: [docs/releases/README.md](docs/releases/README.md).

## [0.15.0] — 2026-07-09 · 커밋 × AI 세션 시간 상관 (비용 귀속 아님)

"이 커밋 즈음 AI 세션이 있었나"를 **시간 겹침**으로. **커밋별 비용 귀속은 안 함**(v0.9.0의
의도적 결정 유지 — 거짓 정밀도·척추 위반 회피). 신규 `core/correlate.ts`(커밋 시각이 세션
`[start,end]±30분` 안 비율). `analyze --repo`·MCP `retro`에 `## 커밋 × AI 세션 (시간 상관)`
섹션 + 비용 귀속·인과 아님 라벨. 상세: [v0.15.0](docs/releases/v0.15.0-commit-session-correlation.md). 262 그린.

## [0.14.0] — 2026-07-09 · Cursor 내용 다이제스트 + 내용 격리 해제

Cursor의 **요청(user 프롬프트)**이 "무엇을 했나" 롤업에 포함. 버블 `type===1` 텍스트 →
`userPrompts`. `contentSummary`를 전 소스로 집계(내용 격리 해제) — **"무엇을 했나"는 활동
서술이지 비용이 아니므로**. 비용·모델·시간 롤업은 여전히 cost-known만(오염 없음). 기존 격리
회귀 테스트를 "포함"으로 반전. Cursor는 요청 건수만 기여(도구·파일은 후속). 상세: [v0.14.0](docs/releases/v0.14.0-cursor-content.md). 257 그린.

## [0.13.0] — 2026-07-09 · 회고 강화: memoir 내레이터 + retro MCP 도구

`retro --send`가 조각 섹션이 아닌 **한 편의 회고 글**(memoir 내레이터, `AIMM_MEMOIR_MODEL`).
`buildNarrativeContext`가 이미 모든 재료를 한 블록으로 모으고 있어 프롬프트 스왑 + 배선만.
`retro`를 **MCP 도구**로 노출(standup·analyze·retro) — Claude Code 안에서 회고 호출(결정적).
상세: [v0.13.0](docs/releases/v0.13.0-retro-memoir.md). 257 그린.

## [0.12.0] — 2026-07-09 · 회고록(retro) + 주간 자동 생성

사용 패턴 + "무엇을 만들었나"를 한 회고 문서로. 신규 `aimm retro`(기간 기본 최근 1주,
`--period month`)는 `analyze`와 동일 엔진(멀티소스·전송 경계)에 회고 프레이밍만 얹음
(`emitAnalysis` 공통화, dup 아님). `retro --write`는 `~/aimm/retro-<end>.md`에 저장 —
결정적·주간 멱등(같은 창 skip, `--force` 덮어씀)·실패 시 에러 노트. OS 스케줄러 한 줄로
주간 자동(README). `renderAnalysis`에 heading 파라미터 추가. 상세: [v0.12.0](docs/releases/v0.12.0-retro.md). 257 그린.

## [0.11.0] — 2026-07-09 · Codex CLI 어댑터 — 진짜 멀티-LLM 비용 비교 (Phase 2)

Claude Code에 이어 **Codex CLI**를 소스로 추가. `~/.codex/sessions/**/rollout-*.jsonl`에서
모델·토큰이 실재해 **providesCost=true** — Cursor(비용 미상)와 달리 "Claude vs Codex" 도구 간
**실제 비용 비교**가 성립한다. 신규 `parse/codex.ts`(token_count·turn_context·도구 정규화),
`adapters/codex.ts`(재귀 발견), `pricing.ts` GPT 단가, `ANALYSIS_ADAPTERS` 등록.
닫힌 어휘 다이제스트·어댑터 격리·비용 정직성 원칙 유지. 상세: [v0.11.0](docs/releases/v0.11.0-codex-adapter.md). 253 테스트 그린.

## [0.10.0] — 2026-07-05 · 무엇을 만들었나 — 내용 기반(요청·파일 → LLM)

git 커밋(v0.9.0)을 넘어 **실제 프롬프트·다룬 파일을 읽고** "무엇을 만들었나"를 LLM이 서술한다.
신규 `src/core/intent.ts`가 세션 원시 텍스트(user 요청 + tool_use 파일)를 KST 창별로 추출 →
마스킹(fail-closed) → `analyze --llm --send`가 `## 무엇을 만들었나 — 내용 기반 요약` 프로즈 생성.
**첫 원시-텍스트 외부 전송 기능** — 그래서 경계를 엄격히: (1) 원시 텍스트는 intent.ts 안에서만 살고
digest/거울/초상은 절대 안 봄, (2) 파일은 **basename만**(머신 경로·홈·타 프로젝트 구조 제거),
(3) 시스템·스킬 주입 메시지(command/task-notification/SKILL 덤프/거대 diff/리뷰 보일러플레이트)는
노이즈로 필터, (4) `--send` 아니면 dry-run이 "보낼 내용"을 그대로 보여줌(fail-closed 미리보기).
프롬프트·파일 상한(60·80·300자)으로 노출·비용 억제. 테스트 238 → 248 그린.

→ 상세: [docs/releases/v0.10.0-content-summary.md](docs/releases/v0.10.0-content-summary.md)

## [0.9.0] — 2026-07-05 · 무엇을 만들었나 (비용 ↔ 성과)

"어떻게 썼나"(도구 빈도)를 넘어 **"이 비용으로 무엇을 만들었나"**(git 커밋 성과)를 보여준다.
`summarizeSituation`이 feat/fix/refactor/perf 커밋 **제목**을 `built`로 추출 →
`analyze --repo`에 `## 무엇을 만들었나 (이 기간 추정 $X)` 섹션(만든 것 나열 + 기간 비용).
`aimm today --repo`도 오늘 만든 것을 🔨로. LLM 층(`--llm`)은 narrative에 `[만든것]` 사실줄
추가(마스킹 경계 통과 후 성과를 산문화). **프라이버시 스코프**: 원시 커밋 제목은 로컬
문서(analyze·today CLI)에만 — 거울(systemMessage)·초상(공유)엔 안 넣음. 테스트 235 → 238 그린.

→ 상세: [docs/releases/v0.9.0-what-you-built.md](docs/releases/v0.9.0-what-you-built.md)

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
