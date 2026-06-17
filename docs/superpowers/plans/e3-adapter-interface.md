# E3 — 멀티소스 어댑터 인터페이스 (Source Adapter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 사용 소스를 `SourceAdapter` 계약 뒤로 격리해, 오케스트레이터(`buildStandup`/`buildAnalysis`)가 더 이상 Claude Code 파일 구조를 직접 모르게 하고, 새 소스(E5 Cursor)가 "인터페이스 구현 + 주입"만으로 드롭인되게 한다.

**Architecture:** 새 `src/adapters/types.ts`(계약)와 `src/adapters/claudeCode.ts`(기존 발견+읽기 합성)를 만들고, `standup.ts`의 두 오케스트레이터가 `discoverSessionFiles`+`readSessionFiles` 직접 호출 대신 주입 가능한 `adapter.collect()`(기본 `claudeCodeAdapter`)를 쓰게 바꾼다. CLI·hook·MCP는 무변경(기본 어댑터 흡수).

**Tech Stack:** TypeScript(strict, NodeNext ESM; `exactOptionalPropertyTypes`·`noUncheckedIndexedAccess` ON), vitest. 로컬 import는 `.js` 확장자 필수.

설계 근거: [specs/e3-adapter-interface-design.md](../specs/e3-adapter-interface-design.md) (적대적 리뷰 1라운드로 굳힘) · 로드맵: [ROADMAP.md](../../../ROADMAP.md)

> **⚠️ git 규칙(2026-06-17 갱신):** 에이전트가 커밋/푸시를 실행해도 되지만 **올리기 전 사용자 컨펌 필수**. 이 계획은 사용자 지시("다 완료되면 커밋 전에 물어봐")에 따라 **per-task 커밋을 하지 않고**, 모든 코드·테스트·릴리스 작업을 마친 뒤 **마지막 Task에서 한 번에 커밋 게이트**(스테이징 대상 + 메시지 제시 → 승인)를 둔다. 각 코드 Task는 "테스트 그린"에서 멈춘다.

---

## File Structure

| 파일 | 책임 | 신규/수정 |
|------|------|-----------|
| `src/adapters/types.ts` | `SourceAdapter`·`CollectOptions` 계약(타입 전용, I/O 없음) | 신규 |
| `src/adapters/claudeCode.ts` | `claudeCodeAdapter` — 발견+읽기+파싱 합성, 계약 만족 | 신규 |
| `src/core/standup.ts` | `buildStandup`/`buildAnalysis`가 어댑터 주입 사용 | 수정 |
| `src/core/portrait.ts` | L117 stale 주석 "E3/E5"→"E4" 1줄 | 수정(주석만) |
| `test/adapters.test.ts` | 계약 값·collect 동작·DI seam·기본 배선 | 신규 |
| `package.json` · `CHANGELOG.md` · `docs/releases/v0.4.0-e3-adapter-interface.md` | 릴리스 기록 | 수정/신규 |

---

## Task 1: 계약 + Claude Code 어댑터 (TDD)

**Files:**
- Create: `src/adapters/types.ts`
- Create: `src/adapters/claudeCode.ts`
- Test: `test/adapters.test.ts`

- [ ] **Step 1: 어댑터 단위 테스트를 먼저 작성(실패하게)**

`test/adapters.test.ts` 생성:

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../src/adapters/claudeCode.js";

// 정상 assistant 라인(opus, 토큰 input100/output50) 1개 = 메시지 1.
const GOOD =
  '{"timestamp":"2026-06-12T05:00:00.000Z","sessionId":"a","message":{"role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}';
const CORRUPT = "{ this is not valid json";

const tmpDirs: string[] = [];
async function makeTmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "aimm-adapters-"));
  tmpDirs.push(d);
  return d;
}
afterEach(async () => {
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("claudeCodeAdapter 계약 값", () => {
  it("id/displayName", () => {
    expect(claudeCodeAdapter.id).toBe("claude-code");
    expect(claudeCodeAdapter.displayName).toBe("Claude Code");
  });
});

describe("claudeCodeAdapter.collect", () => {
  it("paths: 명시 파일을 읽고 손상은 warning으로 격리(throw 없음)", async () => {
    const dir = await makeTmp();
    const f1 = join(dir, "good.jsonl");
    const f2 = join(dir, "bad.jsonl");
    await writeFile(f1, GOOD + "\n");
    await writeFile(f2, CORRUPT + "\n");
    const r = await claudeCodeAdapter.collect({ paths: [f1, f2] });
    expect(r.sessions).toHaveLength(2); // 파일당 세션 1개(손상 파일은 메시지 0)
    const msgs = r.sessions.reduce((n, s) => n + s.messages.length, 0);
    expect(msgs).toBe(1); // good=1, bad=0
    expect(r.warnings.length).toBeGreaterThan(0); // 손상 라인 경고
  });

  it("rootDir: 자동 발견으로 projectsDir 하위 세션을 파싱", async () => {
    const root = await makeTmp();
    const proj = join(root, "my-project");
    await mkdir(proj, { recursive: true });
    await writeFile(join(proj, "sess.jsonl"), GOOD + "\n");
    const r = await claudeCodeAdapter.collect({ rootDir: root });
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]?.messages).toHaveLength(1);
  });

  it("paths가 rootDir 자동발견을 대체(rootDir에 세션이 있어도 paths만 읽음)", async () => {
    const root = await makeTmp();
    const proj = join(root, "p");
    await mkdir(proj, { recursive: true });
    await writeFile(join(proj, "discovered.jsonl"), GOOD + "\n"); // 메시지 1
    const explicit = join(root, "explicit.jsonl");
    await writeFile(explicit, GOOD + "\n" + GOOD + "\n"); // 메시지 2
    const r = await claudeCodeAdapter.collect({ rootDir: root, paths: [explicit] });
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]?.messages).toHaveLength(2); // explicit(2), discovered(1) 아님
  });

  it("빈 paths([])는 자동 발견을 건너뛴다(rootDir에 세션이 있어도 0) — load-bearing 불변식", async () => {
    const root = await makeTmp();
    const proj = join(root, "p");
    await mkdir(proj, { recursive: true });
    await writeFile(join(proj, "s.jsonl"), GOOD + "\n"); // 발견되면 1개
    const r = await claudeCodeAdapter.collect({ paths: [], rootDir: root });
    expect(r).toEqual({ sessions: [], warnings: [] }); // paths:[]가 발견을 단락시킴
  });

  it("없는 디렉터리는 빈 결과(throw 없음)", async () => {
    const missing = join(tmpdir(), "aimm-nope-" + process.pid + "-x");
    const r = await claudeCodeAdapter.collect({ rootDir: missing });
    expect(r).toEqual({ sessions: [], warnings: [] });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/adapters.test.ts`
Expected: FAIL — `Failed to resolve import "../src/adapters/claudeCode.js"`(모듈 없음).

- [ ] **Step 3: 계약 파일 생성 `src/adapters/types.ts`**

```typescript
/**
 * AI 사용 소스 어댑터 계약 (E3).
 *
 * 오케스트레이터는 이 인터페이스에만 의존하고, 어떤 소스의 저장 포맷·위치·파서도 모른다.
 * 새 소스(Cursor 등, E5)는 SourceAdapter를 구현해 주입하기만 하면 분석 파이프라인을 탄다.
 */

import type { ParseResult } from "../types.js";

/** 한 소스에서 사용 기록을 수집할 때의 옵션. 해석은 어댑터별(소스-특화). */
export interface CollectOptions {
  /** 명시 입력 위치(소스-특화: 파일 경로, DB 경로 등). 주어지면 자동 발견을 대체. */
  paths?: string[];
  /** 자동 발견 루트 오버라이드(테스트/커스텀 위치). */
  rootDir?: string;
}

/**
 * 구현체는 자기 소스의 발견·읽기·파싱을 캡슐화해 정규화된 ParseResult를 돌려준다.
 * 레코드/파일 단위 손상은 warning으로 격리하고 절대 throw로 전체를 중단하지 않는다(§4.4).
 * discover/read/parse는 소스별로 함께 변하므로 collect() 하나로 묶고 계약에 노출하지 않는다.
 */
export interface SourceAdapter {
  /** 안정적 기계 식별자. 예: "claude-code". */
  readonly id: string;
  /** 사람용 표시 이름. 예: "Claude Code". */
  readonly displayName: string;
  /** 발견 + 읽기 + 파싱 → 정규화 세션. */
  collect(opts?: CollectOptions): Promise<ParseResult>;
}
```

- [ ] **Step 4: 어댑터 파일 생성 `src/adapters/claudeCode.ts`**

```typescript
/**
 * Claude Code 소스 어댑터 (E3).
 *
 * 기존 발견(fs/discover)·읽기(fs/sessions)·파싱(parse/claudeCode)을 합성해 SourceAdapter 계약을
 * 만족한다. "명시 경로 > 자동 발견" 정책은 소스-특화이므로 여기(어댑터)에 둔다.
 * 빈 배열 paths([])는 truthy이며 `[] ?? discover()`가 []를 유지하므로 자동 발견을 건너뛴다 —
 * 기존 오케스트레이터 동작과 동일(이 불변식을 .length 가드로 바꾸지 말 것).
 */

import { discoverSessionFiles } from "../fs/discover.js";
import { readSessionFiles } from "../fs/sessions.js";
import type { ParseResult } from "../types.js";
import type { CollectOptions, SourceAdapter } from "./types.js";

export const claudeCodeAdapter: SourceAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  async collect(opts: CollectOptions = {}): Promise<ParseResult> {
    const files = opts.paths ?? (await discoverSessionFiles(opts.rootDir));
    return readSessionFiles(files);
  },
};
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run test/adapters.test.ts`
Expected: PASS (6개 테스트 그린).

---

## Task 2: 오케스트레이터 DI 리팩토링 (TDD)

**Files:**
- Modify: `src/core/standup.ts` (imports; `StandupOptions`/`AnalysisBuildOptions`에 `adapter?`; `buildStandup`·`buildAnalysis`의 세션 수집 2블록)
- Test: `test/adapters.test.ts` (추가)

- [ ] **Step 1: DI seam + 기본 배선 테스트 추가(실패하게)**

`test/adapters.test.ts` 상단 import에 추가:

```typescript
import { buildAnalysis, buildStandup } from "../src/core/standup.js";
import type { SourceAdapter } from "../src/adapters/types.js";
import type { NormalizedSession, ParseResult } from "../src/types.js";
import { vi } from "vitest";
```

(파일 맨 위 `import { afterEach, describe, expect, it } from "vitest";` 줄에 `vi`를 합쳐 `import { afterEach, describe, expect, it, vi } from "vitest";`로 둬도 됨.)

파일 끝에 추가:

```typescript
describe("오케스트레이터 DI seam (E3 핵심)", () => {
  it("buildAnalysis가 주입된 어댑터에만 의존 — 디스크 I/O 없이 분석 산출", async () => {
    const sessions: NormalizedSession[] = [
      {
        sessionId: "INJECTED-UNIQUE",
        projectPath: "fake-proj",
        messages: [
          {
            model: "claude-opus-4-8",
            timestamp: new Date("2026-06-12T05:00:00.000Z"),
            tokens: { input: 7, output: 3, cacheRead: 0, cacheCreation: 0 },
          },
        ],
        startTime: new Date("2026-06-12T05:00:00.000Z"),
        endTime: new Date("2026-06-12T05:00:00.000Z"),
      },
    ];
    const collect = vi.fn(async (): Promise<ParseResult> => ({ sessions, warnings: [] }));
    const fake: SourceAdapter = { id: "fake", displayName: "Fake", collect };

    // sessionFiles/projectsDir 미지정 → 구버전이면 실 ~/.claude를 스캔했을 경로.
    const r = await buildAnalysis({ adapter: fake });

    expect(collect).toHaveBeenCalledTimes(1);
    expect(r.analysis.totals.sessions).toBe(1);
    const t = r.analysis.totals.tokens;
    // 고유 토큰 합 10 — 실 Claude Code 경로가 우연히 낼 수 없는 값. 주입 데이터가 흐름을 증명.
    expect(t.input + t.output + t.cacheRead + t.cacheCreation).toBe(10);
  });

  it("buildStandup도 주입 어댑터를 정확히 1회 호출", async () => {
    const collect = vi.fn(async (): Promise<ParseResult> => ({ sessions: [], warnings: [] }));
    const fake: SourceAdapter = { id: "fake", displayName: "Fake", collect };
    await buildStandup({ adapter: fake, date: "2026-06-12" });
    expect(collect).toHaveBeenCalledTimes(1);
  });
});

describe("기본 어댑터 배선", () => {
  it("adapter 미지정 시 기본 claudeCodeAdapter 경로(픽스처 end-to-end)", async () => {
    const r = await buildAnalysis({ sessionFiles: ["test/fixtures/one-session.jsonl"] });
    expect(r.analysis.totals.sessions).toBe(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/adapters.test.ts`
Expected: FAIL — `buildAnalysis`/`buildStandup`의 옵션 타입에 `adapter`가 없어 타입 에러, 또는 주입 어댑터가 무시되어 `collect` 미호출.

- [ ] **Step 3: `src/core/standup.ts` 수정**

(a) import 교체 — 기존:
```typescript
import { collectCommits } from "../fs/git.js";
import { discoverSessionFiles } from "../fs/discover.js";
import { readSessionFiles } from "../fs/sessions.js";
```
로 변경:
```typescript
import { collectCommits } from "../fs/git.js";
import { claudeCodeAdapter } from "../adapters/claudeCode.js";
import type { CollectOptions, SourceAdapter } from "../adapters/types.js";
```
(`discoverSessionFiles`·`readSessionFiles` import 제거. `collectCommits`는 유지.)

(b) `StandupOptions`와 `AnalysisBuildOptions` **양쪽**에 필드 추가(예: 각 인터페이스의 `projectsDir?: string;` 줄 바로 아래):
```typescript
  /** AI 사용 소스 어댑터. 기본 claudeCodeAdapter. 테스트·멀티소스 확장용 주입점. */
  adapter?: SourceAdapter;
```

(c) `buildStandup`(현 L61-62)의 두 줄:
```typescript
  const files = opts.sessionFiles ?? (await discoverSessionFiles(opts.projectsDir));
  const parsed = await readSessionFiles(files);
```
를:
```typescript
  const adapter = opts.adapter ?? claudeCodeAdapter;
  const collectOpts: CollectOptions = {};
  if (opts.sessionFiles) collectOpts.paths = opts.sessionFiles;
  if (opts.projectsDir) collectOpts.rootDir = opts.projectsDir;
  const parsed = await adapter.collect(collectOpts);
```

(d) `buildAnalysis`(현 L145-146)의 동일한 두 줄을 (c)와 **똑같이** 교체.

> 빈 배열 불변식: `if (opts.sessionFiles)`는 `[]`가 truthy라 `paths=[]`로 매핑되고, 어댑터의 `[] ?? discover()`가 `[]`를 유지 → 자동 발견 건너뜀. `.length` 가드로 바꾸지 말 것. `parsed.warnings` 처리·git·LLM·situation 등 나머지 본문은 불변.

- [ ] **Step 4: 통과 확인(신규 + 전체 회귀)**

Run: `npx vitest run test/adapters.test.ts`
Expected: PASS (9개 테스트).

Run: `npx vitest run`
Expected: PASS (기존 전체 스위트 + adapters; `test/narrative.test.ts`·`test/hook.test.ts`·`test/portrait.test.ts`의 `sessionFiles`/`sessionFiles:[]` 케이스 회귀 없음).

---

## Task 3: portrait.ts stale 주석 1줄 정정

**Files:**
- Modify: `src/core/portrait.ts:117`

- [ ] **Step 1: 주석 수정**

`src/core/portrait.ts` L117:
```typescript
  lines.push("_다중 도구(Cursor 등)는 후속 단계(E3/E5)에서 추가됩니다._");
```
를:
```typescript
  lines.push("_다중 도구(Cursor 등)는 후속 단계(E4)에서 추가됩니다._");
```
(도구별 라벨 일반화는 source 태깅이 필요해 E4 일임 — E3는 코드 동작 불변, 약속만 현실에 맞춤.)

- [ ] **Step 2: portrait 회귀 확인**

Run: `npx vitest run test/portrait.test.ts`
Expected: PASS — `test/portrait.test.ts`가 "E3/E5" 문자열을 단언하지 않으면 영향 없음. (만약 단언한다면 그 기대값도 "E4"로 갱신.)

---

## Task 4: 검증 (typecheck · build · 전체 테스트)

**Files:** 없음(검증만)

- [ ] **Step 1: 타입체크**

Run: `npm run typecheck`
Expected: 에러 0(`exactOptionalPropertyTypes`에서 `collectOpts` 조건부 할당이 통과).

- [ ] **Step 2: 빌드**

Run: `npm run build`
Expected: `dist/` 생성, 에러 0. `dist/adapters/` 포함 확인.

- [ ] **Step 3: 전체 테스트**

Run: `npm test`
Expected: 전부 PASS.

- [ ] **Step 4: 스모크(기본 어댑터 실경로)**

Run: `node dist/cli.js analyze --start 2026-06-01 --end 2026-06-17`
Expected: 분석 문서 출력(기본 claudeCodeAdapter로 실 세션 수집). 에러 없이 종료.

---

## Task 5: 릴리스 노트 + 버전 범프

**Files:**
- Modify: `package.json:3` (`"version": "0.3.0"` → `"0.4.0"`)
- Create: `docs/releases/v0.4.0-e3-adapter-interface.md`
- Modify: `CHANGELOG.md` (인덱스에 v0.4.0 항목)

- [ ] **Step 1: `package.json` 버전 범프**

`"version": "0.3.0",` → `"version": "0.4.0",`

- [ ] **Step 2: 릴리스 노트 작성**

`docs/releases/README.md`의 템플릿·규칙을 따라 `docs/releases/v0.4.0-e3-adapter-interface.md` 작성. 포함:
- **무엇이 바뀌었나**: `SourceAdapter` 계약 + `claudeCodeAdapter` 도입, 오케스트레이터가 어댑터 주입 의존으로 전환(구조 작업, 사용자 체감 기능 변화 없음).
- **before/after**: 오케스트레이터가 `discoverSessionFiles`+`readSessionFiles`를 직접 호출 → `adapter.collect()` 한 번. CLI·hook·MCP 무변경.
- **검증**: `npm test` 그린(adapters 9 테스트 신규 포함), `tsc --noEmit` 클린, `npm run build` 성공, DI-seam 테스트가 디스크 I/O 없이 분석 산출 증명.
- **도그푸딩 AI메타**: `node dist/cli.js analyze`로 이 작업 기간의 본인 AI 사용 메트릭 1줄(릴리스 README 규칙).
- **다음**: E5(Cursor 어댑터, 스파이크 먼저) / E4(통합 뷰·source 태깅).

- [ ] **Step 3: CHANGELOG 인덱스 갱신**

`CHANGELOG.md`에 기존 형식에 맞춰 v0.4.0 줄 + 릴리스 노트 링크 추가.

- [ ] **Step 4: 재검증**

Run: `npm test`
Expected: PASS(문서·버전만 바뀌어 테스트 영향 없음).

---

## Task 6: 커밋 게이트 (사용자 컨펌)

**Files:** 없음(스테이징·커밋만)

- [ ] **Step 1: 변경 요약 + 스테이징 대상 + 커밋 메시지 초안을 사용자에게 제시**

제시 항목:
- 신규: `src/adapters/types.ts`, `src/adapters/claudeCode.ts`, `test/adapters.test.ts`, `docs/releases/v0.4.0-e3-adapter-interface.md`, `docs/superpowers/specs/e3-adapter-interface-design.md`, `docs/superpowers/plans/e3-adapter-interface.md`
- 수정: `src/core/standup.ts`, `src/core/portrait.ts`, `package.json`, `CHANGELOG.md`
- 커밋 메시지(초안):
  ```
  feat: source adapter interface (E3, v0.4.0)

  AI 사용 소스를 SourceAdapter 계약 뒤로 격리. 오케스트레이터가 Claude Code
  파일 구조를 직접 모르게 하고, 새 소스(E5)는 인터페이스 구현+주입으로 드롭인.
  CLI·hook·MCP 무변경(기본 claudeCodeAdapter).

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

- [ ] **Step 2: 승인 시에만 커밋(+필요 시 push) 실행. 미승인이면 멈춤.**

---

## Self-Review (작성자 체크)

- **Spec coverage:** §5 계약→Task1 Step3 · §6 어댑터→Task1 Step4 · §7 오케스트레이터→Task2 Step3 · §9 테스트 #1~#8→Task1/Task2 테스트 · §10 검증→Task4 · §11 릴리스→Task5 · §12 portrait 주석→Task3. 갭 없음.
- **Placeholder scan:** "DD" 등 미해결 플레이스홀더 없음(릴리스 파일명 날짜 2026-06-17 확정). 모든 코드 스텝에 실제 코드.
- **Type consistency:** `SourceAdapter`/`CollectOptions`/`ParseResult`/`NormalizedSession` 이름이 spec·코드·테스트에서 일치. `collect(opts?)` 인터페이스 vs `collect(opts = {})` 구현은 의도된 호환 형태(§6 노트).
