import { describe, expect, it } from "vitest";
import { parseSessionContent } from "../src/parse/claudeCode.js";
import { OTHER } from "../src/core/content.js";

/** 실측 구조(2026-06-10)를 본뜬 정상 assistant 라인 1개. */
function assistantLine(opts: {
  ts: string;
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheCreation?: number;
}): string {
  const usage: Record<string, number> = {
    input_tokens: opts.input ?? 100,
    output_tokens: opts.output ?? 50,
  };
  if (opts.cacheRead !== undefined) usage.cache_read_input_tokens = opts.cacheRead;
  if (opts.cacheCreation !== undefined) usage.cache_creation_input_tokens = opts.cacheCreation;
  return JSON.stringify({
    timestamp: opts.ts,
    sessionId: "s1",
    message: { role: "assistant", model: opts.model ?? "claude-opus-4-8", usage },
  });
}

describe("parseSessionContent", () => {
  it("정상 assistant 라인을 파싱하고 토큰·모델·UTC 타임스탬프를 추출한다", () => {
    const content = assistantLine({ ts: "2026-06-02T12:58:24.798Z", input: 12517, output: 234, cacheRead: 27518, cacheCreation: 2801 });
    const { session, warnings } = parseSessionContent(content, "s1");
    expect(warnings).toHaveLength(0);
    expect(session.messages).toHaveLength(1);
    const m = session.messages[0]!;
    expect(m.model).toBe("claude-opus-4-8");
    expect(m.tokens).toEqual({ input: 12517, output: 234, cacheRead: 27518, cacheCreation: 2801 });
    expect(m.timestamp.toISOString()).toBe("2026-06-02T12:58:24.798Z");
  });

  it("깨진 JSON 라인은 abort 없이 skip하고 warning을 남긴다", () => {
    const content = [
      assistantLine({ ts: "2026-06-02T10:00:00.000Z" }),
      "{ this is not valid json",
      assistantLine({ ts: "2026-06-02T11:00:00.000Z" }),
    ].join("\n");
    const { session, warnings } = parseSessionContent(content, "s1");
    expect(session.messages).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.line).toBe(2);
  });

  it("assistant가 아니거나 usage 없는 라인은 조용히 무시한다(경고 아님)", () => {
    const content = [
      JSON.stringify({ timestamp: "2026-06-02T10:00:00.000Z", message: { role: "user", content: "hi" } }),
      JSON.stringify({ timestamp: "2026-06-02T10:01:00.000Z", message: { role: "assistant", model: "claude-opus-4-8" } }),
      assistantLine({ ts: "2026-06-02T10:02:00.000Z" }),
    ].join("\n");
    const { session, warnings } = parseSessionContent(content, "s1");
    expect(session.messages).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  it("usage 필드가 비정상(숫자 아님)이면 0으로 강제하지 않고 skip+warning", () => {
    const bad = JSON.stringify({
      timestamp: "2026-06-02T10:00:00.000Z",
      message: { role: "assistant", model: "claude-opus-4-8", usage: { input_tokens: "lots", output_tokens: 5 } },
    });
    const { session, warnings } = parseSessionContent(bad, "s1");
    expect(session.messages).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it("캐시 필드가 없는 옛 로그는 캐시 토큰을 0으로 채운다", () => {
    const content = assistantLine({ ts: "2026-06-02T10:00:00.000Z", input: 10, output: 20 });
    const { session } = parseSessionContent(content, "s1");
    expect(session.messages[0]!.tokens.cacheRead).toBe(0);
    expect(session.messages[0]!.tokens.cacheCreation).toBe(0);
  });

  it("start/end time은 메시지 타임스탬프의 최소/최대다", () => {
    const content = [
      assistantLine({ ts: "2026-06-02T12:00:00.000Z" }),
      assistantLine({ ts: "2026-06-02T09:00:00.000Z" }),
      assistantLine({ ts: "2026-06-02T15:30:00.000Z" }),
    ].join("\n");
    const { session } = parseSessionContent(content, "s1");
    expect(session.startTime?.toISOString()).toBe("2026-06-02T09:00:00.000Z");
    expect(session.endTime?.toISOString()).toBe("2026-06-02T15:30:00.000Z");
  });

  it("빈 입력/공백 라인은 메시지 0개, 경고 0개", () => {
    const { session, warnings } = parseSessionContent("\n   \n\n", "s1");
    expect(session.messages).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(session.startTime).toBeUndefined();
  });
});

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
    expect(c.commandVerbs).toEqual({ git: 1, [OTHER]: 1 }); // cd 스킵→git; ./secret/deploy.sh→기타(원시 미저장)
    expect(JSON.stringify(c)).not.toContain("/home");
    expect(JSON.stringify(c)).not.toContain("deploy.sh");
  });

  it("usage 없는 assistant의 tool_use도 카운트한다(메트릭과 독립)", () => {
    const content = assistantTools(
      "2026-06-02T10:00:00.000Z",
      [{ type: "tool_use", name: "Read", input: { file_path: "x.md" } }],
      false,
    );
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

  it("file_path/command 외 input 필드(path·pattern·url)는 다이제스트에 안 들어간다(누출 방지 회귀)", () => {
    const content = assistantTools("2026-06-02T10:00:00.000Z", [
      { type: "tool_use", name: "Grep", input: { pattern: "/secret/leak", path: "/home/u/private" } },
      { type: "tool_use", name: "WebFetch", input: { url: "https://example.com/token.txt" } },
    ]);
    const { session } = parseSessionContent(content, "s1");
    const c = session.content!;
    expect(c.toolUses).toEqual({ Grep: 1, WebFetch: 1 }); // 도구명만(닫힌 어휘)
    expect(c.fileExts).toEqual({}); // path/pattern은 읽지 않음 — .txt는 url이지 file_path 아님
    expect(c.commandVerbs).toEqual({});
    const s = JSON.stringify(c);
    expect(s).not.toContain("/secret");
    expect(s).not.toContain("example.com");
    expect(s).not.toMatch(/[/\\]/);
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
