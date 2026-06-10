import { describe, expect, it } from "vitest";
import { parseSessionContent } from "../src/parse/claudeCode.js";

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
