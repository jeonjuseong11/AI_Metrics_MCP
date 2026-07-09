import { describe, expect, it } from "vitest";
import { buildCliPrompt, createClaudeCliMemoirNarrator } from "../src/llm/claudeCli.js";

describe("claudeCli", () => {
  it("buildCliPrompt은 시스템 프롬프트 + 프레임을 두 줄 띄워 합친다", () => {
    const p = buildCliPrompt("SYS", "CTX");
    expect(p).toBe("SYS\n\nCTX");
  });

  it("팩토리는 Summarizer(함수)를 만든다", () => {
    expect(typeof createClaudeCliMemoirNarrator()).toBe("function");
  });
});
