# E1 — AI craft 초상 (Craft Portrait) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `aimm portrait` 명령을 추가해, 기존 `UsageAnalysis`를 재사용한 공유용 AI craft 초상(텍스트+표만, 5필드, 결정적 미니 인사이트)을 생성한다.

**Architecture:** 순수 함수 2개를 코어에 추가하고 얇은 CLI 진입점으로 노출한다 — `insight.ts`(결정적 미니 인사이트), `portrait.ts`(공유용 렌더, 막대/프로젝트명 없음). `analyze()`/`buildAnalysis`/`render.ts` 헬퍼를 재사용한다(DRY). 마지막 task로 v0.2.0 릴리스 노트를 만든다(릴리스 기록 규칙).

**Tech Stack:** TypeScript(strict, NodeNext ESM), vitest. 로컬 import는 `.js` 확장자 필수.

> **⚠️ git 규칙:** 이 저장소는 **사용자가 git add/commit/push를 직접** 한다. 각 Task 끝 "Commit"의 명령은 **사용자가 실행**한다. 에이전트 실행자는 커밋 단계에서 멈추고 명령을 제시한다.

설계 스펙: [docs/superpowers/specs/e1-craft-portrait-design.md](../specs/e1-craft-portrait-design.md)
릴리스 규칙: [docs/releases/README.md](../../releases/README.md)

---

## 파일 구조

| 파일 | 책임 | 신규/수정 |
|------|------|-----------|
| `src/core/insight.ts` | `deriveInsights(analysis)` 결정적 미니 인사이트 | 신규 |
| `test/insight.test.ts` | 인사이트 임계·항상-존재 | 신규 |
| `src/core/portrait.ts` | `renderPortrait(analysis, opts)` 공유용 렌더 | 신규 |
| `test/portrait.test.ts` | 5필드·막대없음·프로젝트명 누출없음·빈상태 | 신규 |
| `src/cli.ts` | `aimm portrait` 명령 + usage | 수정 |
| `CHANGELOG.md` / `docs/releases/…` / `package.json` | v0.2.0 릴리스 | 수정/신규 |

> 결정론 규칙: 정렬 동률 비교는 `localeCompare`(호스트 로케일 의존) 대신 코드유닛 비교(`a<b?-1:…`)를 쓴다 — `situation.ts` 선례.

---

## Task 1: 미니 인사이트 `insight.ts`

**Files:**
- Create: `src/core/insight.ts`
- Test: `test/insight.test.ts`

- [ ] **Step 1: Write the failing test** — Create `test/insight.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { deriveInsights } from "../src/core/insight.js";
import type { UsageAnalysis } from "../src/core/analysis.js";

function fixture(over: Partial<UsageAnalysis> = {}): UsageAnalysis {
  return {
    range: { start: "2026-06-01", end: "2026-06-15" },
    totals: { sessions: 5, tokens: { input: 100, output: 50, cacheRead: 200, cacheCreation: 30 }, costUsd: 100, durationMs: 60000 },
    byModel: [{ model: "claude-opus-4-8", displayTokens: 380, costUsd: 100, tokenShare: 1, costShare: 1 }],
    byDay: [
      { date: "2026-06-10", sessions: 2, displayTokens: 100, costUsd: 70 },
      { date: "2026-06-11", sessions: 3, displayTokens: 280, costUsd: 30 },
    ],
    byHourKst: new Array<number>(24).fill(0),
    byProject: [{ project: "p", sessions: 5, displayTokens: 380, costUsd: 100 }],
    busiestDay: { date: "2026-06-10", sessions: 2, displayTokens: 100, costUsd: 70 },
    hasUnknownModel: false,
    pricingVersion: "test",
    ...over,
  };
}

describe("deriveInsights", () => {
  it("세션 0이면 빈 배열", () => {
    const empty = fixture({ totals: { sessions: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 0 } });
    expect(deriveInsights(empty)).toEqual([]);
  });

  it("비용이 하루에 20% 이상 집중되면 cost-concentration", () => {
    const cc = deriveInsights(fixture()).find((i) => i.kind === "cost-concentration");
    expect(cc?.text).toContain("70%");
    expect(cc?.text).toContain("2026-06-10");
  });

  it("집중이 20% 미만이면 cost-concentration 없음", () => {
    const ins = deriveInsights(fixture({ busiestDay: { date: "2026-06-10", sessions: 1, displayTokens: 10, costUsd: 10 } }));
    expect(ins.find((i) => i.kind === "cost-concentration")).toBeUndefined();
  });

  it("단일 모델이면 model-focus에 '단일 모델 집중'", () => {
    const mf = deriveInsights(fixture()).find((i) => i.kind === "model-focus");
    expect(mf?.text).toContain("100%");
    expect(mf?.text).toContain("Opus");
    expect(mf?.text).toContain("단일 모델 집중");
  });

  it("세션>0이면 최소 1개 보장", () => {
    expect(deriveInsights(fixture()).length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run test/insight.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: Write minimal implementation** — Create `src/core/insight.ts`:

```typescript
/**
 * 미니 인사이트 — craft 초상(E1)의 결정적 관찰 계층.
 *
 * UsageAnalysis만으로 계산되는 사실 1~2개. 순수·결정적(LLM 우회).
 * 세션>0이면 최소 1개(model-focus)를 보장한다. E2가 git 상관 인사이트로 확장할 자리.
 * ④ 시간대는 portrait 렌더의 별도 섹션이라 여기 포함하지 않는다(중복 방지).
 */

import type { UsageAnalysis } from "./analysis.js";
import { shortModelName } from "./render.js";

export interface Insight {
  text: string;
  kind: "cost-concentration" | "model-focus";
}

/** 패밀리(Opus/Sonnet/Haiku)별 토큰 비중 최대. 동률은 이름 코드유닛 비교. */
function topModelFamily(a: UsageAnalysis): { name: string; tokenShare: number } | undefined {
  const fam = new Map<string, number>();
  for (const m of a.byModel) {
    const name = shortModelName(m.model);
    fam.set(name, (fam.get(name) ?? 0) + m.tokenShare);
  }
  const sorted = [...fam.entries()].sort(
    (x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0),
  );
  const top = sorted[0];
  return top ? { name: top[0], tokenShare: top[1] } : undefined;
}

/** 결정적 미니 인사이트. 순서: [cost-concentration?, model-focus]. */
export function deriveInsights(a: UsageAnalysis): Insight[] {
  if (a.totals.sessions === 0) return [];
  const out: Insight[] = [];

  if (a.busiestDay && a.totals.costUsd > 0) {
    const share = a.busiestDay.costUsd / a.totals.costUsd;
    if (share >= 0.2) {
      out.push({
        kind: "cost-concentration",
        text: `비용의 약 ${Math.round(share * 100)}%가 단 하루(${a.busiestDay.date})에 집중됐습니다.`,
      });
    }
  }

  const top = topModelFamily(a);
  if (top) {
    const focus = top.tokenShare >= 0.8 ? " (단일 모델 집중)" : "";
    out.push({
      kind: "model-focus",
      text: `토큰의 ${Math.round(top.tokenShare * 100)}%를 ${top.name}로 썼습니다${focus}.`,
    });
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run test/insight.test.ts` → PASS(5 tests). `npx tsc --noEmit` 통과.

- [ ] **Step 5: Commit (사용자가 실행)**

```bash
git add src/core/insight.ts test/insight.test.ts
git commit -m "feat: deterministic mini-insight engine (cost-concentration, model-focus)"
```

---

## Task 2: 초상 렌더 `portrait.ts`

**Files:**
- Create: `src/core/portrait.ts`
- Test: `test/portrait.test.ts`

- [ ] **Step 1: Write the failing test** — Create `test/portrait.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { renderPortrait } from "../src/core/portrait.js";
import type { UsageAnalysis } from "../src/core/analysis.js";

function fixture(over: Partial<UsageAnalysis> = {}): UsageAnalysis {
  const byHour = new Array<number>(24).fill(0);
  byHour[21] = 2; byHour[22] = 4; byHour[23] = 3; // 밤 21~23 피크
  return {
    range: { start: "2026-05-11", end: "2026-06-15" },
    totals: { sessions: 23, tokens: { input: 100, output: 50, cacheRead: 200, cacheCreation: 30 }, costUsd: 3434.04, durationMs: 60000 },
    byModel: [{ model: "claude-opus-4-8", displayTokens: 380, costUsd: 3434.04, tokenShare: 1, costShare: 1 }],
    byDay: [
      { date: "2026-05-17", sessions: 1, displayTokens: 100, costUsd: 758.02 },
      { date: "2026-06-10", sessions: 5, displayTokens: 280, costUsd: 608.32 },
    ],
    byHourKst: byHour,
    byProject: [
      { project: "C--Users-jeonj-GitHub-turbo-pra", sessions: 5, displayTokens: 100, costUsd: 1204.27 },
      { project: "C--Users-jeonj-GitHub-AI-Metrics-MCP", sessions: 3, displayTokens: 50, costUsd: 700 },
    ],
    busiestDay: { date: "2026-05-17", sessions: 1, displayTokens: 100, costUsd: 758.02 },
    hasUnknownModel: false,
    pricingVersion: "test",
    ...over,
  };
}

describe("renderPortrait", () => {
  it("5필드 헤더를 모두 포함한다", () => {
    const out = renderPortrait(fixture());
    for (const h of ["## 도구별 사용", "## 비용 요약", "## 발견", "## 시간대 패턴", "## 본인 메모"]) {
      expect(out).toContain(h);
    }
  });

  it("막대/스파크라인 문자를 쓰지 않는다", () => {
    expect(renderPortrait(fixture())).not.toContain("█");
  });

  it("프로젝트명을 노출하지 않고 개수만 보여준다", () => {
    const out = renderPortrait(fixture());
    expect(out).not.toContain("turbo-pra");
    expect(out).not.toContain("AI-Metrics-MCP");
    expect(out).toContain("2개에 걸쳐");
  });

  it("정직성 푸터를 포함한다", () => {
    expect(renderPortrait(fixture())).toContain("*서술*이며 *평가*");
  });

  it("천단위 콤마 비용 포맷", () => {
    expect(renderPortrait(fixture())).toContain("$3,434.04");
  });

  it("시간대 최빈 구간을 '밤 21~23시'로 표기", () => {
    expect(renderPortrait(fixture())).toContain("밤 21~23시");
  });

  it("author/generatedDate를 헤더에 반영", () => {
    const out = renderPortrait(fixture(), { author: "전주성", generatedDate: "2026-06-15" });
    expect(out).toContain("# AI Craft 초상 — 전주성");
    expect(out).toContain("· 생성 2026-06-15");
  });

  it("세션 0이면 빈 초상(필드 표 생략)", () => {
    const out = renderPortrait(fixture({ totals: { sessions: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 0 } }));
    expect(out).toContain("기록된 AI 세션이 없습니다");
    expect(out).not.toContain("## 도구별 사용");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run test/portrait.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: Write minimal implementation** — Create `src/core/portrait.ts`:

```typescript
/**
 * craft 초상(E1) 렌더 — 공유 가능한 AI 사용 스냅샷.
 *
 * analyze 덤프와 달리 외부 독자용·텍스트+표만(막대/스파크라인 없음)·5필드 큐레이션.
 * 프로젝트명은 절대 렌더하지 않는다(개수만). 결정적(LLM 우회).
 */

import type { UsageAnalysis } from "./analysis.js";
import { shortModelName } from "./render.js";
import { deriveInsights } from "./insight.js";

export interface PortraitOptions {
  author?: string;
  /** "· 생성 <date>" 라벨. CLI가 KST 오늘 날짜 주입. 없으면 생략. */
  generatedDate?: string;
}

/** 천단위 콤마 + 소수 2자리. 3434.04 → "$3,434.04". */
function formatMoney(usd: number): string {
  const fixed = usd.toFixed(2);
  const dot = fixed.indexOf(".");
  const whole = fixed.slice(0, dot);
  const frac = fixed.slice(dot + 1);
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${withCommas}.${frac}`;
}

/** 토큰 비중 최대 패밀리 + 비중(0~1). 동률은 이름 코드유닛 비교. */
function topModel(a: UsageAnalysis): { name: string; share: number } | undefined {
  const fam = new Map<string, number>();
  for (const m of a.byModel) {
    const name = shortModelName(m.model);
    fam.set(name, (fam.get(name) ?? 0) + m.tokenShare);
  }
  const sorted = [...fam.entries()].sort(
    (x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0),
  );
  const t = sorted[0];
  return t ? { name: t[0], share: t[1] } : undefined;
}

/** range(YYYY-MM-DD~YYYY-MM-DD)의 inclusive 일수. 빈 문자열이면 활동일 수로 폴백. */
function periodDays(a: UsageAnalysis): number {
  const { start, end } = a.range;
  if (!start || !end) return a.byDay.length;
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
}

const DAY_PARTS: Array<{ from: number; to: number; label: string }> = [
  { from: 0, to: 5, label: "새벽" },
  { from: 6, to: 11, label: "아침" },
  { from: 12, to: 17, label: "오후" },
  { from: 18, to: 20, label: "저녁" },
  { from: 21, to: 23, label: "밤" },
];

function dayPart(hour: number): string {
  for (const p of DAY_PARTS) if (hour >= p.from && hour <= p.to) return p.label;
  return "";
}

/** 최빈 시작시각 구간을 한국어로. "밤 21~23시" / "밤 22시 전후". */
function peakWindow(byHourKst: number[]): string {
  const peak = Math.max(...byHourKst);
  if (peak <= 0) return "기록 없음";
  let m = 0;
  for (let h = 0; h < 24; h++) {
    if (byHourKst[h] === peak) { m = h; break; }
  }
  let lo = m;
  let hi = m;
  if (m - 1 >= 0 && (byHourKst[m - 1] ?? 0) >= peak / 2) lo = m - 1;
  if (m + 1 <= 23 && (byHourKst[m + 1] ?? 0) >= peak / 2) hi = m + 1;
  const part = dayPart(m);
  return lo === hi ? `${part} ${m}시 전후` : `${part} ${lo}~${hi}시`;
}

/** craft 초상 마크다운을 렌더한다(공유용·결정적). */
export function renderPortrait(a: UsageAnalysis, opts: PortraitOptions = {}): string {
  const who = opts.author ? ` — ${opts.author}` : "";
  const gen = opts.generatedDate ? ` · 생성 ${opts.generatedDate}` : "";
  const lines: string[] = [];
  lines.push(`# AI Craft 초상${who}`);
  lines.push(`기간: ${a.range.start} ~ ${a.range.end} (KST)${gen}`);
  lines.push("");

  if (a.totals.sessions === 0) {
    lines.push("이 기간에 기록된 AI 세션이 없습니다.");
    lines.push("");
    lines.push("---");
    lines.push("⚠️ *서술*이며 *평가* 아님. 로컬 생성·본인 소유.");
    return lines.join("\n");
  }

  lines.push("> 내가 AI를 실제로 어떻게 쓰는지의 정직한 스냅샷. 평가가 아니라 서술입니다.");
  lines.push("");

  const unknownNote = a.hasUnknownModel ? " (일부 모델 단가 미상)" : "";
  const tm = topModel(a);
  const tmCell = tm ? `${tm.name} (토큰 ${Math.round(tm.share * 100)}%)` : "—";

  lines.push("## 한눈에");
  lines.push("| 항목 | 값 |");
  lines.push("|------|-----|");
  lines.push(`| 활동 | ${periodDays(a)}일 중 ${a.byDay.length}일 |`);
  lines.push(`| AI 세션 | ${a.totals.sessions}건 |`);
  lines.push(`| 추정 비용 | 약 ${formatMoney(a.totals.costUsd)}${unknownNote} |`);
  lines.push(`| 주력 모델 | ${tmCell} |`);
  lines.push(`| 프로젝트 | ${a.byProject.length}개에 걸쳐 사용 |`);
  lines.push("");

  lines.push("## 도구별 사용");
  lines.push("| 도구 | 세션 |");
  lines.push("|------|------|");
  lines.push(`| Claude Code | ${a.totals.sessions} |`);
  lines.push("_다중 도구(Cursor 등)는 후속 단계(E3/E5)에서 추가됩니다._");
  lines.push("");

  lines.push("## 비용 요약");
  lines.push("| 항목 | 값 |");
  lines.push("|------|-----|");
  lines.push(`| 총 추정 | 약 ${formatMoney(a.totals.costUsd)} |`);
  if (a.busiestDay) {
    lines.push(`| 가장 활발한 날 | ${a.busiestDay.date} (약 ${formatMoney(a.busiestDay.costUsd)}) |`);
  }
  const avg = a.byDay.length > 0 ? a.totals.costUsd / a.byDay.length : 0;
  lines.push(`| 활동일 평균 | 약 ${formatMoney(avg)}/일 |`);
  lines.push("");

  lines.push("## 발견");
  for (const ins of deriveInsights(a)) lines.push(`- ${ins.text}`);
  lines.push("> 결정적 관찰. 상관이지 인과·증명이 아니며, 더 깊은 인사이트는 후속(E2).");
  lines.push("");

  lines.push("## 시간대 패턴");
  lines.push(`주로 **${peakWindow(a.byHourKst)}**에 사용합니다 (세션 시작 KST 최빈 구간).`);
  lines.push("");

  lines.push("## 본인 메모");
  lines.push("_(이 줄을 지우고, 이 기간 자랑할 작업·맥락을 직접 적으세요.)_");
  lines.push("");

  lines.push("---");
  lines.push(
    `⚠️ *서술*이며 *평가* 아님. 토큰·세션은 양이지 실력이 아닙니다. 비용은 추정치(단가 v${a.pricingVersion}, 정산액 아님). 로컬 생성·본인 소유.`,
  );
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run test/portrait.test.ts` → PASS(8 tests). `npx tsc --noEmit` 통과.

- [ ] **Step 5: Commit (사용자가 실행)**

```bash
git add src/core/portrait.ts test/portrait.test.ts
git commit -m "feat: renderPortrait — shareable craft portrait (text+tables, masked projects)"
```

---

## Task 3: CLI `aimm portrait` 명령

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: imports 추가** — `src/cli.ts` 상단에서 `import { renderAnalysis } from "./core/render.js";` 줄을 찾아 그 아래에 추가:

```typescript
import { renderPortrait, type PortraitOptions } from "./core/portrait.js";
import { toKstDateString } from "./core/day.js";
```

> `exactOptionalPropertyTypes: true`이므로 `{ author: undefined }`를 넘기면 안 된다(아래 조건 할당).

- [ ] **Step 2: usage 텍스트 추가** — `usage()`에서 analyze의 `--send` 줄(`"    --send … --llm과 함께",` 중 **두 번째**, analyze 블록 끝)을 찾아 그 아래, `"  aimm hook …"` 줄 **앞에** 삽입:

```typescript
      "  aimm portrait [옵션]                      공유용 AI craft 초상(텍스트+표) 생성",
      "    --start YYYY-MM-DD  시작 KST 날짜(기본: 데이터 전체)",
      "    --end YYYY-MM-DD    끝 KST 날짜",
      "    --author <name>     문서 헤더",
      "    --sessions <file>   세션 파일 명시(반복 가능)",
```

- [ ] **Step 3: cmdPortrait 추가** — `cmdAnalyze` 함수 정의 **뒤**(닫는 `}` 다음)에 추가:

```typescript
async function cmdPortrait(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const opts: AnalysisBuildOptions = {};
  if (flags.start?.[0]) opts.start = flags.start[0];
  if (flags.end?.[0]) opts.end = flags.end[0];
  if (flags.sessions && flags.sessions.length > 0) opts.sessionFiles = flags.sessions.filter((s) => s !== "");
  const author = flags.author?.[0];

  const { analysis, warnings } = await buildAnalysis(opts);
  const portraitOpts: PortraitOptions = { generatedDate: toKstDateString(new Date()) };
  if (author) portraitOpts.author = author;
  process.stdout.write(renderPortrait(analysis, portraitOpts) + "\n");
  if (warnings.length > 0) {
    process.stderr.write(`\n[warnings] ${warnings.length}건:\n`);
    for (const w of warnings) process.stderr.write(`  - ${w}\n`);
  }
  return 0;
}
```

- [ ] **Step 4: switch case 추가** — `main()`의 `case "analyze":` 블록(`return cmdAnalyze(rest);`) 아래에 추가:

```typescript
    case "portrait":
      return cmdPortrait(rest);
```

- [ ] **Step 5: Build + smoke (이 레포 실데이터로, 네트워크 없음)**

Run:
```bash
npx tsc --noEmit && npm run build && node dist/cli.js portrait --author 전주성 2>&1 | head -40
```
Expected: `# AI Craft 초상 — 전주성` 헤더, `## 한눈에`/`## 도구별 사용`/`## 비용 요약`/`## 발견`/`## 시간대 패턴`/`## 본인 메모` 섹션이 보이고, 막대(█)·프로젝트명이 없다.

- [ ] **Step 6: Full suite + typecheck** — `npx vitest run && npx tsc --noEmit` → 전체 PASS(기존 96 + 신규 ~13), 타입 에러 없음.

- [ ] **Step 7: Commit (사용자가 실행)**

```bash
git add src/cli.ts
git commit -m "feat: aimm portrait command (shareable craft portrait)"
```

---

## Task 4: v0.2.0 릴리스 (릴리스 기록 규칙 적용)

**Files:**
- Create: `docs/releases/2026-06-15-v0.2.0-e1-craft-portrait.md`
- Modify: `CHANGELOG.md`, `package.json`

- [ ] **Step 1: 증거 수집** — 릴리스 노트에 박을 값을 캡처한다(어긋나면 Step 2 본문 교체).

Run (after 샘플):
```bash
node dist/cli.js portrait --author 전주성 2>/dev/null | head -40
```
Run (AI 메타 — **AI-Metrics-MCP 줄만**, fail-closed 마스킹):
```bash
node dist/cli.js analyze 2>&1 | sed -n '/## 프로젝트별/,/^---/p' | grep "AI-Metrics-MCP"
```
Run (검증 수치):
```bash
npx vitest run 2>&1 | grep -E "Tests|Test Files" && npx tsc --noEmit && echo "tsc OK"
```

- [ ] **Step 2: 릴리스 노트 작성** — `docs/releases/2026-06-15-v0.2.0-e1-craft-portrait.md`를 작성(Step 1 실측 반영):

````markdown
# v0.2.0 — E1 AI craft 초상

릴리스: 2026-06-15 (KST)

## 한 줄 요약
`aimm portrait` 한 번으로, AI를 모르는 사람도 읽는 공유용 craft 초상(텍스트+표, 5필드)을 만든다.

## 산출물 before/after
**before** — 공유하려면 `analyze` 분석 덤프(ASCII 막대·스파크라인·클라이언트 프로젝트명 포함)를
손으로 다듬어야 했다. 외부에 그대로 못 붙임.

**after** — `aimm portrait`:
```
(Step 1에서 캡처한 portrait 출력 샘플을 붙여넣기 — 헤더 + 5필드)
```
- 텍스트+표만(막대/그래프 없음), 프로젝트명 비노출(개수만), 결정적 미니 인사이트 ≥1, 정직성 라벨.

## 검증
- 테스트: 96 → (Step 1 수치) 그린. 신규 `insight`(5) + `portrait`(8).
- `npx tsc --noEmit` / `npm run build` 클린.

## AI 사용 메타 — 도그푸딩
- AI-Metrics-MCP: (Step 1 캡처) 세션 N · 추정 $N.
> ⚠️ 기간 근사·전체 사용·시간은 세션 지속 추정. 양이지 실력 아님.

## 런타임 벤치
N/A: 핫패스 아님.

## 본인 메모
_(선택 — 비워둠)_
````

- [ ] **Step 3: CHANGELOG 갱신** — `CHANGELOG.md`에서 `## [0.1.0]` 줄을 찾아 그 **앞**에 v0.2.0 항목을 삽입:

````markdown
## [0.2.0] — 2026-06-15 · E1 AI craft 초상

`aimm portrait` 명령 추가 — 공유용 AI craft 초상(텍스트+표만, 5필드, 결정적 미니 인사이트).
프로젝트명 비노출. 기존 분석 코어 재사용.

→ 상세: [docs/releases/2026-06-15-v0.2.0-e1-craft-portrait.md](docs/releases/2026-06-15-v0.2.0-e1-craft-portrait.md)

````

- [ ] **Step 4: 버전 bump** — `package.json`에서 `"version": "0.1.0",`를 `"version": "0.2.0",`로 교체.

- [ ] **Step 5: 검증** — 파일 존재 + 마스킹 누출 검사 + 버전.

Run:
```bash
test -f docs/releases/2026-06-15-v0.2.0-e1-craft-portrait.md && echo "EXISTS"
grep -Eq "turbo-pra|checkin-be|seoultel|supertonic|kiosk|bbibbi|arreo|mcmp|AIWS|std-new" docs/releases/2026-06-15-v0.2.0-e1-craft-portrait.md && echo "❌ 누출" || echo "✅ 누출 없음"
grep '"version": "0.2.0"' package.json && echo "✅ 버전 0.2.0"
```
Expected: `EXISTS` · `✅ 누출 없음` · `✅ 버전 0.2.0`.

- [ ] **Step 6: Commit (사용자가 실행)**

```bash
git add docs/releases/2026-06-15-v0.2.0-e1-craft-portrait.md CHANGELOG.md package.json
git commit -m "docs: v0.2.0 release note (E1 craft portrait) + version bump"
```

---

## 완료 기준 (전체)

- `aimm portrait`가 5필드(도구별 세션·비용·발견≥1·시간대 한 줄·본인 메모)를 텍스트+표로 출력.
- 막대/스파크라인(█) 없음. 프로젝트명 누출 없음(개수만).
- `--start/--end`로 기간 좁힘. 세션 0이면 graceful 빈 초상.
- `npx vitest run` 전체 그린(기존 96 + 신규 ~13) · `npx tsc --noEmit` 클린.
- `CHANGELOG.md`에 v0.2.0 + 상세 노트, `package.json` 0.2.0.
- MCP `portrait` 도구·PDF·`--repo`는 범위 밖(후속).
