# 세션 내용 요약 + 클린 설치/aimm init (v0.6.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 파서가 버리던 세션 대화 내용을 결정적 닫힌-어휘 다이제스트로 추출해 analyze/portrait/narrative 보고서에 "무엇을 했나"를 넣고, GitHub 클론만으로 MCP 설치가 끝까지 동작하게 한다(`prepare` 빌드훅 + `aimm init`).

**Architecture:** 단일 파싱 패스를 재구성해(role/usage 가드 위로 hoist) 모든 레코드에서 tool_use·user 프롬프트를 닫힌 어휘 카운트로 누적 → `NormalizedSession.content`. `analyze()`가 cost-known 세션의 digest만 `summarizeContent()`로 롤업 → `UsageAnalysis.contentSummary` → 기존 render/portrait/narrative 심에 섹션·사실줄 추가. 설치는 `package.json` `prepare` 훅 + `aimm init`(settings.json 안정-센티넬 멱등 병합 + claude mcp add 스폰/.mcp.json 폴백).

**Tech Stack:** TypeScript(strict, NodeNext, exactOptionalPropertyTypes), vitest, node:fs/os/path/url/child_process. 신규 npm 의존성 0.

## Global Constraints

- Node `>=22`(현 engines 유지). 신규 npm 의존성 추가 금지.
- `tsconfig`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes: true` — **옵셔널 속성에 `undefined` 대입 금지, 부재 시 속성 생략**(조건부 spread/할당).
- 결정적: 정렬 동률은 코드유닛 비교(`a<b?-1:a>b?1:0`), `localeCompare`·`Math.random`·`toLocaleString` 금지.
- 프라이버시: 다이제스트·사실줄·portrait에 **원시 경로·명령 문자열·프로젝트명·`/`·`\` 금지**. 키는 닫힌 어휘(도구 레지스트리명 / 알려진 확장자∪`기타` / 허용목록 동사∪`기타`).
- 견고성: 파서·어댑터는 손상 레코드를 skip+warn, 절대 throw로 전체 abort 금지.
- 무오염: metrics.ts·standup·hook·Cursor 출력 불변. 기존 146 테스트 그린 유지.
- 커밋은 자유, **push 전 사용자 컨펌**(프로젝트 규칙). 커밋 메시지 영문 conventional, Co-Authored-By 트레일러 포함.
- 문서 파일명 날짜 프리픽스 금지(specs/plans=기능명).

---

### Task 1: 설치 하드닝 — `prepare` 빌드훅 (순수 버그픽스, 첫 커밋)

**Files:**
- Modify: `package.json` (scripts에 `prepare` 추가)
- Modify: `README.md` (설치 절차)

**Interfaces:**
- Consumes: 없음
- Produces: 클론 후 `npm install`이 `dist/cli.js`를 자동 생성(이후 모든 작업과 무관, 독립)

- [ ] **Step 1: package.json에 prepare 스크립트 추가**

`package.json`의 `scripts`에 한 줄 추가(기존 build 재사용):

```json
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "prepare": "npm run build",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
```

- [ ] **Step 2: 클린 클론 설치를 임시 디렉터리에서 실제 검증**

Run (bash):
```bash
rm -rf /tmp/aimm-clone && git clone -q "$(pwd)" /tmp/aimm-clone && cd /tmp/aimm-clone && npm install --silent 2>/dev/null && test -f dist/cli.js && node dist/cli.js --help 2>&1 | head -3; echo "EXIT=$?"; cd - >/dev/null
```
Expected: `dist/cli.js` 존재, `aimm — AI-Metrics MCP` usage 출력, `EXIT=0`. (clone은 커밋된 트리만 가져오므로 dist 없음 → prepare가 빌드해야 통과. prepare 없으면 이 단계 실패 = 버그 재현.)

- [ ] **Step 3: README 설치 절차 갱신**

`README.md`의 "## 설치 & 사용" 블록을 교체:

```markdown
## 설치 & 사용

```bash
git clone <repo-url> && cd AI_Metrics_MCP
npm install        # prepare 훅이 dist/를 자동 빌드 (클론 직후 바로 사용 가능)
npm test           # (선택) 테스트 확인
node dist/cli.js init   # (선택) SessionEnd hook · MCP 자동 등록 — 아래 "Claude Code 연동" 참고
```
```

- [ ] **Step 4: 커밋**

```bash
git add package.json README.md
git commit -m "fix: auto-build dist on install via prepare hook

dist/는 gitignore라 클론 후 빌드 없이는 bin(dist/cli.js)이 없어 MCP 등록이 실패했다.
prepare 훅으로 npm install 시 자동 빌드 → 클론 직후 claude mcp add가 바로 동작.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `core/content.ts` — 분류 + 롤업 (닫힌 어휘)

**Files:**
- Modify: `src/types.ts` (SessionContentDigest 추가)
- Create: `src/core/content.ts`
- Test: `test/content.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `interface SessionContentDigest { userPrompts: number; toolUses: Record<string,number>; fileExts: Record<string,number>; commandVerbs: Record<string,number> }` (types.ts)
  - `const OTHER = "기타"` (content.ts)
  - `isKnownExt(ext: string): boolean` / `isKnownVerb(verb: string): boolean` (content.ts) — 파서가 닫힌 어휘 판정에 사용
  - `interface ContentSummary { sessionsWithContent: number; userPrompts: number; totalToolUses: number; activity: Array<{category:string;count:number;share:number}>; areas: Array<{area:string;count:number}>; commands: Array<{category:string;count:number;exampleVerbs:string[]}> }`
  - `summarizeContent(digests: SessionContentDigest[]): ContentSummary`

- [ ] **Step 1: types.ts에 SessionContentDigest 추가**

`src/types.ts`에서 `NormalizedMessage` 위(또는 `NormalizedSession` 위)에 추가하고, `NormalizedSession`에 옵셔널 `content` 추가:

```ts
/**
 * 세션 내용 다이제스트 — 닫힌 어휘 카운트만(프라이버시 구성상 보장).
 * 키: 도구 레지스트리명 / 알려진 확장자∪"기타" / 허용목록 동사∪"기타".
 * 원시 경로·명령 문자열·프롬프트 텍스트는 분류 후 버려지고 여기 저장되지 않는다.
 */
export interface SessionContentDigest {
  userPrompts: number;
  toolUses: Record<string, number>;
  fileExts: Record<string, number>;
  commandVerbs: Record<string, number>;
}
```

그리고 `NormalizedSession` 인터페이스 안에 한 줄 추가(messages 위):

```ts
  /** 대화 내용 다이제스트(Claude Code만; 신호 없으면 생략). */
  content?: SessionContentDigest;
```

- [ ] **Step 2: 실패하는 테스트 작성 — `test/content.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { summarizeContent, isKnownExt, isKnownVerb, OTHER } from "../src/core/content.js";
import type { SessionContentDigest } from "../src/types.js";

function digest(p: Partial<SessionContentDigest>): SessionContentDigest {
  return { userPrompts: 0, toolUses: {}, fileExts: {}, commandVerbs: {}, ...p };
}

describe("isKnownExt / isKnownVerb (닫힌 어휘 판정)", () => {
  it("알려진 확장자/동사만 true", () => {
    expect(isKnownExt(".ts")).toBe(true);
    expect(isKnownExt(".local")).toBe(false);
    expect(isKnownVerb("git")).toBe(true);
    expect(isKnownVerb("./deploy.sh")).toBe(false);
  });
});

describe("summarizeContent", () => {
  it("도구를 활동 카테고리로 합산하고 share를 계산한다", () => {
    const cs = summarizeContent([
      digest({ toolUses: { Edit: 6, Write: 4, Read: 5, Bash: 5 } }),
    ]);
    expect(cs.totalToolUses).toBe(20);
    const impl = cs.activity.find((a) => a.category === "구현")!;
    expect(impl.count).toBe(10);
    expect(impl.share).toBeCloseTo(0.5, 5);
    expect(cs.activity.find((a) => a.category === "탐색")!.count).toBe(5);
    expect(cs.activity.find((a) => a.category === "실행·검증")!.count).toBe(5);
  });

  it("확장자를 영역으로, 미지 확장자는 기타로 합산한다", () => {
    const cs = summarizeContent([digest({ fileExts: { ".ts": 10, ".tsx": 3, ".md": 4, [OTHER]: 2 } })]);
    expect(cs.areas.find((a) => a.area === "TypeScript")!.count).toBe(13);
    expect(cs.areas.find((a) => a.area === "문서")!.count).toBe(4);
    expect(cs.areas.find((a) => a.area === OTHER)!.count).toBe(2);
  });

  it("허용목록 동사를 명령 카테고리로, exampleVerbs는 허용목록만·기타는 예시 없음", () => {
    const cs = summarizeContent([digest({ commandVerbs: { git: 5, npm: 3, npx: 2, [OTHER]: 7 } })]);
    const pkg = cs.commands.find((c) => c.category === "패키지")!;
    expect(pkg.count).toBe(5);
    expect(pkg.exampleVerbs).toEqual(["npm", "npx"]); // count desc, tie code-unit
    const other = cs.commands.find((c) => c.category === OTHER)!;
    expect(other.count).toBe(7);
    expect(other.exampleVerbs).toEqual([]);
  });

  it("userPrompts·sessionsWithContent를 합산한다", () => {
    const cs = summarizeContent([digest({ userPrompts: 10 }), digest({ userPrompts: 5, toolUses: { Edit: 1 } })]);
    expect(cs.userPrompts).toBe(15);
    expect(cs.sessionsWithContent).toBe(2);
  });

  it("빈 입력은 0·빈 배열", () => {
    const cs = summarizeContent([]);
    expect(cs.sessionsWithContent).toBe(0);
    expect(cs.totalToolUses).toBe(0);
    expect(cs.activity).toEqual([]);
  });

  it("정렬은 count 내림차순, 동률은 코드유닛(결정적)", () => {
    const cs = summarizeContent([digest({ toolUses: { Read: 3, Edit: 3 } })]); // 탐색3·구현3 동률
    expect(cs.activity.map((a) => a.category)).toEqual(["구현", "탐색"]); // 구현<탐색 코드유닛
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -- content`
Expected: FAIL (`Cannot find module '../src/core/content.js'`).

- [ ] **Step 4: `src/core/content.ts` 구현**

```ts
/**
 * 세션 내용 분류·롤업 — 결정적, 닫힌 어휘.
 *
 * 파서가 추출한 닫힌-어휘 카운트(도구명·알려진 확장자·허용목록 동사∪기타)를
 * 활동/영역/명령 카테고리로 합산한다. 순수·결정적(정렬 동률은 코드유닛).
 * *서술*이지 *평가*가 아니다 — tool_use 빈도는 양이지 실력이 아니다.
 */

import type { SessionContentDigest } from "../types.js";

export const OTHER = "기타";

const TOOL_ACTIVITY: Record<string, string> = {
  Edit: "구현", Write: "구현", MultiEdit: "구현", NotebookEdit: "구현",
  Read: "탐색", Grep: "탐색", Glob: "탐색", LS: "탐색", NotebookRead: "탐색", ToolSearch: "탐색",
  Bash: "실행·검증", PowerShell: "실행·검증", BashOutput: "실행·검증", KillShell: "실행·검증",
  TodoWrite: "계획·조율", TaskCreate: "계획·조율", TaskUpdate: "계획·조율", TaskList: "계획·조율",
  TaskGet: "계획·조율", AskUserQuestion: "계획·조율", Skill: "계획·조율", Agent: "계획·조율",
  Workflow: "계획·조율", ExitPlanMode: "계획·조율", EnterPlanMode: "계획·조율",
  WebFetch: "웹", WebSearch: "웹",
};

const EXT_AREA: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".java": "Java", ".py": "Python", ".go": "Go", ".rs": "Rust",
  ".md": "문서", ".mdx": "문서", ".txt": "문서", ".rst": "문서",
  ".json": "설정", ".yml": "설정", ".yaml": "설정", ".toml": "설정", ".properties": "설정", ".xml": "설정", ".ini": "설정",
  ".css": "스타일", ".scss": "스타일", ".sass": "스타일", ".less": "스타일",
  ".sh": "셸", ".bash": "셸", ".ps1": "셸",
  ".html": "HTML", ".sql": "SQL",
};

const VERB_CATEGORY: Record<string, string> = {
  git: "버전관리", gh: "버전관리",
  npm: "패키지", pnpm: "패키지", yarn: "패키지", npx: "패키지", bun: "패키지",
  pip: "패키지", poetry: "패키지", cargo: "패키지", mvn: "패키지", gradle: "패키지",
  node: "실행·테스트", tsx: "실행·테스트", "ts-node": "실행·테스트", vitest: "실행·테스트",
  jest: "실행·테스트", pytest: "실행·테스트", deno: "실행·테스트", python: "실행·테스트", java: "실행·테스트",
  ls: "파일", cat: "파일", find: "파일", rm: "파일", mkdir: "파일", cp: "파일", mv: "파일",
  touch: "파일", echo: "파일", pwd: "파일", head: "파일", tail: "파일", grep: "파일", sed: "파일", awk: "파일",
  curl: "네트워크", wget: "네트워크",
};

export function isKnownExt(ext: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXT_AREA, ext);
}
export function isKnownVerb(verb: string): boolean {
  return Object.prototype.hasOwnProperty.call(VERB_CATEGORY, verb);
}

export interface ContentSummary {
  sessionsWithContent: number;
  userPrompts: number;
  totalToolUses: number;
  activity: Array<{ category: string; count: number; share: number }>;
  areas: Array<{ area: string; count: number }>;
  commands: Array<{ category: string; count: number; exampleVerbs: string[] }>;
}

/** count 내림차순, 동률은 라벨 코드유닛(결정적). */
function cmpCount(a: { count: number; key: string }, b: { count: number; key: string }): number {
  return b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export function summarizeContent(digests: SessionContentDigest[]): ContentSummary {
  let userPrompts = 0;
  let totalToolUses = 0;
  const activity = new Map<string, number>();
  const area = new Map<string, number>();
  const command = new Map<string, number>();
  const verbsByCat = new Map<string, Map<string, number>>();

  for (const d of digests) {
    userPrompts += d.userPrompts;
    for (const [tool, n] of Object.entries(d.toolUses)) {
      totalToolUses += n;
      const cat = TOOL_ACTIVITY[tool] ?? OTHER;
      activity.set(cat, (activity.get(cat) ?? 0) + n);
    }
    for (const [ext, n] of Object.entries(d.fileExts)) {
      const a = EXT_AREA[ext] ?? OTHER;
      area.set(a, (area.get(a) ?? 0) + n);
    }
    for (const [verb, n] of Object.entries(d.commandVerbs)) {
      const cat = VERB_CATEGORY[verb] ?? OTHER;
      command.set(cat, (command.get(cat) ?? 0) + n);
      if (cat !== OTHER) {
        const m = verbsByCat.get(cat) ?? new Map<string, number>();
        m.set(verb, (m.get(verb) ?? 0) + n);
        verbsByCat.set(cat, m);
      }
    }
  }

  const activityArr = [...activity.entries()]
    .map(([category, count]) => ({ category, count, key: category }))
    .sort(cmpCount)
    .map(({ category, count }) => ({ category, count, share: totalToolUses > 0 ? count / totalToolUses : 0 }));

  const areasArr = [...area.entries()]
    .map(([a, count]) => ({ area: a, count, key: a }))
    .sort(cmpCount)
    .map(({ area: a, count }) => ({ area: a, count }));

  const commandsArr = [...command.entries()]
    .map(([category, count]) => ({ category, count, key: category }))
    .sort(cmpCount)
    .map(({ category, count }) => {
      const exampleVerbs = [...(verbsByCat.get(category) ?? new Map<string, number>()).entries()]
        .map(([verb, c]) => ({ verb, count: c, key: verb }))
        .sort(cmpCount)
        .slice(0, 3)
        .map((x) => x.verb);
      return { category, count, exampleVerbs };
    });

  return {
    sessionsWithContent: digests.length,
    userPrompts,
    totalToolUses,
    activity: activityArr,
    areas: areasArr,
    commands: commandsArr,
  };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test -- content`
Expected: PASS (6개). 이어서 `npm run typecheck` 클린.

- [ ] **Step 6: 커밋**

```bash
git add src/types.ts src/core/content.ts test/content.test.ts
git commit -m "feat: content classification + rollup (closed-vocabulary digest)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 파서 내용 추출 — 루프 재구성 (가드 위로 hoist)

**Files:**
- Modify: `src/parse/claudeCode.ts`
- Test: `test/parse.test.ts` (증분)

**Interfaces:**
- Consumes: `isKnownExt`, `isKnownVerb`, `OTHER` (content.ts); `SessionContentDigest` (types.ts)
- Produces: `parseSessionContent`이 신호 있는 세션에 `session.content` 부여(없으면 생략). 메트릭 경로 거동 불변.

- [ ] **Step 1: 실패하는 테스트 작성 — `test/parse.test.ts`에 describe 블록 추가**

파일 끝(마지막 `});` 뒤)에 추가:

```ts
describe("parseSessionContent — 내용 다이제스트", () => {
  const userStr = (ts: string, text: string) =>
    JSON.stringify({ timestamp: ts, message: { role: "user", content: text } });
  const userToolResult = (ts: string) =>
    JSON.stringify({ timestamp: ts, message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } });
  const assistantTools = (ts: string, items: unknown[], usage = true) => {
    const message: Record<string, unknown> = { role: "assistant", model: "claude-opus-4-8", content: items };
    if (usage) message.usage = { input_tokens: 10, output_tokens: 5 };
    return JSON.stringify({ timestamp: ts, message });
  };

  it("tool_use·file_path·command·user 프롬프트를 닫힌 어휘로 추출한다", () => {
    const content = [
      userStr("2026-06-02T10:00:00.000Z", "구현해줘"),
      assistantTools("2026-06-02T10:01:00.000Z", [
        { type: "text", text: "ok" },
        { type: "tool_use", name: "Edit", input: { file_path: "/home/x/src/a.ts" } },
        { type: "tool_use", name: "Bash", input: { command: "cd /repo && git status" } },
        { type: "tool_use", name: "Bash", input: { command: "./secret/deploy.sh" } },
      ]),
      userToolResult("2026-06-02T10:02:00.000Z"),
    ].join("\n");
    const { session } = parseSessionContent(content, "s1");
    expect(session.content).toBeDefined();
    const c = session.content!;
    expect(c.userPrompts).toBe(1); // tool_result 턴은 제외
    expect(c.toolUses).toEqual({ Edit: 1, Bash: 2 });
    expect(c.fileExts).toEqual({ ".ts": 1 });
    expect(c.commandVerbs).toEqual({ git: 1, [OTHER]: 1 }); // cd 스킵→git; ./secret/deploy.sh→기타(원시 토큰 미저장)
    // 프라이버시: 원시 경로/명령이 키로 새지 않는다.
    expect(JSON.stringify(c)).not.toContain("/home");
    expect(JSON.stringify(c)).not.toContain("deploy.sh");
  });

  it("usage 없는 assistant의 tool_use도 카운트한다(메트릭과 독립)", () => {
    const content = assistantTools("2026-06-02T10:00:00.000Z", [
      { type: "tool_use", name: "Read", input: { file_path: "x.md" } },
    ], false);
    const { session } = parseSessionContent(content, "s1");
    expect(session.messages).toHaveLength(0); // usage 없으니 메트릭 0(불변)
    expect(session.content?.toolUses).toEqual({ Read: 1 });
    expect(session.content?.fileExts).toEqual({ ".md": 1 });
  });

  it("내용 신호가 전혀 없으면 content를 생략한다(usage-only 라인)", () => {
    const content = assistantLine({ ts: "2026-06-02T10:00:00.000Z" });
    const { session } = parseSessionContent(content, "s1");
    expect(session.content).toBeUndefined();
    expect(session.messages).toHaveLength(1); // 메트릭 불변
  });

  it("기존 user 'hi' 라인은 userPrompts:1을 기여하되 메트릭은 불변", () => {
    const content = [
      JSON.stringify({ timestamp: "2026-06-02T10:00:00.000Z", message: { role: "user", content: "hi" } }),
      assistantLine({ ts: "2026-06-02T10:02:00.000Z" }),
    ].join("\n");
    const { session, warnings } = parseSessionContent(content, "s1");
    expect(session.messages).toHaveLength(1);
    expect(warnings).toHaveLength(0);
    expect(session.content?.userPrompts).toBe(1);
  });
});
```

상단 import에 `OTHER` 추가:
```ts
import { isKnownExt, isKnownVerb, OTHER } from "../src/core/content.js";
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- parse`
Expected: 새 4개 FAIL(`session.content` undefined), 기존 7개 PASS.

- [ ] **Step 3: `src/parse/claudeCode.ts` 루프 재구성 + 헬퍼 추가**

상단 import 추가:
```ts
import { isKnownExt, isKnownVerb, OTHER } from "../core/content.js";
import type {
  NormalizedMessage,
  NormalizedSession,
  ParseWarning,
  RawUsage,
  SessionContentDigest,
  TokenTotals,
} from "../types.js";
```
(기존 import 라인에서 `SessionContentDigest` 추가.)

파일 하단(기존 함수들 아래, `parseSessionContent` 위)에 순수 헬퍼 추가:

```ts
const NAV_SKIP = new Set(["cd", "pushd", "popd", "set", "export", "sudo", "env"]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 명령에서 첫 의미 토큰(내비 노이즈 스킵). 원시 토큰 반환 — 호출부가 닫힌 어휘로 분류. */
function firstMeaningfulVerb(command: string): string | null {
  for (const seg of command.split(/&&|;/)) {
    const tok = seg.trim().split(/\s+/)[0];
    if (!tok || NAV_SKIP.has(tok)) continue;
    return tok;
  }
  return null;
}

function emptyDigest(): SessionContentDigest {
  return { userPrompts: 0, toolUses: {}, fileExts: {}, commandVerbs: {} };
}

function digestHasSignal(d: SessionContentDigest): boolean {
  return (
    d.userPrompts > 0 ||
    Object.keys(d.toolUses).length > 0 ||
    Object.keys(d.fileExts).length > 0 ||
    Object.keys(d.commandVerbs).length > 0
  );
}

/** message 1건의 내용을 digest에 누적(닫힌 어휘만 저장). role/usage 가드와 독립. */
function accumulateContent(d: SessionContentDigest, msg: Record<string, unknown>): void {
  const role = msg.role;
  const content = msg.content;

  if (role === "user") {
    if (typeof content === "string") {
      if (content.trim() !== "") d.userPrompts += 1;
    } else if (Array.isArray(content)) {
      if (content.some((it) => isObj(it) && it.type === "text")) d.userPrompts += 1;
    }
    return;
  }

  if (role === "assistant" && Array.isArray(content)) {
    for (const it of content) {
      if (!isObj(it) || it.type !== "tool_use") continue;
      const name = typeof it.name === "string" ? it.name : null;
      if (!name) continue;
      d.toolUses[name] = (d.toolUses[name] ?? 0) + 1;
      const input = it.input;
      if (!isObj(input)) continue;
      const fp = input.file_path ?? input.notebook_path;
      if (typeof fp === "string") {
        const m = /\.[A-Za-z0-9]{1,12}$/.exec(fp);
        if (m) {
          const ext = m[0].toLowerCase();
          const key = isKnownExt(ext) ? ext : OTHER;
          d.fileExts[key] = (d.fileExts[key] ?? 0) + 1;
        }
      }
      if ((name === "Bash" || name === "PowerShell") && typeof input.command === "string") {
        const verb = firstMeaningfulVerb(input.command);
        if (verb) {
          const key = isKnownVerb(verb) ? verb : OTHER;
          d.commandVerbs[key] = (d.commandVerbs[key] ?? 0) + 1;
        }
      }
    }
  }
}
```

`parseSessionContent` 루프를 재구성. 기존 본문에서 `const rec = obj as Record<string, unknown>;` 이후를 다음으로 교체:

```ts
  const digest = emptyDigest();

  // ... (루프 시작 전 messages/warnings 선언은 기존 그대로)
```

루프 내부(`const rec = obj as ...; const message = rec.message; ... const msg = message as Record<string, unknown>;` 직후, 기존 `if (msg.role !== "assistant") continue;` **앞**)에 한 줄 삽입하고, 가드는 그대로 둔다:

```ts
    const msg = message as Record<string, unknown>;

    // 내용 추출 — role/usage 가드 '위'에서(user 프롬프트·usage 없는 tool_use 포착).
    accumulateContent(digest, msg);

    if (msg.role !== "assistant") continue;     // (메트릭) 기존 그대로
    if (msg.usage === undefined) continue;       // (메트릭) 기존 그대로
    // ... 이하 extractTokens/parseTimestamp/messages.push 기존 그대로
```

함수 끝의 return을 교체(세션에 content 조건부 부여):

```ts
  const session: NormalizedSession = { sessionId, projectPath, messages, startTime, endTime };
  if (digestHasSignal(digest)) session.content = digest;

  return { session, warnings };
```

> 주의: `NormalizedSession` 리터럴에 `content`를 넣지 말 것(exactOptionalPropertyTypes). 신호 있을 때만 `session.content = digest` 할당.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- parse` → 11개 PASS. 그다음 `npm run typecheck` 클린.

- [ ] **Step 5: 커밋**

```bash
git add src/parse/claudeCode.ts test/parse.test.ts
git commit -m "feat: extract session content digest in restructured parse loop

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `analyze()` — contentSummary 롤업 (cost-known 격리)

**Files:**
- Modify: `src/core/analysis.ts`
- Test: `test/analysis.test.ts` (증분)

**Interfaces:**
- Consumes: `summarizeContent`, `ContentSummary` (content.ts); `SessionContentDigest` (types.ts)
- Produces: `UsageAnalysis.contentSummary?: ContentSummary` — knownSessions(cost-known)의 `.content`만 롤업.

- [ ] **Step 1: 실패하는 테스트 — `test/analysis.test.ts`에 추가**

기존 파일 끝에 추가(헬퍼는 파일 상단 기존 것 재사용; 없으면 인라인 세션 생성). 세션 생성 헬퍼 예:

```ts
import type { SessionContentDigest } from "../src/types.js";

function sessionWithContent(source: string, content: SessionContentDigest, start = "2026-06-10T01:00:00Z") {
  return {
    sessionId: "x", source, projectPath: "p",
    messages: source === "cursor" ? [] : [{ model: "claude-opus-4-8", timestamp: new Date(start), tokens: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 } }],
    startTime: new Date(start), endTime: new Date(start),
    content,
  };
}

describe("analyze — contentSummary", () => {
  const meta = new Map([
    ["claude-code", { displayName: "Claude Code", providesCost: true }],
    ["cursor", { displayName: "Cursor", providesCost: false }],
  ]);

  it("cost-known 세션의 digest를 contentSummary로 롤업한다", () => {
    const a = analyze([sessionWithContent("claude-code", { userPrompts: 3, toolUses: { Edit: 5 }, fileExts: { ".ts": 5 }, commandVerbs: {} })], {}, meta);
    expect(a.contentSummary?.sessionsWithContent).toBe(1);
    expect(a.contentSummary?.userPrompts).toBe(3);
    expect(a.contentSummary?.activity[0]?.category).toBe("구현");
  });

  it("cost-unknown 세션에 합성 content가 있어도 내용 롤업에서 제외한다(격리 회귀)", () => {
    const a = analyze(
      [
        sessionWithContent("claude-code", { userPrompts: 1, toolUses: { Edit: 1 }, fileExts: {}, commandVerbs: {} }),
        sessionWithContent("cursor", { userPrompts: 99, toolUses: { Bash: 99 }, fileExts: {}, commandVerbs: {} }),
      ],
      {}, meta,
    );
    expect(a.contentSummary?.sessionsWithContent).toBe(1); // cursor 제외
    expect(a.contentSummary?.userPrompts).toBe(1);
    expect(a.contentSummary?.activity.find((x) => x.category === "실행·검증")).toBeUndefined();
  });

  it("content 있는 세션이 없으면 contentSummary는 undefined", () => {
    const a = analyze([sessionWithContent("claude-code", { userPrompts: 0, toolUses: {}, fileExts: {}, commandVerbs: {} })].map((s) => ({ ...s, content: undefined })), {}, meta);
    expect(a.contentSummary).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- analysis` → 새 3개 FAIL.

- [ ] **Step 3: `src/core/analysis.ts` 수정**

import 추가:
```ts
import { summarizeContent, type ContentSummary } from "./content.js";
import type { NormalizedSession, SessionContentDigest, TokenTotals } from "../types.js";
```
(기존 types import에 `SessionContentDigest` 추가.)

`UsageAnalysis` 인터페이스에 한 줄 추가(byTool 아래):
```ts
  /** 세션 내용 요약(Claude Code cost-known만). content 있는 세션 없으면 생략. */
  contentSummary?: ContentSummary;
```

`analyze` 함수에서 `knownSessions` 계산 이후(예: `const overall = aggregate(knownSessions);` 근처)에 추가:
```ts
  const contentDigests = knownSessions
    .map((s) => s.content)
    .filter((c): c is SessionContentDigest => c !== undefined);
  const contentSummary = contentDigests.length > 0 ? summarizeContent(contentDigests) : undefined;
```

함수 마지막 `return { ... byTool };`를 조건부 spread로:
```ts
  return {
    range: { start: rangeStart, end: rangeEnd },
    totals: { sessions: overall.sessionCount, tokens: overall.totals, costUsd: overall.totalCostUsd, durationMs: overall.totalDurationMs },
    byModel,
    byDay,
    byHourKst,
    byProject,
    busiestDay,
    hasUnknownModel: overall.hasUnknownModel,
    pricingVersion: PRICING_TABLE_VERSION,
    byTool,
    ...(contentSummary ? { contentSummary } : {}),
  };
```

- [ ] **Step 4: 테스트 통과 + 무오염 확인**

Run: `npm test -- analysis` → PASS. 그다음 전체 `npm test`로 기존 multisource/격리 회귀 그린 확인. `npm run typecheck` 클린.

- [ ] **Step 5: 커밋**

```bash
git add src/core/analysis.ts test/analysis.test.ts
git commit -m "feat: roll content digest into UsageAnalysis (cost-known only)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `renderAnalysis` — "## 무엇을 했나" 섹션

**Files:**
- Modify: `src/core/render.ts`
- Test: `test/render.test.ts` (증분)

**Interfaces:**
- Consumes: `UsageAnalysis.contentSummary`; `OTHER` (content.ts)
- Produces: 내용 섹션(상세). `sessionsWithContent>0`일 때만.

- [ ] **Step 1: 실패하는 테스트 — `test/render.test.ts`에 추가**

상단 import에 추가: `import { OTHER } from "../src/core/content.js";` (있다면 생략). 그리고 `analysisFixture`를 확장한 변형으로 테스트:

```ts
describe("renderAnalysis 무엇을 했나 섹션", () => {
  function withContent() {
    const a = analysisFixture();
    a.contentSummary = {
      sessionsWithContent: 8, userPrompts: 278, totalToolUses: 1800,
      activity: [
        { category: "구현", count: 880, share: 880 / 1800 },
        { category: "탐색", count: 500, share: 500 / 1800 },
        { category: "실행·검증", count: 420, share: 420 / 1800 },
      ],
      areas: [{ area: "TypeScript", count: 508 }, { area: "문서", count: 240 }],
      commands: [
        { category: "패키지", count: 83, exampleVerbs: ["npm", "pnpm", "npx"] },
        { category: OTHER, count: 12, exampleVerbs: [] },
      ],
    };
    return a;
  }

  it("contentSummary가 있으면 '무엇을 했나' 섹션을 넣는다", () => {
    const out = renderAnalysis(withContent());
    expect(out).toContain("## 무엇을 했나 (세션 내용 기반)");
    expect(out).toContain("구현 49%");
    expect(out).toContain("TypeScript 508");
    expect(out).toContain("패키지(npm·pnpm·npx 83)");
    expect(out).toContain("기타 12"); // 기타는 카운트만, 예시 없음
    expect(out).toContain("사용자 요청 ~278건");
    expect(out).toContain("서브에이전트 내부 작업은 제외");
  });

  it("내용 섹션에 경로 구분자(/ \\)가 없다(프라이버시)", () => {
    const out = renderAnalysis(withContent());
    const section = out.slice(out.indexOf("## 무엇을 했나"));
    expect(section).not.toMatch(/[/\\]/);
  });

  it("contentSummary가 없으면 섹션이 없다", () => {
    expect(renderAnalysis(analysisFixture())).not.toContain("## 무엇을 했나");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npm test -- render` → 새 2개 FAIL.

- [ ] **Step 3: `src/core/render.ts` 수정**

import 추가: `import { OTHER } from "./content.js";`

정수 천단위 헬퍼 추가(`pct` 근처):
```ts
function commaInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
```

`renderAnalysis`에서 작업 성격(situation) 섹션 **앞**에 삽입:
```ts
  // 무엇을 했나(세션 내용) — 결정적, content 있을 때만.
  const cs = a.contentSummary;
  if (cs && cs.sessionsWithContent > 0) {
    lines.push("## 무엇을 했나 (세션 내용 기반)");
    const act = cs.activity.map((x) => `${x.category} ${pct(x.share)}`).join(" · ");
    lines.push(`- 활동: ${act}   (도구 호출 ${commaInt(cs.totalToolUses)}건 기준)`);
    const TOP_AREAS = 6;
    const shownAreas = cs.areas.slice(0, TOP_AREAS);
    const extraAreas = cs.areas.length - shownAreas.length;
    const areaStr = shownAreas.map((x) => `${x.area} ${x.count}`).join(" · ");
    if (areaStr) lines.push(`- 다룬 영역: ${areaStr}${extraAreas > 0 ? ` · 외 ${extraAreas}개` : ""}`);
    const cmdStr = cs.commands
      .map((c) => (c.category === OTHER ? `기타 ${c.count}` : `${c.category}(${c.exampleVerbs.join("·")} ${c.count})`))
      .join(" · ");
    if (cmdStr) lines.push(`- 명령: ${cmdStr}`);
    lines.push(`- 대화 깊이: 사용자 요청 ~${cs.userPrompts}건 · 내용 분석된 세션 ${cs.sessionsWithContent}건`);
    lines.push("ℹ️ tool_use 빈도 기반 휴리스틱(무엇을 했나의 근사). Claude Code 세션만 분석(타 소스 내용 미파악).");
    lines.push("   메인 세션의 서브에이전트 디스패치만 셈 — 서브에이전트 내부 작업은 제외(무거우면 총량 과소).");
    lines.push("");
  }
```

> 주의: 영역 라벨·카테고리 라벨에는 `/`·`\`가 없다(닫힌 어휘). exampleVerbs는 허용목록 동사뿐이라 경로 불가. 테스트가 단언.

- [ ] **Step 4: 테스트 통과** — Run: `npm test -- render` → PASS. `npm run typecheck` 클린.

- [ ] **Step 5: 커밋**

```bash
git add src/core/render.ts test/render.test.ts
git commit -m "feat: render '무엇을 했나' content section in analyze

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `renderPortrait` — "## 무엇에 썼나" 추상화 섹션

**Files:**
- Modify: `src/core/portrait.ts`
- Test: `test/portrait.test.ts` (증분)

**Interfaces:**
- Consumes: `UsageAnalysis.contentSummary`
- Produces: 공유 안전 추상화 섹션(경로·프로젝트명·카운트·기타-예시 無).

- [ ] **Step 1: 실패하는 테스트 — `test/portrait.test.ts`에 추가**

기존 portrait 테스트 파일의 분석 픽스처에 contentSummary를 단 변형으로:

```ts
describe("renderPortrait 무엇에 썼나", () => {
  it("활동·영역을 추상 라벨로만 넣는다(경로·카운트 없음)", () => {
    const a = analysisFixtureForPortrait(); // 기존 파일의 픽스처(sessions>0)
    a.contentSummary = {
      sessionsWithContent: 8, userPrompts: 278, totalToolUses: 1800,
      activity: [
        { category: "구현", count: 880, share: 0.49 },
        { category: "탐색", count: 500, share: 0.28 },
        { category: "실행·검증", count: 420, share: 0.23 },
      ],
      areas: [{ area: "TypeScript", count: 508 }, { area: "Java", count: 187 }, { area: "문서", count: 240 }],
      commands: [],
    };
    const out = renderPortrait(a);
    expect(out).toContain("## 무엇에 썼나");
    expect(out).toContain("구현");
    expect(out).toContain("TypeScript");
    // 추상화: 카운트(508)·경로 구분자 노출 금지(섹션 한정)
    const section = out.slice(out.indexOf("## 무엇에 썼나"), out.indexOf("## 본인 메모"));
    expect(section).not.toContain("508");
    expect(section).not.toMatch(/[/\\]/);
  });
});
```
(픽스처 헬퍼명은 기존 `test/portrait.test.ts`의 것에 맞춘다. 없으면 render.test.ts의 `analysisFixture` 패턴을 복사하되 `byTool` 포함.)

- [ ] **Step 2: 테스트 실패 확인** — Run: `npm test -- portrait` → FAIL.

- [ ] **Step 3: `src/core/portrait.ts` 수정**

`renderPortrait`에서 "## 시간대 패턴" 다음, "## 본인 메모" **앞**에 삽입:

```ts
  const cs = a.contentSummary;
  if (cs && cs.sessionsWithContent > 0 && cs.activity.length > 0) {
    const top = cs.activity.slice(0, 3).map((x) => x.category);
    const first = top[0]!;
    const rest = top.slice(1);
    const acts = rest.length > 0 ? `주로 **${first}**(${rest.join("·")})` : `주로 **${first}**`;
    const topAreas = cs.areas.slice(0, 3).map((x) => x.area).join("·");
    lines.push("## 무엇에 썼나");
    lines.push(`${acts}${topAreas ? `. ${topAreas} 영역에 사용` : ""}.`);
    lines.push("> tool_use 빈도 기반 *서술*이지 평가가 아닙니다.");
    lines.push("");
  }
```

> 카운트·share 수치·경로 비노출 — 카테고리/영역 라벨만. 테스트가 `508` 부재와 `/`·`\` 부재를 단언.

- [ ] **Step 4: 테스트 통과** — Run: `npm test -- portrait` → PASS. `npm run typecheck` 클린.

- [ ] **Step 5: 커밋**

```bash
git add src/core/portrait.ts test/portrait.test.ts
git commit -m "feat: portrait '무엇에 썼나' abstracted content section

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: narrative 사실줄 `[작업내용]` + 내레이터 프롬프트

**Files:**
- Modify: `src/core/narrative.ts`, `src/llm/anthropic.ts`
- Test: `test/narrative.test.ts` (증분)

**Interfaces:**
- Consumes: `UsageAnalysis.contentSummary`; `OTHER` (content.ts)
- Produces: `buildNarrativeContext`가 content 있으면 `[작업내용] …` 줄 추가(카테고리·정수만).

- [ ] **Step 1: 실패하는 테스트 — `test/narrative.test.ts`에 추가**

```ts
import { OTHER } from "../src/core/content.js";

describe("buildNarrativeContext — 작업내용", () => {
  function withContent() {
    const a = /* 기존 분석 픽스처 */ narrativeAnalysisFixture();
    a.contentSummary = {
      sessionsWithContent: 8, userPrompts: 278, totalToolUses: 1000,
      activity: [
        { category: "구현", count: 490, share: 0.49 },
        { category: "탐색", count: 280, share: 0.28 },
        { category: "실행·검증", count: 230, share: 0.23 },
      ],
      areas: [{ area: "TypeScript", count: 5 }, { area: "Java", count: 3 }],
      commands: [{ category: "패키지", count: 5, exampleVerbs: ["npm"] }, { category: OTHER, count: 2, exampleVerbs: [] }],
    };
    return a;
  }

  it("content 있으면 [작업내용] 줄을 카테고리·정수로만 넣는다", () => {
    const ctx = buildNarrativeContext(withContent());
    expect(ctx).toContain("[작업내용]");
    expect(ctx).toContain("구현49%");
    expect(ctx).toContain("요청 278건");
    expect(ctx).not.toMatch(/[/\\]/); // 경로·원시토큰 없음
  });

  it("content 없으면 [작업내용] 줄이 없다", () => {
    expect(buildNarrativeContext(narrativeAnalysisFixture())).not.toContain("[작업내용]");
  });
});
```
(`narrativeAnalysisFixture`는 기존 narrative 테스트의 분석 픽스처에 맞춘다.)

- [ ] **Step 2: 테스트 실패 확인** — Run: `npm test -- narrative` → 새 1개 FAIL(첫 it).

- [ ] **Step 3: `src/core/narrative.ts` 수정**

import 추가: `import { OTHER } from "./content.js";`

`buildNarrativeContext`에서 situation 줄 추가 **앞**(또는 뒤)에 삽입:

```ts
  const cs = a.contentSummary;
  if (cs && cs.sessionsWithContent > 0) {
    const parts: string[] = [];
    const act = cs.activity.map((x) => `${x.category}${Math.round(x.share * 100)}%`).join("·");
    if (act) parts.push(`활동 ${act}`);
    const areas = cs.areas.slice(0, 4).map((x) => x.area).join("·");
    if (areas) parts.push(`영역 ${areas}`);
    const cmds = cs.commands.filter((c) => c.category !== OTHER).map((c) => c.category).join("·");
    if (cmds) parts.push(`명령 ${cmds}`);
    parts.push(`요청 ${cs.userPrompts}건`);
    lines.push(`[작업내용] ${parts.join(" · ")}`);
  }
```

- [ ] **Step 4: `src/llm/anthropic.ts` — NARRATIVE_SYSTEM_PROMPT에 한 줄 추가**

`NARRATIVE_SYSTEM_PROMPT` 배열의 `"- 표는 문서에 남으므로..."` 줄 앞에 추가:

```ts
  "- '작업내용'(활동·영역·명령 카테고리)이 있으면 *근사*로 느슨히 서술하고, 정확한 작업 분해·인과로 단정하지 말 것.",
```

- [ ] **Step 5: 테스트 통과** — Run: `npm test -- narrative` → PASS. `npm run typecheck` 클린.

- [ ] **Step 6: 커밋**

```bash
git add src/core/narrative.ts src/llm/anthropic.ts test/narrative.test.ts
git commit -m "feat: add [작업내용] fact-line to weekly narrative (category-only)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `core/init.ts` — settings 병합·MCP 등록 (순수 헬퍼 + IO DI)

**Files:**
- Create: `src/core/init.ts`
- Test: `test/init.test.ts`

**Interfaces:**
- Consumes: 없음(노드 빌트인만)
- Produces:
  - `isAimmHook(command: string): boolean`
  - `mergeSessionEndHook(settings: unknown, command: string): { settings: Record<string,unknown>; action: "add"|"replace"|"noop" }`
  - `mergeMcpJson(json: unknown, absCliJs: string): Record<string,unknown>`
  - `interface InitIo { homedir():string; cwd():string; now():string; readFile(p:string):string|null; writeFile(p:string,c:string):void; backup(p:string):string; registerMcp(absCliJs:string):boolean }`
  - `interface InitResult { cliJs:string; settingsPath:string; hookAction:"add"|"replace"|"noop"; mcpVia:"claude"|"mcp.json"; mcpJsonPath:string; warnings:string[]; backups:string[] }`
  - `runInit(io: InitIo, moduleUrl: string, opts: { dryRun?: boolean }): InitResult`

- [ ] **Step 1: 실패하는 테스트 — `test/init.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { isAimmHook, mergeSessionEndHook, mergeMcpJson, runInit, type InitIo } from "../src/core/init.js";

const MODULE_URL = "file:///repo/dist/core/init.js"; // → cli.js = /repo/dist/cli.js

function fakeIo(files: Record<string, string>, claudeOk = false): InitIo & { files: Record<string, string> } {
  const f = { ...files };
  return {
    files: f,
    homedir: () => "/home/u",
    cwd: () => "/work",
    now: () => "20260622",
    readFile: (p) => (p in f ? f[p]! : null),
    writeFile: (p, c) => { f[p] = c; },
    backup: (p) => { const b = `${p}.aimm-bak-20260622`; f[b] = f[p]!; return b; },
    registerMcp: () => claudeOk,
  };
}

describe("isAimmHook", () => {
  it("cli.js ... hook 패턴을 인식(경로 무관)", () => {
    expect(isAimmHook('node "/a/b/dist/cli.js" hook')).toBe(true);
    expect(isAimmHook("node /x/cli.js hook")).toBe(true);
    expect(isAimmHook("node /x/cli.js mcp")).toBe(false);
    expect(isAimmHook("some-other-tool run")).toBe(false);
  });
});

describe("mergeSessionEndHook", () => {
  it("없으면 add", () => {
    const r = mergeSessionEndHook({}, 'node "/r/dist/cli.js" hook');
    expect(r.action).toBe("add");
    expect((r.settings.hooks as any).SessionEnd[0].hooks[0].command).toContain("hook");
  });
  it("같은 명령이면 noop", () => {
    const cmd = 'node "/r/dist/cli.js" hook';
    const base = mergeSessionEndHook({}, cmd).settings;
    expect(mergeSessionEndHook(base, cmd).action).toBe("noop");
  });
  it("경로만 바뀌면 replace(중복 append 안 함)", () => {
    const base = mergeSessionEndHook({}, 'node "/old/dist/cli.js" hook').settings;
    const r = mergeSessionEndHook(base, 'node "/new/dist/cli.js" hook');
    expect(r.action).toBe("replace");
    expect((r.settings.hooks as any).SessionEnd).toHaveLength(1);
    expect((r.settings.hooks as any).SessionEnd[0].hooks[0].command).toContain("/new/");
  });
  it("기존 비-aimm hook을 보존한다", () => {
    const base = { hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "other thing" }] }] } };
    const r = mergeSessionEndHook(base, 'node "/r/dist/cli.js" hook');
    expect((r.settings.hooks as any).SessionEnd).toHaveLength(2);
  });
});

describe("runInit", () => {
  it("새 settings 생성 + claude 성공 시 .mcp.json 미생성", () => {
    const io = fakeIo({}, true);
    const r = runInit(io, MODULE_URL, {});
    expect(r.cliJs).toBe("/repo/dist/cli.js");
    expect(r.hookAction).toBe("add");
    expect(r.mcpVia).toBe("claude");
    expect("/home/u/.claude/settings.json" in io.files).toBe(true);
    expect("/work/.mcp.json" in io.files).toBe(false);
  });

  it("claude 실패 시 .mcp.json 폴백", () => {
    const io = fakeIo({}, false);
    const r = runInit(io, MODULE_URL, {});
    expect(r.mcpVia).toBe("mcp.json");
    expect(JSON.parse(io.files["/work/.mcp.json"]!).mcpServers.aimm.args).toEqual(["/repo/dist/cli.js", "mcp"]);
  });

  it("dry-run은 아무것도 쓰지 않는다", () => {
    const io = fakeIo({}, true);
    const before = Object.keys(io.files).length;
    runInit(io, MODULE_URL, { dryRun: true });
    expect(Object.keys(io.files).length).toBe(before);
  });

  it("기존 settings 수정 시 백업을 만든다", () => {
    const io = fakeIo({ "/home/u/.claude/settings.json": "{}" }, true);
    const r = runInit(io, MODULE_URL, {});
    expect(r.backups.length).toBeGreaterThan(0);
    expect(`/home/u/.claude/settings.json.aimm-bak-20260622` in io.files).toBe(true);
  });

  it("재실행은 멱등(중복 hook 없음)", () => {
    const io = fakeIo({}, true);
    runInit(io, MODULE_URL, {});
    runInit(io, MODULE_URL, {});
    const s = JSON.parse(io.files["/home/u/.claude/settings.json"]!);
    expect(s.hooks.SessionEnd).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npm test -- init` → FAIL(모듈 없음).

- [ ] **Step 3: `src/core/init.ts` 구현**

```ts
/**
 * aimm init — SessionEnd hook · MCP 자동 등록(원커맨드 셋업).
 *
 * 안전: 안정 센티넬(cli.js … hook) 기반 멱등(경로 바뀌어도 교체, 중복 없음),
 * 우리 키만 딥머지, 타임스탬프 백업, IO는 주입(테스트가 바이너리/디스크 비의존).
 * 순수 헬퍼(merge*)는 부수효과 없음 → 단위 테스트.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** SessionEnd hook 커맨드가 aimm 것인가 — 절대경로 아닌 안정 마커(cli.js … hook)로 판정. */
const HOOK_MARKER = /(?:^|[\\/])cli\.js["']?\s+hook(?:\s|$)/;
export function isAimmHook(command: string): boolean {
  return HOOK_MARKER.test(command);
}

function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? deepCopy(v as Record<string, unknown>) : {};
}

interface HookGroup { hooks?: Array<{ type?: string; command?: string }>; }

export function mergeSessionEndHook(
  settings: unknown,
  command: string,
): { settings: Record<string, unknown>; action: "add" | "replace" | "noop" } {
  const s = asObj(settings);
  const hooks = (s.hooks = asObj(s.hooks));
  const list = (Array.isArray(hooks.SessionEnd) ? hooks.SessionEnd : (hooks.SessionEnd = [])) as HookGroup[];
  for (const group of list) {
    if (!group || !Array.isArray(group.hooks)) continue;
    for (const h of group.hooks) {
      if (h && h.type === "command" && typeof h.command === "string" && isAimmHook(h.command)) {
        if (h.command === command) return { settings: s, action: "noop" };
        h.command = command;
        return { settings: s, action: "replace" };
      }
    }
  }
  list.push({ hooks: [{ type: "command", command }] });
  return { settings: s, action: "add" };
}

export function mergeMcpJson(json: unknown, absCliJs: string): Record<string, unknown> {
  const j = asObj(json);
  const servers = (j.mcpServers = asObj(j.mcpServers));
  servers.aimm = { command: "node", args: [absCliJs, "mcp"] };
  return j;
}

export interface InitIo {
  homedir(): string;
  cwd(): string;
  now(): string;
  readFile(path: string): string | null;
  writeFile(path: string, content: string): void;
  backup(path: string): string;
  registerMcp(absCliJs: string): boolean;
}

export interface InitResult {
  cliJs: string;
  settingsPath: string;
  hookAction: "add" | "replace" | "noop";
  mcpVia: "claude" | "mcp.json";
  mcpJsonPath: string;
  warnings: string[];
  backups: string[];
}

/** init.js(dist/core/) 기준 형제 dist/cli.js 해석. */
function resolveCliJs(moduleUrl: string): { path: string; warning?: string } {
  const here = fileURLToPath(moduleUrl);
  const cliJs = join(dirname(here), "..", "cli.js");
  if (/[\\/]src[\\/]/.test(here) || here.endsWith(".ts")) {
    return { path: cliJs, warning: "빌드된 dist에서 실행하세요(node dist/cli.js init). src/tsx 실행은 등록 경로가 부정확합니다." };
  }
  return { path: cliJs };
}

export function runInit(io: InitIo, moduleUrl: string, opts: { dryRun?: boolean } = {}): InitResult {
  const { path: cliJs, warning } = resolveCliJs(moduleUrl);
  const warnings = warning ? [warning] : [];
  const backups: string[] = [];

  const settingsPath = join(io.homedir(), ".claude", "settings.json");
  const raw = io.readFile(settingsPath);
  const command = `node ${JSON.stringify(cliJs)} hook`;
  const { settings: merged, action } = mergeSessionEndHook(raw ? JSON.parse(raw) : {}, command);

  const mcpJsonPath = join(io.cwd(), ".mcp.json");

  if (opts.dryRun) {
    return { cliJs, settingsPath, hookAction: action, mcpVia: "claude", mcpJsonPath, warnings, backups };
  }

  if (action !== "noop") {
    if (raw !== null) backups.push(io.backup(settingsPath));
    io.writeFile(settingsPath, JSON.stringify(merged, null, 2) + "\n");
  }

  let mcpVia: "claude" | "mcp.json" = "claude";
  if (!io.registerMcp(cliJs)) {
    mcpVia = "mcp.json";
    const existing = io.readFile(mcpJsonPath);
    if (existing !== null) backups.push(io.backup(mcpJsonPath));
    io.writeFile(mcpJsonPath, JSON.stringify(mergeMcpJson(existing ? JSON.parse(existing) : {}, cliJs), null, 2) + "\n");
  }

  return { cliJs, settingsPath, hookAction: action, mcpVia, mcpJsonPath, warnings, backups };
}
```

- [ ] **Step 4: 테스트 통과** — Run: `npm test -- init` → PASS. `npm run typecheck` 클린.

- [ ] **Step 5: 커밋**

```bash
git add src/core/init.ts test/init.test.ts
git commit -m "feat: aimm init core — sentinel-idempotent settings/MCP merge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: CLI `init` 명령 (실 IO 결선)

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `runInit`, `InitIo` (init.ts)
- Produces: `aimm init [--dry-run]` 명령 + usage 항목

- [ ] **Step 1: `src/cli.ts`에 cmdInit 추가**

상단 import:
```ts
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { runInit, type InitIo } from "./core/init.js";
```

함수 추가(다른 cmd* 옆):
```ts
function trySpawnClaude(absCliJs: string): boolean {
  try {
    const r = spawnSync("claude", ["mcp", "add", "aimm", "--scope", "user", "--", "node", absCliJs, "mcp"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
      encoding: "utf-8",
      shell: process.platform === "win32",
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

async function cmdInit(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const dryRun = flags["dry-run"] !== undefined;
  const io: InitIo = {
    homedir: () => homedir(),
    cwd: () => process.cwd(),
    now: () => new Date().toISOString().replace(/[:.]/g, "-"),
    readFile: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
    writeFile: (p, c) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, c);
    },
    backup: (p) => {
      const b = `${p}.aimm-bak-${io.now()}`;
      copyFileSync(p, b);
      return b;
    },
    registerMcp: (abs) => trySpawnClaude(abs),
  };

  const r = runInit(io, import.meta.url, { dryRun });
  const out: string[] = [];
  out.push(dryRun ? "[dry-run] aimm init — 변경 예정:" : "aimm init 완료:");
  out.push(`  CLI: ${r.cliJs}`);
  out.push(`  SessionEnd hook: ${r.hookAction} → ${r.settingsPath}`);
  out.push(`  MCP 등록: ${r.mcpVia === "claude" ? "claude mcp add --scope user" : `.mcp.json (${r.mcpJsonPath})`}`);
  if (r.mcpVia === "mcp.json") {
    out.push(`  ↳ 전역 등록을 원하면: claude mcp add aimm --scope user -- node ${JSON.stringify(r.cliJs)} mcp`);
  }
  for (const w of r.warnings) out.push(`  ⚠️ ${w}`);
  if (r.backups.length > 0) out.push(`  백업: ${r.backups.join(", ")}`);
  if (!dryRun) {
    out.push("  복구: 위 백업을 원위치로 복사 + `claude mcp remove aimm` + .mcp.json의 aimm 항목 제거.");
    out.push("  다음: Claude Code를 재시작하면 SessionEnd 초안·MCP 도구가 활성화됩니다.");
  }
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}
```

`usage()` 텍스트에 한 줄 추가(`aimm mcp` 위):
```ts
      "  aimm init [--dry-run]                     SessionEnd hook·MCP 자동 등록(원커맨드 셋업)",
```

`main()`의 switch에 케이스 추가:
```ts
    case "init":
      return cmdInit(rest);
```

- [ ] **Step 2: 빌드 + dry-run 스모크 검증**

Run:
```bash
npm run build && node dist/cli.js init --dry-run
```
Expected: `[dry-run] aimm init — 변경 예정:` + CLI 경로가 `.../dist/cli.js`로 끝나고 hook action 출력. 디스크 변경 없음(dry-run).

- [ ] **Step 3: 커밋**

```bash
git add src/cli.ts
git commit -m "feat: aimm init CLI command (claude mcp add + .mcp.json fallback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: MCP analyze 도구 내용 노출 확인 + 문서/릴리스

**Files:**
- Modify: `package.json` (version 0.6.0), `CHANGELOG.md`, `README.md`, `ROADMAP.md`(선택)
- Create: `docs/releases/v0.6.0-session-content-summary.md`
- Modify: 메모리 `MEMORY.md` + 항목 파일

**Interfaces:** 없음(문서·버전)

- [ ] **Step 1: MCP analyze가 내용 섹션을 전송 없이 노출하는지 회귀 확인**

`src/mcp/server.ts`는 무변경(이미 `renderAnalysis(analysis, args.author)` 호출). 확인용 임시 점검:
Run: `npm run build && node dist/cli.js analyze --start 2026-06-01 --end 2026-06-30 2>/dev/null | grep -A1 "무엇을 했나" | head -3`
Expected: 실데이터가 있으면 "## 무엇을 했나" 섹션 출력(없으면 섹션 생략 — 정상). 외부 전송 없음.

- [ ] **Step 2: package.json version → 0.6.0**

```json
  "version": "0.6.0",
```

- [ ] **Step 3: 릴리스 노트 작성 — `docs/releases/v0.6.0-session-content-summary.md`**

(템플릿은 `docs/releases/v0.5.0-cursor-multisource.md` 형식: 한 줄 요약 / 무엇이 바뀌었나 / 출력 before-after / 검증 / AI 사용 메타(도그푸딩) / 알려진 한계 / 다음. 이번 작업 세션 내용 — 브레인스토밍→적대 spec 리뷰(blocker 5)→TDD 구현→설치 하드닝 — 을 충실히 기록.)

- [ ] **Step 4: CHANGELOG.md 최상단에 0.6.0 항목 추가** (0.5.0 위에, Keep-a-Changelog 형식, 릴리스 노트 링크).

- [ ] **Step 5: README 갱신** — "## 상태 & 로드맵" 완료 목록에 "세션 내용 요약(analyze/portrait/narrative)"·"`aimm init`" 추가. "## 프로젝트 구조"에 `core/content.ts`·`core/init.ts` 추가. "Claude Code 연동"에 `node dist/cli.js init` 안내.

- [ ] **Step 6: 메모리 갱신** — `MEMORY.md`의 aimm 라인에 v0.6.0(세션 내용 요약 + prepare 빌드훅 + aimm init, 적대 리뷰 blocker 5 반영) 추가; `aimm-poc-decisions.md` 본문도 동일 갱신.

- [ ] **Step 7: 커밋**

```bash
git add package.json CHANGELOG.md README.md ROADMAP.md docs/releases/v0.6.0-session-content-summary.md
git commit -m "docs: v0.6.0 release note + CHANGELOG/README (session content summary, aimm init)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
(메모리 파일은 git 외부 — 별도 Write로 갱신.)

---

### Task 11: 최종 검증 + 적대적 코드 리뷰

**Files:** 없음(검증)

- [ ] **Step 1: 전체 스위트 + 타입 + 빌드**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck 클린, 전체 테스트 그린(기존 146 + 신규 ~22 = ~168), 빌드 클린.

- [ ] **Step 2: 클린 클론 설치 재검증(Task 1 회귀)**

Run:
```bash
rm -rf /tmp/aimm-clone && git clone -q "$(pwd)" /tmp/aimm-clone && (cd /tmp/aimm-clone && npm install --silent 2>/dev/null && node dist/cli.js init --dry-run | head -4); echo "EXIT=$?"
```
Expected: 빌드된 dist에서 `init --dry-run`이 정상 출력, `EXIT=0`.

- [ ] **Step 3: 적대적 코드 리뷰(Workflow) — 프라이버시·정합·격리**

구현 diff에 대해 3 리뷰어 병렬(프라이버시 누출/원시토큰, 메트릭·무오염 회귀, 정렬 결정성·엣지)로 점검 → blocker 있으면 수정 후 재검증.

- [ ] **Step 4: push 전 사용자 컨펌 요청**

전체 커밋 목록·테스트 결과 요약을 제시하고 **push 승인**을 받는다(프로젝트 규칙: 올리기 전 컨펌).

---

## Self-Review (작성자 점검)

- **Spec coverage:** Part 1(파서→content.ts→analysis→render/portrait/narrative) = Task 2~7; Part 2(prepare/aimm init) = Task 1·8·9; 문서·검증 = Task 10·11. 모든 spec 섹션에 대응 태스크 존재. ✓
- **Placeholder scan:** 코드 스텝은 실제 코드 포함. 릴리스 노트(Task 10 Step 3)·포트레이트 픽스처명은 "기존 파일에 맞춤"으로 명시(해당 파일 구조 따름). ✓
- **Type consistency:** `SessionContentDigest`(types.ts), `ContentSummary`/`summarizeContent`/`isKnownExt`/`isKnownVerb`/`OTHER`(content.ts), `UsageAnalysis.contentSummary`(analysis.ts), `runInit`/`mergeSessionEndHook`/`mergeMcpJson`/`InitIo`(init.ts) — 태스크 간 동일 시그니처 사용. ✓
- **적대 리뷰 blocker 반영:** 루프 hoist(Task 3 Step 3), commandVerbs 닫힌어휘(Task 3 accumulateContent + isKnownVerb), 렌더 예시 안전(Task 5/6 테스트), exactOptional 생략(Task 3 Step 3 주의), init 센티넬 멱등(Task 8). ✓
