# 주간 내러티브 (Phase 1 ①) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결정적 사용 분석(`analyze`) 위에 "이번 주 이렇게 썼다"를 짧은 한국어 산문으로 얹는다 — 신규 데이터 수집 없이, 마스킹 fail-closed + 옵인 전송으로.

**Architecture:** standup의 마스킹 전송 경계(`summarize.ts`)를 분석용으로 대칭 복제한 새 `core/narrative.ts`를 둔다. LLM에는 결정적으로 계산된 집계 사실 블록만 보내고, 산문은 그 숫자를 서술할 뿐 새 숫자를 만들지 않는다. 기본 `analyze`는 결정적 문서만, `--send` 했을 때만 산문 섹션이 붙는다. MCP는 변경 없음.

**Tech Stack:** TypeScript(strict, NodeNext ESM), vitest, @anthropic-ai/sdk, zod.

> **⚠️ git 규칙:** 이 저장소는 **사용자가 git add/commit/push를 직접** 한다. 각 Task 끝 "Commit" 단계의 명령은 **사용자가 실행**한다(에이전트는 대신 실행하지 않는다). 에이전트 실행자는 커밋 단계에서 멈추고 사용자에게 명령을 제시한다.

설계 스펙: [docs/superpowers/specs/weekly-narrative-design.md](../specs/weekly-narrative-design.md)

---

## 파일 구조

| 파일 | 책임 | 신규/수정 |
|------|------|-----------|
| `src/core/narrative.ts` | 분석 사실 블록 빌드 · 마스킹(fail-closed) · 내레이터 호출 | 신규 |
| `test/narrative.test.ts` | 위 함수 + buildAnalysis 통합 경로 | 신규 |
| `src/llm/anthropic.ts` | `createAnthropicNarrator()` 추가(공용 헬퍼로 DRY) | 수정 |
| `src/core/render.ts` | `renderAnalysis`에 산문 섹션 옵션 추가 | 수정 |
| `src/core/standup.ts` | `buildAnalysis`에 LLM·드라이런·폴백 분기 추가 | 수정 |
| `src/cli.ts` | `analyze`에 `--llm`/`--send` + 미리보기 | 수정 |
| `src/mcp/server.ts` | (변경 없음 — 결정적 유지) | — |

---

## Task 1: 사실 블록 빌더 `buildNarrativeContext`

**Files:**
- Create: `src/core/narrative.ts`
- Test: `test/narrative.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/narrative.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildNarrativeContext } from "../src/core/narrative.js";
import type { UsageAnalysis } from "../src/core/analysis.js";

/** 테스트용 최소 UsageAnalysis 픽스처. 필요한 필드만 채우고 나머지는 합리적 기본값. */
function fixture(over: Partial<UsageAnalysis> = {}): UsageAnalysis {
  const byHour = new Array<number>(24).fill(0);
  byHour[15] = 5; // 오후 피크
  return {
    range: { start: "2026-06-08", end: "2026-06-14" },
    totals: {
      sessions: 23,
      tokens: { input: 1000, output: 500, cacheRead: 2000, cacheCreation: 300 },
      costUsd: 4.1,
      durationMs: 3_600_000,
    },
    byModel: [
      { model: "claude-opus-4-8", displayTokens: 6200, costUsd: 3.1, tokenShare: 0.62, costShare: 0.76 },
      { model: "claude-sonnet-4-6", displayTokens: 2800, costUsd: 0.8, tokenShare: 0.28, costShare: 0.2 },
      { model: "claude-haiku-4-5", displayTokens: 1000, costUsd: 0.2, tokenShare: 0.1, costShare: 0.04 },
    ],
    byDay: [
      { date: "2026-06-12", sessions: 8, displayTokens: 5000, costUsd: 1.4 },
      { date: "2026-06-13", sessions: 15, displayTokens: 5000, costUsd: 2.7 },
    ],
    byHourKst: byHour,
    byProject: [
      { project: "C--Users-jeonj-GitHub-AI_Metrics_MCP", sessions: 18, displayTokens: 7000, costUsd: 3.0 },
      { project: "C--Users-jeonj-GitHub-AIWS-Front", sessions: 5, displayTokens: 3000, costUsd: 1.1 },
    ],
    busiestDay: { date: "2026-06-12", sessions: 8, displayTokens: 5000, costUsd: 1.4 },
    hasUnknownModel: false,
    pricingVersion: "test",
    ...over,
  };
}

describe("buildNarrativeContext", () => {
  it("기간·총계·모델믹스·시간대·프로젝트·가장활발을 라벨과 함께 낸다", () => {
    const ctx = buildNarrativeContext(fixture());
    expect(ctx).toContain("[기간] 2026-06-08 ~ 2026-06-14 (KST)");
    expect(ctx).toContain("세션 23");
    expect(ctx).toContain("Opus 62% 토큰");
    expect(ctx).toContain("오후");
    expect(ctx).toContain("[가장 활발] 2026-06-12");
  });

  it("프로젝트 슬러그를 읽기 쉬운 이름으로 줄인다", () => {
    const ctx = buildNarrativeContext(fixture());
    expect(ctx).toContain("AI_Metrics_MCP");
    expect(ctx).not.toContain("C--Users-jeonj");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/narrative.test.ts`
Expected: FAIL — `buildNarrativeContext` 모듈/함수 없음.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/narrative.ts`:

```typescript
/**
 * 주간 내러티브의 전송 경계 — summarize.ts(커밋용)의 분석판.
 *
 *   분석 사실 ─▶ 사실 블록 빌드 ─▶ 마스킹(fail-closed) ─▶ [승인] ─▶ 내레이터 ─▶ 산문
 *
 * LLM에 보내는 것은 이미 결정적으로 계산된 집계 사실뿐. 산문은 그 숫자를
 * *서술*할 뿐 새 숫자를 만들지 않는다(결정적 메트릭은 LLM 우회).
 */

import { maskSecrets, type Redaction } from "./mask.js";
import { SummarizerError, type Summarizer } from "../llm/summarizer.js";
import { shortModelName, prettyProject } from "./render.js";
import type { UsageAnalysis } from "./analysis.js";

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function totalDisplayTokens(a: UsageAnalysis): number {
  const t = a.totals.tokens;
  return t.input + t.output + t.cacheRead + t.cacheCreation;
}

/** 세션 시작 시간대(KST) 분포에서 피크 시각과 대략적 시간 띠를 서술. */
function peakHourPhrase(byHour: number[]): string {
  let peak = 0;
  for (let h = 1; h < byHour.length; h++) {
    if ((byHour[h] ?? 0) > (byHour[peak] ?? 0)) peak = h;
  }
  const band = peak < 6 ? "새벽" : peak < 12 ? "오전" : peak < 18 ? "오후" : "저녁";
  return `피크 ${peak}시 (${band} 집중)`;
}

/** 결정적 분석 → LLM에 보낼 사실 블록(마스킹 전 원본). 지시문은 내레이터가 감싼다. */
export function buildNarrativeContext(a: UsageAnalysis): string {
  const lines: string[] = [];
  lines.push(`[기간] ${a.range.start} ~ ${a.range.end} (KST)`);
  lines.push(`[총계] 세션 ${a.totals.sessions} · 활동일 ${a.byDay.length} · 비용 약 $${a.totals.costUsd.toFixed(2)}`);

  // 모델 패밀리(Opus/Sonnet/Haiku) 합산 — renderAnalysis와 동일 규칙.
  const fam = new Map<string, { cost: number; tokenShare: number }>();
  for (const m of a.byModel) {
    const name = shortModelName(m.model);
    const cur = fam.get(name) ?? { cost: 0, tokenShare: 0 };
    cur.cost += m.costUsd;
    cur.tokenShare += m.tokenShare;
    fam.set(name, cur);
  }
  const models = [...fam.entries()]
    .sort((x, y) => y[1].tokenShare - x[1].tokenShare)
    .map(([name, f]) => `${name} ${pct(f.tokenShare)} 토큰/$${f.cost.toFixed(2)}`)
    .join(" · ");
  if (models) lines.push(`[모델믹스] ${models}`);

  lines.push(`[시간대] ${peakHourPhrase(a.byHourKst)}`);

  const total = totalDisplayTokens(a);
  const projects = a.byProject
    .map((p) => `${prettyProject(p.project)} ${pct(total > 0 ? p.displayTokens / total : 0)}`)
    .join(" · ");
  if (projects) lines.push(`[프로젝트] ${projects}`);

  if (a.busiestDay) {
    lines.push(`[가장 활발] ${a.busiestDay.date} ($${a.busiestDay.costUsd.toFixed(2)})`);
  }
  return lines.join("\n");
}
```

> 참고: `shortModelName`은 "claude-opus-4-8" → "Opus"로 줄인다(render.ts:14). `prettyProject`는 "...GitHub-AI_Metrics_MCP" → "AI_Metrics_MCP"로 줄인다(render.ts:149).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/narrative.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit (사용자가 실행)**

```bash
git add src/core/narrative.ts test/narrative.test.ts
git commit -m "feat: narrative facts block from deterministic analysis"
```

---

## Task 2: 마스킹 전송 경계 + 내레이터 호출

**Files:**
- Modify: `src/core/narrative.ts` (append)
- Test: `test/narrative.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/narrative.test.ts` (imports를 맨 위 import 줄에 추가):

```typescript
import { prepareNarrativeSend, narrateUsage } from "../src/core/narrative.js";
import { SummarizerError, type Summarizer } from "../src/llm/summarizer.js";
```

Append these describe blocks:

```typescript
const echo: Summarizer = async (ctx) => `서술: ${ctx.split("\n").length}줄`;

describe("prepareNarrativeSend", () => {
  it("사실 블록 속 비밀을 마스킹한다", () => {
    const a = fixture({
      byProject: [
        { project: "C--Users-jeonj-GitHub-AKIAIOSFODNN7EXAMPLE", sessions: 1, displayTokens: 100, costUsd: 0.1 },
      ],
    });
    const { maskedContext, redactions } = prepareNarrativeSend(a);
    expect(maskedContext).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(redactions.length).toBe(1);
  });
});

describe("narrateUsage", () => {
  it("내레이터 산문을 반환한다", async () => {
    const r = await narrateUsage(fixture(), echo);
    expect(r.prose).toContain("서술:");
  });

  it("세션 0건이면 SummarizerError(empty)를 던진다", async () => {
    const empty = fixture({ totals: { sessions: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 0 } });
    await expect(narrateUsage(empty, echo)).rejects.toMatchObject({ kind: "empty" });
  });

  it("내레이터 빈 응답이면 SummarizerError(empty)를 던진다", async () => {
    const blank: Summarizer = async () => "   ";
    await expect(narrateUsage(fixture(), blank)).rejects.toMatchObject({ kind: "empty" });
  });

  it("내레이터 에러는 그대로 전파된다(호출부가 폴백)", async () => {
    const boom: Summarizer = async () => {
      throw new SummarizerError("transport", "네트워크 실패");
    };
    await expect(narrateUsage(fixture(), boom)).rejects.toMatchObject({ kind: "transport" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/narrative.test.ts`
Expected: FAIL — `prepareNarrativeSend` / `narrateUsage` export 없음.

- [ ] **Step 3: Write minimal implementation**

Append to `src/core/narrative.ts`:

```typescript
export interface PreparedNarrative {
  /** 마스킹을 거쳐 실제로 전송될 사실 블록. */
  maskedContext: string;
  redactions: Redaction[];
}

/** 전송 준비: 사실 블록 빌드 + 마스킹(fail-closed). maskSecrets throw 시 전파(전송 차단). */
export function prepareNarrativeSend(a: UsageAnalysis): PreparedNarrative {
  const raw = buildNarrativeContext(a);
  const { masked, redactions } = maskSecrets(raw);
  return { maskedContext: masked, redactions };
}

export interface NarrativeResult {
  prose: string;
  redactions: Redaction[];
}

/**
 * 마스킹된 사실 블록을 내레이터에 보내 주간 산문을 얻는다.
 * 세션 0건/빈 응답은 SummarizerError, 그 외 실패는 그대로 전파 → 호출부 폴백.
 */
export async function narrateUsage(a: UsageAnalysis, narrator: Summarizer): Promise<NarrativeResult> {
  if (a.totals.sessions === 0) {
    throw new SummarizerError("empty", "서술할 세션이 없습니다.");
  }
  const { maskedContext, redactions } = prepareNarrativeSend(a);
  const prose = await narrator(maskedContext);
  if (typeof prose !== "string" || prose.trim() === "") {
    throw new SummarizerError("empty", "내레이터가 빈 응답을 반환했습니다.");
  }
  return { prose: prose.trim(), redactions };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/narrative.test.ts`
Expected: PASS (6 tests 누적).

- [ ] **Step 5: Commit (사용자가 실행)**

```bash
git add src/core/narrative.ts test/narrative.test.ts
git commit -m "feat: narrative masking send-boundary + narrateUsage"
```

---

## Task 3: Anthropic 내레이터 (DRY 리팩터)

**Files:**
- Modify: `src/llm/anthropic.ts` (전체 교체)

기존 `createAnthropicSummarizer`의 호출 로직을 공용 헬퍼로 빼고, 같은 헬퍼로 `createAnthropicNarrator`를 추가한다. 요약기 동작(모델·env·프레이밍)은 정확히 보존한다.

- [ ] **Step 1: 전체 교체**

Replace the entire contents of `src/llm/anthropic.ts`:

```typescript
/**
 * 실제 Anthropic 호출기 — Summarizer 인터페이스 구현(요약기/내레이터 2종).
 *
 * 둘 다 저가 모델 기본(claude-haiku-4-5). 키는 ANTHROPIC_API_KEY, 없으면
 * SummarizerError('no-api-key'). 시스템 프롬프트로 "수치 임의 생성 금지"를 제약한다.
 * 호출 로직은 makeAnthropicCaller 하나로 DRY.
 */

import Anthropic from "@anthropic-ai/sdk";
import { SummarizerError, type Summarizer } from "./summarizer.js";

const DEFAULT_MODEL = "claude-haiku-4-5";

const SUMMARY_SYSTEM_PROMPT = [
  "당신은 개발자의 어제 Git 커밋 목록을 받아 일일 스크럼의 '어제 한 일' 항목으로 간결히 요약한다.",
  "규칙:",
  "- 커밋에 없는 성과·수치·지표를 절대 지어내지 말 것.",
  "- 한국어, 불릿(- )으로. 관련 커밋을 묶어 자연스럽게.",
  "- 각 항목 끝에 근거 커밋 해시를 (해시) 형태로 표기.",
  "- 출력은 불릿 목록만. 머리말·맺음말 없이.",
].join("\n");

const NARRATIVE_SYSTEM_PROMPT = [
  "당신은 개발자의 결정적으로 집계된 AI 사용 통계(사실 블록)를 받아 '이번 주 이렇게 썼다'를 짧은 한국어 산문으로 서술한다.",
  "규칙:",
  "- 사실 블록에 없는 수치·지표·성과를 절대 지어내지 말 것. 정량 주장은 블록의 값만 인용.",
  "- 서술이지 평가가 아니다 — '잘 썼다'가 아니라 '이렇게 썼다'. 토큰은 양이지 실력이 아니다.",
  "- 한국어 산문 2~4문장. 머리말·맺음말 없이.",
  "- 표는 문서에 남으므로 숫자 나열이 아니라 패턴 해석에 집중.",
].join("\n");

export interface AnthropicSummarizerOptions {
  model?: string;
  maxTokens?: number;
  /** 테스트·주입용. 미지정 시 env에서 읽는다. */
  apiKey?: string;
}

/** 시스템 프롬프트 + 유저 프레이밍 + 모델 env 키를 받아 Summarizer를 만든다. */
function makeAnthropicCaller(
  system: string,
  frame: (maskedContext: string) => string,
  modelEnvVar: string,
  opts: AnthropicSummarizerOptions,
): Summarizer {
  const model = opts.model ?? process.env[modelEnvVar] ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? 1024;

  return async (maskedContext: string): Promise<string> => {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new SummarizerError("no-api-key", "ANTHROPIC_API_KEY가 설정되지 않았습니다.");
    }

    const client = new Anthropic({ apiKey });
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: frame(maskedContext) }],
      });
    } catch (err) {
      throw new SummarizerError("transport", `Anthropic 호출 실패: ${(err as Error).message}`);
    }

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock || textBlock.text.trim() === "") {
      throw new SummarizerError("empty", "모델 응답에 텍스트가 없습니다.");
    }
    return textBlock.text;
  };
}

/** "어제 한 일" 요약기(스크럼용). env: AIMM_SUMMARY_MODEL. */
export function createAnthropicSummarizer(opts: AnthropicSummarizerOptions = {}): Summarizer {
  return makeAnthropicCaller(SUMMARY_SYSTEM_PROMPT, (ctx) => `어제 커밋 목록:\n${ctx}`, "AIMM_SUMMARY_MODEL", opts);
}

/** 주간 사용 내레이터(분석용). env: AIMM_NARRATIVE_MODEL. */
export function createAnthropicNarrator(opts: AnthropicSummarizerOptions = {}): Summarizer {
  return makeAnthropicCaller(NARRATIVE_SYSTEM_PROMPT, (ctx) => `사용 통계(사실 블록):\n${ctx}`, "AIMM_NARRATIVE_MODEL", opts);
}
```

- [ ] **Step 2: Run full suite to verify no regression**

Run: `npx vitest run`
Expected: PASS — 기존 61 + narrative 6 = 67 tests. (anthropic는 네트워크 의존이라 직접 테스트 없음; 요약 경로 회귀 없음을 전체 통과로 확인.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: Commit (사용자가 실행)**

```bash
git add src/llm/anthropic.ts
git commit -m "feat: createAnthropicNarrator + DRY anthropic caller"
```

---

## Task 4: `renderAnalysis` 산문 섹션

**Files:**
- Modify: `src/core/render.ts:172` (`renderAnalysis` 시그니처 + 본문)
- Test: `test/render.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/render.test.ts`. 먼저 `renderAnalysis` import가 있는지 확인하고 없으면 추가:

```typescript
import { renderAnalysis } from "../src/core/render.js";
import type { UsageAnalysis } from "../src/core/analysis.js";

function analysisFixture(): UsageAnalysis {
  return {
    range: { start: "2026-06-08", end: "2026-06-14" },
    totals: { sessions: 5, tokens: { input: 100, output: 50, cacheRead: 200, cacheCreation: 30 }, costUsd: 1.0, durationMs: 60000 },
    byModel: [{ model: "claude-opus-4-8", displayTokens: 380, costUsd: 1.0, tokenShare: 1, costShare: 1 }],
    byDay: [{ date: "2026-06-12", sessions: 5, displayTokens: 380, costUsd: 1.0 }],
    byHourKst: new Array<number>(24).fill(0),
    byProject: [{ project: "C--Users-jeonj-GitHub-X", sessions: 5, displayTokens: 380, costUsd: 1.0 }],
    busiestDay: { date: "2026-06-12", sessions: 5, displayTokens: 380, costUsd: 1.0 },
    hasUnknownModel: false,
    pricingVersion: "test",
  };
}

describe("renderAnalysis 산문 섹션", () => {
  it("narrative를 주면 '한 주 돌아보기' 섹션을 맨 위에 넣는다", () => {
    const out = renderAnalysis(analysisFixture(), undefined, "오후에 집중해 Opus를 주로 썼다.");
    expect(out).toContain("## 한 주 돌아보기");
    expect(out).toContain("오후에 집중해 Opus를 주로 썼다.");
    // 산문 섹션이 요약 섹션보다 앞에 온다.
    expect(out.indexOf("## 한 주 돌아보기")).toBeLessThan(out.indexOf("## 요약"));
  });

  it("narrative가 없으면 산문 섹션을 넣지 않는다", () => {
    const out = renderAnalysis(analysisFixture());
    expect(out).not.toContain("## 한 주 돌아보기");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/render.test.ts`
Expected: FAIL — `renderAnalysis`가 3번째 인자를 무시하므로 "## 한 주 돌아보기" 없음.

- [ ] **Step 3: Implement**

In `src/core/render.ts`, change the signature at line 172:

```typescript
export function renderAnalysis(a: UsageAnalysis, author?: string, narrative?: string): string {
```

Then, immediately after the `sessions === 0` early-return block (current lines 179–182, before the `// 요약.` comment at line 184), insert:

```typescript
  // 주간 내러티브(옵션) — 결정적 표보다 앞에 둬 한눈에 읽히게. 표는 아래 남아 대조 검증.
  if (narrative && narrative.trim() !== "") {
    lines.push("## 한 주 돌아보기");
    lines.push(narrative.trim());
    lines.push("⚠️ 아래 수치를 *서술*한 것이며 새 수치를 만들지 않습니다.");
    lines.push("");
  }

```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/render.test.ts`
Expected: PASS (기존 7 + 2 = 9 tests).

- [ ] **Step 5: Commit (사용자가 실행)**

```bash
git add src/core/render.ts test/render.test.ts
git commit -m "feat: renderAnalysis weekly narrative section"
```

---

## Task 5: `buildAnalysis` LLM·드라이런·폴백 분기

**Files:**
- Modify: `src/core/standup.ts:109-133` (`AnalysisBuildOptions`, `AnalysisBuildResult`, `buildAnalysis`)
- Test: `test/standup.test.ts` (없으면 생성) — 여기서는 `test/narrative.test.ts`에 통합 테스트 추가

- [ ] **Step 1: Write the failing test**

Append to `test/narrative.test.ts`:

```typescript
import { buildAnalysis } from "../src/core/standup.js";

// 세션 1건이 있는 임시 JSONL 픽스처를 쓰는 대신, buildAnalysis는 sessionFiles로
// 빈 목록을 받으면 세션 0건이 된다. LLM 분기는 sessions>0에서만 동작하므로
// 통합 테스트는 "세션 0건일 때 산문/미리보기를 만들지 않는다"를 확인한다.
describe("buildAnalysis LLM 분기", () => {
  it("세션이 없으면 useLlm이어도 narrative/preview가 없다", async () => {
    const r = await buildAnalysis({ sessionFiles: [], useLlm: true, dryRunLlm: true });
    expect(r.analysis.totals.sessions).toBe(0);
    expect(r.narrative).toBeUndefined();
    expect(r.preview).toBeUndefined();
  });
});
```

> 세션이 있는 경로(드라이런 preview 채워짐 / narrator 주입 시 narrative 채워짐 / narrator 실패 시 폴백+warning)는 실제 JSONL 픽스처가 필요하다. 아래 Step 6에서 픽스처 기반 테스트를 추가한다. Step 1~5는 시그니처/분기 골격을 세운다.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/narrative.test.ts`
Expected: FAIL — `buildAnalysis` 결과에 `narrative`/`preview` 프로퍼티 타입 없음(컴파일 에러) 또는 옵션 `useLlm` 미지원.

- [ ] **Step 3: Implement — 옵션/결과 타입 확장**

In `src/core/standup.ts`, replace the `AnalysisBuildOptions` and `AnalysisBuildResult` interfaces (lines 109–120):

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

export interface AnalysisBuildResult {
  analysis: UsageAnalysis;
  warnings: string[];
  /** --send 경로에서 생성된 주간 산문(있으면 renderAnalysis에 전달). */
  narrative?: string;
  /** dryRunLlm일 때 전송 예정 컨텍스트 미리보기(승인용). */
  preview?: { maskedContext: string; redactions: Redaction[] };
}
```

- [ ] **Step 4: Implement — buildAnalysis 본문**

In `src/core/standup.ts`, add the narrative imports near the top (alongside the existing `prepareSend, summarizeAccomplishments` import):

```typescript
import { prepareNarrativeSend, narrateUsage } from "./narrative.js";
```

Replace the body of `buildAnalysis` (current lines 123–133) with:

```typescript
export async function buildAnalysis(opts: AnalysisBuildOptions = {}): Promise<AnalysisBuildResult> {
  const warnings: string[] = [];
  const files = opts.sessionFiles ?? (await discoverSessionFiles(opts.projectsDir));
  const parsed = await readSessionFiles(files);
  for (const w of parsed.warnings) warnings.push(formatParseWarning(w));

  const analyzeOpts: AnalyzeOptions = {};
  if (opts.start) analyzeOpts.start = opts.start;
  if (opts.end) analyzeOpts.end = opts.end;
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
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run test/narrative.test.ts && npx tsc --noEmit`
Expected: PASS (통합 테스트 통과) + 타입 에러 없음.

- [ ] **Step 6: 픽스처 기반 세션>0 경로 테스트**

Create `test/fixtures/one-session.jsonl` — 한 줄 = assistant 이벤트 1개. 파서(`src/parse/claudeCode.ts`)는 `message.role==="assistant"` + `message.usage` + 유효 `timestamp`인 라인만 집계한다. projectPath는 파일의 부모 디렉터리명("fixtures")에서 유도된다. 아래 한 줄을 그대로 쓴다(끝에 개행 1개):

```
{"timestamp":"2026-06-12T05:00:00.000Z","sessionId":"fix1","message":{"role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":200,"cache_creation_input_tokens":30}}}
```

> 이 타임스탬프(UTC 05:00 = KST 14:00, 2026-06-12)면 세션 1건·활동일 1일로 집계되어 `analysis.totals.sessions === 1`이 된다. 비용/토큰은 단가표 버전에 따라 달라질 수 있으나 테스트는 `sessions > 0`과 `[기간]` 포함만 단언하므로 안정적이다.

Append to `test/narrative.test.ts`:

```typescript
describe("buildAnalysis 세션>0 경로", () => {
  const FIX = ["test/fixtures/one-session.jsonl"];

  it("드라이런이면 preview를 채우고 전송하지 않는다", async () => {
    const r = await buildAnalysis({ sessionFiles: FIX, useLlm: true, dryRunLlm: true });
    expect(r.analysis.totals.sessions).toBeGreaterThan(0);
    expect(r.preview?.maskedContext).toContain("[기간]");
    expect(r.narrative).toBeUndefined();
  });

  it("내레이터 주입이면 narrative를 채운다", async () => {
    const r = await buildAnalysis({ sessionFiles: FIX, useLlm: true, summarizer: echo });
    expect(r.narrative).toContain("서술:");
  });

  it("내레이터 실패면 결정적 문서로 폴백하고 warning을 남긴다", async () => {
    const boom: Summarizer = async () => {
      throw new SummarizerError("transport", "네트워크 실패");
    };
    const r = await buildAnalysis({ sessionFiles: FIX, useLlm: true, summarizer: boom });
    expect(r.narrative).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("LLM 서술 실패"))).toBe(true);
  });
});
```

> `echo`와 `SummarizerError`/`Summarizer`는 Task 2에서 이미 이 파일에 import/정의돼 있다.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run test/narrative.test.ts`
Expected: PASS. 만약 세션이 0건으로 나오면 픽스처 필드가 파서와 안 맞는 것 — `src/parse/claudeCode.ts`와 대조해 픽스처를 고친다.

- [ ] **Step 8: Commit (사용자가 실행)**

```bash
git add src/core/standup.ts test/narrative.test.ts test/fixtures/one-session.jsonl
git commit -m "feat: buildAnalysis LLM narrative branch with masked dry-run + fallback"
```

---

## Task 6: CLI `analyze --llm/--send`

**Files:**
- Modify: `src/cli.ts:120-134` (`cmdAnalyze`), `src/cli.ts:16` (import), `src/cli.ts:33-37` (usage 텍스트)

- [ ] **Step 1: Implement — import 추가**

In `src/cli.ts`, the narrator factory is already importable from anthropic. Confirm line 16 imports `createAnthropicSummarizer`; change it to also import the narrator:

```typescript
import { createAnthropicSummarizer, createAnthropicNarrator } from "./llm/anthropic.js";
```

- [ ] **Step 2: Implement — usage 텍스트**

In `src/cli.ts`, replace the `analyze` block in `usage()` (lines 33–37) with:

```typescript
      "  aimm analyze [옵션]                       개인 AI 사용 분석 문서 생성",
      "    --start YYYY-MM-DD  시작 KST 날짜(기본: 데이터 전체)",
      "    --end YYYY-MM-DD    끝 KST 날짜",
      "    --author <name>     문서 헤더",
      "    --sessions <file>   세션 파일 명시(반복 가능)",
      "    --llm               주간 사용을 LLM으로 서술. 기본은 드라이(보낼 수치·가림 건수만)",
      "    --send              실제로 LLM에 전송(ANTHROPIC_API_KEY 필요). --llm과 함께",
```

- [ ] **Step 3: Implement — cmdAnalyze 본문**

Replace `cmdAnalyze` (lines 120–134) with:

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

  if (preview) {
    process.stderr.write(
      `\n[dry-run] LLM에 전송될 내용 (${preview.redactions.length}개 비밀 가림):\n` +
        "─".repeat(50) +
        "\n" +
        preview.maskedContext +
        "\n" +
        "─".repeat(50) +
        "\n실제 전송하려면 --send 를 추가하세요(ANTHROPIC_API_KEY 필요).\n",
    );
  }
  if (warnings.length > 0) {
    process.stderr.write(`\n[warnings] ${warnings.length}건\n`);
  }
  return 0;
}
```

- [ ] **Step 4: Build + manual smoke (드라이런, 네트워크 없음)**

Run:
```bash
npx tsc --noEmit && npx tsc && node dist/cli.js analyze --sessions test/fixtures/one-session.jsonl --llm
```
Expected: stdout에 분석 문서(산문 없음), stderr에 `[dry-run] LLM에 전송될 내용 ... [기간] ...` 미리보기. 네트워크 호출 없음(--send 안 함).

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전체 PASS (67+ tests), 타입 에러 없음.

- [ ] **Step 6: Commit (사용자가 실행)**

```bash
git add src/cli.ts
git commit -m "feat: analyze --llm/--send weekly narrative with masked dry-run preview"
```

---

## 완료 기준 (전체)

- `npx vitest run` 전체 통과(기존 61 + 신규 ~10).
- `npx tsc --noEmit` 에러 없음.
- `aimm analyze --llm`(드라이런)이 전송 없이 마스킹된 사실 블록 미리보기를 보여준다.
- `aimm analyze --llm --send`가 문서 맨 위에 `## 한 주 돌아보기` 산문을 넣는다(키 있을 때).
- LLM/마스킹 실패가 결정적 분석 문서 출력을 막지 않는다(폴백 + warning).
- MCP `analyze` 도구는 변경 없이 결정적 문서만 반환한다.
- README의 `analyze` 사용법에 `--llm/--send` 반영(선택 — 별도 docs 커밋).
