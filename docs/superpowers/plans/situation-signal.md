# 상황 신호 (Phase 1 ②) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** git 커밋 타입(feat/fix/refactor…)을 결정적으로 분류해 `analyze --repo`에 "작업 성격" 축을 더하고, 주간 내러티브가 그 성격을 느슨히 서술하게 한다.

**Architecture:** 새 `core/situation.ts`(순수 분류기)가 `Commit[]`을 타입 분포로 집계한다. `buildAnalysis`는 `--repo` 주어지면 분석 기간과 같은 시간창의 커밋을 (주입 가능한 collector로) 모아 `SituationSummary`를 만들고, 결정적 렌더 섹션 + 내레이터 사실블록에 thread한다. 커밋과 AI 세션의 연결은 시간 추정임을 양쪽에 라벨한다.

**Tech Stack:** TypeScript(strict, NodeNext ESM), vitest. 로컬 import는 `.js` 확장자 필수.

> **⚠️ git 규칙:** 이 저장소는 **사용자가 git add/commit/push를 직접** 한다. 각 Task 끝 "Commit"의 명령은 **사용자가 실행**한다. 에이전트 실행자는 커밋 단계에서 멈추고 명령을 제시한다.

설계 스펙: [docs/superpowers/specs/situation-signal-design.md](../specs/situation-signal-design.md)

---

## 파일 구조

| 파일 | 책임 | 신규/수정 |
|------|------|-----------|
| `src/core/situation.ts` | 커밋 타입 분류·분포·글로스 | 신규 |
| `test/situation.test.ts` | 분류·분포·글로스 | 신규 |
| `src/core/narrative.ts` | 사실블록에 `[작업성격]` 줄(thread) | 수정 |
| `src/llm/anthropic.ts` | 인과 단정 금지 프롬프트 절 | 수정 |
| `src/core/render.ts` | `## 작업 성격` 섹션 | 수정 |
| `src/core/standup.ts` | `buildAnalysis` 커밋 수집(DI)·situation thread | 수정 |
| `src/cli.ts` | `analyze --repo` | 수정 |
| `src/mcp/server.ts` | (변경 없음) | — |

---

## Task 1: 커밋 타입 분류기 `situation.ts`

**Files:**
- Create: `src/core/situation.ts`
- Test: `test/situation.test.ts`

- [ ] **Step 1: Write the failing test** — Create `test/situation.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { classifyCommitType, summarizeSituation, labelCommitType } from "../src/core/situation.js";
import type { Commit } from "../src/parse/git.js";

function commit(subject: string): Commit {
  return { hash: "h" + subject, shortHash: "h", author: "u", timestamp: new Date("2026-06-12T05:00:00Z"), subject };
}

describe("classifyCommitType", () => {
  it("conventional 접두사를 타입으로 분류한다", () => {
    expect(classifyCommitType("feat: x")).toBe("feat");
    expect(classifyCommitType("fix(api): y")).toBe("fix");
    expect(classifyCommitType("refactor!: z")).toBe("refactor");
    expect(classifyCommitType("DOCS: caps")).toBe("docs");
    expect(classifyCommitType("  chore: 선행공백")).toBe("chore");
  });

  it("접두사 없음/미지의 단어는 기타", () => {
    expect(classifyCommitType("WIP something")).toBe("기타");
    expect(classifyCommitType("Merge branch 'main'")).toBe("기타");
    expect(classifyCommitType("wip: 미지 타입")).toBe("기타");
  });
});

describe("summarizeSituation", () => {
  it("타입별 count·share를 내림차순으로 집계한다(동률은 타입 알파벳)", () => {
    const s = summarizeSituation([
      commit("feat: a"),
      commit("fix: b"),
      commit("fix: c"),
      commit("fix: d"),
      commit("docs: e"),
    ]);
    expect(s.total).toBe(5);
    expect(s.byType[0]).toMatchObject({ type: "fix", count: 3 });
    expect(s.byType[0].share).toBeCloseTo(0.6);
    expect(s.byType.map((t) => t.type)).toEqual(["fix", "docs", "feat"]);
  });

  it("빈 입력은 total 0", () => {
    const s = summarizeSituation([]);
    expect(s.total).toBe(0);
    expect(s.byType).toEqual([]);
  });
});

describe("labelCommitType", () => {
  it("알려진 타입에 한글 글로스를 붙인다", () => {
    expect(labelCommitType("fix")).toBe("fix(수정/디버깅)");
    expect(labelCommitType("기타")).toBe("기타");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run test/situation.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: Write minimal implementation** — Create `src/core/situation.ts`:

```typescript
/**
 * 커밋 타입 분류 — 상황 신호(Phase 1 ②)의 결정적 데이터 계층.
 *
 * conventional-commit 접두사(feat/fix/refactor…)로 "이 기간 어떤 성격의 작업을
 * 했나"를 분류한다. 순수·결정적. *서술*이지 *평가*가 아니다(휴리스틱).
 */

import type { Commit } from "../parse/git.js";

const KNOWN_TYPES = new Set([
  "feat", "fix", "refactor", "docs", "test", "chore", "style", "perf", "build", "ci", "revert",
]);

const GLOSS: Record<string, string> = {
  feat: "신규", fix: "수정/디버깅", refactor: "리팩터", docs: "문서", test: "테스트",
  chore: "잡무", style: "스타일", perf: "성능", build: "빌드", ci: "CI", revert: "되돌림",
};

/** conventional-commit 접두사에서 타입을 뽑는다. 미지정/미지의 단어는 '기타'. */
export function classifyCommitType(subject: string): string {
  const m = /^\s*(\w+)(?:\([^)]*\))?!?:/.exec(subject);
  if (!m || m[1] === undefined) return "기타";
  const type = m[1].toLowerCase();
  return KNOWN_TYPES.has(type) ? type : "기타";
}

/** 표시용 한글 글로스를 붙인다(예: fix → "fix(수정/디버깅)"). 글로스 없으면 타입 그대로. */
export function labelCommitType(type: string): string {
  const g = GLOSS[type];
  return g ? `${type}(${g})` : type;
}

export interface SituationSummary {
  byType: Array<{ type: string; count: number; share: number }>;
  total: number;
}

/** 커밋들을 타입별로 집계(count 내림차순, 동률은 타입 알파벳). 순수·결정적. */
export function summarizeSituation(commits: Commit[]): SituationSummary {
  const counts = new Map<string, number>();
  for (const c of commits) {
    const t = classifyCommitType(c.subject);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const total = commits.length;
  const byType = [...counts.entries()]
    .map(([type, count]) => ({ type, count, share: total > 0 ? count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  return { byType, total };
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run test/situation.test.ts` → PASS(7 tests). 또한 `npx tsc --noEmit` 통과 확인.

- [ ] **Step 5: Commit (사용자가 실행)**

```bash
git add src/core/situation.ts test/situation.test.ts
git commit -m "feat: commit-type classifier + situation summary"
```

---

## Task 2: 사실블록 `[작업성격]` 줄 (narrative thread)

**Files:**
- Modify: `src/core/narrative.ts`
- Test: `test/narrative.test.ts` (append)

- [ ] **Step 1: Write the failing test** — Append to `test/narrative.test.ts` (먼저 상단 import 줄에 추가):

```typescript
import type { SituationSummary } from "../src/core/situation.js";
```

그리고 새 describe 블록 추가:

```typescript
const sampleSituation: SituationSummary = {
  total: 5,
  byType: [
    { type: "fix", count: 3, share: 0.6 },
    { type: "feat", count: 2, share: 0.4 },
  ],
};

describe("buildNarrativeContext 작업성격", () => {
  it("situation을 주면 [작업성격] 줄을 추가한다", () => {
    const ctx = buildNarrativeContext(fixture(), sampleSituation);
    expect(ctx).toContain("[작업성격]");
    expect(ctx).toContain("fix 60%");
    expect(ctx).toContain("커밋 5건");
  });

  it("situation이 없으면 [작업성격] 줄이 없다", () => {
    expect(buildNarrativeContext(fixture())).not.toContain("[작업성격]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run test/narrative.test.ts` → FAIL(2번째 인자 무시, `[작업성격]` 없음).

- [ ] **Step 3: Implement** — In `src/core/narrative.ts`:

(a) import 추가(파일 상단, `import type { UsageAnalysis }` 줄 아래):

```typescript
import type { SituationSummary } from "./situation.js";
```

(b) `buildNarrativeContext` 시그니처를 바꾸고, `return lines.join("\n");` 직전에 `[작업성격]` 줄을 추가한다. 함수 시그니처 줄:

```typescript
export function buildNarrativeContext(a: UsageAnalysis, situation?: SituationSummary): string {
```

그리고 `if (a.busiestDay) { ... }` 블록과 `return lines.join("\n");` 사이에 삽입:

```typescript
  if (situation && situation.total > 0) {
    const types = situation.byType.map((t) => `${t.type} ${pct(t.share)}`).join(" · ");
    lines.push(`[작업성격] ${types} (커밋 ${situation.total}건, repo 기준)`);
  }
```

(c) `prepareNarrativeSend`와 `narrateUsage`가 situation을 thread하도록 바꾼다:

```typescript
export function prepareNarrativeSend(a: UsageAnalysis, situation?: SituationSummary): PreparedNarrative {
  const raw = buildNarrativeContext(a, situation);
  const { masked, redactions } = maskSecrets(raw);
  return { maskedContext: masked, redactions };
}
```

```typescript
export async function narrateUsage(
  a: UsageAnalysis,
  narrator: Summarizer,
  situation?: SituationSummary,
): Promise<NarrativeResult> {
  if (a.totals.sessions === 0) {
    throw new SummarizerError("empty", "서술할 세션이 없습니다.");
  }
  const { maskedContext, redactions } = prepareNarrativeSend(a, situation);
  const prose = await narrator(maskedContext);
  if (typeof prose !== "string" || prose.trim() === "") {
    throw new SummarizerError("empty", "내레이터가 빈 응답을 반환했습니다.");
  }
  return { prose: prose.trim(), redactions };
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run test/narrative.test.ts` → PASS. `npx tsc --noEmit` 통과.

- [ ] **Step 5: Commit (사용자가 실행)**

```bash
git add src/core/narrative.ts test/narrative.test.ts
git commit -m "feat: thread situation into narrative facts block"
```

---

## Task 3: `renderAnalysis` 작업 성격 섹션

**Files:**
- Modify: `src/core/render.ts`
- Test: `test/render.test.ts` (append)

- [ ] **Step 1: Write the failing test** — Append to `test/render.test.ts`:

```typescript
import type { SituationSummary } from "../src/core/situation.js";

const sampleSituation: SituationSummary = {
  total: 5,
  byType: [
    { type: "fix", count: 3, share: 0.6 },
    { type: "feat", count: 2, share: 0.4 },
  ],
};

describe("renderAnalysis 작업 성격 섹션", () => {
  it("situation을 주면 '작업 성격' 섹션 + 정직성 라벨을 넣는다", () => {
    const out = renderAnalysis(analysisFixture(), undefined, undefined, sampleSituation);
    expect(out).toContain("## 작업 성격 (커밋 타입)");
    expect(out).toContain("fix(수정/디버깅)");
    expect(out).toContain("시간 추정이지 커밋별 증명이 아닙니다");
  });

  it("situation이 없으면 '작업 성격' 섹션이 없다", () => {
    expect(renderAnalysis(analysisFixture())).not.toContain("## 작업 성격");
  });
});
```

> `analysisFixture()`는 Phase 1 ① 작업에서 `test/render.test.ts`에 이미 정의돼 있다(재사용).

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run test/render.test.ts` → FAIL(4번째 인자 무시).

- [ ] **Step 3: Implement** — In `src/core/render.ts`:

(a) import 추가(파일 상단, 다른 import 아래):

```typescript
import { labelCommitType, type SituationSummary } from "./situation.js";
```

(b) `renderAnalysis` 시그니처를 바꾼다:

```typescript
export function renderAnalysis(a: UsageAnalysis, author?: string, narrative?: string, situation?: SituationSummary): string {
```

(c) 프로젝트별 섹션과 푸터(`lines.push("---");`) 사이에 작업 성격 섹션을 삽입한다. 즉 다음 코드를 찾아서:

```typescript
  lines.push("---");
  lines.push("⚠️ 이 문서는 *서술*(어떻게 쓰는지)이며 *평가*(잘 쓰는지)가 아닙니다. 토큰·빈도는 양이지 실력이 아닙니다.");
```

그 앞에 삽입:

```typescript
  // 작업 성격(커밋 타입) — situation 있을 때만(--repo). 결정적, 정직성 라벨.
  if (situation && situation.total > 0) {
    lines.push("## 작업 성격 (커밋 타입)");
    for (const t of situation.byType) {
      lines.push(`- ${labelCommitType(t.type)} ${bar(t.share, 12)} ${pct(t.share)} (${t.count}건)`);
    }
    lines.push(
      `ℹ️ 커밋 ${situation.total}건을 conventional-commit 타입으로 분류(휴리스틱·평가 아님). ` +
        `AI 사용과의 연결은 같은 기간이라는 시간 추정이지 커밋별 증명이 아닙니다.`,
    );
    lines.push("");
  }

```

> `bar(share, width)`와 `pct(share)`는 이 파일에 이미 있는 헬퍼다(render.ts).

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run test/render.test.ts` → PASS. `npx tsc --noEmit` 통과.

- [ ] **Step 5: Commit (사용자가 실행)**

```bash
git add src/core/render.ts test/render.test.ts
git commit -m "feat: renderAnalysis work-character section"
```

---

## Task 4: 내레이터 프롬프트에 인과-단정 금지 절

**Files:**
- Modify: `src/llm/anthropic.ts`

- [ ] **Step 1: Implement** — In `src/llm/anthropic.ts`, `NARRATIVE_SYSTEM_PROMPT` 배열에서 다음 줄을 찾아서:

```typescript
  "- 표는 문서에 남으므로 숫자 나열이 아니라 패턴 해석에 집중.",
```

그 앞에 한 줄 추가:

```typescript
  "- '작업성격'(커밋 타입)이 있으면 AI 사용과 느슨히 엮되, 'X하느라 썼다'처럼 인과로 단정하지 말 것(같은 기간의 정황일 뿐).",
```

- [ ] **Step 2: Verify no regression** — `npx vitest run && npx tsc --noEmit` → 전체 PASS(기존 + 신규), 타입 에러 없음. (anthropic는 네트워크 의존이라 직접 테스트 없음; 전체 통과로 회귀 없음 확인.)

- [ ] **Step 3: Commit (사용자가 실행)**

```bash
git add src/llm/anthropic.ts
git commit -m "feat: narrator prompt — no causal claims for work-character"
```

---

## Task 5: `buildAnalysis` 커밋 수집(DI) + situation thread

**Files:**
- Modify: `src/core/standup.ts`
- Test: `test/narrative.test.ts` (append)

- [ ] **Step 1: Write the failing test** — Append to `test/narrative.test.ts`:

```typescript
describe("buildAnalysis 상황 신호(--repo)", () => {
  const FIX = ["test/fixtures/one-session.jsonl"];
  const fakeCommits = [
    { hash: "a", shortHash: "a", author: "u", timestamp: new Date("2026-06-12T05:00:00Z"), subject: "fix: bug" },
    { hash: "b", shortHash: "b", author: "u", timestamp: new Date("2026-06-12T06:00:00Z"), subject: "feat: x" },
  ];

  it("repoPath + commitCollector 주입 시 situation을 채우고 사실블록에 [작업성격]을 넣는다", async () => {
    const r = await buildAnalysis({
      sessionFiles: FIX,
      repoPath: "/x",
      commitCollector: async () => ({ commits: fakeCommits }),
      useLlm: true,
      dryRunLlm: true,
    });
    expect(r.situation?.total).toBe(2);
    expect(r.preview?.maskedContext).toContain("[작업성격]");
  });

  it("collector가 warning을 내면 situation 없이 warning + 결정적 문서 유지", async () => {
    const r = await buildAnalysis({
      sessionFiles: FIX,
      repoPath: "/x",
      commitCollector: async () => ({ commits: [], warning: "git 실패" }),
    });
    expect(r.situation).toBeUndefined();
    expect(r.warnings).toContain("git 실패");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run test/narrative.test.ts` → FAIL(`repoPath`/`commitCollector` 옵션·`situation` 결과 없음).

- [ ] **Step 3: Implement — imports** — In `src/core/standup.ts`, situation import 추가(`import { prepareNarrativeSend, narrateUsage } from "./narrative.js";` 줄 아래):

```typescript
import { summarizeSituation, type SituationSummary } from "./situation.js";
```

> `collectCommits`(from `../fs/git.js`)와 `kstDayRange`(from `./day.js`)는 이미 import돼 있다(buildStandup이 사용).

- [ ] **Step 4: Implement — 옵션/결과 타입** — `AnalysisBuildOptions`와 `AnalysisBuildResult`를 확장한다. 다음 인터페이스를 찾아서:

```typescript
export interface AnalysisBuildOptions {
  /** KST 시작/끝 날짜(포함). 미지정 시 데이터 전체. */
  start?: string;
  end?: string;
  sessionFiles?: string[];
  projectsDir?: string;
  /** 주어지고 useLlm=true면 주간 사용을 LLM으로 서술(실패 시 결정적 문서로 폴백). */
  summarizer?: Summarizer;
  useLlm?: boolean;
  /** useLlm이면서 dryRunLlm=true면 전송하지 않고 "보낼 내용"만 준비(승인용 미리보기). */
  dryRunLlm?: boolean;
}
```

다음으로 교체(끝에 3개 필드 추가):

```typescript
export interface AnalysisBuildOptions {
  /** KST 시작/끝 날짜(포함). 미지정 시 데이터 전체. */
  start?: string;
  end?: string;
  sessionFiles?: string[];
  projectsDir?: string;
  /** 주어지고 useLlm=true면 주간 사용을 LLM으로 서술(실패 시 결정적 문서로 폴백). */
  summarizer?: Summarizer;
  useLlm?: boolean;
  /** useLlm이면서 dryRunLlm=true면 전송하지 않고 "보낼 내용"만 준비(승인용 미리보기). */
  dryRunLlm?: boolean;
  /** 주어지면 같은 시간창의 커밋 타입 분포(작업 성격)를 수집한다. */
  repoPath?: string;
  /** 커밋 작성자 필터(+분석 문서 헤더와 동일 값 재사용). */
  author?: string;
  /** 테스트·주입용 커밋 수집기. 미지정 시 실제 collectCommits. */
  commitCollector?: typeof collectCommits;
}
```

그리고 `AnalysisBuildResult`를 찾아서:

```typescript
export interface AnalysisBuildResult {
  analysis: UsageAnalysis;
  warnings: string[];
  /** --send 경로에서 생성된 주간 산문(있으면 renderAnalysis에 전달). */
  narrative?: string;
  /** dryRunLlm일 때 전송 예정 컨텍스트 미리보기(승인용). */
  preview?: { maskedContext: string; redactions: Redaction[] };
}
```

다음으로 교체(situation 필드 추가):

```typescript
export interface AnalysisBuildResult {
  analysis: UsageAnalysis;
  warnings: string[];
  /** --send 경로에서 생성된 주간 산문(있으면 renderAnalysis에 전달). */
  narrative?: string;
  /** dryRunLlm일 때 전송 예정 컨텍스트 미리보기(승인용). */
  preview?: { maskedContext: string; redactions: Redaction[] };
  /** --repo 주어졌을 때의 작업 성격(커밋 타입 분포). */
  situation?: SituationSummary;
}
```

- [ ] **Step 5: Implement — buildAnalysis 본문** — `buildAnalysis`에서 다음 부분을 찾아서:

```typescript
  const analysis = analyze(parsed.sessions, analyzeOpts);

  const result: AnalysisBuildResult = { analysis, warnings };

  // LLM 서술(선택). 세션이 있을 때만. 실패하면 결정적 문서로 폴백(§4.4).
  if (opts.useLlm && analysis.totals.sessions > 0) {
    if (opts.dryRunLlm) {
      try {
        result.preview = prepareNarrativeSend(analysis);
      } catch (err) {
        warnings.push(`전송 준비 실패(마스킹 차단): ${(err as Error).message}`);
      }
    } else if (opts.summarizer) {
      try {
        const { prose, redactions } = await narrateUsage(analysis, opts.summarizer);
        result.narrative = prose;
        if (redactions.length > 0) warnings.push(`마스킹: ${redactions.length}개 비밀 가림 후 전송`);
      } catch (err) {
        warnings.push(`LLM 서술 실패 — 결정적 문서만: ${(err as Error).message}`);
      }
    }
  }

  return result;
```

다음으로 교체(situation 수집 + thread):

```typescript
  const analysis = analyze(parsed.sessions, analyzeOpts);

  const result: AnalysisBuildResult = { analysis, warnings };

  // 상황 신호(선택): --repo 주어지면 분석 기간과 같은 시간창의 커밋 타입 분포.
  // 어떤 실패도 결정적 문서를 막지 않는다(폴백).
  let situation: SituationSummary | undefined;
  if (opts.repoPath && analysis.range.start && analysis.range.end) {
    try {
      const collector = opts.commitCollector ?? collectCommits;
      const startUtc = kstDayRange(analysis.range.start).startUtc;
      const endUtc = kstDayRange(analysis.range.end).endUtc;
      const r = await collector(opts.repoPath, startUtc, endUtc, opts.author);
      if (r.warning) warnings.push(r.warning);
      const s = summarizeSituation(r.commits);
      if (s.total > 0) {
        situation = s;
        result.situation = s;
      }
    } catch (err) {
      warnings.push(`상황 신호 수집 실패: ${(err as Error).message}`);
    }
  }

  // LLM 서술(선택). 세션이 있을 때만. 실패하면 결정적 문서로 폴백(§4.4).
  if (opts.useLlm && analysis.totals.sessions > 0) {
    if (opts.dryRunLlm) {
      try {
        result.preview = prepareNarrativeSend(analysis, situation);
      } catch (err) {
        warnings.push(`전송 준비 실패(마스킹 차단): ${(err as Error).message}`);
      }
    } else if (opts.summarizer) {
      try {
        const { prose, redactions } = await narrateUsage(analysis, opts.summarizer, situation);
        result.narrative = prose;
        if (redactions.length > 0) warnings.push(`마스킹: ${redactions.length}개 비밀 가림 후 전송`);
      } catch (err) {
        warnings.push(`LLM 서술 실패 — 결정적 문서만: ${(err as Error).message}`);
      }
    }
  }

  return result;
```

- [ ] **Step 6: Run test to verify it passes** — `npx vitest run test/narrative.test.ts && npx tsc --noEmit` → PASS.

- [ ] **Step 7: Commit (사용자가 실행)**

```bash
git add src/core/standup.ts test/narrative.test.ts
git commit -m "feat: buildAnalysis collects commit-type situation (injectable)"
```

---

## Task 6: CLI `analyze --repo`

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement — usage 텍스트** — In `src/cli.ts`, `usage()`에서 analyze 블록의 `--sessions` 줄을 찾아서:

```typescript
      "    --sessions <file>   세션 파일 명시(반복 가능)",
```

그 아래에 추가:

```typescript
      "    --repo <path>       작업 성격(커밋 타입)을 분류할 저장소 경로",
```

- [ ] **Step 2: Implement — cmdAnalyze** — `cmdAnalyze`를 찾아서:

```typescript
async function cmdAnalyze(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const opts: AnalysisBuildOptions = {};
  if (flags.start?.[0]) opts.start = flags.start[0];
  if (flags.end?.[0]) opts.end = flags.end[0];
  if (flags.sessions && flags.sessions.length > 0) opts.sessionFiles = flags.sessions.filter((s) => s !== "");
  const author = flags.author?.[0];

  const useLlm = flags.llm !== undefined;
  const send = flags.send !== undefined;
  if (useLlm) {
    opts.useLlm = true;
    if (send) opts.summarizer = createAnthropicNarrator();
    else opts.dryRunLlm = true;
  }

  const { analysis, warnings, narrative, preview } = await buildAnalysis(opts);
  process.stdout.write(renderAnalysis(analysis, author, narrative) + "\n");
```

다음으로 교체(repo/author 배선 + situation 렌더):

```typescript
async function cmdAnalyze(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const opts: AnalysisBuildOptions = {};
  if (flags.start?.[0]) opts.start = flags.start[0];
  if (flags.end?.[0]) opts.end = flags.end[0];
  if (flags.sessions && flags.sessions.length > 0) opts.sessionFiles = flags.sessions.filter((s) => s !== "");
  if (flags.repo?.[0]) opts.repoPath = flags.repo[0];
  const author = flags.author?.[0];
  if (author) opts.author = author;

  const useLlm = flags.llm !== undefined;
  const send = flags.send !== undefined;
  if (useLlm) {
    opts.useLlm = true;
    if (send) opts.summarizer = createAnthropicNarrator();
    else opts.dryRunLlm = true;
  }

  const { analysis, warnings, narrative, preview, situation } = await buildAnalysis(opts);
  process.stdout.write(renderAnalysis(analysis, author, narrative, situation) + "\n");
```

> 나머지(preview/warnings 출력)는 그대로 둔다.

- [ ] **Step 3: Build + smoke (현재 레포로 결정적 작업 성격 확인, 네트워크 없음)**

Run:
```bash
npx tsc --noEmit && npm run build && node dist/cli.js analyze --repo . --start 2026-05-11 --end 2026-06-14 2>&1 | head -40
```
Expected: 분석 문서에 `## 작업 성격 (커밋 타입)` 섹션이 보이고 feat/fix/docs/chore 등 분포가 막대로 출력된다(이 레포 커밋 기준). 산문은 없음(--llm 안 함).

- [ ] **Step 4: Full suite + typecheck** — `npx vitest run && npx tsc --noEmit` → 전체 PASS, 타입 에러 없음.

- [ ] **Step 5: Commit (사용자가 실행)**

```bash
git add src/cli.ts
git commit -m "feat: analyze --repo surfaces commit-type work character"
```

---

## 완료 기준 (전체)

- `npx vitest run` 전체 통과(기존 81 + 신규 ~13).
- `npx tsc --noEmit` 에러 없음.
- `analyze --repo <path>`가 결정적 `## 작업 성격` 섹션을 보여준다(커밋 0건이면 생략).
- `analyze --repo --llm`(드라이런)이 사실블록에 `[작업성격]` 줄을 포함한다.
- `analyze --repo --llm --send`가 작업 성격을 인용한(인과 단정 없는) 산문을 만든다.
- collector 실패·커밋 0건 등 어떤 상황 실패도 결정적 분석 문서 출력을 막지 않는다.
- MCP `analyze` 도구는 변경 없이 결정적 문서만 반환한다.
- README의 analyze 사용법에 `--repo` 반영(선택 — 별도 docs 커밋).
