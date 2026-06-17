# 상황 신호 (Phase 1 ②) — 설계

작성일: 2026-06-14 · 단계: Phase 1 ②(상황 신호 — "어떤 작업에 AI를 썼나") · 선행: Phase 1 ① 완료

기획 배경: [AIMM_PoC_기획서_v2.md](../../../AIMM_PoC_기획서_v2.md) · 로드맵: [ROADMAP.md](../../../ROADMAP.md) · 선행 설계: [weekly-narrative-design.md](./weekly-narrative-design.md)

## 목표

git 커밋 타입(feat/fix/refactor…)으로 "이 기간 어떤 성격의 작업을 했나"를 결정적으로
분류해, 주간 내러티브에 작업 성격 축을 더한다. 신규 LLM 호출 없이(분류는 휴리스틱),
"디버깅엔 주로, 신규 개발엔 얼마나 AI를 썼나"를 *서술적으로* 추정한다.

## 확정된 결정 (브레인스토밍)

1. **수집 범위 = 단일 레포(`--repo`)** — standup의 `collectCommits`를 재사용. 세션 슬러그
   ↔ 실제 경로 매핑은 `-`/`\` 모호성으로 신뢰 불가 → 자동 복원/다중 레포는 후속 슬라이스.
2. **신호 = 커밋 타입만** — 이미 수집된 subject로 충분(신규 git 호출 없음). 편집 파일
   종류는 후속.
3. **상황은 별도 라벨 신호** — analyze는 그대로 여러 프로젝트를 가로지르고, 작업 성격은
   *그 레포의 커밋*임을 명시. 세션을 그 레포로 필터링하지 않는다.

## 변하지 않는 원칙 (이 기능에 적용)

- **서술이지 평가가 아님.** 커밋 타입 분포는 "이런 성격의 작업을 했다"이지 "잘했다"가 아니다.
- **정직한 한계 표기.** 커밋과 AI 세션의 연결은 **같은 기간이라는 시간 추정**이지 커밋별
  증명이 아니다. 분류는 conventional-commit 휴리스틱이다. 둘 다 명시한다.
- **결정적 (LLM 우회).** 분류·분포는 로컬 결정적 계산. 산문은 이 분포를 서술할 뿐.

## 데이터 흐름

```
analyze --repo <path> [--start --end]
        │
        ├─ (기존) 세션 → 결정적 UsageAnalysis ─────────────┐
        │                                                   │
        └─ collectCommits(repo, 창) → classifyCommitType ─ SituationSummary
                                                            │
        ┌───────────────────────────────────────────────────┤
        ▼                                                   ▼
  renderAnalysis: "## 작업 성격(커밋 타입)" 섹션      buildNarrativeContext:
  (결정적, 항상)                                      "[작업성격] fix 40% · feat 30%" 줄
                                                       → 산문이 느슨히 서술
```

- **커밋 수집 창** = 분석 기간(`--start`/`--end`, 없으면 데이터 전체 범위 `analysis.range`)을
  그대로 사용 → AI 사용과 동일 시간창. `kstDayRange`로 KST→UTC 변환.
- 창 내 커밋 0건 → SituationSummary.total 0 → 섹션·줄 생략.

## 파일 / 컴포넌트

### 신규

- `src/core/situation.ts`
  - `classifyCommitType(subject: string): string` — conventional-commit 접두사 파싱.
  - `summarizeSituation(commits: Commit[]): SituationSummary` — 타입별 분포.
  - `SituationSummary { byType: Array<{ type: string; count: number; share: number }>; total: number }`.
  - 순수·결정적. `Commit` 타입은 `parse/git.ts`에서 재사용.
- `test/situation.test.ts` — 분류·분포 테스트.

### 수정

- `src/core/narrative.ts` — `buildNarrativeContext(a, situation?)`가 situation 있으면
  `[작업성격] …` 줄 추가. `prepareNarrativeSend(a, situation?)`·
  `narrateUsage(a, narrator, situation?)`가 situation을 thread.
- `src/llm/anthropic.ts` — `NARRATIVE_SYSTEM_PROMPT`에 한 줄 추가: 작업 성격과 AI 사용을
  인과로 단정하지 말 것(느슨한 "~한 시기였다" 서술).
- `src/core/render.ts` — `renderAnalysis(a, author?, narrative?, situation?)`가 situation
  있으면 `## 작업 성격 (커밋 타입)` 섹션(막대 + 정직성 라벨) 추가.
- `src/core/standup.ts` — `buildAnalysis`에 `repoPath?`/`author?` + 주입형
  `commitCollector?`(기본 = 실제 `collectCommits`, 테스트용 DI). 커밋 수집 →
  `summarizeSituation` → narrative thread + 결과에 `situation?: SituationSummary` 포함.
- `src/cli.ts` — `analyze`에 `--repo` 추가(+ 기존 `--author`를 커밋 작성자 필터로 재사용).
  usage 텍스트 갱신.
- `src/mcp/server.ts` — 변경 없음(이번 슬라이스 제외; 상황은 결정적이라 추후 안전히 추가 가능).

설계 메모:
- `SituationSummary`는 `UsageAnalysis`에 합치지 않는다(출처가 git vs 세션). 선택적으로 thread.
- `commitCollector` DI는 기존 `summarizer` 주입과 같은 패턴 — git 없이 테스트 가능하게.

## 분류기 규칙

```
^\s*(\w+)(?:\([^)]*\))?(!)?:   →  type = \1 소문자
```
- 알려진 타입: `feat fix refactor docs test chore style perf build ci revert` → 그대로.
- 접두사 없음/미지정 단어("WIP …", "Merge …") → `기타`.
- `!`(breaking)는 타입에 영향 없음(예: `feat!` → feat). 별도 표기 안 함(YAGNI).
- 표시용 글로스: feat→신규, fix→수정/디버깅, refactor→리팩터, docs→문서, test→테스트,
  chore→잡무, style→스타일, perf→성능, build→빌드, ci→CI, revert→되돌림, 기타→기타.

## 렌더 + 사실 블록 (정직성 라벨)

```
## 작업 성격 (커밋 타입)
- fix    ████████ 40% (8건)
- feat   ██████   30% (6건)
ℹ️ <repo> 커밋 N건을 conventional-commit 타입으로 분류(휴리스틱·평가 아님).
   AI 사용과의 연결은 같은 기간이라는 시간 추정이지 커밋별 증명이 아닙니다.
```
사실 블록: `[작업성격] fix 40% · feat 30% · refactor 15% · 기타 15% (커밋 N건, repo 기준)`

## 에러 처리 / 폴백

- `collectCommits` 실패 → warning + situation 미설정 → 결정적 분석 문서는 정상 출력.
- 창 내 커밋 0건 → situation.total 0 → 섹션·사실블록 줄 생략.
- `--repo` 미지정 → 상황 신호 없음(기존 동작 그대로).
- 어떤 상황 실패도 세션 분석/내러티브 출력을 막지 않는다.

## 테스트 전략 (TDD, git 없이 — 커밋 픽스처 + commitCollector DI)

`test/situation.test.ts`:
1. `classifyCommitType` — `feat:`→feat / `fix(api):`→fix / `refactor!:`→refactor /
   `WIP x`·`Merge branch`→기타 / 대소문자·선행공백 허용.
2. `summarizeSituation` — 타입별 count·share, count 내림차순 정렬, 빈 입력 → total 0.

`test/narrative.test.ts`:
3. `buildNarrativeContext(a, situation)` → `[작업성격]` 줄 포함; situation 없으면 미포함.
4. `buildAnalysis({ repoPath, commitCollector: 가짜 })` → `result.situation` 채워짐 +
   preview 사실블록에 `[작업성격]`; collector throw → situation undefined + warning,
   결정적 문서 정상.

`test/render.test.ts`:
5. `renderAnalysis(a, …, situation)` → `## 작업 성격` 섹션 + 정직성 라벨; 없으면 미포함.

기존 81 테스트는 옵셔널 인자만 추가하므로 전부 통과 유지.

## 비목표 (이번 슬라이스 제외)

- 편집 파일 종류(파일 확장자 축) — 후속(`git --name-only` 수집 필요).
- 다중 레포(`--repos`)·슬러그→경로 자동 복원.
- MCP `analyze`에 상황 추가.
- 추세·이상치(Phase 1 ③), PDF 공유 산출물(Phase 1 ④).
