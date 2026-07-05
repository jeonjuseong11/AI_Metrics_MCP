import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractIntent, collectIntents, buildIntentContext, prepareIntentSend } from "../src/core/intent.js";

function jsonl(lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

const asstUsage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function session(ts: string): string {
  return jsonl([
    { timestamp: ts, message: { role: "user", content: "거울 만들어줘" } },
    { timestamp: ts, message: { role: "assistant", model: "claude-opus-4-8", usage: asstUsage, content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/a.ts" } }] } },
    { timestamp: ts, message: { role: "user", content: [{ type: "text", text: "테스트 추가" }] } },
    { timestamp: ts, message: { role: "assistant", model: "claude-opus-4-8", usage: asstUsage, content: [{ type: "tool_use", name: "NotebookEdit", input: { notebook_path: "nb.ipynb" } }] } },
  ]);
}

describe("extractIntent", () => {
  it("user 프롬프트(문자열·배열) + tool_use 파일경로 + startTime을 뽑는다", () => {
    const ex = extractIntent(session("2026-07-04T02:00:00Z"));
    expect(ex.prompts).toEqual(["거울 만들어줘", "테스트 추가"]);
    expect(ex.files.sort()).toEqual(["a.ts", "nb.ipynb"]); // basename만(경로 제거)
    expect(ex.startTime?.toISOString()).toBe("2026-07-04T02:00:00.000Z");
  });

  it("절대경로는 basename만 남긴다(머신 구조 노출 제거)", () => {
    const ex = extractIntent(jsonl([
      { timestamp: "2026-07-04T02:00:00Z", message: { role: "assistant", model: "m", usage: asstUsage, content: [{ type: "tool_use", name: "Edit", input: { file_path: "C:\\Users\\jeonj\\.claude\\skills\\x\\render.ts" } }] } },
    ]));
    expect(ex.files).toEqual(["render.ts"]);
  });

  it("시스템·스킬 주입 user 메시지는 노이즈로 필터한다", () => {
    const ex = extractIntent(jsonl([
      { timestamp: "2026-07-04T02:00:00Z", message: { role: "user", content: "진짜 요청" } },
      { timestamp: "2026-07-04T02:00:00Z", message: { role: "user", content: "<command-message>office-hours</command-message>" } },
      { timestamp: "2026-07-04T02:00:00Z", message: { role: "user", content: "Base directory for this skill: /x" } },
      { timestamp: "2026-07-04T02:00:00Z", message: { role: "user", content: "<task-notification> done" } },
      { timestamp: "2026-07-04T02:00:00Z", message: { role: "user", content: "Review this change for security vulnerabilities. …" } },
      { timestamp: "2026-07-04T02:00:00Z", message: { role: "user", content: "=== DIFF: src/a.ts" } },
    ]));
    expect(ex.prompts).toEqual(["진짜 요청"]);
  });

  it("usage 있는 assistant 레코드 없으면 startTime 없음", () => {
    const ex = extractIntent(jsonl([{ timestamp: "2026-07-04T02:00:00Z", message: { role: "user", content: "hi" } }]));
    expect(ex.startTime).toBeUndefined();
    expect(ex.prompts).toEqual(["hi"]);
  });

  it("깨진 JSON 라인은 스킵(throw 안 함)", () => {
    const ex = extractIntent('{"message":{"role":"user","content":"ok"}}\n{깨짐\n');
    expect(ex.prompts).toEqual(["ok"]);
  });
});

describe("collectIntents — KST 창 필터", () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "aimm-intent-")); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("창 안 세션만 모으고 밖은 제외", async () => {
    const inWin = join(dir, "in.jsonl");
    const outWin = join(dir, "out.jsonl");
    writeFileSync(inWin, session("2026-07-04T02:00:00Z")); // KST 2026-07-04
    writeFileSync(outWin, session("2026-01-01T02:00:00Z")); // KST 2026-01-01
    const r = await collectIntents([inWin, outWin], { start: "2026-07-01", end: "2026-07-05" });
    expect(r.prompts).toContain("거울 만들어줘");
    expect(r.files).toContain("a.ts"); // basename
    // 창 밖 세션의 내용은 없음(같은 프롬프트지만 2개 세션이면 4개일 것 → 창 필터로 2개 프롬프트)
    expect(r.prompts.length).toBe(2);
  });

  it("읽기 실패·startTime 없는 세션은 스킵", async () => {
    const noTime = join(dir, "notime.jsonl");
    writeFileSync(noTime, jsonl([{ timestamp: "2026-07-04T02:00:00Z", message: { role: "user", content: "x" } }]));
    const r = await collectIntents([noTime, "/does/not/exist.jsonl"], {});
    expect(r.prompts).toEqual([]); // startTime 없어 창 판정 불가 → 스킵
  });
});

describe("buildIntentContext + prepareIntentSend", () => {
  it("[요청]·[다룬 파일] 블록으로 조립", () => {
    const ctx = buildIntentContext({ prompts: ["거울 만들기", "today 추가"], files: ["a.ts", "b.md"] });
    expect(ctx).toContain("[요청]");
    expect(ctx).toContain("- 거울 만들기");
    expect(ctx).toContain("[다룬 파일]");
    expect(ctx).toContain("a.ts · b.md");
  });

  it("프롬프트 상한(60)·파일 상한(80)·프롬프트 길이(300자) 적용", () => {
    const prompts = Array.from({ length: 100 }, (_, i) => `p${i}`);
    const files = Array.from({ length: 100 }, (_, i) => `f${i}.ts`);
    const long = "가".repeat(500);
    const ctx = buildIntentContext({ prompts: [long, ...prompts], files });
    expect(ctx).toContain("…"); // 긴 프롬프트 절단
    expect((ctx.match(/- /g) ?? []).length).toBeLessThanOrEqual(60); // 요청 상한
    expect(ctx).not.toContain("f80.ts"); // 파일 상한(0~79만)
  });

  it("prepareIntentSend는 비밀을 마스킹한다(fail-closed 경계)", () => {
    const { masked, redactions } = prepareIntentSend({ prompts: ["이 키 써: AKIAIOSFODNN7EXAMPLE"], files: [] });
    expect(masked).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(redactions.map((r) => r.ruleId)).toContain("aws-access-key-id");
  });
});
