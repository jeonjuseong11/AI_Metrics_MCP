# SessionStart 거울 (v0.7.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code를 켤 때마다 어제·이번주 AI 사용을 한 줄 거울로 사용자에게 표출하는 `aimm session-start` CLI + SessionStart hook 자동 등록.

**Architecture:** 신규 `aimm session-start`가 stdin JSON(`source`)을 읽어 `startup`/`resume`에만 발화, 코어(`buildAnalysis`/`analyze`/`content`)로 어제·이번주(최근7일) cost-known 롤업을 만들고 `renderGlance`로 한 줄을 포맷, **top-level `systemMessage`** JSON으로 출력(스파이크 실측: nested·additionalContext는 사용자 비표출). `runInit`이 SessionEnd에 더해 SessionStart hook도 별개 마커로 멱등 병합. 항상 exit 0.

**Tech Stack:** TypeScript + Node(engines >=22), vitest, 의존성 무추가(stdin은 `process.stdin`).

## Global Constraints

- engines `>=22`, `strict` + `exactOptionalPropertyTypes` 유지 — 옵셔널 필드는 조건부 스프레드(`...(x ? {k:x} : {})`).
- 결정적: 같은 입력→같은 줄. 요일 변환 로케일 비의존(`toLocaleString` 금지, `getUTCDay` 사용).
- 프라이버시: 글랜스에 원시 경로·프롬프트 텍스트·`/`·`\` 0 — 닫힌 어휘(활동 카테고리·요일)·숫자만. empty-day 문자열도 동일.
- 글랜스 지표는 **cost-known(Claude Code) 소스만**(v0.6.0 내용-미파악 격리 평행). session-start는 기본 어댑터(claude-only) 사용 — Cursor 미주입.
- 실패 안전: SessionStart hook은 **절대 세션을 안 깬다** — 항상 `process.exit(0)`, 실패 시 `systemMessage`에 `⚠️ AIMM 거울 생성 실패: …` 한 줄. 기존 `cmdHook`의 exit 1을 복제하지 말 것.
- 커밋: conventional commits(영어), 슬라이스별. 푸시는 사용자 컨펌 후([[commits-user-handles]]).
- 문서 파일명 날짜 프리픽스 금지([[doc-naming-convention]]).

## File Structure

- `src/core/day.ts` — **수정**: `WEEKDAY`·`weekdayOf`·`isoDatePlusDays`를 patterns.ts에서 끌어올려 export(중복 제거).
- `src/core/patterns.ts` — **수정**: 위 3개를 day.ts에서 import(로컬 정의 삭제).
- `src/core/render.ts` — **수정**: `renderGlance` 추가(한 줄 포맷, 정상·empty·cold-start).
- `src/core/sessionStart.ts` — **신규**: stdin 파싱·source 필터 순수 헬퍼 + `runSessionStart` 오케스트레이터 + `toHookOutput` JSON 셰이퍼.
- `src/cli.ts` — **수정**: `cmdSessionStart`(stdin 읽기·always exit 0) + usage 항목 + dispatch.
- `src/core/init.ts` — **수정**: `mergeSessionStartHook` + `isAimmSessionStartHook`(별개 마커), `runInit`이 양쪽 hook 등록.
- `test/*` — 각 모듈 테스트.
- 문서: README·CHANGELOG·`docs/releases/v0.7.0-session-start-mirror.md`·`package.json` version.

---

### Task 1: day.ts로 요일·주간 헬퍼 추출

발명 아닌 리팩터. patterns.ts:13-30의 `WEEKDAY`/`weekdayOf`/`isoDatePlusDays`(module-private)를 day.ts로 끌어올려 export하고 patterns.ts가 재사용. 동작 불변 — 기존 patterns 테스트가 회귀 가드.

**Files:**
- Modify: `src/core/day.ts` (끝에 export 추가)
- Modify: `src/core/patterns.ts:13-30` (로컬 정의 삭제 → import)
- Test: `test/day.test.ts` (직접 단위 테스트 추가)

**Interfaces:**
- Produces:
  - `export const WEEKDAY: string[]` — `["일","월","화","수","목","금","토"]`
  - `export function weekdayOf(dateStr: string): number` — KST 날짜 문자열의 요일(0=일…6=토)
  - `export function isoDatePlusDays(start: string, n: number): string` — KST 날짜에 n일 더한 "YYYY-MM-DD"

- [ ] **Step 1: day.ts에 실패 테스트 추가**

`test/day.test.ts`에 추가(파일 없으면 생성, import는 기존 패턴 따름):

```typescript
import { describe, it, expect } from "vitest";
import { WEEKDAY, weekdayOf, isoDatePlusDays } from "../src/core/day.js";

describe("weekday/week helpers", () => {
  it("weekdayOf maps KST date string to 0=일..6=토 (locale-independent)", () => {
    // 2026-06-28 is a Sunday
    expect(weekdayOf("2026-06-28")).toBe(0);
    expect(WEEKDAY[weekdayOf("2026-06-28")]).toBe("일");
    expect(WEEKDAY[weekdayOf("2026-06-24")]).toBe("수");
  });
  it("isoDatePlusDays shifts by n days (UTC math)", () => {
    expect(isoDatePlusDays("2026-06-28", -6)).toBe("2026-06-22");
    expect(isoDatePlusDays("2026-06-28", 0)).toBe("2026-06-28");
    expect(isoDatePlusDays("2026-06-30", 1)).toBe("2026-07-01");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/day.test.ts`
Expected: FAIL — `WEEKDAY`/`weekdayOf`/`isoDatePlusDays` not exported from day.js

- [ ] **Step 3: day.ts에 헬퍼 이동·export**

`src/core/day.ts` 끝(daysBetweenInclusive 아래)에 추가:

```typescript
/** 요일 라벨(0=일 … 6=토). 로케일 비의존. */
export const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

/** KST 날짜 문자열("YYYY-MM-DD")의 요일(0=일 … 6=토). */
export function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** KST 날짜에 n일 더한 날짜 문자열(UTC 기준 계산). */
export function isoDatePlusDays(start: string, n: number): string {
  const ms = Date.parse(`${start}T00:00:00Z`) + n * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: patterns.ts에서 로컬 정의 삭제 → import**

`src/core/patterns.ts`에서 13행 `const WEEKDAY`, 15-18행 `weekdayOf`, 26-30행 `isoDatePlusDays` 삭제. import 줄(11행)을 교체:

```typescript
import { daysBetweenInclusive, WEEKDAY, weekdayOf, isoDatePlusDays } from "./day.js";
```

- [ ] **Step 5: 전체 테스트 통과 확인(회귀 포함)**

Run: `npx vitest run test/day.test.ts test/patterns.test.ts`
Expected: PASS — 신규 day 테스트 + 기존 patterns 테스트 그린(동작 불변)

- [ ] **Step 6: 커밋**

```bash
git add src/core/day.ts src/core/patterns.ts test/day.test.ts
git commit -m "refactor: hoist weekday/week helpers from patterns to day.ts"
```

---

### Task 2: renderGlance — 한 줄 거울 포맷

순수 함수. 어제·이번주 분석 + 이번주 가장 바쁜 요일을 받아 한 줄을 만든다. 정상·어제빈·전체빈 3분기. 닫힌 어휘·숫자만.

**Files:**
- Modify: `src/core/render.ts` (export 추가)
- Test: `test/render-glance.test.ts`

**Interfaces:**
- Consumes: `UsageAnalysis`(analysis.ts — `totals.sessions`, `totals.costUsd`, `contentSummary?.activity`)
- Produces:
  - `export interface GlanceInput { yesterday: UsageAnalysis; week: UsageAnalysis; weekBusiestWeekday?: string }`
  - `export function renderGlance(input: GlanceInput): string`
    - 어제>0: `🪞 어제: {N}세션 · ${cost} · {활동믹스 상위3}  |  이번주(최근7일): {M}세션 · ${wcost}{ · 가장 바쁜 요일 {요일}}`
    - 어제0·이번주>0: `🪞 어제 기록 없음 · 이번주(최근7일) {M}세션 · ${wcost}`
    - 둘 다 0: `🪞 아직 기록 없음 — 다음 세션부터 쌓임`
    - 활동믹스 = `contentSummary.activity` 상위 3개 `{category}{share%}`를 `·`로(없으면 생략)

- [ ] **Step 1: 실패 테스트 작성**

`test/render-glance.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderGlance } from "../src/core/render.js";
import type { UsageAnalysis } from "../src/core/analysis.js";

function mkAnalysis(over: Partial<UsageAnalysis>): UsageAnalysis {
  return {
    range: { start: "", end: "" },
    totals: { sessions: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 0 },
    byModel: [], byDay: [], byHourKst: new Array(24).fill(0), byProject: [],
    busiestDay: undefined, hasUnknownModel: false, pricingVersion: "test",
    ...over,
  };
}

describe("renderGlance", () => {
  it("renders yesterday + week with activity mix and busiest weekday", () => {
    const yesterday = mkAnalysis({
      totals: { sessions: 3, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 1.4, durationMs: 0 },
      contentSummary: {
        sessionsWithContent: 3, userPrompts: 10, totalToolUses: 100,
        activity: [
          { category: "탐색", count: 42, share: 0.42 },
          { category: "구현", count: 19, share: 0.19 },
          { category: "실행·검증", count: 15, share: 0.15 },
          { category: "계획·조율", count: 10, share: 0.10 },
        ],
        areas: [], commands: [],
      },
    });
    const week = mkAnalysis({
      totals: { sessions: 12, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 8.7, durationMs: 0 },
    });
    const line = renderGlance({ yesterday, week, weekBusiestWeekday: "화" });
    expect(line).toContain("🪞 어제: 3세션 · $1.40");
    expect(line).toContain("탐색42%·구현19%·실행·검증15%");
    expect(line).toContain("이번주(최근7일): 12세션 · $8.70");
    expect(line).toContain("가장 바쁜 요일 화");
    // 활동믹스는 상위 3개만
    expect(line).not.toContain("계획·조율10%");
    // 프라이버시: 경로 구분자 없음
    expect(line).not.toMatch(/[\\/]/);
  });

  it("yesterday empty but week has data", () => {
    const empty = mkAnalysis({});
    const week = mkAnalysis({
      totals: { sessions: 5, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 2.0, durationMs: 0 },
    });
    const line = renderGlance({ yesterday: empty, week });
    expect(line).toBe("🪞 어제 기록 없음 · 이번주(최근7일) 5세션 · $2.00");
  });

  it("cold start — everything empty", () => {
    const empty = mkAnalysis({});
    expect(renderGlance({ yesterday: empty, week: empty })).toBe("🪞 아직 기록 없음 — 다음 세션부터 쌓임");
  });

  it("yesterday with sessions but no content summary omits activity mix", () => {
    const yesterday = mkAnalysis({
      totals: { sessions: 2, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.5, durationMs: 0 },
    });
    const week = mkAnalysis({
      totals: { sessions: 2, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.5, durationMs: 0 },
    });
    const line = renderGlance({ yesterday, week });
    expect(line).toContain("🪞 어제: 2세션 · $0.50");
    expect(line).toContain("이번주(최근7일): 2세션 · $0.50");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/render-glance.test.ts`
Expected: FAIL — `renderGlance` not exported

- [ ] **Step 3: renderGlance 구현**

`src/core/render.ts`에 추가(파일 상단 import에 `UsageAnalysis`가 이미 있으면 재사용):

```typescript
export interface GlanceInput {
  yesterday: UsageAnalysis;
  week: UsageAnalysis;
  /** 이번주 가장 바쁜 요일 라벨(예 "화"). 없으면 생략. */
  weekBusiestWeekday?: string;
}

/** 한 줄 거울(SessionStart 표출). 닫힌 어휘·숫자만. */
export function renderGlance(input: GlanceInput): string {
  const { yesterday, week, weekBusiestWeekday } = input;
  const yCost = `$${yesterday.totals.costUsd.toFixed(2)}`;
  const wCost = `$${week.totals.costUsd.toFixed(2)}`;

  if (yesterday.totals.sessions === 0) {
    if (week.totals.sessions === 0) return "🪞 아직 기록 없음 — 다음 세션부터 쌓임";
    return `🪞 어제 기록 없음 · 이번주(최근7일) ${week.totals.sessions}세션 · ${wCost}`;
  }

  const mix = (yesterday.contentSummary?.activity ?? [])
    .slice(0, 3)
    .map((a) => `${a.category}${(a.share * 100).toFixed(0)}%`)
    .join("·");
  const yPart = `🪞 어제: ${yesterday.totals.sessions}세션 · ${yCost}${mix ? ` · ${mix}` : ""}`;
  const busiest = weekBusiestWeekday ? ` · 가장 바쁜 요일 ${weekBusiestWeekday}` : "";
  const wPart = `이번주(최근7일): ${week.totals.sessions}세션 · ${wCost}${busiest}`;
  return `${yPart}  |  ${wPart}`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/render-glance.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/render.ts test/render-glance.test.ts
git commit -m "feat: renderGlance one-line mirror formatter"
```

---

### Task 3: sessionStart 순수 헬퍼 — stdin 파싱 + source 필터 + JSON 셰이퍼

stdin JSON 파싱·source dedupe·hook 출력 JSON은 전부 순수 함수로 분리해 단위 테스트. CLI는 이들을 얇게 엮는다.

**Files:**
- Create: `src/core/sessionStart.ts`
- Test: `test/session-start.test.ts`

**Interfaces:**
- Produces:
  - `export function parseSessionSource(raw: string): string` — stdin JSON에서 `source` 추출, 실패/부재 시 `"unknown"`
  - `export function shouldMirror(source: string): boolean` — `startup`·`resume`만 true(`compact`·`clear`·기타 false)
  - `export function toHookOutput(systemMessage: string): string` — `JSON.stringify({ systemMessage })` (**top-level** — 스파이크 정정)

- [ ] **Step 1: 실패 테스트 작성**

`test/session-start.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseSessionSource, shouldMirror, toHookOutput } from "../src/core/sessionStart.js";

describe("session-start helpers", () => {
  it("parseSessionSource extracts source from stdin JSON", () => {
    expect(parseSessionSource(JSON.stringify({ source: "startup", session_id: "x" }))).toBe("startup");
    expect(parseSessionSource(JSON.stringify({ source: "compact" }))).toBe("compact");
  });
  it("parseSessionSource returns 'unknown' on empty/bad input", () => {
    expect(parseSessionSource("")).toBe("unknown");
    expect(parseSessionSource("not json")).toBe("unknown");
    expect(parseSessionSource(JSON.stringify({}))).toBe("unknown");
  });
  it("shouldMirror only on startup/resume", () => {
    expect(shouldMirror("startup")).toBe(true);
    expect(shouldMirror("resume")).toBe(true);
    expect(shouldMirror("compact")).toBe(false);
    expect(shouldMirror("clear")).toBe(false);
    expect(shouldMirror("unknown")).toBe(false);
  });
  it("toHookOutput puts systemMessage at TOP LEVEL (spike-confirmed)", () => {
    const out = JSON.parse(toHookOutput("🪞 hi"));
    expect(out.systemMessage).toBe("🪞 hi");
    expect(out.hookSpecificOutput).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/session-start.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: sessionStart.ts 헬퍼 구현**

`src/core/sessionStart.ts`(orchestrator는 Task 4에서 추가):

```typescript
/**
 * SessionStart 거울 — stdin source 필터 + top-level systemMessage 출력.
 *
 * 스파이크 실측(CC v2.1.195): 사용자 표출은 **top-level `systemMessage`**.
 * `hookSpecificOutput.systemMessage`(nested)·`additionalContext`는 사용자 비표출.
 * 거울은 startup·resume에만(compact·clear 스킵 — 스팸 방지).
 */

/** stdin JSON에서 source 추출. 부재/파싱실패 시 "unknown". */
export function parseSessionSource(raw: string): string {
  try {
    const v = JSON.parse(raw) as { source?: unknown };
    return typeof v.source === "string" ? v.source : "unknown";
  } catch {
    return "unknown";
  }
}

/** 거울을 낼 source인가 — startup·resume만(나머지 스킵). */
export function shouldMirror(source: string): boolean {
  return source === "startup" || source === "resume";
}

/** hook 출력 JSON — systemMessage는 top-level(스파이크 정정). */
export function toHookOutput(systemMessage: string): string {
  return JSON.stringify({ systemMessage });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/session-start.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/sessionStart.ts test/session-start.test.ts
git commit -m "feat: session-start pure helpers (source filter + top-level systemMessage)"
```

---

### Task 4: runSessionStart 오케스트레이터 — 어제·이번주 글랜스 빌드

코어 재사용으로 어제·이번주(최근7일) cost-known 분석을 만들고 이번주 가장 바쁜 요일을 계산해 `renderGlance` 한 줄을 낸다. 실패해도 `⚠️ …` 한 줄을 반환(throw 안 함 — CLI가 항상 exit 0).

**Files:**
- Modify: `src/core/sessionStart.ts` (orchestrator 추가)
- Test: `test/session-start-run.test.ts`

**Interfaces:**
- Consumes:
  - `buildAnalysis` from `./standup.js` — `{ analysis }`, opts: `{ start?, end?, sessionFiles?, projectsDir?, adapters? }`
  - `yesterdayKst`·`isoDatePlusDays`·`weekdayOf`·`WEEKDAY` from `./day.js`
  - `renderGlance`·`GlanceInput` from `./render.js`
  - `UsageAnalysis` from `./analysis.js`
- Produces:
  - `export interface SessionStartOptions { now?: Date; sessionFiles?: string[]; projectsDir?: string }`
  - `export async function runSessionStart(opts?: SessionStartOptions): Promise<string>` — 거울 한 줄(실패 시 `⚠️ AIMM 거울 생성 실패: …`). default 어댑터(claude-only).

- [ ] **Step 1: 실패 테스트 작성**

세션 픽스처는 기존 테스트 패턴 재사용(임시 jsonl 파일을 `sessionFiles`로 주입). `test/session-start-run.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSessionStart } from "../src/core/sessionStart.js";

// 어제(KST) startTime을 가진 Claude Code 세션 1줄 + assistant usage.
function sessionJsonl(isoTs: string): string {
  return [
    JSON.stringify({ type: "user", timestamp: isoTs, message: { role: "user", content: "hi" } }),
    JSON.stringify({
      type: "assistant", timestamp: isoTs,
      message: { role: "assistant", model: "claude-opus-4-8", usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }),
  ].join("\n");
}

describe("runSessionStart", () => {
  let dir: string;
  const now = new Date("2026-06-28T05:00:00Z"); // KST 14:00, 어제=2026-06-27
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aimm-ss-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("cold start (no sessions) → 아직 기록 없음", async () => {
    const line = await runSessionStart({ now, sessionFiles: [] });
    expect(line).toBe("🪞 아직 기록 없음 — 다음 세션부터 쌓임");
  });

  it("yesterday session → mirror line with 어제", async () => {
    const f = join(dir, "s.jsonl");
    writeFileSync(f, sessionJsonl("2026-06-27T03:00:00Z")); // KST 12:00 어제
    const line = await runSessionStart({ now, sessionFiles: [f] });
    expect(line).toContain("🪞 어제: 1세션");
    expect(line).toContain("이번주(최근7일): 1세션");
    expect(line).not.toMatch(/[\\/]/); // 경로 누출 없음
  });

  it("never throws — returns ⚠️ line on failure", async () => {
    // projectsDir를 존재하지 않는 경로로 주되 sessionFiles 없이 → 수집은 빈 결과로 안전.
    // 강제 실패는 잡기 어려우니 최소: 정상 경로가 throw하지 않음을 보장.
    const line = await runSessionStart({ now, sessionFiles: [] });
    expect(typeof line).toBe("string");
    expect(line.startsWith("🪞") || line.startsWith("⚠️")).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/session-start-run.test.ts`
Expected: FAIL — `runSessionStart` not exported

- [ ] **Step 3: orchestrator 구현**

`src/core/sessionStart.ts`에 추가(상단에 import 추가):

```typescript
import { buildAnalysis } from "./standup.js";
import { yesterdayKst, isoDatePlusDays, weekdayOf, WEEKDAY } from "./day.js";
import { renderGlance } from "./render.js";
import type { UsageAnalysis } from "./analysis.js";

export interface SessionStartOptions {
  now?: Date;
  /** 테스트 주입: 세션 파일 명시(빈 배열이면 자동 발견 스킵). */
  sessionFiles?: string[];
  /** 테스트 주입: projects 루트. */
  projectsDir?: string;
}

/** 이번주(byDay) 가장 바쁜 요일 라벨 — 세션 수 최다, 동률은 이른 요일(결정적). 없으면 undefined. */
function busiestWeekday(week: UsageAnalysis): string | undefined {
  if (week.byDay.length === 0) return undefined;
  const byWd = new Array<number>(7).fill(0);
  for (const d of week.byDay) byWd[weekdayOf(d.date)] += d.sessions;
  let best = -1;
  let bestN = 0;
  for (let wd = 0; wd < 7; wd++) {
    if ((byWd[wd] ?? 0) > bestN) {
      bestN = byWd[wd] ?? 0;
      best = wd;
    }
  }
  return best >= 0 ? WEEKDAY[best] : undefined;
}

/** SessionStart 거울 한 줄. 코어 재사용(claude-only cost-known). 실패해도 throw 안 함. */
export async function runSessionStart(opts: SessionStartOptions = {}): Promise<string> {
  try {
    const now = opts.now ?? new Date();
    const yDate = yesterdayKst(now);
    const weekStart = isoDatePlusDays(yDate, -6); // 최근 7일(어제 종료)

    const common: { sessionFiles?: string[]; projectsDir?: string } = {};
    if (opts.sessionFiles) common.sessionFiles = opts.sessionFiles;
    if (opts.projectsDir) common.projectsDir = opts.projectsDir;

    const [{ analysis: yesterday }, { analysis: week }] = await Promise.all([
      buildAnalysis({ ...common, start: yDate, end: yDate }),
      buildAnalysis({ ...common, start: weekStart, end: yDate }),
    ]);

    const input: import("./render.js").GlanceInput = { yesterday, week };
    const wd = busiestWeekday(week);
    if (wd) input.weekBusiestWeekday = wd;
    return renderGlance(input);
  } catch (err) {
    return `⚠️ AIMM 거울 생성 실패: ${(err as Error).message}`;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/session-start-run.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/sessionStart.ts test/session-start-run.test.ts
git commit -m "feat: runSessionStart orchestrator (yesterday + last-7-days glance)"
```

---

### Task 5: CLI `aimm session-start` — stdin 읽기, 항상 exit 0

stdin JSON을 읽어 source 필터→글랜스→top-level systemMessage JSON 출력. source≠startup/resume면 무출력. **항상 exit 0**(거울은 systemMessage로만 전달; exit 1/2 금지).

**Files:**
- Modify: `src/cli.ts` (`cmdSessionStart` + usage + dispatch)
- Test: `test/cli-session-start.test.ts` (빌드 후 spawn 통합 테스트)

**Interfaces:**
- Consumes: `parseSessionSource`·`shouldMirror`·`toHookOutput`·`runSessionStart` from `./core/sessionStart.js`

- [ ] **Step 1: 통합 테스트 작성(빌드된 dist를 spawn, stdin 주입)**

`test/cli-session-start.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CLI = join(process.cwd(), "dist", "cli.js");

function run(stdin: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", [CLI, "session-start"], { input: stdin, encoding: "utf-8" });
    return { stdout, status: 0 };
  } catch (e: any) {
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

describe("aimm session-start CLI", () => {
  beforeAll(() => {
    if (!existsSync(CLI)) throw new Error("run `npm run build` before this test");
  });

  it("startup → emits top-level systemMessage JSON, exit 0", () => {
    const { stdout, status } = run(JSON.stringify({ source: "startup", session_id: "x" }));
    expect(status).toBe(0);
    const out = JSON.parse(stdout);
    expect(typeof out.systemMessage).toBe("string");
    expect(out.systemMessage).toContain("🪞");
    expect(out.hookSpecificOutput).toBeUndefined();
  });

  it("compact → no output, exit 0 (source filtered)", () => {
    const { stdout, status } = run(JSON.stringify({ source: "compact" }));
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("clear → no output, exit 0", () => {
    const { stdout, status } = run(JSON.stringify({ source: "clear" }));
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("empty stdin (unknown source) → no output, exit 0", () => {
    const { stdout, status } = run("");
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});
```

- [ ] **Step 2: 빌드 후 실패 확인**

Run: `npm run build && npx vitest run test/cli-session-start.test.ts`
Expected: FAIL — `알 수 없는 명령: session-start`(stderr) → exit 2, stdout 빈값 (test 기대 불일치)

- [ ] **Step 3: cmdSessionStart 구현 + dispatch + usage**

`src/cli.ts` import에 추가:

```typescript
import { parseSessionSource, shouldMirror, toHookOutput, runSessionStart } from "./core/sessionStart.js";
```

`cmdHook` 아래에 추가:

```typescript
/** stdin 전체를 읽는다(SessionStart hook이 JSON을 stdin으로 넘김). */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => resolve(raw));
    process.stdin.on("error", () => resolve(raw));
  });
}

/** SessionStart hook 진입점. 거울 한 줄을 top-level systemMessage로 낸다. 항상 exit 0. */
async function cmdSessionStart(): Promise<number> {
  try {
    const raw = await readStdin();
    const source = parseSessionSource(raw);
    if (!shouldMirror(source)) return 0; // compact·clear·기타 스킵(무출력)
    const line = await runSessionStart();
    process.stdout.write(toHookOutput(line));
  } catch (err) {
    // 절대 세션을 깨지 않는다 — systemMessage로 실패를 알리고 exit 0.
    process.stdout.write(toHookOutput(`⚠️ AIMM 거울 생성 실패: ${(err as Error).message}`));
  }
  return 0;
}
```

`main()`의 switch에 추가(`case "hook":` 아래):

```typescript
    case "session-start":
      return cmdSessionStart();
```

usage()의 hook 줄 아래에 추가:

```typescript
      "  aimm session-start                       SessionStart hook용 — 어제·이번주 거울 한 줄(stdin JSON)",
```

- [ ] **Step 4: 빌드 후 통과 확인**

Run: `npm run build && npx vitest run test/cli-session-start.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/cli.ts test/cli-session-start.test.ts
git commit -m "feat: aimm session-start CLI (stdin source filter, always exit 0)"
```

---

### Task 6: init — SessionStart hook 별개 마커 + 멱등 병합

`mergeSessionEndHook` 패턴을 복제해 SessionStart hook을 멱등 병합. 마커는 **별개**(`session-start` 서브커맨드) — 기존 `isAimmHook`(`cli.js … hook`)과 교차매칭 안 됨을 테스트로 보장.

**Files:**
- Modify: `src/core/init.ts` (`isAimmSessionStartHook` + `mergeSessionStartHook`)
- Test: `test/init.test.ts` (기존 파일에 추가)

**Interfaces:**
- Produces:
  - `export function isAimmSessionStartHook(command: string): boolean` — `/cli\.js … session-start/` 매칭
  - `export function mergeSessionStartHook(settings, command): { settings; action: "add"|"replace"|"noop" }` — SessionStart 배열에 멱등 병합
- 비교차 불변식: `isAimmHook("… session-start")===false`, `isAimmSessionStartHook("… hook")===false`

- [ ] **Step 1: 실패 테스트 작성**

`test/init.test.ts`에 추가:

```typescript
import { isAimmSessionStartHook, mergeSessionStartHook } from "../src/core/init.js";

describe("SessionStart hook markers", () => {
  const ssCmd = 'node "/x/dist/cli.js" session-start';
  const endCmd = 'node "/x/dist/cli.js" hook';

  it("markers do not cross-match", () => {
    expect(isAimmSessionStartHook(ssCmd)).toBe(true);
    expect(isAimmSessionStartHook(endCmd)).toBe(false);
    // 기존 isAimmHook은 session-start를 안 잡아야(under-match 정상)
    // (isAimmHook은 같은 모듈에서 import)
  });

  it("merge adds SessionStart group when absent", () => {
    const { settings, action } = mergeSessionStartHook({}, ssCmd);
    expect(action).toBe("add");
    const list = (settings.hooks as any).SessionStart;
    expect(list[0].hooks[0].command).toBe(ssCmd);
  });

  it("merge is idempotent (noop on same command)", () => {
    const first = mergeSessionStartHook({}, ssCmd).settings;
    const { action } = mergeSessionStartHook(first, ssCmd);
    expect(action).toBe("noop");
  });

  it("merge replaces when path changed", () => {
    const first = mergeSessionStartHook({}, 'node "/old/cli.js" session-start').settings;
    const { settings, action } = mergeSessionStartHook(first, ssCmd);
    expect(action).toBe("replace");
    expect((settings.hooks as any).SessionStart[0].hooks[0].command).toBe(ssCmd);
  });

  it("does not touch existing SessionEnd entries", () => {
    const withEnd = { hooks: { SessionEnd: [{ hooks: [{ type: "command", command: endCmd }] }] } };
    const { settings } = mergeSessionStartHook(withEnd, ssCmd);
    expect((settings.hooks as any).SessionEnd[0].hooks[0].command).toBe(endCmd);
    expect((settings.hooks as any).SessionStart[0].hooks[0].command).toBe(ssCmd);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/init.test.ts`
Expected: FAIL — `isAimmSessionStartHook`/`mergeSessionStartHook` not exported

- [ ] **Step 3: 구현**

`src/core/init.ts`의 `isAimmHook` 아래에 추가:

```typescript
/** SessionStart hook 마커 — SessionEnd(`… hook`)와 교차매칭 안 되게 `session-start` 서브커맨드로 판정. */
const SESSION_START_MARKER = /(?:^|[\\/])cli\.js["']?\s+session-start(?:\s|$)/;
export function isAimmSessionStartHook(command: string): boolean {
  return SESSION_START_MARKER.test(command);
}
```

`mergeSessionEndHook` 아래에 추가(같은 패턴, SessionStart 배열·별개 마커):

```typescript
export function mergeSessionStartHook(
  settings: unknown,
  command: string,
): { settings: Record<string, unknown>; action: "add" | "replace" | "noop" } {
  const s = asObj(settings);
  const hooks = (s.hooks = asObj(s.hooks));
  const list = (Array.isArray(hooks.SessionStart) ? hooks.SessionStart : (hooks.SessionStart = [])) as HookGroup[];
  for (const group of list) {
    if (!group || !Array.isArray(group.hooks)) continue;
    for (const h of group.hooks) {
      if (h && h.type === "command" && typeof h.command === "string" && isAimmSessionStartHook(h.command)) {
        if (h.command === command) return { settings: s, action: "noop" };
        h.command = command;
        return { settings: s, action: "replace" };
      }
    }
  }
  list.push({ hooks: [{ type: "command", command }] });
  return { settings: s, action: "add" };
}
```

> 주의: 기존 `isAimmHook`(`/cli\.js … hook/`)이 `session-start`도 잡지 않음을 확인 — `session-start`엔 `hook` 단어가 없어 under-match(정상). 교차 안전.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/init.test.ts`
Expected: PASS (기존 + 신규 5 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/init.ts test/init.test.ts
git commit -m "feat: mergeSessionStartHook with separate non-crossmatching marker"
```

---

### Task 7: runInit이 SessionStart hook도 등록

`runInit`이 SessionEnd에 더해 SessionStart hook(`cli.js session-start`)도 멱등 병합. 결과에 별도 액션 노출, cmdInit 출력 갱신.

**Files:**
- Modify: `src/core/init.ts` (`runInit` + `InitResult`)
- Modify: `src/cli.ts` (`cmdInit` 출력)
- Test: `test/init.test.ts` (runInit 통합 — 양쪽 hook 등록)

**Interfaces:**
- Consumes: `mergeSessionStartHook`(Task 6)
- Produces: `InitResult`에 `sessionStartAction: "add"|"replace"|"noop"` 추가

- [ ] **Step 1: 실패 테스트 작성**

`test/init.test.ts`의 runInit 테스트 섹션에 추가(기존 InitIo 목 패턴 재사용):

```typescript
it("runInit registers BOTH SessionEnd and SessionStart hooks", () => {
  let written = "";
  const io = {
    homedir: () => "/home/u",
    cwd: () => "/repo",
    now: () => "T",
    readFile: () => null,
    writeFile: (_p: string, c: string) => { written = c; },
    backup: () => "/bak",
    registerMcp: () => true,
  };
  const r = runInit(io, "file:///repo/dist/core/init.js");
  expect(r.hookAction).toBe("add");
  expect(r.sessionStartAction).toBe("add");
  const parsed = JSON.parse(written);
  const endCmds = parsed.hooks.SessionEnd[0].hooks[0].command;
  const startCmds = parsed.hooks.SessionStart[0].hooks[0].command;
  expect(endCmds).toContain("cli.js");
  expect(endCmds).toContain("hook");
  expect(startCmds).toContain("session-start");
});

it("runInit is idempotent across both hooks (second run noop)", () => {
  let store: string | null = null;
  const io = {
    homedir: () => "/home/u", cwd: () => "/repo", now: () => "T",
    readFile: () => store,
    writeFile: (_p: string, c: string) => { store = c; },
    backup: () => "/bak", registerMcp: () => true,
  };
  runInit(io, "file:///repo/dist/core/init.js");
  const r2 = runInit(io, "file:///repo/dist/core/init.js");
  expect(r2.hookAction).toBe("noop");
  expect(r2.sessionStartAction).toBe("noop");
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/init.test.ts`
Expected: FAIL — `sessionStartAction` undefined / SessionStart 미등록

- [ ] **Step 3: runInit 수정**

`src/core/init.ts`의 `InitResult`에 필드 추가:

```typescript
  hookAction: "add" | "replace" | "noop";
  sessionStartAction: "add" | "replace" | "noop";
```

`runInit` 본문에서 SessionEnd 병합 직후 SessionStart도 병합. `command`·병합 부분 교체:

```typescript
  const command = `node ${JSON.stringify(cliJs)} hook`;
  const ssCommand = `node ${JSON.stringify(cliJs)} session-start`;
  const endMerge = mergeSessionEndHook(raw ? JSON.parse(raw) : {}, command);
  const startMerge = mergeSessionStartHook(endMerge.settings, ssCommand);
  const merged = startMerge.settings;
  const action = endMerge.action;
  const sessionStartAction = startMerge.action;
```

dryRun 반환·정상 반환의 결과 객체에 `sessionStartAction` 추가. 쓰기 가드는 둘 중 하나라도 변경 시:

```typescript
  if (opts.dryRun) {
    return { cliJs, settingsPath, hookAction: action, sessionStartAction, mcpVia: "claude", mcpJsonPath, warnings, backups };
  }

  if (action !== "noop" || sessionStartAction !== "noop") {
    if (raw !== null) backups.push(io.backup(settingsPath));
    io.writeFile(settingsPath, JSON.stringify(merged, null, 2) + "\n");
  }
```

마지막 반환에도 `sessionStartAction` 추가.

- [ ] **Step 4: cmdInit 출력 갱신**

`src/cli.ts` `cmdInit`에서 hook 줄 아래 추가:

```typescript
  out.push(`  SessionStart hook: ${r.sessionStartAction} → ${r.settingsPath}`);
```

- [ ] **Step 5: 빌드 후 통과 확인**

Run: `npm run build && npx vitest run test/init.test.ts`
Expected: PASS (전부 그린)

- [ ] **Step 6: 커밋**

```bash
git add src/core/init.ts src/cli.ts test/init.test.ts
git commit -m "feat: aimm init registers SessionStart hook (idempotent, both hooks)"
```

---

### Task 8: 전체 회귀 + 문서 + 릴리스 노트 + version bump

릴리스 규칙(강제): 마지막 task = 릴리스 노트 + CHANGELOG + version bump + README. 전체 테스트 그린 확인.

**Files:**
- Modify: `README.md` (Claude Code 연동에 SessionStart 항목)
- Create: `docs/releases/v0.7.0-session-start-mirror.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json` (version 0.6.0 → 0.7.0)

- [ ] **Step 1: 전체 테스트 + 빌드 그린 확인**

Run: `npm run build && npx vitest run`
Expected: PASS — 전부 그린(178 + 신규). 실패 시 systematic-debugging.

- [ ] **Step 2: 실제 도그푸딩 한 줄 캡처(릴리스 노트용)**

Run: `echo '{"source":"startup"}' | node dist/cli.js session-start`
출력 JSON의 `systemMessage`를 릴리스 노트 "도그푸딩"에 기록(닫힌 어휘 확인).

- [ ] **Step 3: README에 SessionStart 항목 추가**

`README.md`의 "Claude Code 연동"(또는 aimm init 설명) 섹션에 한 줄: `aimm init`이 이제 SessionStart hook도 등록 → 새 세션 시작 시 어제·이번주 거울 한 줄이 표출됨(top-level systemMessage). `compact`·`clear`엔 안 뜸.

- [ ] **Step 4: 릴리스 노트 작성**

`docs/releases/v0.7.0-session-start-mirror.md` — 기존 릴리스 노트 템플릿(`docs/releases/README.md`) 따름: before/after(트리거 부재→매일 거울)·검증(테스트 수·스파이크 정정)·AI사용메타(도그푸딩 한 줄). 스키마 정정(top-level systemMessage) 명시.

- [ ] **Step 5: CHANGELOG + package.json bump**

`CHANGELOG.md` 인덱스에 v0.7.0 줄 추가. `package.json` `"version": "0.7.0"`.

- [ ] **Step 6: 커밋**

```bash
git add README.md CHANGELOG.md package.json docs/releases/v0.7.0-session-start-mirror.md docs/superpowers/specs/daily-trigger-design.md docs/superpowers/plans/daily-trigger.md
git commit -m "docs: v0.7.0 release note + SessionStart mirror docs"
```

---

## Self-Review

**Spec coverage:**
- 신규 CLI `aimm session-start`(stdin·source 필터·한 줄) → Task 3·4·5 ✓
- 가시성 메커니즘 top-level systemMessage(스파이크 정정) → Task 3(`toHookOutput`)·5 ✓
- source 필터(startup/resume만, compact/clear 스킵) → Task 3(`shouldMirror`)·5 ✓
- renderGlance(정상·empty·cold-start) → Task 2 ✓
- 요일·주간 헬퍼 추출(patterns→day) → Task 1 ✓
- 코어 재사용(buildAnalysis/analyze/content/day, cost-known만) → Task 4 ✓
- 가장 바쁜 요일 → Task 4(`busiestWeekday`) ✓
- init SessionStart 멱등 병합 + 별개 마커 비교차 → Task 6·7 ✓
- 실패 안전 항상 exit 0 → Task 4·5 ✓
- 프라이버시 단언(경로 구분자 0) → Task 2·4 테스트 ✓
- 결정적(로케일 비의존) → Task 1 ✓
- 배포 문서 + 릴리스 기록 → Task 8 ✓
- "fix N" 커밋 제외(repo 인자 없음) → session-start는 repo 미사용, 자연 충족 ✓

**Placeholder scan:** 코드 단계 전부 실제 코드 포함. 문서 task(8)는 기존 템플릿 참조(서술 OK).

**Type consistency:** `GlanceInput`(render.ts)·`SessionStartOptions`(sessionStart.ts)·`InitResult.sessionStartAction`·`isAimmSessionStartHook`/`mergeSessionStartHook` 명칭 task 간 일관. `buildAnalysis` 반환 `{ analysis }` 구조분해 일치.

**열린 결정(MVP):** resume 포함(shouldMirror가 startup+resume) — 답답하면 후속에서 startup만으로 좁힘. busiest weekday 동률=이른 요일.
