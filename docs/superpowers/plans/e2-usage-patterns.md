# E2 — 사용 패턴 발견 엔진 (Usage Patterns) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 세션 데이터만으로 비자명 사용 패턴(케이던스·요일·추세·비용급증)을 결정적으로 발견해, craft 초상의 `## 발견` 섹션을 E1 인사이트와 합성해 풍부하게 한다.

**Architecture:** 새 순수 모듈 2개 — `patterns.ts`(E2 4축), `findings.ts`(E1+E2 합성·상한). 공유 날짜 헬퍼를 `day.ts`에 추가(DRY). `portrait.ts`는 `## 발견`이 `deriveFindings`를 호출하도록 한 줄 바꾼다. git·LLM·`--repo` 불요.

**Tech Stack:** TypeScript(strict: noUncheckedIndexedAccess + exactOptionalPropertyTypes, NodeNext ESM), vitest. 로컬 import는 `.js` 확장자.

> **⚠️ git 규칙:** 사용자가 git add/commit/push를 직접 한다. 각 Task "Commit"은 **사용자가 실행**. 에이전트는 멈추고 명령 제시. **`docs/superpowers/`(specs·plans)는 커밋 제외, 로컬 유지**(사용자 선호) — 아래 커밋 명령은 코드·릴리스만 스테이징한다.

> **결정론:** 문자열 정렬 동률은 코드유닛 비교. `localeCompare` 금지(situation.ts 선례).

설계 스펙: [docs/superpowers/specs/e2-usage-patterns-design.md](../specs/e2-usage-patterns-design.md)

---

## 파일 구조

| 파일 | 책임 | 신규/수정 |
|------|------|-----------|
| `src/core/day.ts` | `daysBetweenInclusive(start,end)` | 수정 |
| `src/core/insight.ts` | `Insight.kind` 유니온에 E2 4종 추가 | 수정 |
| `src/core/patterns.ts` | `derivePatterns(a)` 4축 | 신규 |
| `src/core/findings.ts` | `deriveFindings(a)` 합성·상한 5 | 신규 |
| `src/core/portrait.ts` | 발견이 `deriveFindings` 호출 + 노트 갱신 + 공유 헬퍼 사용 | 수정 |
| `test/{day,patterns,findings,portrait}.test.ts` | 단위·합성 | 신규/수정 |
| `CHANGELOG.md` · `docs/releases/…` · `package.json` | v0.3.0 | 수정/신규 |

---

## Task 1: `day.ts` 공유 일수 헬퍼

**Files:**
- Modify: `src/core/day.ts`
- Test: `test/day.test.ts` (append)

- [ ] **Step 1: Write the failing test** — `test/day.test.ts` 맨 아래에 추가(상단에 import 한 줄 추가):

```typescript
import { daysBetweenInclusive } from "../src/core/day.js";

describe("daysBetweenInclusive", () => {
  it("같은 날은 1일", () => {
    expect(daysBetweenInclusive("2026-06-10", "2026-06-10")).toBe(1);
  });
  it("inclusive 일수", () => {
    expect(daysBetweenInclusive("2026-06-01", "2026-06-15")).toBe(15);
    expect(daysBetweenInclusive("2026-05-11", "2026-06-15")).toBe(36);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run test/day.test.ts` → FAIL(daysBetweenInclusive 없음).

- [ ] **Step 3: Implement** — `src/core/day.ts` 맨 아래에 추가:

```typescript
/** 두 KST 날짜("YYYY-MM-DD") 사이 inclusive 일수. start<=end 가정. */
export function daysBetweenInclusive(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run test/day.test.ts` → PASS. `npx tsc --noEmit` 통과.

- [ ] **Step 5: Commit (사용자가 실행)**

```bash
git add src/core/day.ts test/day.test.ts
git commit -m "feat: daysBetweenInclusive date helper"
```

---

## Task 2: 패턴 엔진 `patterns.ts`

**Files:**
- Modify: `src/core/insight.ts` (kind 유니온 확장)
- Create: `src/core/patterns.ts`
- Test: `test/patterns.test.ts`

- [ ] **Step 1: insight.ts kind 확장** — `src/core/insight.ts`에서 다음 줄을 찾아:

```typescript
  kind: "cost-concentration" | "model-focus";
```

다음으로 교체:

```typescript
  kind: "cost-concentration" | "model-focus" | "session-cadence" | "weekday-rhythm" | "usage-trend" | "cost-spike";
```

- [ ] **Step 2: Write the failing test** — Create `test/patterns.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { derivePatterns } from "../src/core/patterns.js";
import type { UsageAnalysis } from "../src/core/analysis.js";

type Day = { date: string; sessions: number; displayTokens: number; costUsd: number };

function fixture(byDay: Day[], over: Partial<UsageAnalysis> = {}): UsageAnalysis {
  const sessions = byDay.reduce((s, d) => s + d.sessions, 0);
  const dates = byDay.map((d) => d.date).sort();
  return {
    range: { start: dates[0] ?? "", end: dates[dates.length - 1] ?? "" },
    totals: { sessions, tokens: { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 }, costUsd: byDay.reduce((s, d) => s + d.costUsd, 0), durationMs: sessions * 3600000 },
    byModel: [{ model: "claude-opus-4-8", displayTokens: 4, costUsd: 1, tokenShare: 1, costShare: 1 }],
    byDay,
    byHourKst: new Array<number>(24).fill(0),
    byProject: [{ project: "p", sessions, displayTokens: 4, costUsd: 1 }],
    busiestDay: byDay[0],
    hasUnknownModel: false,
    pricingVersion: "test",
    ...over,
  };
}

function d(date: string, sessions: number, costUsd: number): Day {
  return { date, sessions, displayTokens: 4, costUsd };
}

describe("derivePatterns", () => {
  it("세션 케이던스는 항상 나온다(평균 세션·활동일)", () => {
    const ins = derivePatterns(fixture([d("2026-06-10", 2, 10)]));
    const c = ins.find((i) => i.kind === "session-cadence");
    expect(c?.text).toContain("평균 세션");
    expect(c?.text).toContain("활동");
  });

  it("활동일이 기간 대비 적으면 '몰아서'", () => {
    // 2일 활동, 기간 36일 → ratio ~0.056
    const ins = derivePatterns(fixture([d("2026-05-11", 1, 5), d("2026-06-15", 1, 5)]));
    expect(ins.find((i) => i.kind === "session-cadence")?.text).toContain("몰아서");
  });

  it("주말 비중 낮으면 '주로 평일' (활동일>=3)", () => {
    // 2026-06-10(수)·11(목)·12(금) 전부 평일
    const ins = derivePatterns(fixture([d("2026-06-10", 2, 5), d("2026-06-11", 2, 5), d("2026-06-12", 2, 5)]));
    expect(ins.find((i) => i.kind === "weekday-rhythm")?.text).toContain("주로 평일");
  });

  it("활동일 2개면 요일 리듬 생략", () => {
    const ins = derivePatterns(fixture([d("2026-06-10", 2, 5), d("2026-06-11", 2, 5)]));
    expect(ins.find((i) => i.kind === "weekday-rhythm")).toBeUndefined();
  });

  it("후반부 세션이 많으면 '더 자주' (기간>=6)", () => {
    // 기간 2026-06-01~06-10(10일), 전반부 1세션, 후반부 6세션
    const ins = derivePatterns(fixture([d("2026-06-02", 1, 5), d("2026-06-09", 6, 5)]));
    expect(ins.find((i) => i.kind === "usage-trend")?.text).toContain("더 자주");
  });

  it("비용이 한 날만 크면 '튄 날' (활동일>=4)", () => {
    const ins = derivePatterns(fixture([d("2026-06-01", 1, 10), d("2026-06-02", 1, 10), d("2026-06-03", 1, 10), d("2026-06-04", 1, 100)]));
    const cs = ins.find((i) => i.kind === "cost-spike");
    expect(cs?.text).toContain("튄 날");
    expect(cs?.text).toContain("2026-06-04");
  });

  it("활동일 3개면 비용 급증 생략", () => {
    const ins = derivePatterns(fixture([d("2026-06-01", 1, 10), d("2026-06-02", 1, 10), d("2026-06-03", 1, 100)]));
    expect(ins.find((i) => i.kind === "cost-spike")).toBeUndefined();
  });

  it("세션 0이면 빈 배열", () => {
    const empty = fixture([], { totals: { sessions: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 0 } });
    expect(derivePatterns(empty)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails** — `npx vitest run test/patterns.test.ts` → FAIL(모듈 없음).

- [ ] **Step 4: Implement** — Create `src/core/patterns.ts`:

```typescript
/**
 * 사용 패턴 발견 엔진(E2) — 세션 데이터만으로 "어떻게 쓰는지" 비자명 패턴.
 *
 * 순수·결정적(LLM·git 불요). 작은 n에서 거짓 패턴을 피하려 가드로 침묵한다.
 * 모든 관찰은 *서술*이지 통계적 단정·인과가 아니다.
 */

import type { UsageAnalysis } from "./analysis.js";
import type { Insight } from "./insight.js";
import { formatDuration } from "./render.js";
import { daysBetweenInclusive } from "./day.js";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

/** KST 날짜 문자열의 요일(0=일 … 6=토). */
function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** 기간 일수(inclusive). range 비면 활동일 수. */
function periodDays(a: UsageAnalysis): number {
  if (a.range.start && a.range.end) return daysBetweenInclusive(a.range.start, a.range.end);
  return a.byDay.length;
}

/** KST 날짜에 n일 더한 날짜 문자열(UTC 기준 계산). */
function isoDatePlusDays(start: string, n: number): string {
  const ms = Date.parse(`${start}T00:00:00Z`) + n * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** 중앙값(짝수면 두 중앙 평균). 빈 배열 0. */
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** 세션 데이터 기반 사용 패턴 발견. 가드 미달 축은 생략. */
export function derivePatterns(a: UsageAnalysis): Insight[] {
  const out: Insight[] = [];
  if (a.totals.sessions === 0) return out;

  const days = periodDays(a);

  // 1. 세션 케이던스 (항상)
  const avg = formatDuration(a.totals.durationMs / a.totals.sessions);
  const ratio = days > 0 ? a.byDay.length / days : 0;
  const qualifier = ratio < 0.3 ? "며칠에 몰아서" : ratio > 0.6 ? "꾸준히" : "";
  out.push({
    kind: "session-cadence",
    text: qualifier
      ? `평균 세션 약 ${avg}, 기간 ${days}일 중 ${a.byDay.length}일 활동 — ${qualifier} 작업하는 편입니다.`
      : `평균 세션 약 ${avg}, 기간 ${days}일 중 ${a.byDay.length}일 활동입니다.`,
  });

  // 2. 요일 리듬 (활동일 >= 3)
  if (a.byDay.length >= 3) {
    const totalS = a.byDay.reduce((s, x) => s + x.sessions, 0);
    const weekendS = a.byDay.reduce((s, x) => {
      const wd = weekdayOf(x.date);
      return wd === 0 || wd === 6 ? s + x.sessions : s;
    }, 0);
    const share = totalS > 0 ? weekendS / totalS : 0;
    if (share <= 0.1) {
      out.push({ kind: "weekday-rhythm", text: `주로 평일에 작업합니다 (주말 비중 ${pct(share)}).` });
    } else if (share >= 0.4) {
      out.push({ kind: "weekday-rhythm", text: `주말에도 활발합니다 (주말 비중 ${pct(share)}).` });
    } else {
      const byWd = new Array<number>(7).fill(0);
      for (const x of a.byDay) {
        const wd = weekdayOf(x.date);
        byWd[wd] = (byWd[wd] ?? 0) + x.sessions;
      }
      let arg = 0;
      for (let i = 1; i < 7; i++) if ((byWd[i] ?? 0) > (byWd[arg] ?? 0)) arg = i;
      out.push({ kind: "weekday-rhythm", text: `가장 활발한 요일은 ${WEEKDAY[arg]}요일입니다.` });
    }
  }

  // 3. 사용 추세 (기간 >= 6 AND 전·후반 둘 다 세션>0)
  if (days >= 6 && a.range.start) {
    const mid = isoDatePlusDays(a.range.start, Math.floor(days / 2));
    let first = 0;
    let second = 0;
    for (const x of a.byDay) {
      if (x.date < mid) first += x.sessions;
      else second += x.sessions;
    }
    if (first > 0 && second > 0) {
      const r = second / first;
      if (r >= 1.3) {
        out.push({ kind: "usage-trend", text: `후반부 사용이 전반부의 약 ${r.toFixed(1)}배 — 최근 더 자주 씁니다.` });
      } else if (r <= 0.77) {
        out.push({ kind: "usage-trend", text: `사용이 줄고 있습니다 (후반부가 전반부의 약 ${r.toFixed(1)}배).` });
      } else {
        out.push({ kind: "usage-trend", text: `사용이 대체로 꾸준합니다.` });
      }
    }
  }

  // 4. 비용 급증일 (활동일 >= 4 AND 중앙값 > 0)
  if (a.byDay.length >= 4) {
    const med = median(a.byDay.map((x) => x.costUsd));
    if (med > 0) {
      const spikes = a.byDay.filter((x) => x.costUsd > 2 * med).sort((x, y) => y.costUsd - x.costUsd);
      if (spikes.length > 0) {
        const top = spikes.slice(0, 2);
        const maxR = (top[0]?.costUsd ?? 0) / med;
        out.push({
          kind: "cost-spike",
          text: `비용이 튄 날: ${top.map((x) => x.date).join(", ")} (평소 중앙값 $${med.toFixed(2)}의 최대 약 ${maxR.toFixed(1)}배).`,
        });
      }
    }
  }

  return out;
}
```

- [ ] **Step 5: Run test to verify it passes** — `npx vitest run test/patterns.test.ts` → PASS(8 tests). `npx tsc --noEmit` 통과.

- [ ] **Step 6: Commit (사용자가 실행)**

```bash
git add src/core/insight.ts src/core/patterns.ts test/patterns.test.ts
git commit -m "feat: usage-pattern engine (cadence, weekday, trend, cost-spike)"
```

---

## Task 3: 합성 `findings.ts`

**Files:**
- Create: `src/core/findings.ts`
- Test: `test/findings.test.ts`

- [ ] **Step 1: Write the failing test** — Create `test/findings.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { deriveFindings } from "../src/core/findings.js";
import type { UsageAnalysis } from "../src/core/analysis.js";

type Day = { date: string; sessions: number; displayTokens: number; costUsd: number };

function fixture(byDay: Day[]): UsageAnalysis {
  const sessions = byDay.reduce((s, d) => s + d.sessions, 0);
  const dates = byDay.map((d) => d.date).sort();
  const busiest = [...byDay].sort((a, b) => b.costUsd - a.costUsd)[0];
  return {
    range: { start: dates[0] ?? "", end: dates[dates.length - 1] ?? "" },
    totals: { sessions, tokens: { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 }, costUsd: byDay.reduce((s, d) => s + d.costUsd, 0), durationMs: sessions * 3600000 },
    byModel: [{ model: "claude-opus-4-8", displayTokens: 4, costUsd: 1, tokenShare: 1, costShare: 1 }],
    byDay,
    byHourKst: new Array<number>(24).fill(0),
    byProject: [{ project: "p", sessions, displayTokens: 4, costUsd: 1 }],
    busiestDay: busiest,
    hasUnknownModel: false,
    pricingVersion: "test",
  };
}

function d(date: string, sessions: number, costUsd: number): Day {
  return { date, sessions, displayTokens: 4, costUsd };
}

describe("deriveFindings", () => {
  it("cost-spike가 있으면 cost-concentration을 뺀다", () => {
    // 4일+한 날 급증 → cost-spike 발생, cost-concentration도 발생 조건이지만 제거돼야
    const ins = deriveFindings(fixture([d("2026-06-01", 1, 10), d("2026-06-02", 1, 10), d("2026-06-03", 1, 10), d("2026-06-04", 1, 100)]));
    expect(ins.some((i) => i.kind === "cost-spike")).toBe(true);
    expect(ins.some((i) => i.kind === "cost-concentration")).toBe(false);
  });

  it("최대 5개로 자른다", () => {
    expect(deriveFindings(fixture([d("2026-06-01", 1, 10), d("2026-06-02", 1, 10), d("2026-06-03", 1, 10), d("2026-06-04", 1, 100)])).length).toBeLessThanOrEqual(5);
  });

  it("패턴이 E1 인사이트보다 앞에 온다", () => {
    const ins = deriveFindings(fixture([d("2026-06-10", 2, 10)]));
    // 첫 항목은 패턴(session-cadence)
    expect(ins[0]?.kind).toBe("session-cadence");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run test/findings.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: Implement** — Create `src/core/findings.ts`:

```typescript
/**
 * 발견 합성 — E1 미니 인사이트 + E2 사용 패턴을 초상 `## 발견`용으로 합친다.
 * 순서: 패턴 먼저(더 흥미로운 "어떻게 쓰는지"), 그다음 E1. 비용 이중표기 정리. 상한 5.
 */

import type { UsageAnalysis } from "./analysis.js";
import { deriveInsights, type Insight } from "./insight.js";
import { derivePatterns } from "./patterns.js";

const MAX_FINDINGS = 5;

/** 초상 `## 발견`에 들어갈 최종 발견 목록. */
export function deriveFindings(a: UsageAnalysis): Insight[] {
  const pattern = derivePatterns(a);
  let mini = deriveInsights(a);
  // cost-spike가 있으면 E1 cost-concentration 제거(비용 이중표기 방지).
  if (pattern.some((p) => p.kind === "cost-spike")) {
    mini = mini.filter((m) => m.kind !== "cost-concentration");
  }
  return [...pattern, ...mini].slice(0, MAX_FINDINGS);
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run test/findings.test.ts` → PASS(3 tests). `npx tsc --noEmit` 통과.

- [ ] **Step 5: Commit (사용자가 실행)**

```bash
git add src/core/findings.ts test/findings.test.ts
git commit -m "feat: deriveFindings — compose E1 insights + E2 patterns (cap 5)"
```

---

## Task 4: 초상 배선 `portrait.ts`

**Files:**
- Modify: `src/core/portrait.ts`
- Test: `test/portrait.test.ts` (append)

- [ ] **Step 1: import 교체** — `src/core/portrait.ts`에서:

```typescript
import { shortModelName } from "./render.js";
import { deriveInsights } from "./insight.js";
```

다음으로 교체(deriveInsights→deriveFindings, daysBetweenInclusive 추가):

```typescript
import { shortModelName } from "./render.js";
import { deriveFindings } from "./findings.js";
import { daysBetweenInclusive } from "./day.js";
```

- [ ] **Step 2: periodDays 공유 헬퍼 사용** — `portrait.ts`의 `periodDays` 본문을 바꾼다. 다음을 찾아:

```typescript
function periodDays(a: UsageAnalysis): number {
  const { start, end } = a.range;
  if (!start || !end) return a.byDay.length;
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
}
```

다음으로 교체:

```typescript
function periodDays(a: UsageAnalysis): number {
  const { start, end } = a.range;
  if (!start || !end) return a.byDay.length;
  return daysBetweenInclusive(start, end);
}
```

- [ ] **Step 3: 발견 섹션 교체** — `portrait.ts`에서 다음 두 줄을 찾아:

```typescript
  lines.push("## 발견");
  for (const ins of deriveInsights(a)) lines.push(`- ${ins.text}`);
  lines.push("> 결정적 관찰. 상관이지 인과·증명이 아니며, 더 깊은 인사이트는 후속(E2).");
```

다음으로 교체:

```typescript
  lines.push("## 발견");
  for (const ins of deriveFindings(a)) lines.push(`- ${ins.text}`);
  lines.push(`> 결정적 관찰(활동일 ${a.byDay.length}일 기준). 추세·상관 서술이지 통계적 단정·인과가 아닙니다.`);
```

- [ ] **Step 4: 테스트 추가** — `test/portrait.test.ts`의 `describe("renderPortrait", () => {` 블록 안에 추가:

```typescript
  it("발견에 사용 패턴(케이던스)이 등장한다", () => {
    const out = renderPortrait(fixture());
    expect(out).toContain("평균 세션");
    expect(out).toContain("활동일");
  });
```

- [ ] **Step 5: Run + typecheck** — `npx vitest run && npx tsc --noEmit` → 전체 PASS(기존 + 신규), 타입 에러 없음.

- [ ] **Step 6: Build + smoke (이 레포 실데이터)** — `npm run build && node dist/cli.js portrait --author 전주성 2>/dev/null | sed -n '/## 발견/,/^##/p'`
  Expected: `## 발견`에 "평균 세션 …"(케이던스), 요일/추세/비용급증 중 조건 충족 항목, 끝에 "결정적 관찰(활동일 N일 기준)" 노트.

- [ ] **Step 7: Commit (사용자가 실행)**

```bash
git add src/core/portrait.ts test/portrait.test.ts
git commit -m "feat: portrait 발견 uses composed findings (E1+E2)"
```

---

## Task 5: v0.3.0 릴리스 (규칙 적용)

**Files:**
- Create: `docs/releases/v0.3.0-e2-usage-patterns.md`
- Modify: `CHANGELOG.md`, `package.json`

- [ ] **Step 1: 증거 수집**

Run (after 샘플 — 발견 섹션):
```bash
node dist/cli.js portrait --author 전주성 2>/dev/null | sed -n '/## 발견/,/^##/p'
```
Run (AI 메타 — AI-Metrics-MCP 줄만, fail-closed):
```bash
node dist/cli.js analyze 2>&1 | sed -n '/## 프로젝트별/,/^---/p' | grep "AI-Metrics-MCP"
```
Run (검증):
```bash
npx vitest run 2>&1 | grep -E "Test Files|Tests " && npx tsc --noEmit && echo "tsc OK"
```

- [ ] **Step 2: 릴리스 노트 작성** — `docs/releases/v0.3.0-e2-usage-patterns.md` (Step 1 실측 반영):

````markdown
# v0.3.0 — E2 사용 패턴 발견 엔진

릴리스: 2026-06-15 (KST)

## 한 줄 요약
초상의 `## 발견`이 세션 데이터만으로 "어떻게 쓰는지" 패턴(케이던스·요일·추세·비용급증)을 보여준다.

## 산출물 before/after
**before** — `## 발견`은 E1 미니 인사이트 2개(비용 집중·주력 모델)뿐.
**after** — 사용 패턴 4축이 합성되어(상한 5), 예:
```
(Step 1에서 캡처한 ## 발견 섹션을 붙여넣기)
```
- 전부 결정적(git·LLM 불요), 작은 n 가드로 거짓 패턴 침묵, "활동일 N일 기준" 정직성 라벨.

## 검증
- 테스트: 109 → (Step 1 수치) 그린. 신규 `patterns`·`findings`·`day` + portrait 확장.
- `npx tsc --noEmit` / `npm run build` 클린.

## AI 사용 메타 — 도그푸딩
- AI-Metrics-MCP: (Step 1 캡처) 세션 N · 추정 $N.
> ⚠️ 기간 근사·전체 사용·시간은 세션 지속 추정. 양이지 실력 아님.

## 런타임 벤치
N/A: 핫패스 아님.

## 본인 메모
_(선택 — 비워둠)_
````

- [ ] **Step 3: CHANGELOG 갱신** — `CHANGELOG.md`의 `## [0.2.0]` 줄 **앞**에 삽입:

````markdown
## [0.3.0] — 2026-06-15 · E2 사용 패턴 발견

초상 `## 발견`에 세션 기반 사용 패턴(케이던스·요일 리듬·사용 추세·비용 급증일) 추가.
결정적·작은 n 가드. git 상관(생산성)은 후속 단계로.

→ 상세: [docs/releases/v0.3.0-e2-usage-patterns.md](docs/releases/v0.3.0-e2-usage-patterns.md)

````

- [ ] **Step 4: 버전 bump** — `package.json` `"version": "0.2.0"` → `"version": "0.3.0"`.

- [ ] **Step 5: 검증**

```bash
test -f docs/releases/v0.3.0-e2-usage-patterns.md && echo "EXISTS"
grep -Eq "turbo-pra|checkin-be|seoultel|supertonic|kiosk|bbibbi|arreo|mcmp|AIWS|std-new" docs/releases/v0.3.0-e2-usage-patterns.md && echo "❌ 누출" || echo "✅ 누출 없음"
grep -q '"version": "0.3.0"' package.json && echo "✅ 0.3.0"
```
Expected: `EXISTS` · `✅ 누출 없음` · `✅ 0.3.0`.

- [ ] **Step 6: Commit (사용자가 실행)**

```bash
git add docs/releases/v0.3.0-e2-usage-patterns.md CHANGELOG.md package.json
git commit -m "docs: v0.3.0 release note (E2 usage patterns) + version bump"
```

---

## 완료 기준 (전체)

- 초상 `## 발견`이 세션 기반 패턴(케이던스 항상 + 조건 충족 축)을 E1 인사이트와 합성(상한 5)해 보여준다.
- 가드 미달 데이터에서 거짓 패턴 없이 침묵. cost-spike 시 cost-concentration 미표기.
- `--repo`/커밋/LLM 없이 동작. 전체 테스트 그린 · `tsc --noEmit` 클린.
- `CHANGELOG.md` v0.3.0 + 상세 노트, `package.json` 0.3.0.
- git 생산성 상관·analyze 통합·LLM은 범위 밖(후속).
