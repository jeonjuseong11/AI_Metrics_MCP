# 설계: v0.7.0 — 매일의 트리거 (SessionStart 거울)

생성: /office-hours, 2026-06-24 (KST)
브랜치: feat/v0.6.0-session-content-summary 기준 (다음 릴리스: v0.7.0)
레포: jeonjuseong11/AI_Metrics_MCP
상태: APPROVED (2026-06-24 — office-hours 2라운드 적대 리뷰 + claude-code-guide hook 사실검증 후)
모드: Builder (개인 self-tool)

## 문제 정의

AIMM은 단일 소스(Claude Code) 분석이 탄탄하지만 **daily-driver가 아니다.** office-hours 진단:

- **목표:** v0.7.0 = "매일 쓰는 도구로". 채택이 데이터셋을 살리는 엔진(README §무엇을·왜)이라, 안 쓰면 나머지 기능은 다 무의미.
- **진짜 마찰 = 트리거 부재.** SessionEnd hook은 `~/aimm/draft-<date>.md`에 **조용히 파일로만** 쓴다(`src/core/hook.ts:72-75`, stdout 없음). `aimm init`은 SessionEnd hook + MCP만 등록하고 **SessionStart는 미사용**(`src/core/init.ts`). 출력은 있는데 *보이는 자리*가 없어 draft가 `~/aimm/`에 쌓이기만 하고 아무도 안 본다.
- 네가 매일 *확실히* 하는 단 하나의 순간 = **Claude Code를 켠다**(그게 데이터 소스 자체). 그 자리가 비어 있다.

## 무엇이 매력인가

매일 Claude Code를 켤 때마다 **"어제의 너"가 한 줄로 먼저 인사한다.** 도구를 찾아갈 필요 없이, 이미 매일 하는 행동에 거울이 올라탄다. v0.6.0이 만든 "무엇을 했나"(활동·영역·명령 믹스)가 비로소 매일 눈에 보인다 — 셀프 인식의 일상화. 풀 문서는 한 번 더(기존 `analyze`/MCP).

## 제약

- **변하지 않는 원칙(ROADMAP):** 로컬 우선, 결정적 메트릭(LLM 우회), 서술이지 평가 아님, 어댑터 격리.
- **v0.7.0은 가볍게:** 새 알림앱/트레이/폼팩터(E7) 금지. 네이티브 hook + 기존 코어 재사용만.
- **글랜서블:** 트리거는 한눈 한 줄. 풀 문서는 한 번 더(기존 analyze/MCP).
- engines `>=22`, strict + exactOptionalPropertyTypes 유지.

## 전제 (합의됨)

1. 고침 = AIMM에 기능 추가가 아니라, 네가 *이미 매일 보는 표면(Claude Code)*에 AIMM을 올려놓기.
2. 새 알림 시스템(트레이/OS앱=E7) 안 만듦 — 네이티브 hook + 기존 전송경계 재사용.
3. 트리거는 글랜서블 한 줄, 풀 문서는 한 번 더(지금 draft가 풀 문서라 안 끌린 핵심 이유).

## 검토한 대안

### A: SessionStart 거울 (채택)
Claude Code 켤 때마다 SessionStart hook이 어제·이번주 한 줄을 **`systemMessage`로** 사용자에게 표출. 재사용 최대·네이티브, ③를 가장 확실히 고침. Completeness 8/10. Effort S(human ~1-2일 / CC ~1-2h), Risk Low(메커니즘 `systemMessage` 정정으로 결정적 표출 — 초기 'additionalContext 비가시성' 리스크 해소).

### B: SessionEnd 한 줄 + `aimm today`
현 SessionEnd hook이 stdout에 한 줄도 찍고 '오늘 누적'으로 굴림 + zero-arg `aimm today`. 최소 diff지만 **SessionEnd stdout 가시성 부족이 곧 ③의 원인**이라 단독으론 안 고쳐질 위험. Completeness 5/10.

### C: 스케줄 자동 다이제스트
`aimm digest` + 스케줄러(Win Task Scheduler/cron) → 매일 아침/매주 글랜서블 다이제스트를 네가 보는 곳에 push. 진짜 push지만 스케줄러 플랫폼별 + 전달처 의존, 가장 무거움. Completeness 7/10.

## 채택안 + 근거

**A (SessionStart 거울)만 v0.7.0 코어.** 매일 확실한 단 하나의 순간(Claude Code 켜기)에 올라탄다. `aimm today`(B의 pull 글랜스)는 **이번 릴리스에서 분리** — pull은 바로 그 마찰(③: 열 이유가 없음)을 다시 만드는 lesser 문제라 YAGNI. 거울이 글랜스 포맷을 증명한 뒤 v0.7.x 후속으로. C(스케줄)는 v0.8+ 셀프리뷰 어필 산출물과 함께.

### 상세 설계

- **신규 CLI `aimm session-start`** — SessionStart hook이 호출. **stdin JSON**(`source`·`cwd`·`session_id`)을 읽고 한 줄 거울을 낸다.
  - 출력 예(cost-known 지표 + 내용 다이제스트만): `🪞 어제: 3세션 · $1.40 · 탐색42%·구현19%·검증15%  |  이번주(최근7일): 12세션 · $8.7 · 가장 바쁜 요일 화`
    - "fix N" 류 커밋 항목은 **제외** — `--repo`/git이 있어야 도출되는데 SessionStart 흐름엔 repo 인자가 없음(stated 입력으로 도출 불가, 리뷰 지적).
  - **가시성 메커니즘(스파이크 실측 정정, CC v2.1.195):** **top-level `systemMessage`** 필드로 낸다 — `{"systemMessage":"🪞 …"}`. **이게 사용자 화면에 `SessionStart:startup says: 🪞 …` 노티스로 결정적 표출됨(2026-06-28 스파이크 확인).** ⚠️ **중요 정정:** `hookSpecificOutput.systemMessage`(NESTED)는 **표출 안 됨** — 초기 설계가 잘못 짚었음. systemMessage 는 hook 출력의 **top-level** 필드여야 한다. `hookSpecificOutput.additionalContext`는 *모델 컨텍스트에만* 들어가 사용자엔 안 보임(옵션으로 동봉해 모델이 "오늘의 사용" 맥락 인지 가능하나, **사용자 표출 보장은 top-level `systemMessage`에서만**). (스파이크: top-level=표출 / nested=무시 / additionalContext=모델전용.)
  - **source 필터(dedupe)** — SessionStart는 `startup`·`resume`·`clear`·`compact`에 발화. 거울은 **`startup`(+선택 `resume`)에만**, `compact`·`clear`엔 스킵 — 안 그러면 자동 compact마다 같은 줄 반복(스팸). 그래서 stdin `source` 파싱이 필수.
- **init 확장** — `runInit`이 SessionEnd에 더해 **SessionStart hook**도 멱등 병합. `mergeSessionEndHook` 패턴 복제 → `mergeSessionStartHook`. **마커(리뷰):** 기존 `isAimmHook`(init.ts:16, `/cli\.js … hook/`)은 `session-start`를 **안 잡음**(under-match, 정상) → `session-start`용 **별개 마커** 추가(서브커맨드 파라미터화), 두 마커가 서로 **교차매칭 안 됨**을 비중첩 테스트로 보장. `--dry-run`·백업·딥머지(우리 키만) 그대로.
- **신규/추출 표면(작음 — "전부 재사용" 아님, 리뷰):**
  - `renderGlance`(한 줄 포맷, render.ts) — empty-day 포함. **(신규)**
  - **stdin JSON 파싱** — 기존 hook은 stdin을 안 읽음. strict·exactOptional 주의(조건부 스프레드). **(신규)**
  - **source 기반 dedupe 분기.** **(신규)**
  - **요일·주간 헬퍼 = 신규 아님, 추출(리뷰 정정).** `WEEKDAY`+`weekdayOf`(로케일 비의존, `toLocaleString` 불사용)와 `isoDatePlusDays`(주간 윈도우 계산)가 **이미 `patterns.ts:13-30`에 존재**(module-private). → `day.ts`로 **끌어올려 export**하고 patterns.ts가 재사용(중복 제거). "이번주"=최근 7일(어제 종료, KST)는 `isoDatePlusDays`로. 발명 아닌 리팩터(검증된 동작).
- **코어 로직 재사용** — `analysis.ts`(롤업)·`content.ts`(내용 다이제스트)·`day.ts`(KST). 글랜스 비용·지표는 **cost-known(Claude Code)만** 집계(v0.6.0 내용-미파악 격리의 평행).
- **empty/cold-start** — 어제 0세션/첫 실행: `renderGlance`가 `🪞 어제 기록 없음 · 이번주 N세션`, 데이터 전무면 `🪞 아직 기록 없음 — 다음 세션부터 쌓임`. 닫힌 어휘만(프라이버시 단언 적용).
- **실패 안전(§4.4)** — **항상 exit 0.** 이유(리뷰 정정): 거울은 `systemMessage`(exit-0 JSON)로만 전달됨 — exit 2는 systemMessage를 못 싣고 stderr를 에러 노티스로 띄울 뿐(SessionStart exit 2는 세션을 *막진* 않으나 거울 전달엔 부적합). 실패 시 `systemMessage`에 한 줄(`⚠️ AIMM 거울 생성 실패: …`). **주의:** 기존 `cmdHook`(cli.ts)은 실패시 exit 1 — 복제 시 이 exit 코드를 그대로 베끼지 말 것.
- **dedupe(compute)** — 한 줄 거울은 결정적·로컬이라 매번 계산해도 가벼움(MVP). 무거우면 하루 1회 캐시(후속).

## 미해결 질문

1. **가시성(✅ 해소 — 2026-06-28 스파이크 GO):** top-level `systemMessage` 가 CC v2.1.195 에서 `SessionStart:startup says: …` 로 사용자에 표출 확인. NESTED(`hookSpecificOutput.systemMessage`)는 무시됨 → top-level 필수. stdin JSON(`source`·`session_id`·`transcript_path`·`cwd`) 완전 파싱 확인, `source=startup` 검출. 폴백(terminalSequence 등) 불요. **남은 미세확인:** compact/clear 에서 스킵(현 필터 로직상 자명, 빌드 테스트로 커버).
2. **한 줄 필드 확정:** cost-known 지표(세션·비용) + 내용 다이제스트(활동믹스) + 주간(세션·비용·바쁜 요일). "fix N"은 제외(repo 없음). MVP 고정 후 측정 조정.
3. **author 필터:** 개인 PC 본인 → SessionStart선 author 생략(standup과 달리).
4. **resume 포함 여부:** `startup`만 vs `startup`+`resume`. resume가 잦으면 줄 반복 — MVP는 `startup`만, 답답하면 resume 추가.

## 성공 기준

- `aimm init` 후 Claude Code **새 세션(startup) 시작 시 `systemMessage`로 한 줄 거울이 사용자에게 보인다**(확인 스파이크). `compact`·`clear`엔 안 뜬다.
- SessionStart hook은 **절대 세션을 안 깬다**(실패해도 exit 0 + `systemMessage` 한 줄).
- 글랜스에 원시 경로·프롬프트 텍스트·`/`·`\` 0(닫힌 어휘만) — v0.6.0 프라이버시 단언 평행. empty-day 문자열도 동일.
- 결정적: 같은 입력→같은 줄(요일 변환 로케일 비의존, `toLocaleString` 불사용).
- 테스트 그린: `renderGlance`(정상·empty)·요일/주간 헬퍼 추출 회귀(patterns.ts 동작 불변)·source 필터 dedupe·init SessionStart 멱등(별개 마커, 비중첩)·실패안전(exit 0)·프라이버시 단언(현 178 → +α).

## 배포

사용자 = 본인. 설치는 기존 `npm install`(prepare 빌드) + `aimm init`(이제 SessionStart도 등록). 신규 배포 채널 불요. README "Claude Code 연동"에 SessionStart hook 항목 추가 문서화.

## 의존성

- 코어 *로직*은 재사용. **진짜 신규 4개**(renderGlance·stdin 파싱·source dedupe·SessionStart init 병합) + **추출 2개**(요일·주간 헬퍼 = patterns.ts:13-30 → day.ts로 끌어올려 export) — "의존성 0"은 아니나 발명은 적다(리뷰 정정). E3/E4/E5와 독립. **가시성 확인 스파이크가 유일한 선행 게이트(go/no-go 아닌 확인).**

## 과제 (다음 실제 행동)

**이번 주 안에: 가시성 확인 ≤30분.** `~/.claude/settings.json`에 SessionStart hook 하나 손으로 걸어, `{"hookSpecificOutput":{"hookEventName":"SessionStart","systemMessage":"🪞 test mirror"}}`를 내는 더미 스크립트(exit 0)를 등록 → Claude Code 새 세션(startup)·`/clear`·compact를 각각 일으켜 (a) startup에 줄이 **사용자에게** 뜨는지 (b) compact엔 안 뜨게 source 필터가 먹는지 확인.
- 뜨면 → A 풀 구현(`/spec` → plan → TDD).
- `systemMessage`가 기대대로 안 뜨면 → 폴백(`terminalSequence` 데스크톱 노티 / SessionEnd systemMessage / 터미널 직접 출력) 결정 후 spec.

문서는 "표출된다"지만 네 CC 버전 실측이 남았다 — "측정 못 하는 걸 약속 안 함"(ROADMAP 안티목표)의 실천. 코드 전 30분이 방향 리스크를 닫는다.

## 내가 본 너의 사고방식

- **"다음 버전으로 업그레이드"라는 열린 질문에서 곧장 daily-driver를 골랐다.** 기능 욕심(멀티LLM 비전 C)보다 *채택*을 택했다 — README에 네가 적은 "채택이 데이터셋을 살리는 엔진"을 스스로 따른 것.
- **마찰 진단에서 "트리거 부재"를 인정했다.** "기능 X 있으면 쓸 텐데"로 도망가지 않았다. 대부분은 기능 추가로 회피하는데, 너는 "안 여는 진짜 이유"를 골랐다.
- **v0.6.0 릴리스 노트에 "다음" 후보(주제키워드·Cursor내용·E4)를 이미 적어놨는데도** 그걸 바로 집지 않고 "방향부터"에 동의했다. 자산(코드)보다 사용(습관)을 먼저 본 판단.
