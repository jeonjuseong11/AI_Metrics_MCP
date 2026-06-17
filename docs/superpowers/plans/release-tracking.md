# 단계별 릴리스 기록 체계 (Release Tracking) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 각 EXPANSION 항목(E1~)을 "무엇이 어떻게 바뀌었나"의 증거로 닫는 릴리스 기록 인프라를 도입하고, 그 첫 적용으로 현재까지의 작업(Phase 0 코어 + Phase 1 ①②)을 `v0.1.0` 릴리스 노트로 백필한다.

**Architecture:** 순수 문서/프로세스 작업이다(코드 변경 없음). 루트 `CHANGELOG.md`(인덱스) + `docs/releases/`(개별 상세 노트) + `docs/releases/README.md`(작성 규칙·템플릿). AI 사용 메타는 AIMM 자신의 `analyze`로 측정하는 도그푸딩.

**Tech Stack:** Markdown. 검증·데이터 수집에 이미 빌드된 `node dist/cli.js` 사용(`npm run build` 완료 가정).

> **⚠️ git 규칙:** 이 저장소는 **사용자가 git add/commit/push를 직접** 한다. 각 Task 끝 "Commit"의 명령은 **사용자가 실행**한다. 에이전트 실행자는 커밋 단계에서 멈추고 명령을 제시한다.

> **⚠️ 마스킹 규칙(fail-closed):** 전체 `analyze` 출력의 "프로젝트별" 목록엔 **다른 클라이언트 프로젝트명**(예: turbo-pra, checkin-be 등)이 들어간다. 릴리스 노트엔 **`AI-Metrics-MCP` 줄만 추출**하고 다른 프로젝트명은 절대 붙이지 않는다. before/after 샘플은 **이 레포 자체 데이터**(공개 가능)만 사용한다.

> **이 작업은 docs라 코드-TDD가 적용되지 않는다.** 각 Task는 `create → verify(파일 존재·링크·수치 재현) → commit` 구조다.

설계 스펙: [docs/superpowers/specs/release-tracking-design.md](../specs/release-tracking-design.md)

---

## 파일 구조

| 파일 | 책임 | 신규/수정 |
|------|------|-----------|
| `docs/releases/2026-06-15-v0.1.0-phase-1-baseline.md` | v0.1.0 백필 상세 노트 | 신규 |
| `CHANGELOG.md` | 버전 인덱스(한 줄 요약 + 상세 링크) | 신규 |
| `docs/releases/README.md` | 작성 규칙 + 정규 템플릿(미래 E가 참조) | 신규 |
| `package.json` | (변경 없음 — 이미 0.1.0) | — |

> **package.json:** 현재 `version`이 이미 `0.1.0`이므로 백필에선 bump하지 않는다. minor bump는 E1(→0.2.0)부터 시작한다.

---

## Task 1: v0.1.0 백필 상세 노트

설계 §4 템플릿 + §8 백필(약식). 실제 측정 데이터는 아래 본문에 이미 채워져 있다(2026-06-15 캡처). Step 1에서 수치를 재확인해 어긋나면 갱신한다.

**Files:**
- Create: `docs/releases/2026-06-15-v0.1.0-phase-1-baseline.md`

- [ ] **Step 1: 도그푸딩 수치·검증 수치 재확인** — 아래 명령을 돌려 본문에 박힌 값과 대조한다. 어긋나면 본문 수치를 실제 출력으로 교체한다.

Run (AI 사용 메타 — **`AI-Metrics-MCP` 줄만** 본다):
```bash
node dist/cli.js analyze 2>&1 | sed -n '/## 프로젝트별/,/^---/p' | grep "AI-Metrics-MCP"
```
Expected (근사): `- AI-Metrics-MCP — 세션 3 · $700.64`

Run (작업 성격 — 이 레포):
```bash
node dist/cli.js analyze --repo . --start 2026-06-10 --end 2026-06-15 2>&1 | sed -n '/## 작업 성격/,/^---/p'
```
Expected: `feat 67% (6건) · docs 22% (2건) · chore 11% (1건)`, 커밋 9건.

Run (검증 수치):
```bash
npx vitest run 2>&1 | tail -3 && npx tsc --noEmit && echo "tsc OK"
```
Expected: `Tests  96 passed (96)`, `tsc OK`.

- [ ] **Step 2: 노트 파일 작성** — `docs/releases/2026-06-15-v0.1.0-phase-1-baseline.md`를 아래 내용으로 생성한다(Step 1에서 수치가 바뀌었으면 반영):

````markdown
# v0.1.0 — Phase 0 코어 + Phase 1 ①② (baseline 백필)

릴리스: 2026-06-15 (KST) · 백필(소급 작성). 이 체계 도입 이전의 작업이라 before/after는 약식이다.

## 한 줄 요약
Claude Code 세션 로그(JSONL) + Git 커밋을 **로컬에서** 결합해, 일일 스크럼 초안과 개인 AI
사용 분석 문서(주간 내러티브·작업 성격 포함)를 한 번의 명령으로 만든다.

## 산출물 before/after
**before** — 도구 없음:
- 스크럼: 기억/스크롤백을 더듬어 손으로 작성.
- AI 사용 현황: 세션·토큰·비용·시간대를 알 길 없음(JSONL은 있으나 사람이 못 읽음).
- "이번 주 뭘 했나"는 커밋 메시지를 눈으로 훑는 수준.

**after** — `aimm` CLI 5개 명령(`metrics`/`standup`/`analyze`/`hook`/`mcp`):
- `analyze` 개인 사용 분석(요약·모델 믹스·일자별·시간대·프로젝트별), 예(이 레포 작업 성격):
```
## 작업 성격 (커밋 타입)
- feat(신규) ████████···· 67% (6건)
- docs(문서) ███········· 22% (2건)
- chore(잡무) █··········· 11% (1건)
ℹ️ 커밋 9건을 conventional-commit 타입으로 분류(휴리스틱·평가 아님). AI 사용과의
   연결은 같은 기간이라는 시간 추정이지 커밋별 증명이 아닙니다.
```
- `analyze --llm`(드라이런)/`--send`: 주간 사용을 산문 `## 한 주 돌아보기`로 서술(마스킹 전송 경계).
- `standup`: KST 일자 경계로 git 커밋 + 세션을 묶어 스크럼 초안.
- `hook`: SessionEnd 훅이 `~/aimm/draft-<date>.md` 자동 생성. `mcp`: MCP stdio 서버로 `standup`·`analyze` 노출.

## 검증
- 테스트: **96 그린** (`npx vitest run`).
- `npx tsc --noEmit` / `npm run build` 클린.
- 마스킹: gitleaks 룰셋 기반 적대적 테스트(AWS·Bearer·JWT·private key·.env) fail-closed.
- 주간 내러티브 적대적 검증 10건, 작업 성격 검증 7건 수정 반영.

## AI 사용 메타 — 도그푸딩
AIMM 자신의 `analyze`로 측정(2026-06-15):
- **AI-Metrics-MCP 프로젝트: 세션 3 · 추정 비용 약 $700.64** (개발 기간 2026-06-10 ~ 06-15).
- 대표 빌드 세션(2026-06-14): 세션 1 · 지속(추정) 10.1h · 토큰 약 100M · 추정 $316.29.

> ⚠️ 기간 기반 근사다. 같은 기간 전체 Claude Code 사용이며, '시간'은 세션 지속 추정이지
> 근무시간이 아니다. 비용은 추정치(단가 v2026-06-10, 정산액 아님). 토큰·세션은 양이지 실력이
> 아니다. (현재 `analyze`는 프로젝트별 토큰·시간을 따로 집계하지 않는다 — 향후 개선 여지.)

## 런타임 벤치
N/A: 핫패스 아님(전체 테스트 96개 ~0.5초). 의미 있는 측정 대상 없음.

## 본인 메모
_(선택 — 비워둠)_
````

- [ ] **Step 3: 검증** — 파일이 존재하고 마스킹 규칙을 지켰는지 확인한다.

Run:
```bash
test -f docs/releases/2026-06-15-v0.1.0-phase-1-baseline.md && echo "EXISTS"
grep -E "turbo-pra|checkin-be|seoultel|supertonic|kiosk|bbibbi|arreo|mcmp|AIWS" docs/releases/2026-06-15-v0.1.0-phase-1-baseline.md && echo "❌ 타 프로젝트명 누출" || echo "✅ 누출 없음"
```
Expected: `EXISTS` 그리고 `✅ 누출 없음`.

- [ ] **Step 4: Commit (사용자가 실행)**

```bash
git add docs/releases/2026-06-15-v0.1.0-phase-1-baseline.md
git commit -m "docs: v0.1.0 release note (Phase 0 core + Phase 1 backfill)"
```

---

## Task 2: CHANGELOG.md 인덱스

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: 파일 작성** — 루트에 `CHANGELOG.md`를 아래 내용으로 생성한다:

````markdown
# Changelog

이 프로젝트의 단계별 진화 기록이다. 형식은 [Keep a Changelog](https://keepachangelog.com/),
버전은 각 EXPANSION 항목(E1~)마다 minor를 올린다. 상세 릴리스 노트는 `docs/releases/`에 있다.
작성 규칙·템플릿: [docs/releases/README.md](docs/releases/README.md).

## [0.1.0] — 2026-06-15 · Phase 0 코어 + Phase 1 ①② (baseline 백필)

Claude Code 세션 로그 + Git 커밋을 로컬에서 결합해 일일 스크럼 초안과 개인 AI 사용 분석
문서를 생성하는 PoC 코어. 주간 내러티브(①)·작업 성격 신호(②) 포함. 테스트 96 그린.

→ 상세: [docs/releases/2026-06-15-v0.1.0-phase-1-baseline.md](docs/releases/2026-06-15-v0.1.0-phase-1-baseline.md)
````

- [ ] **Step 2: 검증** — 파일 존재 + 링크가 실제 파일을 가리키는지 확인한다.

Run:
```bash
test -f CHANGELOG.md && echo "EXISTS"
test -f docs/releases/2026-06-15-v0.1.0-phase-1-baseline.md && echo "LINK OK"
```
Expected: `EXISTS` 그리고 `LINK OK`.

- [ ] **Step 3: Commit (사용자가 실행)**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG index (v0.1.0)"
```

---

## Task 3: docs/releases/README.md — 작성 규칙 + 정규 템플릿

미래의 모든 E 구현이 참조할 규칙·템플릿을 한곳에 둔다(설계 완료 기준 #3을 내구화).

**Files:**
- Create: `docs/releases/README.md`

- [ ] **Step 1: 파일 작성** — `docs/releases/README.md`를 아래 내용으로 생성한다:

`````markdown
# 릴리스 노트 작성 규칙

각 EXPANSION 항목(E1~)을 spec→plan→구현으로 끝내지 않고 **"무엇이 어떻게 바뀌었나"의
증거로 닫는다.** 설계: [../superpowers/specs/release-tracking-design.md](../superpowers/specs/release-tracking-design.md).

## 규칙
- **단위:** E당 릴리스 1개. **버전:** E당 minor bump(E1→0.2.0, E2→0.3.0…). `package.json` version 동반 상승.
- **파일명:** `docs/releases/YYYY-MM-DD-vX.Y.Z-<slug>.md`. `<slug>`에 E 번호 포함(예 `e1-craft-portrait`).
- **인덱스:** 루트 `CHANGELOG.md`에 한 줄 요약 + 상세 링크를 역순(최신 위)으로 추가.
- **편입:** 각 E 구현 plan의 **마지막 task**로 "릴리스 노트 작성 + CHANGELOG 갱신 + version bump"를 넣는다.
- **커밋:** 사용자가 직접(저장소 규칙).
- **마스킹(fail-closed):** AI 메타는 `analyze`의 `AI-Metrics-MCP` 줄만 추출(타 프로젝트명 금지).
  before/after 샘플은 이 레포 자체 데이터만. 의심되면 가린다.

## AI 사용 메타 측정(도그푸딩)
```bash
node dist/cli.js analyze 2>&1 | sed -n '/## 프로젝트별/,/^---/p' | grep "AI-Metrics-MCP"
```
정직성 라벨 필수: 기간 근사·양이지 실력 아님·시간은 세션 지속 추정.

## 정규 템플릿
```markdown
# E# — <제목>  (vX.Y.Z · YYYY-MM-DD)

## 한 줄 요약
무엇이 가능해졌나 — 사용자가 보는 변화 한 문장.

## 산출물 before/after        (필수)
**before** (E 적용 전 CLI 출력 샘플):
...
**after** (E 적용 후 출력 샘플):
...

## 검증                        (필수)
- 테스트: N → M (신규 K개) · tsc/build 그린 · 적대적 검증 N건(해당 시)

## AI 사용 메타 — 도그푸딩       (필수)
- AI-Metrics-MCP 세션 N · 추정 비용 $N (기간 YYYY-MM-DD ~ YYYY-MM-DD)
> ⚠️ 기간 근사·전체 사용·시간은 세션 지속 추정. 양이지 실력 아님.

## 런타임 벤치                  (선택 — 해당 E만; 대개 "N/A: 핫패스 아님")
## 본인 메모                    (선택)
```
`````

- [ ] **Step 2: 검증** — 파일 존재 확인.

Run:
```bash
test -f docs/releases/README.md && echo "EXISTS"
```
Expected: `EXISTS`.

- [ ] **Step 3: Commit (사용자가 실행)**

```bash
git add docs/releases/README.md
git commit -m "docs: release-note authoring convention + template"
```

---

## 완료 기준 (전체)

- `CHANGELOG.md`가 루트에 존재하고 v0.1.0 항목 + 상세 링크를 가진다.
- `docs/releases/2026-06-15-v0.1.0-phase-1-baseline.md`가 설계 §4 템플릿(백필 약식)으로 작성되고, 타 프로젝트명 누출이 없다.
- `docs/releases/README.md`가 규칙 + 정규 템플릿을 담는다(미래 E가 참조).
- `package.json`은 변경 없음(이미 0.1.0; bump는 E1부터).
- 세 파일 모두 사용자가 커밋(명령 제시됨).
- **후속 규칙:** E1 plan을 작성할 때, 그 plan의 마지막 task로 "릴리스 노트(v0.2.0) + CHANGELOG + version bump"가 반드시 들어간다.
